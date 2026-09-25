import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { db } from "../connection"
import { clean } from "../form-parsers"

// Диалоги единого окна чатов (WhatsApp / Instagram / Telegram через Wazzup). Одна строка `chats`
// на (chat_type, chat_id); лента сообщений живёт в wazzup_messages и запрашивается по той же паре.
// Сущность заменяет канбан сделок как рабочий список менеджера: вкладки «Ждут» (есть входящие
// после нашего последнего ответа), «Мои» (ответственный — я), «Новые» (никто не взял и не ответил).

export type ChatTab = "all" | "waiting" | "mine" | "new"

export type ChatSummary = {
  id: number
  chatType: string
  chatId: string
  channelId: string
  customerId: number | null
  name: string
  hasAvatar: boolean
  phone: string
  username: string
  isGroup: boolean
  assignedUserId: number | null
  assignedUserName: string
  lastMessageAt: string
  lastMessageText: string
  lastMessageType: string
  lastMessageDirection: "inbound" | "outbound" | ""
  lastInboundAt: string
  lastOutboundAt: string
  unansweredCount: number
  // Входящие без ответа, но мы уже отвечали в этом разговоре (с телефона или из CRM) — счётчик бледный.
  repliedRecently: boolean
  archived: boolean
  // Сводка по клиенту для строки списка и шапки чата.
  customerDiscount: number
  ordersCount: number
  activeOrdersCount: number
  createdAt: string
}

export type ChatCounts = Record<ChatTab, number>

export type ChatContactInput = {
  name?: string
  avatarUri?: string
  phone?: string
  username?: string
}

export type ChatMessageTouch = {
  chatType: string
  chatId: string
  channelId?: string
  direction: "inbound" | "outbound"
  messageType: string
  text: string
  dateTime: string
  contact?: ChatContactInput
  customerId?: number | null
  // Кто отправил наше исходящее (из CRM) — становится ответственным, если чат ничей.
  author?: { id: number; name: string } | null
}

const GROUP_CHAT_TYPES = new Set(["whatsgroup", "telegroup", "maxgroup"])

export function isGroupChatType(chatType: string) {
  return GROUP_CHAT_TYPES.has(clean(chatType))
}

// Правила chatId (references/crud-routes.md): whatsapp/viber — только цифры.
export function normalizeChatId(chatType: string, chatId: string) {
  const value = clean(chatId)
  return chatType === "whatsapp" || chatType === "viber" ? value.replace(/\D/g, "") : value
}

// «Уже отвечали»: наш последний ответ (из CRM или эхо Wazzup с телефона) был не раньше чем за двое суток
// до последнего входящего — разговор идёт, очередное «спасибо» не срочное, его счётчик бледный. Ярко —
// только диалоги, где не отвечали вообще или клиент вернулся после долгой паузы (новый запрос).
const REPLIED_RECENTLY_SQL =
  "(chats.last_outbound_at IS NOT NULL AND julianday(chats.last_inbound_at) - julianday(chats.last_outbound_at) <= 2)"

const SUMMARY_SELECT = `
  SELECT chats.*,
    ${REPLIED_RECENTLY_SQL} AS replied_recently,
    COALESCE(customers.default_discount_percent, 0) AS customer_discount,
    (SELECT COUNT(*) FROM orders o
      WHERE o.customer_id = chats.customer_id AND o.status NOT IN ('Отменен', 'Черновик')) AS orders_count,
    (SELECT COUNT(*) FROM orders o
      WHERE o.customer_id = chats.customer_id
        AND o.status IN ('Новый', 'В работе', 'Готов', 'Передан курьеру')) AS active_orders_count
  FROM chats
  LEFT JOIN customers ON customers.id = chats.customer_id`

function tabCondition(tab: ChatTab) {
  switch (tab) {
    case "waiting":
      return "chats.unanswered_count > 0"
    case "mine":
      return "chats.assigned_user_id = @userId"
    case "new":
      return "chats.assigned_user_id IS NULL AND chats.last_outbound_at IS NULL"
    default:
      return "1 = 1"
  }
}

function mapChat(row: Record<string, unknown>): ChatSummary {
  const direction = String(row.last_message_direction ?? "")
  return {
    id: numberFromRow(row.id),
    chatType: String(row.chat_type ?? ""),
    chatId: String(row.chat_id ?? ""),
    channelId: String(row.channel_id ?? ""),
    customerId: row.customer_id === null || row.customer_id === undefined ? null : numberFromRow(row.customer_id),
    name: String(row.name ?? ""),
    hasAvatar: Boolean(clean(String(row.avatar_uri ?? ""))),
    phone: String(row.phone ?? ""),
    username: String(row.username ?? ""),
    isGroup: numberFromRow(row.is_group) === 1,
    assignedUserId:
      row.assigned_user_id === null || row.assigned_user_id === undefined ? null : numberFromRow(row.assigned_user_id),
    assignedUserName: String(row.assigned_user_name ?? ""),
    lastMessageAt: String(row.last_message_at ?? ""),
    lastMessageText: String(row.last_message_text ?? ""),
    lastMessageType: String(row.last_message_type ?? ""),
    lastMessageDirection: direction === "inbound" || direction === "outbound" ? direction : "",
    lastInboundAt: String(row.last_inbound_at ?? ""),
    lastOutboundAt: String(row.last_outbound_at ?? ""),
    unansweredCount: numberFromRow(row.unanswered_count),
    repliedRecently: numberFromRow(row.replied_recently) === 1,
    archived: Boolean(clean(String(row.archived_at ?? ""))),
    customerDiscount: numberFromRow(row.customer_discount),
    ordersCount: numberFromRow(row.orders_count),
    activeOrdersCount: numberFromRow(row.active_orders_count),
    createdAt: String(row.created_at ?? ""),
  }
}

export function listChats(options: {
  tab?: ChatTab
  search?: string
  userId: number
  includeGroups?: boolean
  // true — только архив, иначе архивные диалоги скрыты.
  archived?: boolean
  limit?: number
}): ChatSummary[] {
  const tab = options.tab ?? "all"
  const search = clean(options.search ?? "")
  const conditions = [tabCondition(tab), options.archived ? "chats.archived_at IS NOT NULL" : "chats.archived_at IS NULL"]
  const params: Record<string, unknown> = { userId: options.userId }
  if (!options.includeGroups) {
    conditions.push("chats.is_group = 0")
  }
  if (search) {
    params.search = `%${search.toLowerCase()}%`
    const parts = [
      "lower_u(chats.name) LIKE @search",
      "lower_u(chats.last_message_text) LIKE @search",
      "lower_u(customers.name) LIKE @search",
    ]
    const digits = search.replace(/\D/g, "")
    if (digits) {
      params.digits = `%${digits}%`
      parts.push("chats.phone LIKE @digits", "chats.chat_id LIKE @digits", "customers.normalized_phone LIKE @digits")
    } else {
      parts.push("chats.chat_id LIKE @search", "chats.username LIKE @search")
    }
    conditions.push(`(${parts.join(" OR ")})`)
  }
  params.limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 300), 1000))

  const rows = db()
    .prepare(
      `${SUMMARY_SELECT}
       WHERE ${conditions.join(" AND ")}
       ORDER BY COALESCE(chats.last_message_at, chats.created_at) DESC, chats.id DESC
       LIMIT @limit`
    )
    .all(params) as Array<Record<string, unknown>>

  return rows.map(mapChat)
}

export function getChatCounts(userId: number, includeGroups = false, archived = false): ChatCounts {
  const groups = `${includeGroups ? "" : "AND is_group = 0"} AND archived_at IS ${archived ? "NOT NULL" : "NULL"}`
  const row = db()
    .prepare(
      `SELECT
        SUM(CASE WHEN 1 = 1 ${groups} THEN 1 ELSE 0 END) AS all_count,
        SUM(CASE WHEN unanswered_count > 0 ${groups} THEN 1 ELSE 0 END) AS waiting_count,
        SUM(CASE WHEN assigned_user_id = @userId ${groups} THEN 1 ELSE 0 END) AS mine_count,
        SUM(CASE WHEN assigned_user_id IS NULL AND last_outbound_at IS NULL ${groups} THEN 1 ELSE 0 END) AS new_count
       FROM chats`
    )
    .get({ userId }) as Record<string, unknown> | undefined

  return {
    all: numberFromRow(row?.all_count),
    waiting: numberFromRow(row?.waiting_count),
    mine: numberFromRow(row?.mine_count),
    new: numberFromRow(row?.new_count),
  }
}

// Диалоги, ждущие ответа (бейдж «Чаты»), — без групп и архива: count — где не отвечали (яркий),
// repliedCount — где разговор уже идёт (бледный, см. REPLIED_RECENTLY_SQL).
export function countUnansweredChats(): { count: number; repliedCount: number } {
  const row = db()
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN ${REPLIED_RECENTLY_SQL} THEN 0 ELSE 1 END), 0) AS count,
        COALESCE(SUM(CASE WHEN ${REPLIED_RECENTLY_SQL} THEN 1 ELSE 0 END), 0) AS replied_count
       FROM chats WHERE unanswered_count > 0 AND is_group = 0 AND archived_at IS NULL`
    )
    .get() as { count: number; replied_count: number } | undefined
  return { count: Number(row?.count ?? 0), repliedCount: Number(row?.replied_count ?? 0) }
}

// Ревизия списка для поллинга: меняется при любом апдейте диалога (новое сообщение, статус,
// назначение) и при появлении нового.
export function getChatsRevision(): string {
  const row = db()
    .prepare("SELECT COUNT(*) AS cnt, COALESCE(MAX(id), 0) AS maxId, COALESCE(MAX(updated_at), '') AS maxAt FROM chats")
    .get() as { cnt: number; maxId: number; maxAt: string }
  return `${row.cnt}:${row.maxId}:${row.maxAt}`
}

export function getChatById(id: number): ChatSummary | null {
  const row = db()
    .prepare(`${SUMMARY_SELECT} WHERE chats.id = ?`)
    .get(Math.trunc(id)) as Record<string, unknown> | undefined
  return row ? mapChat(row) : null
}

export function getChatByIdentity(chatType: string, chatId: string): ChatSummary | null {
  const row = db()
    .prepare(`${SUMMARY_SELECT} WHERE chats.chat_type = ? AND chats.chat_id = ?`)
    .get(clean(chatType), normalizeChatId(clean(chatType), chatId)) as Record<string, unknown> | undefined
  return row ? mapChat(row) : null
}

export function getChatAvatarUri(id: number): string {
  const row = db().prepare("SELECT COALESCE(avatar_uri, '') AS uri FROM chats WHERE id = ?").get(Math.trunc(id)) as
    | { uri: string }
    | undefined
  return clean(row?.uri ?? "")
}

// Диалоги для выбора цели пересылки: короткий список без групп, поиск по имени/телефону.
export function listChatsForPicker(search: string, limit = 30): Array<Pick<ChatSummary, "id" | "name" | "phone" | "chatType" | "hasAvatar" | "lastMessageAt">> {
  const query = clean(search)
  const params: Record<string, unknown> = { limit }
  let where = "is_group = 0"
  if (query) {
    params.search = `%${query.toLowerCase()}%`
    params.digits = `%${query.replace(/\D/g, "") || query}%`
    where += " AND (lower_u(name) LIKE @search OR phone LIKE @digits OR chat_id LIKE @digits)"
  }
  const rows = db()
    .prepare(
      `SELECT id, name, phone, chat_type, avatar_uri, last_message_at FROM chats
       WHERE ${where}
       ORDER BY COALESCE(last_message_at, created_at) DESC
       LIMIT @limit`
    )
    .all(params) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: numberFromRow(row.id),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    chatType: String(row.chat_type ?? ""),
    hasAvatar: Boolean(clean(String(row.avatar_uri ?? ""))),
    lastMessageAt: String(row.last_message_at ?? ""),
  }))
}

// Обновление диалога на каждое сообщение ленты (вебхук и наши отправки). Создаёт строку при первом
// сообщении. Входящее увеличивает «неотвеченные», исходящее — сбрасывает и (если чат ничей)
// назначает автора ответственным. Имя/аватар контакта берём из вебхука, имя не затираем пустым.
export function touchChatOnMessage(input: ChatMessageTouch, client: Database.Database = db()): number {
  const chatType = clean(input.chatType)
  const chatId = normalizeChatId(chatType, input.chatId)
  if (!chatType || !chatId) {
    return 0
  }
  const contact = input.contact ?? {}
  const isGroup = isGroupChatType(chatType) ? 1 : 0
  const phone = clean(contact.phone ?? "") || (chatType === "whatsapp" ? chatId : "")
  const preview = messagePreviewText(input.text, input.messageType)
  const dateTime = clean(input.dateTime) || new Date().toISOString()
  const inbound = input.direction === "inbound"
  const author = inbound ? null : input.author ?? null

  client
    .prepare(
      `INSERT INTO chats (
        chat_type, chat_id, channel_id, customer_id, name, avatar_uri, phone, username, is_group,
        assigned_user_id, assigned_user_name,
        last_message_at, last_message_text, last_message_type, last_message_direction,
        last_inbound_at, last_outbound_at, unanswered_count, created_at, updated_at
      ) VALUES (
        @chatType, @chatId, NULLIF(@channelId, ''), @customerId, @name, NULLIF(@avatarUri, ''), @phone, @username, @isGroup,
        @authorId, @authorName,
        @dateTime, @preview, @messageType, @direction,
        CASE WHEN @direction = 'inbound' THEN @dateTime END,
        CASE WHEN @direction = 'outbound' THEN @dateTime END,
        CASE WHEN @direction = 'inbound' THEN 1 ELSE 0 END,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT(chat_type, chat_id) DO UPDATE SET
        channel_id = COALESCE(NULLIF(excluded.channel_id, ''), chats.channel_id),
        customer_id = COALESCE(chats.customer_id, excluded.customer_id),
        name = CASE WHEN chats.name = '' OR chats.name = chats.chat_id OR chats.name = chats.phone THEN excluded.name ELSE chats.name END,
        avatar_uri = COALESCE(NULLIF(excluded.avatar_uri, ''), chats.avatar_uri),
        phone = CASE WHEN chats.phone = '' THEN excluded.phone ELSE chats.phone END,
        username = CASE WHEN chats.username = '' THEN excluded.username ELSE chats.username END,
        assigned_user_id = COALESCE(chats.assigned_user_id, excluded.assigned_user_id),
        assigned_user_name = CASE WHEN chats.assigned_user_id IS NULL THEN excluded.assigned_user_name ELSE chats.assigned_user_name END,
        last_message_at = CASE WHEN COALESCE(chats.last_message_at, '') <= excluded.last_message_at THEN excluded.last_message_at ELSE chats.last_message_at END,
        last_message_text = CASE WHEN COALESCE(chats.last_message_at, '') <= excluded.last_message_at THEN excluded.last_message_text ELSE chats.last_message_text END,
        last_message_type = CASE WHEN COALESCE(chats.last_message_at, '') <= excluded.last_message_at THEN excluded.last_message_type ELSE chats.last_message_type END,
        last_message_direction = CASE WHEN COALESCE(chats.last_message_at, '') <= excluded.last_message_at THEN excluded.last_message_direction ELSE chats.last_message_direction END,
        last_inbound_at = CASE WHEN excluded.last_message_direction = 'inbound' THEN excluded.last_message_at ELSE chats.last_inbound_at END,
        last_outbound_at = CASE WHEN excluded.last_message_direction = 'outbound' THEN excluded.last_message_at ELSE chats.last_outbound_at END,
        unanswered_count = CASE WHEN excluded.last_message_direction = 'inbound' THEN chats.unanswered_count + 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP`
    )
    .run({
      chatType,
      chatId,
      channelId: clean(input.channelId ?? ""),
      customerId: input.customerId ?? null,
      name: clean(contact.name ?? "") || phone || chatId,
      avatarUri: clean(contact.avatarUri ?? ""),
      phone,
      username: clean(contact.username ?? ""),
      isGroup,
      authorId: author?.id ?? null,
      authorName: author?.name ?? "",
      dateTime,
      preview,
      messageType: clean(input.messageType) || "text",
      direction: input.direction,
    })

  const row = client
    .prepare("SELECT id FROM chats WHERE chat_type = ? AND chat_id = ?")
    .get(chatType, chatId) as { id: number } | undefined
  return row?.id ?? 0
}

export function messagePreviewText(text: string, messageType: string) {
  const value = clean(text)
  if (value) {
    return value.slice(0, 300)
  }
  const type = clean(messageType)
  return type ? `[${type}]` : ""
}

export function assignChat(chatRowId: number, user: { id: number; name: string } | null, client: Database.Database = db()) {
  client
    .prepare(
      `UPDATE chats SET assigned_user_id = @userId, assigned_user_name = @userName, updated_at = CURRENT_TIMESTAMP
       WHERE id = @id`
    )
    .run({ id: Math.trunc(chatRowId), userId: user?.id ?? null, userName: user?.name ?? "" })
}

export function markChatAnswered(chatRowId: number, client: Database.Database = db()) {
  client
    .prepare(
      `UPDATE chats SET unanswered_count = 0, answered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(Math.trunc(chatRowId))
}

// Архив: диалог пропадает из списков и счётчиков, сообщения в нём продолжают сохраняться.
export function setChatArchived(chatRowId: number, archived: boolean, client: Database.Database = db()) {
  client
    .prepare(
      `UPDATE chats SET archived_at = CASE WHEN @archived = 1 THEN COALESCE(archived_at, CURRENT_TIMESTAMP) END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = @id`
    )
    .run({ id: Math.trunc(chatRowId), archived: archived ? 1 : 0 })
}

export function setChatChannel(chatRowId: number, channelId: string, client: Database.Database = db()) {
  const value = clean(channelId)
  if (!value) {
    return
  }
  // Перезаписываем и уже заполненный канал: после переподключения номера id меняется.
  client
    .prepare("UPDATE chats SET channel_id = @channelId, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND COALESCE(channel_id, '') <> @channelId")
    .run({ id: Math.trunc(chatRowId), channelId: value })
}

// Привязка клиента к чату (при создании клиента из карточки чата или ручной привязке).
export function linkChatCustomer(chatRowId: number, customerId: number, client: Database.Database = db()) {
  client
    .prepare("UPDATE chats SET customer_id = @customerId, updated_at = CURRENT_TIMESTAMP WHERE id = @id")
    .run({ id: Math.trunc(chatRowId), customerId: Math.trunc(customerId) })
}

// Имя диалога правится вместе с именем клиента (карточка контакта), чтобы список не расходился.
export function renameChatsOfCustomer(customerId: number, name: string, phone: string, client: Database.Database = db()) {
  client
    .prepare(
      `UPDATE chats SET name = CASE WHEN @name <> '' THEN @name ELSE name END,
        phone = CASE WHEN chat_type <> 'whatsapp' AND @phone <> '' THEN @phone ELSE phone END,
        updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = @customerId`
    )
    .run({ customerId: Math.trunc(customerId), name: clean(name), phone: clean(phone) })
}

// Найти или создать WhatsApp-диалог по телефону (кнопка «Новый чат» и «Написать» из карточки
// клиента). Клиента ищем по нормализованному телефону; чат без сообщений живёт в списке как пустой.
export function findOrCreateWhatsappChat(input: {
  phone: string
  name?: string
  customerId?: number | null
}, client: Database.Database = db()): { id: number; created: boolean } {
  const chatId = normalizeChatId("whatsapp", input.phone)
  if (chatId.length < 10) {
    throw new Error("Введите номер в международном формате, например 996555123456.")
  }
  const existing = client
    .prepare("SELECT id FROM chats WHERE chat_type = 'whatsapp' AND chat_id = ?")
    .get(chatId) as { id: number } | undefined
  if (existing) {
    if (input.customerId) {
      client
        .prepare("UPDATE chats SET customer_id = COALESCE(customer_id, ?) WHERE id = ?")
        .run(input.customerId, existing.id)
    }
    return { id: existing.id, created: false }
  }

  const customer =
    input.customerId != null
      ? (client.prepare("SELECT id, COALESCE(name, '') AS name FROM customers WHERE id = ?").get(input.customerId) as
          | { id: number; name: string }
          | undefined)
      : (client
          .prepare("SELECT id, COALESCE(name, '') AS name FROM customers WHERE normalized_phone = ? ORDER BY id LIMIT 1")
          .get(chatId) as { id: number; name: string } | undefined)

  const result = client
    .prepare(
      `INSERT INTO chats (chat_type, chat_id, customer_id, name, phone, is_group, created_at, updated_at)
       VALUES ('whatsapp', @chatId, @customerId, @name, @phone, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .run({
      chatId,
      customerId: customer?.id ?? null,
      name: clean(input.name ?? "") || clean(customer?.name ?? "") || chatId,
      phone: chatId,
    })
  return { id: Number(result.lastInsertRowid), created: true }
}

// Диалог клиента (самый свежий из привязанных): для ссылки «Открыть чат» из заказа/карточки клиента.
export function getChatByCustomerId(customerId: number): ChatSummary | null {
  const row = db()
    .prepare(
      `${SUMMARY_SELECT}
       WHERE chats.customer_id = ? AND chats.is_group = 0
       ORDER BY COALESCE(chats.last_message_at, chats.created_at) DESC, chats.id DESC
       LIMIT 1`
    )
    .get(Math.trunc(customerId)) as Record<string, unknown> | undefined
  return row ? mapChat(row) : null
}
