import type Database from "better-sqlite3"
import type { WazzupMessage } from "../types"
import { db } from "../connection"
import { mapWazzupMessage } from "../mappers"
import { clean } from "../form-parsers"

const DEFAULT_FEED_LIMIT = 200
const MAX_FEED_LIMIT = 500

// Идентичность чата сделки. Ленту запрашиваем И по deal_id, И по (chat_type, chat_id), чтобы
// захватить эхо/входящие до привязки к сделке и строки без deal_id.
export type WazzupChatIdentity = {
  dealId: number | null
  chatType: string
  chatId: string
}

export type OutboundWazzupMessageInput = {
  messageId: string
  crmMessageId: string
  dealId: number | null
  customerId: number | null
  channelId: string
  chatType: string
  chatId: string
  messageType: string
  text?: string | null
  contentUri?: string | null
  authorName?: string | null
  quotedMessageId?: string | null
  quotedText?: string | null
  dateTime: string
}

// Записывает НАШЕ исходящее сообщение в единую ленту wazzup_messages. Ключ дедупликации — Wazzup
// messageId (он же приходит обратно в эхо-вебхуке), поэтому ON CONFLICT(message_id) корректно
// обрабатывает гонку: если эхо успело вставить строку раньше ответа на POST /v3/message, мы лишь
// дополняем её нашими полями (crm_message_id/author/deal) и НЕ понижаем уже пришедший статус
// (delivered/read → sent) и не затираем текст/контент. Если первой пришла наша строка — эхо потом
// отсечётся по INSERT OR IGNORE в processMessages.
export function upsertOutboundWazzupMessage(
  input: OutboundWazzupMessageInput,
  client: Database.Database = db()
) {
  const text = clean(input.text ?? "") || null
  const contentUri = clean(input.contentUri ?? "") || null
  const dateTime = clean(input.dateTime) || null

  client
    .prepare(
      `INSERT INTO wazzup_messages (
        message_id, crm_message_id, deal_id, customer_id, channel_id, chat_type, chat_id,
        direction, message_type, text, content_uri, status, is_echo, author_name,
        quoted_message_id, quoted_text, date_time, raw_payload, created_at, updated_at
      ) VALUES (
        @messageId, @crmMessageId, @dealId, @customerId, @channelId, @chatType, @chatId,
        'outbound', @messageType, @text, @contentUri, 'sent', 1, @authorName,
        @quotedMessageId, @quotedText, @dateTime, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT(message_id) DO UPDATE SET
        crm_message_id = COALESCE(NULLIF(wazzup_messages.crm_message_id, ''), excluded.crm_message_id),
        deal_id = COALESCE(wazzup_messages.deal_id, excluded.deal_id),
        customer_id = COALESCE(wazzup_messages.customer_id, excluded.customer_id),
        channel_id = COALESCE(NULLIF(wazzup_messages.channel_id, ''), excluded.channel_id),
        author_name = COALESCE(NULLIF(wazzup_messages.author_name, ''), excluded.author_name),
        text = COALESCE(wazzup_messages.text, excluded.text),
        content_uri = COALESCE(wazzup_messages.content_uri, excluded.content_uri),
        quoted_message_id = COALESCE(NULLIF(wazzup_messages.quoted_message_id, ''), excluded.quoted_message_id),
        quoted_text = COALESCE(NULLIF(wazzup_messages.quoted_text, ''), excluded.quoted_text),
        updated_at = CURRENT_TIMESTAMP`
    )
    .run({
      messageId: clean(input.messageId),
      crmMessageId: clean(input.crmMessageId) || null,
      dealId: input.dealId ?? null,
      customerId: input.customerId ?? null,
      channelId: clean(input.channelId) || null,
      chatType: clean(input.chatType) || null,
      chatId: clean(input.chatId) || null,
      messageType: clean(input.messageType) || "text",
      text,
      contentUri,
      authorName: clean(input.authorName ?? "") || null,
      quotedMessageId: clean(input.quotedMessageId ?? "") || null,
      quotedText: clean(input.quotedText ?? "") || null,
      dateTime,
    })

  // Обновляем «последнее сообщение» сделки — как для входящих, чтобы канбан сортировался по нему.
  if (input.dealId) {
    const preview = text ? text.slice(0, 500) : clean(input.messageType) ? `[${clean(input.messageType)}]` : ""
    client
      .prepare(
        `UPDATE deals
         SET last_message_text = @preview,
          last_message_at = COALESCE(NULLIF(@dateTime, ''), last_message_at),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @dealId`
      )
      .run({ dealId: input.dealId, preview, dateTime: dateTime ?? "" })
  }
}

export function listWazzupChatMessages(
  identity: WazzupChatIdentity,
  options: { limit?: number } = {}
): WazzupMessage[] {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? DEFAULT_FEED_LIMIT), MAX_FEED_LIMIT))
  const params = {
    dealId: identity.dealId ?? null,
    chatType: clean(identity.chatType),
    chatId: clean(identity.chatId),
    limit,
  }

  // Берём последние `limit` строк (DESC) и разворачиваем по возрастанию для отображения.
  const rows = db()
    .prepare(
      `SELECT * FROM (
        SELECT * FROM wazzup_messages
        WHERE (@dealId IS NOT NULL AND deal_id = @dealId)
           OR (@chatType <> '' AND @chatId <> '' AND chat_type = @chatType AND chat_id = @chatId)
        ORDER BY COALESCE(date_time, created_at) DESC, id DESC
        LIMIT @limit
      ) ORDER BY COALESCE(date_time, created_at) ASC, id ASC`
    )
    .all(params) as Array<Record<string, unknown>>

  return rows.map(mapWazzupMessage)
}

// Лёгкая «ревизия» ленты для поллинга: меняется при новых сообщениях И при апдейте статуса
// (updated_at трогается в processStatuses / upsertOutboundWazzupMessage).
export function getWazzupChatRevision(identity: WazzupChatIdentity): string {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(MAX(id), 0) AS maxId,
        COALESCE(MAX(COALESCE(updated_at, date_time, created_at)), '') AS maxAt
       FROM wazzup_messages
       WHERE (@dealId IS NOT NULL AND deal_id = @dealId)
          OR (@chatType <> '' AND @chatId <> '' AND chat_type = @chatType AND chat_id = @chatId)`
    )
    .get({
      dealId: identity.dealId ?? null,
      chatType: clean(identity.chatType),
      chatId: clean(identity.chatId),
    }) as { cnt: number; maxId: number; maxAt: string }

  return `${row.cnt}:${row.maxId}:${row.maxAt}`
}

export function getWazzupMessageMedia(id: number): { contentUri: string; messageType: string } | null {
  const row = db()
    .prepare(
      `SELECT COALESCE(content_uri, '') AS contentUri, COALESCE(message_type, '') AS messageType
       FROM wazzup_messages WHERE id = ?`
    )
    .get(Math.trunc(id)) as { contentUri: string; messageType: string } | undefined

  if (!row || !clean(row.contentUri)) {
    return null
  }

  return { contentUri: clean(row.contentUri), messageType: clean(row.messageType) || "document" }
}

// Источник для расшифровки голосового: URL аудио + уже сохранённый кэш (если есть). Берём по id строки
// (а не по произвольному URL), как и медиа-прокси, поэтому подделать цель нельзя.
export function getWazzupTranscriptionSource(
  id: number
): { contentUri: string; messageType: string; transcript: string } | null {
  const row = db()
    .prepare(
      `SELECT COALESCE(content_uri, '') AS contentUri, COALESCE(message_type, '') AS messageType,
        COALESCE(transcript, '') AS transcript
       FROM wazzup_messages WHERE id = ?`
    )
    .get(Math.trunc(id)) as { contentUri: string; messageType: string; transcript: string } | undefined

  if (!row || !clean(row.contentUri)) {
    return null
  }

  return {
    contentUri: clean(row.contentUri),
    messageType: clean(row.messageType) || "audio",
    transcript: clean(row.transcript),
  }
}

// Кэшируем расшифровку на строке сообщения. Трогаем updated_at, чтобы revision-поллинг подтянул текст
// в уже открытые окна и он пережил перезагрузку.
export function saveWazzupMessageTranscript(id: number, transcript: string): void {
  db()
    .prepare(
      `UPDATE wazzup_messages SET transcript = @transcript, updated_at = CURRENT_TIMESTAMP WHERE id = @id`
    )
    .run({ id: Math.trunc(id), transcript: clean(transcript) || null })
}
