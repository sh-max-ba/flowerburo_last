import crypto from "node:crypto"
import type Database from "better-sqlite3"
import { initDb, listUsers } from "@/lib/db"
import { generateDealNumber, normalizePhone } from "@/lib/crm"
import { wazzupChatTypeLabel } from "@/lib/labels"
import { getWazzupSettingsForServer } from "@/lib/wazzup"

export type WazzupWebhookEventType =
  | "test"
  | "messages"
  | "statuses"
  | "createContact"
  | "createDeal"
  | "mixed"
  | "unknown"

type JsonRecord = Record<string, unknown>

type ChatContext = {
  chatType: string
  chatId: string
  channelId: string
  name: string
  phone: string
  source: string
  responsibleUserId: string
}

type WebhookProcessingResult = {
  contactId?: number | null
  dealId?: number | null
  messagesSaved?: number
  statusesUpdated?: number
}

export type WazzupWebhookAuthResult = {
  authorized: boolean
  required: boolean
  method: "bearer" | "query" | "none"
  hasAuthorization: boolean
  error?: string
  warning?: string
}

export function isWazzupWebhookAuthorized(input: {
  authorization: string | null
  queryKey?: string | null
}): WazzupWebhookAuthResult {
  const { crmKey, webhookAuthRequired } = getWazzupSettingsForServer()
  const authorization = clean(input.authorization)
  const queryKey = clean(input.queryKey)
  const hasAuthorization = Boolean(authorization)

  if (!crmKey) {
    return {
      authorized: true,
      required: false,
      method: "none",
      hasAuthorization,
      warning: "CRM key не настроен; webhook принят без проверки ключа.",
    }
  }

  if (authorization === `Bearer ${crmKey}`) {
    return { authorized: true, required: webhookAuthRequired, method: "bearer", hasAuthorization }
  }

  if (queryKey === crmKey) {
    return { authorized: true, required: webhookAuthRequired, method: "query", hasAuthorization }
  }

  if (!webhookAuthRequired) {
    return {
      authorized: true,
      required: false,
      method: "none",
      hasAuthorization,
      warning: hasAuthorization
        ? "Webhook принят без совпадающего CRM key; обязательная проверка выключена."
        : "Webhook принят без Authorization; обязательная проверка выключена.",
    }
  }

  return {
    authorized: false,
    required: true,
    method: "none",
    hasAuthorization,
    error: "unauthorized webhook: missing or invalid Authorization",
  }
}

export function createWazzupEventHash(payload: unknown) {
  return crypto.createHash("sha256").update(stableJson(payload)).digest("hex")
}

export function detectWazzupEventType(payload: unknown): WazzupWebhookEventType {
  const body = asRecord(payload)
  if (body.test === true) {
    return "test"
  }

  const types = [
    body.createContact ? "createContact" : "",
    body.createDeal ? "createDeal" : "",
    Array.isArray(body.messages) ? "messages" : "",
    Array.isArray(body.statuses) ? "statuses" : "",
  ].filter(Boolean)

  if (types.length === 1) {
    return types[0] as WazzupWebhookEventType
  }

  if (types.length > 1) {
    return "mixed"
  }

  return "unknown"
}

export function saveWazzupWebhookEvent(input: {
  eventHash: string
  eventType: WazzupWebhookEventType
  rawPayload: string
}) {
  const client = initDb()
  const result = client
    .prepare(
      `INSERT OR IGNORE INTO wazzup_webhook_events (event_hash, event_type, status, raw_payload)
       VALUES (@eventHash, @eventType, 'received', @rawPayload)`
    )
    .run(input)

  if (result.changes === 0) {
    const existing = client
      .prepare("SELECT id FROM wazzup_webhook_events WHERE event_hash = ?")
      .get(input.eventHash) as { id: number } | undefined
    return { eventId: existing?.id ?? null, duplicate: true }
  }

  return { eventId: Number(result.lastInsertRowid), duplicate: false }
}

export function markWazzupWebhookEvent(
  eventId: number,
  status: "processed" | "failed" | "ignored",
  error?: string
) {
  initDb()
    .prepare(
      `UPDATE wazzup_webhook_events
       SET status = @status, error = @error, processed_at = CURRENT_TIMESTAMP
       WHERE id = @eventId`
    )
    .run({
      eventId,
      status,
      error: error ? error.slice(0, 2000) : null,
    })
}

export function processWazzupWebhook(payload: unknown): WebhookProcessingResult {
  const client = initDb()
  const body = asRecord(payload)
  const eventType = detectWazzupEventType(body)

  if (eventType === "test" || eventType === "unknown") {
    return {}
  }

  return client.transaction(() => {
    const result: WebhookProcessingResult = {}

    if (body.createContact) {
      const contact = upsertCustomerFromContext(client, contextFromCreateContact(body.createContact))
      result.contactId = contact.id
    }

    if (body.createDeal) {
      const deal = upsertDealFromCreateDeal(client, body.createDeal)
      result.contactId = deal.customerId
      result.dealId = deal.dealId
    }

    if (Array.isArray(body.messages)) {
      const messageResult = processMessages(client, body.messages)
      result.messagesSaved = messageResult.messagesSaved
      result.contactId = messageResult.contactId ?? result.contactId
      result.dealId = messageResult.dealId ?? result.dealId
    }

    if (Array.isArray(body.statuses)) {
      result.statusesUpdated = processStatuses(client, body.statuses)
    }

    return result
  })()
}

function upsertDealFromCreateDeal(client: Database.Database, payload: unknown) {
  const record = asRecord(payload)
  const context = contextFromCreateDeal(client, record)
  const customer = upsertCustomerFromContext(client, context)
  const dealId = upsertOpenDealForCustomer(client, customer, context, null)

  return { customerId: customer.id, dealId }
}

function processMessages(client: Database.Database, messages: unknown[]) {
  let messagesSaved = 0
  let contactId: number | null = null
  let dealId: number | null = null

  for (const message of messages) {
    const record = asRecord(message)
    const messageId = clean(record.messageId)
    if (!messageId) {
      continue
    }

    const context = contextFromMessage(record)
    const isEcho = record.isEcho === true
    const direction = isEcho ? "outbound" : "inbound"
    const inserted = client
      .prepare(
        `INSERT OR IGNORE INTO wazzup_messages (
          message_id, channel_id, chat_type, chat_id, direction, message_type, text,
          content_uri, status, is_echo, date_time, raw_payload
        ) VALUES (
          @messageId, @channelId, @chatType, @chatId, @direction, @messageType, @text,
          @contentUri, @status, @isEcho, @dateTime, @rawPayload
        )`
      )
      .run({
        messageId,
        channelId: context.channelId || null,
        chatType: context.chatType || null,
        chatId: context.chatId || null,
        direction,
        messageType: clean(record.type) || null,
        text: clean(record.text) || null,
        contentUri: clean(record.contentUri) || null,
        status: clean(record.status) || null,
        isEcho: isEcho ? 1 : 0,
        dateTime: clean(record.dateTime) || null,
        rawPayload: JSON.stringify(record),
      })

    if (inserted.changes === 0) {
      continue
    }

    messagesSaved += 1
    const customer = isEcho ? findCustomerByContext(client, context) : upsertCustomerFromContext(client, context)
    const existingDeal = findOpenDealByContext(client, context, customer?.id ?? null)
    const currentDealId = existingDeal?.id ?? (!isEcho && customer ? upsertOpenDealForCustomer(client, customer, context, record) : null)

    contactId = customer?.id ?? contactId
    dealId = currentDealId ?? dealId

    client
      .prepare("UPDATE wazzup_messages SET customer_id = ?, deal_id = ? WHERE message_id = ?")
      .run(customer?.id ?? null, currentDealId, messageId)

    if (currentDealId) {
      updateDealLastMessage(client, currentDealId, record, context)
    }
  }

  return { messagesSaved, contactId, dealId }
}

function processStatuses(client: Database.Database, statuses: unknown[]) {
  let updated = 0
  const update = client.prepare("UPDATE wazzup_messages SET status = ? WHERE message_id = ?")

  for (const status of statuses) {
    const record = asRecord(status)
    const messageId = clean(record.messageId)
    const value = clean(record.status)
    if (!messageId || !value) {
      continue
    }

    const result = update.run(value, messageId)
    updated += result.changes
  }

  return updated
}

function upsertCustomerFromContext(client: Database.Database, context: ChatContext) {
  const existing = findCustomerByContext(client, context)
  const name = context.name || context.phone || context.chatId || "Клиент Wazzup"
  const phone = context.phone || (context.chatType === "whatsapp" ? context.chatId : "")
  const normalizedPhone = normalizePhone(phone)
  const source = context.source || chatTypeToSource(context.chatType)

  if (existing) {
    client
      .prepare(
        `UPDATE customers
         SET name = CASE WHEN COALESCE(name, '') = '' THEN @name ELSE name END,
          phone = CASE WHEN COALESCE(phone, '') = '' THEN @phone ELSE phone END,
          normalized_phone = CASE WHEN normalized_phone IS NULL OR normalized_phone = '' THEN @normalizedPhone ELSE normalized_phone END,
          source = CASE WHEN COALESCE(source, '') = '' THEN @source ELSE source END,
          wazzup_chat_type = COALESCE(NULLIF(@chatType, ''), wazzup_chat_type),
          wazzup_chat_id = COALESCE(NULLIF(@chatId, ''), wazzup_chat_id),
          wazzup_channel_id = COALESCE(NULLIF(@channelId, ''), wazzup_channel_id),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`
      )
      .run({
        id: existing.id,
        name,
        phone,
        normalizedPhone,
        source,
        chatType: context.chatType,
        chatId: context.chatId,
        channelId: context.channelId,
      })
    return { id: existing.id, name: existing.name || name, phone: existing.phone || phone }
  }

  const result = client
    .prepare(
      `INSERT INTO customers (
        name, phone, normalized_phone, instagram, source, wazzup_chat_type, wazzup_chat_id,
        wazzup_channel_id, updated_at
      ) VALUES (
        @name, @phone, @normalizedPhone, @instagram, @source, @chatType, @chatId, @channelId, CURRENT_TIMESTAMP
      )`
    )
    .run({
      name,
      phone,
      normalizedPhone,
      instagram: context.chatType === "instagram" ? context.chatId : "",
      source,
      chatType: context.chatType || null,
      chatId: context.chatId || null,
      channelId: context.channelId || null,
    })

  return { id: Number(result.lastInsertRowid), name, phone }
}

function upsertOpenDealForCustomer(
  client: Database.Database,
  customer: { id: number; name: string; phone: string },
  context: ChatContext,
  message: JsonRecord | null
) {
  const existing = findOpenDealByContext(client, context, customer.id)
  const pipeline = getDefaultPipeline(client)
  const stageId = getFirstStageId(client, pipeline?.id ?? null)
  const responsible = resolveResponsible(client, context.responsibleUserId)
  const source = chatTypeToSource(context.chatType)
  const title = context.chatType ? `Заявка ${wazzupChatTypeLabel(context.chatType)}` : customer.name || "Заявка Wazzup"

  if (existing) {
    client
      .prepare(
        `UPDATE deals
         SET customer_id = @customerId, customer_name = @customerName, customer_phone = @customerPhone,
          source = CASE WHEN COALESCE(source, '') = '' OR source = 'manual' THEN @source ELSE source END,
          wazzup_chat_type = COALESCE(NULLIF(@chatType, ''), wazzup_chat_type),
          wazzup_chat_id = COALESCE(NULLIF(@chatId, ''), wazzup_chat_id),
          wazzup_channel_id = COALESCE(NULLIF(@channelId, ''), wazzup_channel_id),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @dealId`
      )
      .run({
        dealId: existing.id,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        source,
        chatType: context.chatType,
        chatId: context.chatId,
        channelId: context.channelId,
      })
    return existing.id
  }

  const result = client
    .prepare(
      `INSERT INTO deals (
        customer_id, customer_name, customer_phone, responsible_user_id, responsible_user_name,
        pipeline_id, stage_id, status, source, title, wazzup_chat_type, wazzup_chat_id,
        wazzup_channel_id, last_message_text, last_message_at, updated_at
      ) VALUES (
        @customerId, @customerName, @customerPhone, @responsibleUserId, @responsibleUserName,
        @pipelineId, @stageId, 'open', @source, @title, @chatType, @chatId,
        @channelId, @lastMessageText, @lastMessageAt, CURRENT_TIMESTAMP
      )`
    )
    .run({
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      responsibleUserId: responsible.id,
      responsibleUserName: responsible.name,
      pipelineId: pipeline?.id ?? null,
      stageId,
      source,
      title,
      chatType: context.chatType || null,
      chatId: context.chatId || null,
      channelId: context.channelId || null,
      lastMessageText: message ? messagePreview(message) : null,
      lastMessageAt: message ? clean(message.dateTime) || null : null,
    })
  const dealId = Number(result.lastInsertRowid)
  client.prepare("UPDATE deals SET number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(generateDealNumber(dealId), dealId)

  return dealId
}

function updateDealLastMessage(client: Database.Database, dealId: number, message: JsonRecord, context: ChatContext) {
  client
    .prepare(
      `UPDATE deals
       SET wazzup_chat_type = COALESCE(NULLIF(@chatType, ''), wazzup_chat_type),
        wazzup_chat_id = COALESCE(NULLIF(@chatId, ''), wazzup_chat_id),
        wazzup_channel_id = COALESCE(NULLIF(@channelId, ''), wazzup_channel_id),
        source = CASE WHEN COALESCE(source, '') = '' OR source = 'manual' THEN @source ELSE source END,
        last_message_text = @lastMessageText,
        last_message_at = COALESCE(NULLIF(@lastMessageAt, ''), last_message_at),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = @dealId`
    )
    .run({
      dealId,
      chatType: context.chatType,
      chatId: context.chatId,
      channelId: context.channelId,
      source: context.source,
      lastMessageText: messagePreview(message),
      lastMessageAt: clean(message.dateTime),
    })
}

function findCustomerByContext(client: Database.Database, context: ChatContext) {
  if (context.chatType && context.chatId) {
    const row = client
      .prepare(
        `SELECT id, COALESCE(name, '') as name, COALESCE(phone, '') as phone
         FROM customers
         WHERE wazzup_chat_type = ? AND wazzup_chat_id = ?
         ORDER BY id ASC
         LIMIT 1`
      )
      .get(context.chatType, context.chatId) as { id: number; name: string; phone: string } | undefined
    if (row) {
      return row
    }
  }

  const normalizedPhone = normalizePhone(context.phone || (context.chatType === "whatsapp" ? context.chatId : ""))
  if (normalizedPhone) {
    return client
      .prepare(
        `SELECT id, COALESCE(name, '') as name, COALESCE(phone, '') as phone
         FROM customers
         WHERE normalized_phone = ?
         ORDER BY id ASC
         LIMIT 1`
      )
      .get(normalizedPhone) as { id: number; name: string; phone: string } | undefined
  }

  return null
}

function findOpenDealByContext(client: Database.Database, context: ChatContext, customerId?: number | null) {
  if (context.chatType && context.chatId) {
    const row = client
      .prepare(
        `SELECT deals.id
         FROM deals
         LEFT JOIN deal_stages ON deal_stages.id = deals.stage_id
         WHERE ${openDealWhereClause()} AND wazzup_chat_type = ? AND wazzup_chat_id = ?
         ORDER BY deals.updated_at DESC, deals.id DESC
         LIMIT 1`
      )
      .get(context.chatType, context.chatId) as { id: number } | undefined
    if (row) {
      return row
    }
  }

  if (customerId) {
    const row = client
      .prepare(
        `SELECT deals.id
         FROM deals
         LEFT JOIN deal_stages ON deal_stages.id = deals.stage_id
         WHERE ${openDealWhereClause()} AND customer_id = ?
         ORDER BY deals.updated_at DESC, deals.id DESC
         LIMIT 1`
      )
      .get(customerId) as { id: number } | undefined
    if (row) {
      return row
    }
  }

  const normalizedPhone = normalizePhone(context.phone || (context.chatType === "whatsapp" ? context.chatId : ""))
  if (normalizedPhone) {
    return client
      .prepare(
        `SELECT deals.id
         FROM deals
         LEFT JOIN deal_stages ON deal_stages.id = deals.stage_id
         WHERE ${openDealWhereClause()}
          AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = ?
         ORDER BY deals.updated_at DESC, deals.id DESC
         LIMIT 1`
      )
      .get(normalizedPhone) as { id: number } | undefined
  }

  return null
}

function openDealWhereClause() {
  return `deals.status = 'open'
    AND deals.status NOT IN ('won', 'lost', 'cancelled')
    AND COALESCE(deal_stages.is_closed, 0) != 1
    AND COALESCE(deal_stages.is_won, 0) != 1`
}

function contextFromCreateContact(payload: unknown): ChatContext {
  const record = asRecord(payload)
  const contactData = firstRecord(record.contactData)
  const chatType = clean(contactData.chatType)
  const chatId = normalizeChatId(chatType, clean(contactData.chatId))
  const phone = clean(contactData.phone) || (chatType === "whatsapp" ? chatId : "")

  return {
    chatType,
    chatId,
    channelId: clean(contactData.channelId) || clean(record.channelId),
    name: clean(record.name),
    phone,
    source: chatTypeToSource(chatType),
    responsibleUserId: clean(record.responsibleUserId),
  }
}

function contextFromCreateDeal(client: Database.Database, payload: JsonRecord): ChatContext {
  const contacts = asArray(payload.contacts)
  for (const contact of contacts) {
    const contactRecord = asRecord(contact)
    const embeddedContext = Object.keys(contactRecord).length ? contextFromCreateContact(contactRecord) : null
    if (embeddedContext?.chatType && embeddedContext.chatId) {
      embeddedContext.responsibleUserId = clean(payload.responsibleUserId) || embeddedContext.responsibleUserId
      return embeddedContext
    }

    const contactId = clean(contactRecord.id) || clean(contact)
    if (!contactId) {
      continue
    }

    const row = client
      .prepare(
        `SELECT COALESCE(name, '') as name, COALESCE(phone, '') as phone,
          COALESCE(wazzup_chat_type, '') as chatType,
          COALESCE(wazzup_chat_id, '') as chatId,
          COALESCE(wazzup_channel_id, '') as channelId
         FROM customers
         WHERE id = ?
         LIMIT 1`
      )
      .get(Number(contactId)) as
      | { name: string; phone: string; chatType: string; chatId: string; channelId: string }
      | undefined

    if (row) {
      return {
        chatType: row.chatType,
        chatId: row.chatId,
        channelId: row.channelId,
        name: row.name,
        phone: row.phone,
        source: chatTypeToSource(row.chatType),
        responsibleUserId: clean(payload.responsibleUserId),
      }
    }
  }

  const fallback = contextFromCreateContact(payload)
  fallback.responsibleUserId = clean(payload.responsibleUserId)
  return fallback
}

function contextFromMessage(message: JsonRecord): ChatContext {
  const contact = asRecord(message.contact)
  const chatType = clean(message.chatType)
  const chatId = normalizeChatId(chatType, clean(message.chatId))
  const phone = clean(contact.phone) || (chatType === "whatsapp" ? chatId : "")

  return {
    chatType,
    chatId,
    channelId: clean(message.channelId),
    name: clean(contact.name) || phone || chatId,
    phone,
    source: chatTypeToSource(chatType),
    responsibleUserId: clean(message.authorId),
  }
}

function resolveResponsible(client: Database.Database, responsibleUserId: string) {
  const users = listUsers(client).filter((user) => user.isActive)
  const explicitId = Number(responsibleUserId)
  const explicit = users.find((user) => user.id === explicitId)
  if (explicit) {
    return { id: explicit.id, name: explicit.name }
  }

  const fallback = users.find((user) => user.role === "manager") ?? users.find((user) => user.role === "owner")
  return fallback ? { id: fallback.id, name: fallback.name } : { id: null, name: "" }
}

function getDefaultPipeline(client: Database.Database) {
  return client
    .prepare("SELECT id FROM deal_pipelines ORDER BY is_default DESC, id ASC LIMIT 1")
    .get() as { id: number } | undefined
}

function getFirstStageId(client: Database.Database, pipelineId: number | null) {
  const row = client
    .prepare(
      `SELECT id FROM deal_stages
       WHERE pipeline_id = COALESCE(?, pipeline_id)
       ORDER BY position ASC, id ASC
       LIMIT 1`
    )
    .get(pipelineId) as { id: number } | undefined

  return row?.id ?? null
}

function chatTypeToSource(chatType: string) {
  return clean(chatType) || "whatsapp"
}

function normalizeChatId(chatType: string, chatId: string) {
  return chatType === "whatsapp" || chatType === "viber" ? chatId.replace(/\D/g, "") : chatId
}

function messagePreview(message: JsonRecord) {
  const text = clean(message.text)
  if (text) {
    return text.slice(0, 500)
  }

  const type = clean(message.type)
  return type ? `[${type}]` : ""
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value as JsonRecord)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as JsonRecord)[key])}`)
      .join(",")}}`
  }

  return JSON.stringify(value)
}

function firstRecord(value: unknown) {
  const list = asArray(value)
  return asRecord(list[0])
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}
