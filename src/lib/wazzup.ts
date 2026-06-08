import crypto from "node:crypto"
import { getDeal, normalizePhone, type Deal } from "@/lib/crm"
import {
  getBouquetTemplate,
  getWazzupChatRevision,
  initDb,
  listUsers,
  listWazzupChatMessages,
  recordDealBouquetMessage,
  upsertOutboundWazzupMessage,
  type BouquetTemplate,
  type CurrentUser,
  type UserRole,
  type WazzupChatIdentity,
  type WazzupMessage,
} from "@/lib/db"
import { getSafeBouquetImagePath } from "@/lib/product-images"
import { formatMoney } from "@/lib/utils"

export type WazzupIframeResult =
  | ({ status: "ok"; url: string } & WazzupIframeSafeDiagnostics)
  | ({ status: "not_configured" | "disabled" | "no_chat"; message: string } & WazzupIframeSafeDiagnostics)
  | ({ status: "error"; message: string } & Partial<WazzupIframeSafeDiagnostics>)

export type WazzupDiagnosticWebhookEvent = {
  eventType: string
  status: string
  createdAt: string
  error: string
}

export type WazzupDiagnosticMessage = {
  chatType: string
  chatId: string
  createdAt: string
}

export type WazzupIframeSafeDiagnostics = {
  hasChatType: boolean
  hasChatId: boolean
  hasPhone: boolean
  targetSource: WazzupChatTargetSource | null
  hasApiKey: boolean
  integrationEnabled: boolean
  webhookConfigured: boolean
  customerHasChat: boolean
  dealHasChatId: boolean
  matchingMessagesCount: number
  lastWebhookEvent: WazzupDiagnosticWebhookEvent | null
}

export type WazzupSettingsDiagnostics = {
  recentWebhookEvents: WazzupDiagnosticWebhookEvent[]
  latestMessage: WazzupDiagnosticMessage | null
  webhookEventsCount: number
  wazzupMessagesCount: number
  failedAuthEventsCount: number
  latestEventType: string
  latestError: string
  onlyTestWebhooks: boolean
}

export type WazzupUserSyncStatus = {
  userId: number
  crmName: string
  crmLogin: string
  crmRole: UserRole
  isActive: boolean
  wazzupUserId: string
  syncStatus: "synced" | "failed" | "skipped" | "pending"
  lastSyncedAt: string
  lastError: string
}

export type WazzupUsersSyncResult = {
  ok: boolean
  totalSent: number
  responseStatus: number | null
  message: string
  messages: string[]
}

export type WazzupSyncResult = WazzupUsersSyncResult

export type WazzupSyncSummary = {
  total: number
  synced: number
  failed: number
  pending: number
  lastSyncedAt: string
  lastError: string
}

export type WazzupEntitySyncStatus = {
  pipelines: WazzupSyncSummary
  stages: WazzupSyncSummary
  contacts: WazzupSyncSummary
  deals: WazzupSyncSummary
}

export type WazzupWebhookSubscriptions = {
  messagesAndStatuses: boolean
  contactsAndDealsCreation: boolean
  channelsUpdates: boolean
  templateStatus: boolean
}

export type WazzupWebhookConfig = {
  webhooksUri: string
  subscriptions: WazzupWebhookSubscriptions
}

export type WazzupChannelSummary = {
  channelId: string
  transport: string
  plainId: string
  state: string
}

export type WazzupChatTargetSource = "deal" | "customer" | "phone_fallback"

// Режим чата сделки: встроенный Wazzup iframe (по умолчанию) или собственный UI чата.
export type WazzupChatMode = "iframe" | "custom"

export type WazzupChatTarget =
  | {
      status: "ok"
      chatType: string
      chatId: string
      channelId: string
      name: string
      source: WazzupChatTargetSource
    }
  | {
      status: "no_chat"
      reason: "no_phone"
    }

export type WazzupSettingsStatus = {
  isEnabled: boolean
  apiKeyConfigured: boolean
  apiKeyMasked: string | null
  crmKeyConfigured: boolean
  crmKeyMasked: string | null
  webhookAuthRequired: boolean
  webhookUrl: string
  secureWebhookUrlMasked: string
  appUrlConfigured: boolean
  chatMode: WazzupChatMode
  lastCheckStatus: string
  lastCheckMessage: string
  lastCheckAt: string
  diagnostics: WazzupSettingsDiagnostics
  userSync: WazzupUserSyncStatus[]
  entitySync: WazzupEntitySyncStatus
}

type WazzupSettingsRow = {
  api_key: string | null
  crm_key: string | null
  webhook_url: string | null
  webhook_auth_required: number | null
  is_enabled: number | null
  chat_mode: string | null
  last_check_status: string | null
  last_check_message: string | null
  last_check_at: string | null
}

type WazzupServerSettings = {
  apiKey: string
  crmKey: string
  webhookUrl: string
  webhookAuthRequired: boolean
  isEnabled: boolean
  appUrlConfigured: boolean
  chatMode: WazzupChatMode
}

type WazzupIframeResponse = {
  url?: unknown
}

type WazzupUserSyncResult =
  | { ok: true }
  | {
      ok: false
      code: string
      message: string
      httpStatus: number
    }

export type WazzupIframeRequestBody = {
  user: {
    id: string
    name: string
  }
  scope: "card"
  filter: [
    {
      chatType: string
      chatId: string
      name: string
    },
  ]
  activeChat: {
    chatType: string
    chatId: string
    channelId?: string
  }
}

type DealForWazzupTarget = Pick<
  Deal,
  "id" | "customerId" | "customerName" | "customerPhone" | "title" | "wazzupChatType" | "wazzupChatId" | "wazzupChannelId"
>

const provider = "wazzup"
const wazzupApiBaseUrl = "https://api.wazzup24.com/v3"
const wazzupMessagePath = "/message"
const wazzupSendUnavailableMessage = "Невозможно отправить: у сделки нет телефона клиента или Wazzup не настроен."
// Подстраховочный URL вебхука, если NEXT_PUBLIC_APP_URL не задан в окружении.
// Должен указывать на ТЕКУЩИЙ прод-домен — иначе Wazzup будет слать события в никуда.
// Правильнее всегда задавать NEXT_PUBLIC_APP_URL явно; это значение — лишь fallback.
export const wazzupWebhookTargetUrl = "https://flower-buro.sellz.cloud/api/wazzup/webhook"

export function getWazzupSettingsForServer(): WazzupServerSettings {
  const row = getWazzupSettingsRow()
  const appUrl = clean(process.env.NEXT_PUBLIC_APP_URL)
  // NEXT_PUBLIC_APP_URL ВЫИГРЫВАЕТ у сохранённого в БД webhook_url. Иначе при миграции (старый
  // IP остался в строке БД) переподключение webhook зарегистрировало бы мёртвый URL, пока
  // настройки не пересохранили. С приоритетом env порядок действий оператора больше не критичен.
  const webhookUrl = stripWebhookSecret(
    appUrl ? buildWebhookUrl(appUrl) : clean(row?.webhook_url) || buildWebhookUrl(appUrl)
  )

  return {
    apiKey: clean(row?.api_key) || clean(process.env.WAZZUP_API_KEY),
    crmKey: clean(row?.crm_key) || clean(process.env.WAZZUP_CRM_KEY),
    webhookUrl,
    webhookAuthRequired: row ? row.webhook_auth_required === 1 : true,
    isEnabled: row ? row.is_enabled === 1 : Boolean(clean(process.env.WAZZUP_API_KEY)),
    appUrlConfigured: Boolean(appUrl),
    chatMode: normalizeChatMode(row?.chat_mode),
  }
}

function normalizeChatMode(value: unknown): WazzupChatMode {
  return clean(value) === "custom" ? "custom" : "iframe"
}

export function getWazzupSettingsStatus(): WazzupSettingsStatus {
  const row = getWazzupSettingsRow()
  const settings = getWazzupSettingsForServer()

  return {
    isEnabled: settings.isEnabled,
    apiKeyConfigured: Boolean(settings.apiKey),
    apiKeyMasked: maskSecret(settings.apiKey),
    crmKeyConfigured: Boolean(settings.crmKey),
    crmKeyMasked: maskSecret(settings.crmKey),
    webhookAuthRequired: settings.webhookAuthRequired,
    webhookUrl: settings.webhookUrl,
    secureWebhookUrlMasked: maskWebhookUrl(buildSecureWebhookUrl(settings.webhookUrl, settings.crmKey), settings.crmKey),
    appUrlConfigured: settings.appUrlConfigured,
    chatMode: settings.chatMode,
    lastCheckStatus: clean(row?.last_check_status),
    lastCheckMessage: clean(row?.last_check_message),
    lastCheckAt: clean(row?.last_check_at),
    diagnostics: getWazzupSettingsDiagnostics(),
    userSync: listWazzupUserSyncStatuses(),
    entitySync: getWazzupEntitySyncStatus(),
  }
}

export function saveWazzupSettings(input: {
  apiKey?: string
  crmKey?: string
  isEnabled: boolean
  webhookAuthRequired?: boolean
  chatMode?: WazzupChatMode
}) {
  const current = getWazzupSettingsRow()
  const nextApiKey = clean(input.apiKey) || clean(current?.api_key) || null
  const nextCrmKey = clean(input.crmKey) || clean(current?.crm_key) || null
  upsertWazzupSettings({
    apiKey: nextApiKey,
    crmKey: nextCrmKey,
    isEnabled: input.isEnabled,
    webhookAuthRequired: input.webhookAuthRequired ?? (current?.webhook_auth_required === 1),
    chatMode: input.chatMode ?? normalizeChatMode(current?.chat_mode),
    lastCheckStatus: current?.last_check_status ?? null,
    lastCheckMessage: current?.last_check_message ?? null,
    lastCheckAt: current?.last_check_at ?? null,
  })
}

export function clearWazzupApiKey() {
  const current = getWazzupSettingsRow()
  const settings = getWazzupSettingsForServer()
  upsertWazzupSettings({
    apiKey: null,
    crmKey: clean(current?.crm_key) || null,
    isEnabled: current ? current.is_enabled === 1 : settings.isEnabled,
    webhookAuthRequired: current ? current.webhook_auth_required === 1 : settings.webhookAuthRequired,
    chatMode: settings.chatMode,
    lastCheckStatus: null,
    lastCheckMessage: "API key очищен",
    lastCheckAt: new Date().toISOString(),
  })
}

export function generateCrmKey() {
  return crypto.randomBytes(32).toString("hex")
}

export function generateAndSaveWazzupCrmKey() {
  const current = getWazzupSettingsRow()
  const settings = getWazzupSettingsForServer()
  const crmKey = generateCrmKey()
  upsertWazzupSettings({
    apiKey: clean(current?.api_key) || null,
    crmKey,
    isEnabled: current ? current.is_enabled === 1 : settings.isEnabled,
    webhookAuthRequired: current ? current.webhook_auth_required === 1 : settings.webhookAuthRequired,
    chatMode: settings.chatMode,
    lastCheckStatus: current?.last_check_status ?? null,
    lastCheckMessage: current?.last_check_message ?? null,
    lastCheckAt: current?.last_check_at ?? null,
  })
}

export async function testWazzupApiKey() {
  const settings = getWazzupSettingsForServer()
  if (!settings.apiKey) {
    saveWazzupLastCheck("error", "API key не настроен")
    return { ok: false, message: "API key не настроен" }
  }

  try {
    const response = await wazzupFetch(`${wazzupApiBaseUrl}/channels`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
      },
    })

    if (response.ok) {
      saveWazzupLastCheck("success", "API key проверен")
      return { ok: true, message: "API key проверен" }
    }

    const message = response.status === 401 ? "Неверный API key" : `Wazzup вернул HTTP ${response.status}`
    saveWazzupLastCheck("error", message)
    return { ok: false, message }
  } catch {
    const message = "Не удалось проверить API key"
    saveWazzupLastCheck("error", message)
    return { ok: false, message }
  }
}

export async function getWazzupWebhookSubscriptions(): Promise<WazzupWebhookConfig> {
  const data = await requestWazzupJson("/webhooks", { method: "GET" })
  return normalizeWebhookConfig(data)
}

export async function connectWazzupWebhookSubscriptions(): Promise<{
  before: WazzupWebhookConfig
  patch: { status: number; body: string }
  after: WazzupWebhookConfig
}> {
  const settings = getWazzupSettingsForServer()
  const targetUrl = buildSecureWebhookUrl(settings.webhookUrl, settings.crmKey)
  const before = await getWazzupWebhookSubscriptions()
  const response = await requestWazzup("/webhooks", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      webhooksUri: targetUrl,
      subscriptions: {
        messagesAndStatuses: true,
        contactsAndDealsCreation: true,
        channelsUpdates: false,
        templateStatus: false,
      },
    }),
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(safeWazzupApiErrorMessage(response.status, parseJson(body)))
  }

  const after = await getWazzupWebhookSubscriptions()
  return {
    before,
    patch: {
      status: response.status,
      body: safePatchBody(body, settings.crmKey),
    },
    after,
  }
}

export function getSecureWazzupWebhookUrlForOwner() {
  const settings = getWazzupSettingsForServer()
  return buildSecureWebhookUrl(settings.webhookUrl, settings.crmKey)
}

export function maskWazzupWebhookUrl(value: string) {
  return maskWebhookUrl(value, getWazzupSettingsForServer().crmKey)
}

export async function listWazzupChannels(): Promise<WazzupChannelSummary[]> {
  const data = await requestWazzupJson("/channels", { method: "GET" })
  const records = Array.isArray(data) ? data : Array.isArray(asRecord(data).data) ? (asRecord(data).data as unknown[]) : []

  return records.map((value) => {
    const record = asRecord(value)
    return {
      channelId: clean(record.channelId) || clean(record.id),
      transport: clean(record.transport) || clean(record.channelType) || clean(record.type),
      plainId: clean(record.plainId),
      state: clean(record.state),
    }
  })
}

export function resolveWazzupChatTargetForDeal(deal: DealForWazzupTarget): WazzupChatTarget {
  const dealChatType = clean(deal.wazzupChatType)
  const dealChatId = clean(deal.wazzupChatId)
  if (dealChatType && dealChatId) {
    return {
      status: "ok",
      chatType: dealChatType,
      chatId: normalizeChatId(dealChatType, dealChatId),
      channelId: clean(deal.wazzupChannelId),
      name: targetName(deal),
      source: "deal",
    }
  }

  const customer = getDealCustomerWazzupContext(deal.customerId)
  const customerChatType = clean(customer?.wazzup_chat_type)
  const customerChatId = clean(customer?.wazzup_chat_id)
  if (customerChatType && customerChatId) {
    return {
      status: "ok",
      chatType: customerChatType,
      chatId: normalizeChatId(customerChatType, customerChatId),
      channelId: clean(customer?.wazzup_channel_id),
      name: clean(customer?.name) || targetName(deal),
      source: "customer",
    }
  }

  const customerPhone = clean(customer?.normalized_phone) || normalizePhone(customer?.phone) || ""
  const phone = customerPhone || normalizePhone(deal.customerPhone) || ""
  if (phone && phone.length >= 10) {
    return {
      status: "ok",
      chatType: "whatsapp",
      chatId: phone,
      channelId: "",
      name: clean(customer?.name) || targetName(deal),
      source: "phone_fallback",
    }
  }

  return { status: "no_chat", reason: "no_phone" }
}

export function testLocalWazzupWebhook() {
  const settings = getWazzupSettingsForServer()
  const message = settings.webhookUrl ? "Webhook endpoint доступен локально" : "Webhook URL не сформирован"
  saveWazzupLastCheck(settings.webhookUrl ? "success" : "error", message)

  return {
    ok: Boolean(settings.webhookUrl),
    message,
  }
}

export function linkDealToWazzupByCustomer(dealId: number) {
  const client = initDb()
  const link = client.transaction(() => {
    const deal = client
      .prepare(
        `SELECT id, customer_id, customer_phone, source, wazzup_chat_type, wazzup_chat_id
         FROM deals
         WHERE id = ?`
      )
      .get(dealId) as
      | {
          id: number
          customer_id: number | null
          customer_phone: string | null
          source: string | null
          wazzup_chat_type: string | null
          wazzup_chat_id: string | null
        }
      | undefined

    if (!deal) {
      throw new Error("Сделка не найдена.")
    }

    if (clean(deal.wazzup_chat_type) && clean(deal.wazzup_chat_id)) {
      return
    }

    const customer = deal.customer_id
      ? (client
          .prepare(
            `SELECT id, phone, normalized_phone, wazzup_chat_type, wazzup_chat_id, wazzup_channel_id
             FROM customers
             WHERE id = ?`
          )
          .get(deal.customer_id) as
          | {
              id: number
              phone: string | null
              normalized_phone: string | null
              wazzup_chat_type: string | null
              wazzup_chat_id: string | null
              wazzup_channel_id: string | null
            }
          | undefined)
      : null

    const normalizedPhone =
      clean(customer?.normalized_phone) || normalizePhone(customer?.phone || deal.customer_phone || "") || ""
    const fromCustomer = clean(customer?.wazzup_chat_type) && clean(customer?.wazzup_chat_id)
      ? {
          chatType: clean(customer?.wazzup_chat_type),
          chatId: clean(customer?.wazzup_chat_id),
          channelId: clean(customer?.wazzup_channel_id),
        }
      : null
    const fromMessage = fromCustomer
      ? null
      : (client
          .prepare(
            `SELECT chat_type as chatType, chat_id as chatId, channel_id as channelId
             FROM wazzup_messages
             WHERE (customer_id = @customerId AND @customerId IS NOT NULL)
              OR (chat_type = 'whatsapp' AND chat_id = @normalizedPhone AND @normalizedPhone != '')
             ORDER BY id DESC
             LIMIT 1`
          )
          .get({
            customerId: deal.customer_id,
            normalizedPhone,
          }) as { chatType: string | null; chatId: string | null; channelId: string | null } | undefined)
    const match = fromCustomer ?? (fromMessage
      ? {
          chatType: clean(fromMessage.chatType),
          chatId: clean(fromMessage.chatId),
          channelId: clean(fromMessage.channelId),
        }
      : null)

    if (!match?.chatType || !match.chatId) {
      throw new Error("Для клиента еще нет Wazzup-чата. Отправьте или получите сообщение в WhatsApp, затем обновите сделку.")
    }

    client
      .prepare(
        `UPDATE deals
         SET wazzup_chat_type = @chatType,
          wazzup_chat_id = @chatId,
          wazzup_channel_id = NULLIF(@channelId, ''),
          source = CASE WHEN COALESCE(source, '') = '' OR source = 'manual' THEN @source ELSE source END,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @dealId`
      )
      .run({
        dealId,
        chatType: match.chatType,
        chatId: match.chatId,
        channelId: match.channelId,
        source: match.chatType,
      })

    if (deal.customer_id) {
      client
        .prepare(
          `UPDATE customers
           SET wazzup_chat_type = COALESCE(NULLIF(wazzup_chat_type, ''), @chatType),
            wazzup_chat_id = COALESCE(NULLIF(wazzup_chat_id, ''), @chatId),
            wazzup_channel_id = COALESCE(NULLIF(wazzup_channel_id, ''), NULLIF(@channelId, '')),
            updated_at = CURRENT_TIMESTAMP
           WHERE id = @customerId`
        )
        .run({
          customerId: deal.customer_id,
          chatType: match.chatType,
          chatId: match.chatId,
          channelId: match.channelId,
        })
    }

    client
      .prepare(
        `UPDATE wazzup_messages
         SET deal_id = @dealId
         WHERE chat_type = @chatType AND chat_id = @chatId AND (deal_id IS NULL OR deal_id = 0)`
      )
      .run({
        dealId,
        chatType: match.chatType,
        chatId: match.chatId,
      })
  })

  link()
}

export async function getWazzupIframeUrlForDeal(
  dealId: number,
  currentUser: CurrentUser
): Promise<WazzupIframeResult> {
  const deal = getDeal(dealId)
  if (!deal) {
    return { status: "error", message: "Сделка не найдена." }
  }

  const settings = getWazzupSettingsForServer()
  const target = resolveWazzupChatTargetForDeal(deal)
  const diagnostics = getWazzupIframeDiagnostics(dealId, settings, target)

  if (target.status === "no_chat") {
    return {
      status: "no_chat",
      message: "У сделки нет телефона клиента, поэтому Wazzup чат открыть нельзя. Добавьте телефон клиента или дождитесь входящего сообщения.",
      ...diagnostics,
    }
  }

  if (!settings.isEnabled) {
    return { status: "disabled", message: "Интеграция Wazzup выключена.", ...diagnostics }
  }

  if (!settings.apiKey) {
    return { status: "not_configured", message: "Wazzup API key не настроен на сервере.", ...diagnostics }
  }

  const targetWithChannel = await withActiveWhatsappChannel(target)
  const body = buildWazzupIframeRequestBodyForDeal(deal, currentUser, targetWithChannel)
  const userSync = await ensureWazzupUser(currentUser)
  if (!userSync.ok) {
    console.warn("Wazzup user sync failed before iframe request", {
      status: userSync.httpStatus,
      code: userSync.code,
    })

    return {
      status: "error",
      message: userSync.message,
      ...diagnostics,
    }
  }

  let response: Response
  try {
    response = await wazzupFetch(`${wazzupApiBaseUrl}/iframe`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Wazzup недоступен.",
      ...diagnostics,
    }
  }

  if (!response.ok) {
    const safeMessage = await safeWazzupIframeErrorMessage(response)
    const message =
      target.source === "phone_fallback"
        ? `Не удалось открыть Wazzup чат по телефону клиента: ${safeMessage}`
        : safeMessage
    console.warn("Wazzup iframe request failed", {
      status: response.status,
      message,
      hasChatType: diagnostics.hasChatType,
      hasChatId: diagnostics.hasChatId,
      integrationEnabled: diagnostics.integrationEnabled,
      hasApiKey: diagnostics.hasApiKey,
    })

    return {
      status: "error",
      message,
      ...diagnostics,
    }
  }

  const data = (await response.json().catch(() => null)) as WazzupIframeResponse | null
  if (!data || typeof data.url !== "string" || !data.url) {
    return { status: "error", message: "Wazzup не вернул ссылку iframe.", ...diagnostics }
  }

  persistWazzupTargetForDeal(deal.id, targetWithChannel)
  return { status: "ok", url: data.url, ...diagnostics }
}

export async function sendBouquetToDealChat(
  dealId: number,
  bouquetId: number,
  currentUser: CurrentUser
) {
  const deal = getDeal(dealId)
  if (!deal) {
    throw new Error("Сделка не найдена.")
  }

  const bouquet = getBouquetTemplate(bouquetId)
  if (!bouquet || !bouquet.isActive) {
    throw new Error("Активный букет не найден.")
  }

  const messageText = buildBouquetMessageText(bouquet)
  const imagePath = getSafeBouquetImagePath(bouquet.imagePath)

  try {
    const settings = getWazzupSettingsForServer()
    const target = resolveWazzupChatTargetForDeal(deal)
    if (target.status !== "ok" || !settings.isEnabled || !settings.apiKey) {
      throw new Error(wazzupSendUnavailableMessage)
    }

    const targetWithChannel = await withActiveWhatsappChannel(target)
    const channelId = clean(targetWithChannel.channelId)
    if (!channelId) {
      throw new Error(wazzupSendUnavailableMessage)
    }

    const basePayload = {
      channelId,
      chatType: targetWithChannel.chatType,
      chatId: targetWithChannel.chatId,
      crmUserId: String(currentUser.id),
    }

    if (clean(bouquet.imagePath) && !imagePath) {
      throw new Error("Фото букета недоступно.")
    }

    const sentAtIso = new Date().toISOString()

    if (imagePath) {
      const imageUrl = getAbsoluteBouquetImageUrl(imagePath)
      const imageCrmId = createCrmMessageId(deal.id, bouquet.id, "image")
      const imageResult = await postWazzupMessage({
        ...basePayload,
        contentUri: imageUrl,
        crmMessageId: imageCrmId,
      })
      recordOutboundForDeal(deal, targetWithChannel, currentUser, {
        result: imageResult,
        crmMessageId: imageCrmId,
        messageType: "image",
        contentUri: imageUrl,
        dateTime: sentAtIso,
      })
    }

    const textCrmId = createCrmMessageId(deal.id, bouquet.id, "text")
    const textResult = await postWazzupMessage({
      ...basePayload,
      text: messageText,
      crmMessageId: textCrmId,
    })
    recordOutboundForDeal(deal, targetWithChannel, currentUser, {
      result: textResult,
      crmMessageId: textCrmId,
      messageType: "text",
      text: messageText,
      dateTime: sentAtIso,
    })

    persistWazzupTargetForDeal(deal.id, targetWithChannel)
    recordDealBouquetMessage({
      dealId: deal.id,
      bouquetId: bouquet.id,
      bouquetName: bouquet.name,
      messageText,
      imagePath,
      sentByUserId: currentUser.id,
      sentByName: currentUser.name,
      status: "sent",
    })

    return {
      endpoint: `${wazzupApiBaseUrl}${wazzupMessagePath}`,
      sentImage: Boolean(imagePath),
    }
  } catch (error) {
    const message = safeWazzupBouquetSendErrorMessage(error)
    recordDealBouquetMessage({
      dealId: deal.id,
      bouquetId: bouquet.id,
      bouquetName: bouquet.name,
      messageText,
      imagePath,
      sentByUserId: currentUser.id,
      sentByName: currentUser.name,
      status: "failed",
      error: message,
    })
    throw new Error(message)
  }
}

// Generic free-form отправка текста (или вложения) в чат сделки. Резолвит цель как
// sendBouquetToDealChat, шлёт через postWazzupMessage с УНИКАЛЬНЫМ crmMessageId (стабилен при
// сетевом ретрае внутри одного вызова) и пишет исходящее в единую ленту wazzup_messages.
export async function sendTextToDealChat(
  dealId: number,
  text: string,
  currentUser: CurrentUser,
  options: { contentUri?: string; messageType?: string; refMessageId?: string; quotedText?: string } = {}
): Promise<{ ok: true; messageId: string; repeated: boolean }> {
  const deal = getDeal(dealId)
  if (!deal) {
    throw new Error("Сделка не найдена.")
  }

  const body = clean(text)
  const rawContentUri = clean(options.contentUri ?? "")
  if (!body && !rawContentUri) {
    throw new Error("Введите текст сообщения.")
  }
  // В /v3/message text и contentUri взаимоисключающи — за один вызов отправляем что-то одно.
  if (body && rawContentUri) {
    throw new Error("Нельзя отправить текст и вложение одним сообщением.")
  }

  try {
    const settings = getWazzupSettingsForServer()
    const target = resolveWazzupChatTargetForDeal(deal)
    if (target.status !== "ok" || !settings.isEnabled || !settings.apiKey) {
      throw new Error(wazzupSendUnavailableMessage)
    }

    const targetWithChannel = await withActiveWhatsappChannel(target)
    const channelId = clean(targetWithChannel.channelId)
    if (!channelId) {
      throw new Error(wazzupSendUnavailableMessage)
    }

    const contentUri = rawContentUri ? toAbsoluteAppUrl(rawContentUri) : ""
    const messageType = contentUri ? clean(options.messageType) || "document" : "text"
    const refMessageId = clean(options.refMessageId)
    const crmMessageId = `deal-${deal.id}-text-${crypto.randomUUID()}`
    const result = await postWazzupMessage({
      channelId,
      chatType: targetWithChannel.chatType,
      chatId: targetWithChannel.chatId,
      crmUserId: String(currentUser.id),
      crmMessageId,
      ...(contentUri ? { contentUri } : { text: body }),
      ...(refMessageId ? { refMessageId } : {}),
    })

    recordOutboundForDeal(deal, targetWithChannel, currentUser, {
      result,
      crmMessageId,
      messageType,
      text: contentUri ? undefined : body,
      contentUri: contentUri || undefined,
      quotedMessageId: refMessageId || undefined,
      quotedText: refMessageId ? clean(options.quotedText) : undefined,
      dateTime: new Date().toISOString(),
    })

    persistWazzupTargetForDeal(deal.id, targetWithChannel)

    return { ok: true, messageId: result.messageId, repeated: result.repeated }
  } catch (error) {
    throw new Error(safeWazzupBouquetSendErrorMessage(error))
  }
}

export type WazzupChatResult =
  | { status: "ok"; messages: WazzupMessage[]; revision: string }
  | { status: "not_configured" | "disabled" | "no_chat"; message: string }
  | { status: "error"; message: string }

// Лёгкий ответ для поллинга: только статус + revision (без загрузки самой ленты).
export type WazzupChatProbeResult =
  | { status: "ok"; revision: string }
  | { status: "not_configured" | "disabled" | "no_chat" | "error"; message: string }

type DealChatResolution =
  | { status: "ok"; identity: WazzupChatIdentity }
  | { status: "not_configured" | "disabled" | "no_chat" | "error"; message: string }

// Общая логика дискриминанта статуса собственного чата сделки. Статусы совпадают с iframe-фреймом,
// чтобы UI мог переиспользовать те же пустые состояния (no_chat/disabled/not_configured). Wazzup API
// здесь НЕ вызывается — собственный чат читает ленту из БД.
function resolveDealChat(dealId: number): DealChatResolution {
  const deal = getDeal(dealId)
  if (!deal) {
    return { status: "error", message: "Сделка не найдена." }
  }

  const settings = getWazzupSettingsForServer()
  const target = resolveWazzupChatTargetForDeal(deal)

  if (target.status === "no_chat") {
    return {
      status: "no_chat",
      message:
        "У сделки нет телефона клиента, поэтому чат открыть нельзя. Добавьте телефон клиента или дождитесь входящего сообщения.",
    }
  }
  if (!settings.isEnabled) {
    return { status: "disabled", message: "Интеграция Wazzup выключена." }
  }
  if (!settings.apiKey) {
    return { status: "not_configured", message: "Wazzup API key не настроен на сервере." }
  }

  return { status: "ok", identity: { dealId: deal.id, chatType: target.chatType, chatId: target.chatId } }
}

// Полная лента собственного чата сделки (для первичной загрузки и обновления при смене revision).
export function getWazzupChatForDeal(dealId: number): WazzupChatResult {
  const resolution = resolveDealChat(dealId)
  if (resolution.status !== "ok") {
    return resolution
  }

  return {
    status: "ok",
    messages: listWazzupChatMessages(resolution.identity),
    revision: getWazzupChatRevision(resolution.identity),
  }
}

// Лёгкий probe для поллинга: статус + revision, без выгрузки сообщений.
export function getWazzupChatProbeForDeal(dealId: number): WazzupChatProbeResult {
  const resolution = resolveDealChat(dealId)
  if (resolution.status !== "ok") {
    return { status: resolution.status, message: resolution.message }
  }

  return { status: "ok", revision: getWazzupChatRevision(resolution.identity) }
}

type WazzupMessageRequest = {
  channelId: string
  chatType: string
  chatId: string
  crmUserId: string
  crmMessageId: string
  text?: string
  contentUri?: string
  // id цитируемого сообщения Wazzup (ответ на сообщение). См. references/messages.md.
  refMessageId?: string
}

function buildBouquetMessageText(bouquet: BouquetTemplate) {
  const description = clean(bouquet.description) || "Описание букета пока не заполнено."

  return [
    `Букет “${clean(bouquet.name) || "Без названия"}”`,
    formatMoney(bouquet.price),
    "",
    description,
    "",
    "Если понравился, можем сразу оформить заказ 🌸",
  ].join("\n")
}

function getAbsoluteBouquetImageUrl(imagePath: string) {
  const appUrl = clean(process.env.NEXT_PUBLIC_APP_URL)
  if (!appUrl) {
    throw new Error("Для отправки фото настройте NEXT_PUBLIC_APP_URL")
  }

  return `${appUrl.replace(/\/+$/, "")}${imagePath}`
}

// Wazzup скачивает contentUri по ПУБЛИЧНОМУ URL — относительный путь (наш загруженный файл)
// абсолютизируем через NEXT_PUBLIC_APP_URL. Уже абсолютные http(s)-ссылки оставляем как есть.
function toAbsoluteAppUrl(uri: string) {
  const value = clean(uri)
  if (!value || /^https?:\/\//i.test(value)) {
    return value
  }
  const appUrl = clean(process.env.NEXT_PUBLIC_APP_URL)
  if (!appUrl) {
    throw new Error("Для отправки вложения настройте NEXT_PUBLIC_APP_URL")
  }
  return `${appUrl.replace(/\/+$/, "")}${value.startsWith("/") ? "" : "/"}${value}`
}

function createCrmMessageId(dealId: number, bouquetId: number, kind: "image" | "text") {
  // Детерминированный id (без случайного UUID): повторная отправка того же букета в ту же
  // сделку идемпотентна — Wazzup дедуплицирует одинаковый crmMessageId в окне 60с, поэтому
  // двойной клик/повтор не уйдёт клиенту дважды.
  return `deal-${dealId}-bouquet-${bouquetId}-${kind}`
}

type PostWazzupMessageResult = {
  // Wazzup messageId из ответа 201 { messageId, chatId }. Пустой при repeated (см. ниже).
  messageId: string
  chatId: string
  repeated: boolean
}

// Переиспользуемая отправка одного сообщения. Возвращает messageId (ключ дедупликации с эхо).
async function postWazzupMessage(payload: WazzupMessageRequest): Promise<PostWazzupMessageResult> {
  const response = await requestWazzup(wazzupMessagePath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  const raw = await response.text()
  const data = parseJson(raw)
  if (!response.ok) {
    // Идемпотентность отправки: тот же crmMessageId в окне 60с Wazzup отклоняет как
    // REPEATED_CRM_MESSAGE_ID (HTTP 400) — значит, сообщение УЖЕ доставлено (первый POST
    // дошёл, а ответ потерялся и сработал ретрай). Считаем это успехом, а не ошибкой. messageId
    // в этом ответе недоступен — оптимистичную строку не пишем, её допишет эхо-вебхук по messageId.
    if (response.status === 400 && /repeated.?crm.?message.?id/i.test(wazzupErrorCode(data))) {
      return { messageId: "", chatId: "", repeated: true }
    }
    throw new Error(safeWazzupMessageErrorMessage(response.status, data))
  }

  const record = asRecord(data)
  return {
    messageId: clean(record.messageId),
    chatId: clean(record.chatId),
    repeated: false,
  }
}

// Записывает наше исходящее в единую ленту wazzup_messages (если есть messageId). При repeated
// messageId недоступен — строку допишет эхо-вебхук, поэтому здесь ничего не пишем (без дублей).
function recordOutboundForDeal(
  deal: Pick<Deal, "id" | "customerId">,
  target: Extract<WazzupChatTarget, { status: "ok" }>,
  currentUser: Pick<CurrentUser, "name">,
  message: {
    result: PostWazzupMessageResult
    crmMessageId: string
    messageType: string
    text?: string
    contentUri?: string
    quotedMessageId?: string
    quotedText?: string
    dateTime: string
  }
) {
  if (message.result.repeated || !message.result.messageId) {
    return
  }

  upsertOutboundWazzupMessage({
    messageId: message.result.messageId,
    crmMessageId: message.crmMessageId,
    dealId: deal.id,
    customerId: deal.customerId ?? null,
    channelId: target.channelId,
    chatType: target.chatType,
    chatId: message.result.chatId || target.chatId,
    messageType: message.messageType,
    text: message.text ?? null,
    contentUri: message.contentUri ?? null,
    authorName: currentUser.name,
    quotedMessageId: message.quotedMessageId ?? null,
    quotedText: message.quotedText ?? null,
    dateTime: message.dateTime,
  })
}

function safeWazzupMessageErrorMessage(status: number, data: unknown) {
  if (status === 401) {
    return "Невозможно отправить: неверный Wazzup API key."
  }

  const record = asRecord(data)
  const code = wazzupErrorCode(data)
  const description = clean(record.description)
  if (code === "uriNotValid") {
    return "Wazzup не смог получить фото по публичному URL."
  }

  return `Wazzup вернул HTTP ${status}${code ? `: ${code}` : ""}${description ? ` (${description})` : ""}`
}

function safeWazzupBouquetSendErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (!message) {
    return "Не удалось отправить букет через Wazzup."
  }
  if (message === "Wazzup API key не настроен") {
    return wazzupSendUnavailableMessage
  }

  return message
}

export async function syncWazzupUsers(): Promise<WazzupUsersSyncResult> {
  const settings = getWazzupSettingsForServer()
  if (!settings.isEnabled) {
    const message = "Интеграция Wazzup выключена."
    saveWazzupLastCheck("error", message)
    return { ok: false, totalSent: 0, responseStatus: null, message, messages: [message] }
  }
  if (!settings.apiKey) {
    const message = "Wazzup API key не настроен на сервере."
    saveWazzupLastCheck("error", message)
    return { ok: false, totalSent: 0, responseStatus: null, message, messages: [message] }
  }

  const users = listUsers().filter((user) => user.isActive)
  if (!users.length) {
    const message = "Нет активных CRM-пользователей для синхронизации."
    saveWazzupLastCheck("error", message)
    return { ok: false, totalSent: 0, responseStatus: null, message, messages: [message] }
  }

  const body = users.map((user) => ({
    id: String(user.id),
    name: clean(user.name) || clean(user.login) || `User ${user.id}`,
  }))

  let lastResponseStatus: number | null = null
  for (let index = 0; index < body.length; index += 100) {
    const bodyChunk = body.slice(index, index + 100)
    const userChunk = users.slice(index, index + 100)
    const response = await wazzupFetch(`${wazzupApiBaseUrl}/users`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyChunk),
    })
    lastResponseStatus = response.status
    const raw = await response.text()
    const data = parseJson(raw)

    if (!response.ok) {
      const message = safeWazzupUsersSyncErrorMessage(response.status, data)
      saveWazzupUserSyncFailure(userChunk, message)
      saveWazzupLastCheck("error", message)
      return {
        ok: false,
        totalSent: index + bodyChunk.length,
        responseStatus: response.status,
        message,
        messages: [
          `POST /v3/users: HTTP ${response.status}`,
          `Пользователей отправлено: ${index + bodyChunk.length}`,
          message,
        ],
      }
    }
  }

  saveWazzupUserSyncSuccess(users)
  const message = "Пользователи отправлены в Wazzup"
  saveWazzupLastCheck("success", `${message}: ${body.length}`)
  return {
    ok: true,
    totalSent: body.length,
    responseStatus: lastResponseStatus,
    message,
    messages: [`POST /v3/users: HTTP ${lastResponseStatus ?? 200}`, `Пользователей отправлено: ${body.length}`],
  }
}

export async function syncWazzupPipelines(): Promise<WazzupSyncResult> {
  const settings = getWazzupSettingsForServer()
  const unavailable = wazzupUnavailableResult(settings, "Воронки Wazzup")
  if (unavailable) {
    saveWazzupLastCheck("error", unavailable.message)
    return unavailable
  }

  const client = initDb()
  const pipelines = getWazzupPipelinePayloads(client)
  if (!pipelines.length) {
    const message = "Нет CRM-воронок для синхронизации."
    saveWazzupLastCheck("error", message)
    return { ok: false, totalSent: 0, responseStatus: null, message, messages: [message] }
  }

  const response = await wazzupFetch(`${wazzupApiBaseUrl}/pipelines`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pipelines.map((item) => item.payload)),
  })
  const raw = await response.text()
  const data = parseJson(raw)
  if (!response.ok) {
    const message = safeWazzupEntitySyncErrorMessage("Воронки Wazzup не синхронизированы", response.status, data)
    saveWazzupPipelineSyncFailure(pipelines, message)
    saveWazzupLastCheck("error", message)
    return {
      ok: false,
      totalSent: pipelines.length,
      responseStatus: response.status,
      message,
      messages: [`POST /v3/pipelines: HTTP ${response.status}`, `Воронок отправлено: ${pipelines.length}`, message],
    }
  }

  saveWazzupPipelineSyncSuccess(pipelines)
  const stagesCount = pipelines.reduce((sum, item) => sum + item.stageIds.length, 0)
  const message = "Воронки отправлены в Wazzup"
  saveWazzupLastCheck("success", `${message}: ${pipelines.length}, этапов: ${stagesCount}`)
  return {
    ok: true,
    totalSent: pipelines.length,
    responseStatus: response.status,
    message,
    messages: [`POST /v3/pipelines: HTTP ${response.status}`, `Воронок отправлено: ${pipelines.length}`, `Этапов отправлено: ${stagesCount}`],
  }
}

export async function syncWazzupContacts(input: { customerIds?: number[]; updateLastCheck?: boolean } = {}): Promise<WazzupSyncResult> {
  const settings = getWazzupSettingsForServer()
  const unavailable = wazzupUnavailableResult(settings, "Контакты Wazzup")
  if (unavailable) {
    if (input.updateLastCheck !== false) {
      saveWazzupLastCheck("error", unavailable.message)
    }
    return unavailable
  }

  const contacts = getWazzupContactPayloads(input.customerIds)
  if (!contacts.length) {
    const message = "Нет клиентов с Wazzup chatId или телефоном для синхронизации."
    if (input.updateLastCheck !== false) {
      saveWazzupLastCheck("error", message)
    }
    return { ok: false, totalSent: 0, responseStatus: null, message, messages: [message] }
  }

  const result = await postWazzupEntityBatches({
    path: "/contacts",
    label: "Контактов",
    payloads: contacts.map((item) => item.payload),
    apiKey: settings.apiKey,
    onChunkFailure: (start, end, message) => saveWazzupContactSyncFailure(contacts.slice(start, end), message),
  })

  if (!result.ok) {
    if (input.updateLastCheck !== false) {
      saveWazzupLastCheck("error", result.message)
    }
    return result
  }

  saveWazzupContactSyncSuccess(contacts)
  const messages = settings.appUrlConfigured
    ? result.messages
    : [...result.messages, "warning: NEXT_PUBLIC_APP_URL не задан, uri сформирован как относительный путь."]
  const message = "Клиенты отправлены в Wazzup"
  if (input.updateLastCheck !== false) {
    saveWazzupLastCheck("success", `${message}: ${contacts.length}`)
  }
  return { ...result, message, messages }
}

export async function syncWazzupDeals(input: { dealIds?: number[]; updateLastCheck?: boolean } = {}): Promise<WazzupSyncResult> {
  const settings = getWazzupSettingsForServer()
  const unavailable = wazzupUnavailableResult(settings, "Сделки Wazzup")
  if (unavailable) {
    if (input.updateLastCheck !== false) {
      saveWazzupLastCheck("error", unavailable.message)
    }
    return unavailable
  }

  const deals = getWazzupDealPayloads(input.dealIds)
  if (!deals.length) {
    const message = "Нет сделок с customer_id для синхронизации."
    if (input.updateLastCheck !== false) {
      saveWazzupLastCheck("error", message)
    }
    return { ok: false, totalSent: 0, responseStatus: null, message, messages: [message] }
  }

  const result = await postWazzupEntityBatches({
    path: "/deals",
    label: "Сделок",
    payloads: deals.map((item) => item.payload),
    apiKey: settings.apiKey,
    onChunkFailure: (start, end, message) => saveWazzupDealSyncFailure(deals.slice(start, end), message),
  })

  if (!result.ok) {
    if (input.updateLastCheck !== false) {
      saveWazzupLastCheck("error", result.message)
    }
    return result
  }

  saveWazzupDealSyncSuccess(deals)
  const messages = settings.appUrlConfigured
    ? result.messages
    : [...result.messages, "warning: NEXT_PUBLIC_APP_URL не задан, uri сформирован как относительный путь."]
  const message = "Сделки отправлены в Wazzup"
  if (input.updateLastCheck !== false) {
    saveWazzupLastCheck("success", `${message}: ${deals.length}`)
  }
  return { ...result, message, messages }
}

export async function syncWazzupAll(): Promise<WazzupSyncResult> {
  const results: WazzupSyncResult[] = []
  for (const sync of [syncWazzupUsers, syncWazzupPipelines, syncWazzupContacts, syncWazzupDeals]) {
    const result = await sync()
    results.push(result)
    if (!result.ok) {
      return {
        ok: false,
        totalSent: results.reduce((sum, item) => sum + item.totalSent, 0),
        responseStatus: result.responseStatus,
        message: result.message,
        messages: results.flatMap((item) => item.messages),
      }
    }
  }

  const totalSent = results.reduce((sum, item) => sum + item.totalSent, 0)
  return {
    ok: true,
    totalSent,
    responseStatus: results.at(-1)?.responseStatus ?? null,
    message: "Полная синхронизация Wazzup выполнена",
    messages: results.flatMap((item) => item.messages),
  }
}

export async function syncWazzupWebhookEntities(result: { contactId?: number | null; dealId?: number | null }) {
  try {
    if (result.contactId) {
      await syncWazzupContacts({ customerIds: [result.contactId], updateLastCheck: false })
    }
    if (result.dealId) {
      await syncWazzupDeals({ dealIds: [result.dealId], updateLastCheck: false })
    }
  } catch (error) {
    console.warn("Wazzup webhook entity sync failed", {
      message: error instanceof Error ? error.message : "unknown",
    })
  }
}

export async function ensureWazzupUser(
  currentUser: Pick<CurrentUser, "id" | "name"> & { phone?: string | null }
): Promise<WazzupUserSyncResult> {
  const settings = getWazzupSettingsForServer()
  if (!settings.isEnabled) {
    return { ok: false, code: "DISABLED", message: "Интеграция Wazzup выключена.", httpStatus: 0 }
  }
  if (!settings.apiKey) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Wazzup API key не настроен на сервере.", httpStatus: 0 }
  }

  let response: Response
  try {
    response = await wazzupFetch(`${wazzupApiBaseUrl}/users`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildWazzupUserSyncBody(currentUser)),
    })
  } catch (error) {
    return {
      ok: false,
      code: "NETWORK",
      httpStatus: 0,
      message: error instanceof Error ? error.message : "Wazzup недоступен.",
    }
  }

  if (response.ok) {
    return { ok: true }
  }

  const data = (await response.json().catch(() => null)) as unknown
  const code = wazzupErrorCode(data)

  return {
    ok: false,
    code,
    httpStatus: response.status,
    message: safeWazzupUserSyncErrorMessage(response.status, data),
  }
}

export function buildWazzupUserSyncBody(currentUser: Pick<CurrentUser, "id" | "name"> & { phone?: string | null }) {
  const user: { id: string; name: string; phone?: string } = {
    id: String(currentUser.id),
    name: clean(currentUser.name),
  }
  const phone = normalizePhone(currentUser.phone)
  if (phone && phone.length >= 10) {
    user.phone = phone
  }

  return [user]
}

export function buildWazzupIframeRequestBodyForDeal(
  deal: DealForWazzupTarget,
  currentUser: Pick<CurrentUser, "id" | "name">,
  resolvedTarget = resolveWazzupChatTargetForDeal(deal)
): WazzupIframeRequestBody {
  if (resolvedTarget.status !== "ok") {
    throw new Error("Wazzup chat target is not available.")
  }

  const chatType = resolvedTarget.chatType
  const chatId = resolvedTarget.chatId
  const activeChat: WazzupIframeRequestBody["activeChat"] = {
    chatType,
    chatId,
  }

  const channelId = clean(resolvedTarget.channelId)
  if (channelId) {
    activeChat.channelId = channelId
  }

  return {
    user: {
      id: String(currentUser.id),
      name: clean(currentUser.name),
    },
    scope: "card",
    filter: [
      {
        chatType,
        chatId,
        name: resolvedTarget.name || chatId,
      },
    ],
    activeChat,
  }
}

function getWazzupSettingsRow() {
  return initDb()
    .prepare(
      `SELECT api_key, crm_key, webhook_url, is_enabled, last_check_status, last_check_message, last_check_at
        , webhook_auth_required, chat_mode
       FROM integration_settings
       WHERE provider = ?`
    )
    .get(provider) as WazzupSettingsRow | undefined
}

function getWazzupSettingsDiagnostics(): WazzupSettingsDiagnostics {
  const client = initDb()
  const recentWebhookEvents = client
    .prepare(
      `SELECT COALESCE(event_type, '') as eventType, COALESCE(status, '') as status,
        COALESCE(created_at, '') as createdAt, COALESCE(error, '') as error
       FROM wazzup_webhook_events
       ORDER BY id DESC
       LIMIT 5`
    )
    .all() as WazzupDiagnosticWebhookEvent[]
  const latestMessage = client
    .prepare(
      `SELECT COALESCE(chat_type, '') as chatType, COALESCE(chat_id, '') as chatId,
        COALESCE(created_at, '') as createdAt
       FROM wazzup_messages
       ORDER BY id DESC
       LIMIT 1`
    )
    .get() as WazzupDiagnosticMessage | undefined
  const webhookStats = client
    .prepare(
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN event_type != 'test' THEN 1 ELSE 0 END) as nonTest,
        SUM(CASE WHEN status = 'failed' AND COALESCE(error, '') LIKE 'unauthorized webhook:%' THEN 1 ELSE 0 END) as failedAuth
       FROM wazzup_webhook_events`
    )
    .get() as { total: number; nonTest: number | null; failedAuth: number | null }
  const messagesStats = client.prepare("SELECT COUNT(*) as total FROM wazzup_messages").get() as { total: number }
  const latestEvent = recentWebhookEvents[0] ?? null

  return {
    recentWebhookEvents,
    latestMessage: latestMessage ?? null,
    webhookEventsCount: webhookStats.total,
    wazzupMessagesCount: messagesStats.total,
    failedAuthEventsCount: Number(webhookStats.failedAuth ?? 0),
    latestEventType: latestEvent?.eventType ?? "",
    latestError: latestEvent?.error ?? "",
    onlyTestWebhooks: webhookStats.total > 0 && Number(webhookStats.nonTest ?? 0) === 0,
  }
}

function getWazzupIframeDiagnostics(
  dealId: number,
  settings: WazzupServerSettings,
  target?: WazzupChatTarget
): WazzupIframeSafeDiagnostics {
  const client = initDb()
  const deal = client
    .prepare(
      `SELECT id, customer_id, customer_phone, source, wazzup_chat_type, wazzup_chat_id
       FROM deals
       WHERE id = ?`
    )
    .get(dealId) as
    | {
        id: number
        customer_id: number | null
        customer_phone: string | null
        source: string | null
        wazzup_chat_type: string | null
        wazzup_chat_id: string | null
      }
    | undefined
  const customer = deal?.customer_id
    ? (client
        .prepare(
          `SELECT id, phone, normalized_phone, wazzup_chat_type, wazzup_chat_id
           FROM customers
           WHERE id = ?`
        )
        .get(deal.customer_id) as
        | {
            id: number
            phone: string | null
            normalized_phone: string | null
            wazzup_chat_type: string | null
            wazzup_chat_id: string | null
          }
        | undefined)
    : null
  const normalizedPhone =
    clean(customer?.normalized_phone) || normalizePhone(customer?.phone || "") || normalizePhone(deal?.customer_phone || "") || ""
  const matchingMessages = client
    .prepare(
      `SELECT COUNT(*) as count
       FROM wazzup_messages
       WHERE (customer_id = @customerId AND @customerId IS NOT NULL)
        OR (chat_type = 'whatsapp' AND chat_id = @normalizedPhone AND @normalizedPhone != '')`
    )
    .get({
      customerId: deal?.customer_id ?? null,
      normalizedPhone,
    }) as { count: number }
  const lastWebhookEvent = client
    .prepare(
      `SELECT COALESCE(event_type, '') as eventType, COALESCE(status, '') as status,
        COALESCE(created_at, '') as createdAt, '' as error
       FROM wazzup_webhook_events
       ORDER BY id DESC
       LIMIT 1`
    )
    .get() as WazzupDiagnosticWebhookEvent | undefined
  const customerHasStoredChat = Boolean(clean(customer?.wazzup_chat_type) && clean(customer?.wazzup_chat_id))
  const hasPhone = Boolean(normalizedPhone)

  return {
    hasChatType: target?.status === "ok" ? Boolean(target.chatType) : Boolean(clean(deal?.wazzup_chat_type)),
    hasChatId: target?.status === "ok" ? Boolean(target.chatId) : Boolean(clean(deal?.wazzup_chat_id)),
    hasPhone,
    targetSource: target?.status === "ok" ? target.source : null,
    hasApiKey: Boolean(settings.apiKey),
    integrationEnabled: settings.isEnabled,
    webhookConfigured: settings.appUrlConfigured && Boolean(settings.webhookUrl),
    customerHasChat: customerHasStoredChat || matchingMessages.count > 0 || target?.status === "ok",
    dealHasChatId: Boolean(clean(deal?.wazzup_chat_id)) || target?.status === "ok",
    matchingMessagesCount: matchingMessages.count,
    lastWebhookEvent: lastWebhookEvent ?? null,
  }
}

async function withActiveWhatsappChannel(target: Extract<WazzupChatTarget, { status: "ok" }>) {
  if (target.chatType !== "whatsapp" || clean(target.channelId)) {
    return target
  }

  try {
    const activeChannels = (await listWazzupChannels()).filter(
      (channel) => channel.transport === "whatsapp" && channel.state === "active" && channel.channelId
    )
    if (activeChannels.length > 1) {
      console.warn("Multiple active Wazzup WhatsApp channels found; using the first active channel", {
        count: activeChannels.length,
        channelId: activeChannels[0].channelId,
      })
    }

    return activeChannels[0]?.channelId ? { ...target, channelId: activeChannels[0].channelId } : target
  } catch (error) {
    console.warn("Failed to resolve active Wazzup WhatsApp channel for iframe", {
      message: error instanceof Error ? error.message : "unknown",
    })
    return target
  }
}

function persistWazzupTargetForDeal(dealId: number, target: Extract<WazzupChatTarget, { status: "ok" }>) {
  initDb()
    .prepare(
      `UPDATE deals
       SET wazzup_chat_type = COALESCE(NULLIF(wazzup_chat_type, ''), @chatType),
        wazzup_chat_id = COALESCE(NULLIF(wazzup_chat_id, ''), @chatId),
        wazzup_channel_id = COALESCE(NULLIF(wazzup_channel_id, ''), NULLIF(@channelId, '')),
        source = CASE WHEN COALESCE(source, '') = '' OR source = 'manual' THEN @source ELSE source END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = @dealId`
    )
    .run({
      dealId,
      chatType: target.chatType,
      chatId: target.chatId,
      channelId: target.channelId,
      source: target.chatType,
    })
}

function upsertWazzupSettings(input: {
  apiKey: string | null
  crmKey: string | null
  isEnabled: boolean
  webhookAuthRequired?: boolean
  chatMode: WazzupChatMode
  lastCheckStatus?: string | null
  lastCheckMessage?: string | null
  lastCheckAt?: string | null
}) {
  const webhookUrl = buildWebhookUrl(clean(process.env.NEXT_PUBLIC_APP_URL))
  initDb()
    .prepare(
      `INSERT INTO integration_settings (
        provider, api_key, crm_key, webhook_url, webhook_auth_required, is_enabled, chat_mode,
        last_check_status, last_check_message, last_check_at, updated_at
      ) VALUES (
        @provider, @apiKey, @crmKey, @webhookUrl, @webhookAuthRequired, @isEnabled, @chatMode,
        @lastCheckStatus, @lastCheckMessage, @lastCheckAt, CURRENT_TIMESTAMP
      )
      ON CONFLICT(provider) DO UPDATE SET
        api_key = excluded.api_key,
        crm_key = excluded.crm_key,
        webhook_url = excluded.webhook_url,
        webhook_auth_required = excluded.webhook_auth_required,
        is_enabled = excluded.is_enabled,
        chat_mode = excluded.chat_mode,
        last_check_status = excluded.last_check_status,
        last_check_message = excluded.last_check_message,
        last_check_at = excluded.last_check_at,
        updated_at = CURRENT_TIMESTAMP`
    )
    .run({
      provider,
      apiKey: input.apiKey,
      crmKey: input.crmKey,
      webhookUrl,
      webhookAuthRequired: input.webhookAuthRequired ? 1 : 0,
      isEnabled: input.isEnabled ? 1 : 0,
      chatMode: input.chatMode,
      lastCheckStatus: input.lastCheckStatus ?? null,
      lastCheckMessage: input.lastCheckMessage ?? null,
      lastCheckAt: input.lastCheckAt ?? null,
    })
}

function saveWazzupLastCheck(status: "success" | "error", message: string) {
  const current = getWazzupSettingsRow()
  const settings = getWazzupSettingsForServer()
  upsertWazzupSettings({
    apiKey: clean(current?.api_key) || null,
    crmKey: clean(current?.crm_key) || null,
    isEnabled: current ? current.is_enabled === 1 : settings.isEnabled,
    webhookAuthRequired: current ? current.webhook_auth_required === 1 : settings.webhookAuthRequired,
    chatMode: settings.chatMode,
    lastCheckStatus: status,
    lastCheckMessage: message,
    lastCheckAt: new Date().toISOString(),
  })
}

async function safeWazzupIframeErrorMessage(response: Response) {
  if (response.status === 401) {
    return "Неверный Wazzup API key"
  }

  const data = (await response.json().catch(() => null)) as unknown
  const record = asRecord(data)
  const description = clean(record.description)
  const code = wazzupErrorCode(data)

  if (code === "INVALID_USER") {
    return "Пользователь CRM не синхронизирован с Wazzup. Попробуйте повторить или проверьте настройки Wazzup."
  }

  if (code || description) {
    return `Wazzup вернул ошибку ${response.status}${code ? `: ${code}` : ""}${description ? ` (${description})` : ""}`
  }

  return `Wazzup вернул HTTP ${response.status}`
}

function safeWazzupUserSyncErrorMessage(status: number, data: unknown) {
  if (status === 401) {
    return "Не удалось синхронизировать пользователя с Wazzup: неверный API key."
  }

  const code = wazzupErrorCode(data)
  if (code === "USER_LIMIT_EXCEEDED") {
    return "Не удалось синхронизировать пользователя с Wazzup: лимит пользователей Wazzup исчерпан."
  }
  if (code === "INVALID_USERS_DATA") {
    return "Не удалось синхронизировать пользователя с Wazzup: Wazzup не принял данные пользователя CRM."
  }

  return "Не удалось синхронизировать пользователя с Wazzup"
}

function safeWazzupUsersSyncErrorMessage(status: number, data: unknown) {
  if (status === 401) {
    return "Пользователи Wazzup не синхронизированы: неверный API key."
  }

  const code = wazzupErrorCode(data)
  if (code === "INVALID_USERS_DATA") {
    return "Пользователи Wazzup не синхронизированы: Wazzup не принял данные пользователей CRM."
  }
  if (code === "USER_LIMIT_EXCEEDED") {
    return "Пользователи Wazzup не синхронизированы: лимит пользователей Wazzup исчерпан."
  }
  if (code === "TOO_MANY_ENTITIES") {
    return "Пользователи Wazzup не синхронизированы: за один запрос можно отправить не больше 100 пользователей."
  }

  return `Пользователи Wazzup не синхронизированы: Wazzup вернул HTTP ${status}${code ? `: ${code}` : ""}`
}

function safeWazzupEntitySyncErrorMessage(prefix: string, status: number, data: unknown) {
  if (status === 401) {
    return `${prefix}: неверный API key.`
  }

  const code = wazzupErrorCode(data)
  if (code === "INVALID_CONTACTS_DATA") {
    return `${prefix}: Wazzup не принял данные контактов CRM.`
  }
  if (code === "INVALID_DEALS_DATA") {
    return `${prefix}: Wazzup не принял данные сделок CRM.`
  }
  if (code === "INVALID_PIPELINES_DATA") {
    return `${prefix}: Wazzup не принял данные воронок CRM.`
  }
  if (code === "TOO_MANY_ENTITIES") {
    return `${prefix}: за один запрос можно отправить не больше 100 сущностей.`
  }

  return `${prefix}: Wazzup вернул HTTP ${status}${code ? `: ${code}` : ""}`
}

// --- Устойчивый клиент Wazzup: таймаут на каждый запрос + повторы на временных ошибках ---
// Без этого медленный/недоступный Wazzup «подвешивал» бы экшен (открытие чата, синхронизацию,
// и особенно webhook). Повторы безопасны: все наши POST идемпотентны (upsert по id, а отправка
// сообщений — по детерминированному crmMessageId, который Wazzup дедуплицирует 60с).
const WAZZUP_REQUEST_TIMEOUT_MS = 12_000
const WAZZUP_MAX_RETRIES = 2
const WAZZUP_RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

function wazzupRetryDelayMs(attempt: number, retryAfter: string | null) {
  const value = (retryAfter ?? "").trim()
  if (value) {
    // Retry-After: либо число секунд, либо HTTP-дата (RFC 7231) — поддерживаем обе формы.
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 10_000)
    }
    const dateMs = Date.parse(value)
    if (Number.isFinite(dateMs)) {
      return Math.min(Math.max(0, dateMs - Date.now()), 10_000)
    }
  }
  return Math.min(500 * 2 ** attempt, 4_000)
}

function isAbortLikeError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
}

function normalizeWazzupNetworkError(error: unknown): Error {
  if (isAbortLikeError(error)) {
    return new Error("Wazzup не ответил вовремя (таймаут). Попробуйте ещё раз.")
  }
  return new Error("Не удалось связаться с Wazzup. Проверьте подключение и попробуйте ещё раз.")
}

async function wazzupFetch(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? WAZZUP_REQUEST_TIMEOUT_MS
  const maxRetries = options.retries ?? WAZZUP_MAX_RETRIES
  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (WAZZUP_RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
        void response.body?.cancel().catch(() => {})
        clearTimeout(timer)
        await new Promise((resolve) =>
          setTimeout(resolve, wazzupRetryDelayMs(attempt, response.headers.get("retry-after")))
        )
        continue
      }
      // Буферизуем тело под ТЕМ ЖЕ таймаутом: fetch() резолвится по приходу заголовков, а тело
      // стримится лениво — иначе «зависшее» тело обошло бы 12с. Возвращаем уже прочитанный
      // Response; у вызывающих .text()/.json() работают по памяти.
      const bodyText = await response.text()
      clearTimeout(timer)
      const nullBody =
        response.status === 101 || response.status === 204 || response.status === 205 || response.status === 304
      return new Response(nullBody ? null : bodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, wazzupRetryDelayMs(attempt, null)))
        continue
      }
    }
  }

  throw normalizeWazzupNetworkError(lastError)
}

async function requestWazzupJson(path: string, init: RequestInit) {
  const response = await requestWazzup(path, init)
  const raw = await response.text()
  const data = parseJson(raw)
  if (!response.ok) {
    throw new Error(safeWazzupApiErrorMessage(response.status, data))
  }

  return data
}

async function requestWazzup(path: string, init: RequestInit) {
  const settings = getWazzupSettingsForServer()
  if (!settings.apiKey) {
    throw new Error("Wazzup API key не настроен")
  }

  return wazzupFetch(`${wazzupApiBaseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      ...init.headers,
    },
  })
}

function normalizeWebhookConfig(data: unknown): WazzupWebhookConfig {
  const record = asRecord(data)
  const subscriptions = asRecord(record.subscriptions)

  return {
    webhooksUri: clean(record.webhooksUri),
    subscriptions: {
      messagesAndStatuses: booleanish(subscriptions.messagesAndStatuses),
      contactsAndDealsCreation: booleanish(subscriptions.contactsAndDealsCreation),
      channelsUpdates: booleanish(subscriptions.channelsUpdates),
      templateStatus: booleanish(subscriptions.templateStatus),
    },
  }
}

function safeWazzupApiErrorMessage(status: number, data: unknown) {
  if (status === 401) {
    return "401 Unauthorized: неверный Wazzup API key"
  }

  const record = asRecord(data)
  const error = clean(record.error)
  const description = clean(record.description)
  if (error === "uriNotValid") {
    return "uriNotValid: Webhook URL невалиден"
  }
  if (error === "testPostNotPassed") {
    return "testPostNotPassed: Wazzup не получил 200 OK от webhook endpoint"
  }

  return `Wazzup вернул HTTP ${status}${error ? `: ${error}` : ""}${description ? ` (${description})` : ""}`
}

function wazzupErrorCode(data: unknown) {
  const record = asRecord(data)
  const error = record.error
  return typeof error === "string"
    ? error
    : error && typeof error === "object" && !Array.isArray(error)
      ? clean((error as Record<string, unknown>).code) || clean((error as Record<string, unknown>).error)
      : ""
}

function safePatchBody(value: string, secret = "") {
  const cleanValue = clean(value)
  if (!cleanValue) {
    return "<empty>"
  }

  const data = parseJson(cleanValue)
  const record = asRecord(data)
  if (Object.keys(record).length) {
    return maskWebhookUrl(JSON.stringify(record), secret)
  }

  return maskWebhookUrl(cleanValue, secret).slice(0, 200)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function booleanish(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1"
}

type WazzupPipelinePayload = {
  pipelineId: number
  wazzupPipelineId: string
  stageIds: number[]
  payload: {
    id: string
    name: string
    stages?: Array<{ id: string; name: string }>
  }
}

type WazzupContactPayload = {
  customerId: number
  wazzupContactId: string
  payload: {
    id: string
    responsibleUserId: string
    name: string
    contactData: Array<{ chatType: string; chatId: string }>
    uri: string
  }
}

type WazzupDealPayload = {
  dealId: number
  wazzupDealId: string
  payload: {
    id: string
    responsibleUserId: string
    name: string
    uri: string
    contacts: string[]
    closed: boolean
  }
}

function wazzupUnavailableResult(settings: WazzupServerSettings, label: string): WazzupSyncResult | null {
  if (!settings.isEnabled) {
    return {
      ok: false,
      totalSent: 0,
      responseStatus: null,
      message: `${label}: интеграция Wazzup выключена.`,
      messages: [`${label}: интеграция Wazzup выключена.`],
    }
  }
  if (!settings.apiKey) {
    return {
      ok: false,
      totalSent: 0,
      responseStatus: null,
      message: `${label}: Wazzup API key не настроен на сервере.`,
      messages: [`${label}: Wazzup API key не настроен на сервере.`],
    }
  }

  return null
}

async function postWazzupEntityBatches(input: {
  path: string
  label: string
  payloads: unknown[]
  apiKey: string
  onChunkFailure: (start: number, end: number, message: string) => void
}): Promise<WazzupSyncResult> {
  let lastResponseStatus: number | null = null
  for (let index = 0; index < input.payloads.length; index += 100) {
    const chunk = input.payloads.slice(index, index + 100)
    const response = await wazzupFetch(`${wazzupApiBaseUrl}${input.path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    })
    lastResponseStatus = response.status
    const raw = await response.text()
    const data = parseJson(raw)

    if (!response.ok) {
      const message = safeWazzupEntitySyncErrorMessage(`${input.label} Wazzup не синхронизированы`, response.status, data)
      input.onChunkFailure(index, index + chunk.length, message)
      return {
        ok: false,
        totalSent: index + chunk.length,
        responseStatus: response.status,
        message,
        messages: [`POST /v3${input.path}: HTTP ${response.status}`, `${input.label} отправлено: ${index + chunk.length}`, message],
      }
    }
  }

  return {
    ok: true,
    totalSent: input.payloads.length,
    responseStatus: lastResponseStatus,
    message: `${input.label} отправлены в Wazzup`,
    messages: [`POST /v3${input.path}: HTTP ${lastResponseStatus ?? 200}`, `${input.label} отправлено: ${input.payloads.length}`],
  }
}

function getWazzupPipelinePayloads(client = initDb()): WazzupPipelinePayload[] {
  const pipelines = client
    .prepare("SELECT id, COALESCE(name, '') as name FROM deal_pipelines ORDER BY is_default DESC, id ASC")
    .all() as Array<{ id: number; name: string }>
  const stages = client
    .prepare("SELECT id, pipeline_id as pipelineId, COALESCE(name, '') as name FROM deal_stages ORDER BY position ASC, id ASC")
    .all() as Array<{ id: number; pipelineId: number; name: string }>

  return pipelines.map((pipeline) => {
    const pipelineStages = stages
      .filter((stage) => stage.pipelineId === pipeline.id)
      .map((stage) => ({
        id: String(stage.id).slice(0, 100),
        name: (clean(stage.name) || `Stage ${stage.id}`).slice(0, 100),
      }))
    const payload: WazzupPipelinePayload["payload"] = {
      id: String(pipeline.id).slice(0, 100),
      name: (clean(pipeline.name) || `Pipeline ${pipeline.id}`).slice(0, 100),
    }
    if (pipelineStages.length) {
      payload.stages = pipelineStages
    }

    return {
      pipelineId: Number(pipeline.id),
      wazzupPipelineId: payload.id,
      stageIds: stages.filter((stage) => stage.pipelineId === pipeline.id).map((stage) => Number(stage.id)),
      payload,
    }
  })
}

function getWazzupContactPayloads(customerIds?: number[]): WazzupContactPayload[] {
  const client = initDb()
  const allowed = customerIds?.length ? new Set(customerIds.map(Number)) : null
  const appBaseUrl = getCrmAppBaseUrl()
  const fallbackResponsible = resolveFallbackResponsibleUserId(client)
  const rows = client
    .prepare(
      `SELECT id, COALESCE(name, '') as name, COALESCE(phone, '') as phone,
        COALESCE(normalized_phone, '') as normalizedPhone,
        COALESCE(wazzup_chat_type, '') as wazzupChatType,
        COALESCE(wazzup_chat_id, '') as wazzupChatId
       FROM customers
       ORDER BY id ASC`
    )
    .all() as Array<{
    id: number
    name: string
    phone: string
    normalizedPhone: string
    wazzupChatType: string
    wazzupChatId: string
  }>

  return rows.flatMap((row) => {
    const customerId = Number(row.id)
    if (allowed && !allowed.has(customerId)) {
      return []
    }

    const chatType = clean(row.wazzupChatType) || "whatsapp"
    const chatId = normalizeChatId(chatType, clean(row.wazzupChatId) || clean(row.normalizedPhone) || normalizePhone(row.phone) || "")
    const responsibleUserId = resolveCustomerResponsibleUserId(client, customerId) ?? fallbackResponsible
    if (!chatId || !responsibleUserId) {
      return []
    }

    return [
      {
        customerId,
        wazzupContactId: String(customerId),
        payload: {
          id: String(customerId),
          responsibleUserId: String(responsibleUserId),
          name: (clean(row.name) || chatId).slice(0, 200),
          contactData: [{ chatType, chatId }],
          uri: buildCrmUri(appBaseUrl, `/clients/${customerId}`),
        },
      },
    ]
  })
}

function getWazzupDealPayloads(dealIds?: number[]): WazzupDealPayload[] {
  const client = initDb()
  const allowed = dealIds?.length ? new Set(dealIds.map(Number)) : null
  const appBaseUrl = getCrmAppBaseUrl()
  const fallbackResponsible = resolveFallbackResponsibleUserId(client)
  const rows = client
    .prepare(
      `SELECT deals.id, COALESCE(deals.number, '') as number, deals.customer_id as customerId,
        COALESCE(NULLIF(customers.name, ''), deals.customer_name, '') as customerName,
        COALESCE(deals.responsible_user_id, 0) as responsibleUserId,
        COALESCE(deals.status, 'open') as status,
        COALESCE(deals.title, '') as title,
        COALESCE(deal_stages.is_closed, 0) as stageIsClosed,
        COALESCE(deal_stages.is_won, 0) as stageIsWon
       FROM deals
       LEFT JOIN customers ON customers.id = deals.customer_id
       LEFT JOIN deal_stages ON deal_stages.id = deals.stage_id
       WHERE deals.customer_id IS NOT NULL
       ORDER BY deals.id ASC`
    )
    .all() as Array<{
    id: number
    number: string
    customerId: number | null
    customerName: string
    responsibleUserId: number
    status: string
    title: string
    stageIsClosed: number
    stageIsWon: number
  }>

  return rows.flatMap((row) => {
    const dealId = Number(row.id)
    if (allowed && !allowed.has(dealId)) {
      return []
    }
    if (!row.customerId) {
      return []
    }

    const responsibleUserId = Number(row.responsibleUserId) || fallbackResponsible
    if (!responsibleUserId) {
      return []
    }

    const nameParts = [clean(row.number), clean(row.customerName) || clean(row.title) || `Deal ${dealId}`].filter(Boolean)
    return [
      {
        dealId,
        wazzupDealId: String(dealId),
        payload: {
          id: String(dealId),
          responsibleUserId: String(responsibleUserId),
          name: nameParts.join(" · ").slice(0, 200),
          uri: buildCrmUri(appBaseUrl, `/deals/${dealId}`),
          contacts: [String(row.customerId)],
          closed: !isDealOpenStatus(row.status, Number(row.stageIsClosed), Number(row.stageIsWon)),
        },
      },
    ]
  })
}

// Тело ответа на синхронный handshake createContact/createDeal — сущность в сигнатуре CRUD,
// которую Wazzup ждёт (а не {ok}), чтобы связать свою сторону с только что созданной записью CRM.
export function buildWazzupContactEntity(customerId: number) {
  return getWazzupContactPayloads([customerId])[0]?.payload ?? null
}

export function buildWazzupDealEntity(dealId: number) {
  return getWazzupDealPayloads([dealId])[0]?.payload ?? null
}

function resolveCustomerResponsibleUserId(client: ReturnType<typeof initDb>, customerId: number) {
  const row = client
    .prepare(
      `SELECT responsible_user_id as userId
       FROM deals
       WHERE customer_id = ? AND responsible_user_id IS NOT NULL AND responsible_user_id != 0
       ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, updated_at DESC, id DESC
       LIMIT 1`
    )
    .get(customerId) as { userId: number | null } | undefined

  return row?.userId ? Number(row.userId) : null
}

function resolveFallbackResponsibleUserId(client: ReturnType<typeof initDb>) {
  const users = listUsers(client).filter((user) => user.isActive)
  return (users.find((user) => user.role === "manager") ?? users.find((user) => user.role === "owner") ?? users[0])?.id ?? null
}

function isDealOpenStatus(status: string, stageIsClosed: number, stageIsWon: number) {
  const normalizedStatus = clean(status)
  return normalizedStatus === "open" && stageIsClosed !== 1 && stageIsWon !== 1
}

function buildCrmUri(appBaseUrl: string, path: string) {
  return appBaseUrl ? `${appBaseUrl}${path}` : path
}

function getCrmAppBaseUrl() {
  const configured = clean(process.env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, "")
  if (configured) {
    return configured
  }

  const settings = getWazzupSettingsForServer()
  try {
    const webhookUrl = new URL(settings.webhookUrl)
    return webhookUrl.origin
  } catch {
    return ""
  }
}

function saveWazzupPipelineSyncSuccess(items: WazzupPipelinePayload[]) {
  const client = initDb()
  const now = new Date().toISOString()
  const save = client.transaction(() => {
    const pipelineStatement = client.prepare(
      `INSERT INTO wazzup_pipeline_sync (pipeline_id, wazzup_pipeline_id, status, last_synced_at, last_error)
       VALUES (@pipelineId, @wazzupPipelineId, 'synced', @lastSyncedAt, '')
       ON CONFLICT(pipeline_id) DO UPDATE SET
        wazzup_pipeline_id = excluded.wazzup_pipeline_id,
        status = excluded.status,
        last_synced_at = excluded.last_synced_at,
        last_error = ''`
    )
    const stageStatement = client.prepare(
      `INSERT INTO wazzup_stage_sync (stage_id, wazzup_stage_id, status, last_synced_at, last_error)
       VALUES (@stageId, @wazzupStageId, 'synced', @lastSyncedAt, '')
       ON CONFLICT(stage_id) DO UPDATE SET
        wazzup_stage_id = excluded.wazzup_stage_id,
        status = excluded.status,
        last_synced_at = excluded.last_synced_at,
        last_error = ''`
    )
    items.forEach((item) => {
      pipelineStatement.run({ pipelineId: item.pipelineId, wazzupPipelineId: item.wazzupPipelineId, lastSyncedAt: now })
      item.stageIds.forEach((stageId) => {
        stageStatement.run({ stageId, wazzupStageId: String(stageId), lastSyncedAt: now })
      })
    })
  })

  save()
}

function saveWazzupPipelineSyncFailure(items: WazzupPipelinePayload[], error: string) {
  const client = initDb()
  const save = client.transaction(() => {
    const pipelineStatement = client.prepare(
      `INSERT INTO wazzup_pipeline_sync (pipeline_id, wazzup_pipeline_id, status, last_synced_at, last_error)
       VALUES (@pipelineId, @wazzupPipelineId, 'failed', '', @lastError)
       ON CONFLICT(pipeline_id) DO UPDATE SET
        wazzup_pipeline_id = excluded.wazzup_pipeline_id,
        status = excluded.status,
        last_error = excluded.last_error`
    )
    const stageStatement = client.prepare(
      `INSERT INTO wazzup_stage_sync (stage_id, wazzup_stage_id, status, last_synced_at, last_error)
       VALUES (@stageId, @wazzupStageId, 'failed', '', @lastError)
       ON CONFLICT(stage_id) DO UPDATE SET
        wazzup_stage_id = excluded.wazzup_stage_id,
        status = excluded.status,
        last_error = excluded.last_error`
    )
    items.forEach((item) => {
      pipelineStatement.run({ pipelineId: item.pipelineId, wazzupPipelineId: item.wazzupPipelineId, lastError: error })
      item.stageIds.forEach((stageId) => {
        stageStatement.run({ stageId, wazzupStageId: String(stageId), lastError: error })
      })
    })
  })

  save()
}

function saveWazzupContactSyncSuccess(items: WazzupContactPayload[]) {
  saveWazzupEntityRows(
    "wazzup_contact_sync",
    "customer_id",
    "wazzup_contact_id",
    items.map((item) => ({ id: item.customerId, wazzupId: item.wazzupContactId })),
    "synced",
    ""
  )
}

function saveWazzupContactSyncFailure(items: WazzupContactPayload[], error: string) {
  saveWazzupEntityRows(
    "wazzup_contact_sync",
    "customer_id",
    "wazzup_contact_id",
    items.map((item) => ({ id: item.customerId, wazzupId: item.wazzupContactId })),
    "failed",
    error
  )
}

function saveWazzupDealSyncSuccess(items: WazzupDealPayload[]) {
  saveWazzupEntityRows(
    "wazzup_deal_sync",
    "deal_id",
    "wazzup_deal_id",
    items.map((item) => ({ id: item.dealId, wazzupId: item.wazzupDealId })),
    "synced",
    ""
  )
}

function saveWazzupDealSyncFailure(items: WazzupDealPayload[], error: string) {
  saveWazzupEntityRows(
    "wazzup_deal_sync",
    "deal_id",
    "wazzup_deal_id",
    items.map((item) => ({ id: item.dealId, wazzupId: item.wazzupDealId })),
    "failed",
    error
  )
}

function saveWazzupEntityRows(
  table: "wazzup_contact_sync" | "wazzup_deal_sync",
  idColumn: "customer_id" | "deal_id",
  wazzupIdColumn: "wazzup_contact_id" | "wazzup_deal_id",
  rows: Array<{ id: number; wazzupId: string }>,
  status: "synced" | "failed",
  error: string
) {
  const client = initDb()
  const now = new Date().toISOString()
  const save = client.transaction(() => {
    const statement = client.prepare(
      `INSERT INTO ${table} (${idColumn}, ${wazzupIdColumn}, status, last_synced_at, last_error)
       VALUES (@id, @wazzupId, @status, @lastSyncedAt, @lastError)
       ON CONFLICT(${idColumn}) DO UPDATE SET
        ${wazzupIdColumn} = excluded.${wazzupIdColumn},
        status = excluded.status,
        last_synced_at = CASE WHEN excluded.status = 'synced' THEN excluded.last_synced_at ELSE ${table}.last_synced_at END,
        last_error = excluded.last_error`
    )
    rows.forEach((row) => {
      statement.run({
        id: row.id,
        wazzupId: row.wazzupId,
        status,
        lastSyncedAt: status === "synced" ? now : "",
        lastError: error,
      })
    })
  })

  save()
}

function getWazzupEntitySyncStatus(): WazzupEntitySyncStatus {
  const client = initDb()
  return {
    pipelines: getWazzupSyncSummary(
      client,
      "wazzup_pipeline_sync",
      Number((client.prepare("SELECT COUNT(*) as count FROM deal_pipelines").get() as { count: number }).count)
    ),
    stages: getWazzupSyncSummary(
      client,
      "wazzup_stage_sync",
      Number((client.prepare("SELECT COUNT(*) as count FROM deal_stages").get() as { count: number }).count)
    ),
    contacts: getWazzupSyncSummary(client, "wazzup_contact_sync", getWazzupContactPayloads().length),
    deals: getWazzupSyncSummary(
      client,
      "wazzup_deal_sync",
      Number((client.prepare("SELECT COUNT(*) as count FROM deals WHERE customer_id IS NOT NULL").get() as { count: number }).count)
    ),
  }
}

function getWazzupSyncSummary(
  client: ReturnType<typeof initDb>,
  table: "wazzup_pipeline_sync" | "wazzup_stage_sync" | "wazzup_contact_sync" | "wazzup_deal_sync",
  total: number
): WazzupSyncSummary {
  const rows = client
    .prepare(`SELECT COALESCE(status, '') as status, COALESCE(last_synced_at, '') as lastSyncedAt, COALESCE(last_error, '') as lastError FROM ${table}`)
    .all() as Array<{ status: string; lastSyncedAt: string; lastError: string }>
  const synced = rows.filter((row) => row.status === "synced").length
  const failed = rows.filter((row) => row.status === "failed").length
  const lastSyncedAt = rows.map((row) => clean(row.lastSyncedAt)).filter(Boolean).sort().at(-1) ?? ""
  const lastError = rows
    .filter((row) => clean(row.lastError))
    .map((row) => clean(row.lastError))
    .at(-1) ?? ""

  return {
    total,
    synced,
    failed,
    pending: Math.max(total - synced - failed, 0),
    lastSyncedAt,
    lastError,
  }
}

export function listWazzupUserSyncStatuses(): WazzupUserSyncStatus[] {
  const client = initDb()
  const rows = client
    .prepare(
      `SELECT users.id as userId, users.login as crmLogin, users.name as crmName, users.role as crmRole,
        users.is_active as isActive, COALESCE(wazzup_user_sync.wazzup_user_id, '') as wazzupUserId,
        COALESCE(wazzup_user_sync.status, '') as syncStatus,
        COALESCE(wazzup_user_sync.last_synced_at, '') as lastSyncedAt,
        COALESCE(wazzup_user_sync.last_error, '') as lastError
       FROM users
       LEFT JOIN wazzup_user_sync ON wazzup_user_sync.user_id = users.id
       ORDER BY users.is_active DESC, users.role, users.name COLLATE NOCASE, users.login COLLATE NOCASE`
    )
    .all() as Array<{
    userId: number
    crmLogin: string
    crmName: string
    crmRole: string
    isActive: number
    wazzupUserId: string
    syncStatus: string
    lastSyncedAt: string
    lastError: string
  }>

  return rows.map((row) => {
    const isActive = Number(row.isActive ?? 0) === 1
    const status = clean(row.syncStatus)
    return {
      userId: Number(row.userId),
      crmName: clean(row.crmName),
      crmLogin: clean(row.crmLogin),
      crmRole: normalizeUserRole(row.crmRole),
      isActive,
      wazzupUserId: clean(row.wazzupUserId),
      syncStatus:
        status === "synced" || status === "failed" || status === "skipped"
          ? status
          : isActive
            ? "pending"
            : "skipped",
      lastSyncedAt: clean(row.lastSyncedAt),
      lastError: clean(row.lastError),
    }
  })
}

function saveWazzupUserSyncSuccess(users: Array<Pick<CurrentUser, "id" | "name" | "login">>) {
  const client = initDb()
  const now = new Date().toISOString()
  const save = client.transaction(() => {
    const statement = client.prepare(
      `INSERT INTO wazzup_user_sync (user_id, wazzup_user_id, name, status, last_synced_at, last_error)
       VALUES (@userId, @wazzupUserId, @name, 'synced', @lastSyncedAt, '')
       ON CONFLICT(user_id) DO UPDATE SET
        wazzup_user_id = excluded.wazzup_user_id,
        name = excluded.name,
        status = excluded.status,
        last_synced_at = excluded.last_synced_at,
        last_error = ''`
    )
    users.forEach((user) => {
      statement.run({
        userId: user.id,
        wazzupUserId: String(user.id),
        name: clean(user.name) || clean(user.login) || `User ${user.id}`,
        lastSyncedAt: now,
      })
    })
  })

  save()
}

function saveWazzupUserSyncFailure(users: Array<Pick<CurrentUser, "id" | "name" | "login">>, error: string) {
  const client = initDb()
  const save = client.transaction(() => {
    const statement = client.prepare(
      `INSERT INTO wazzup_user_sync (user_id, wazzup_user_id, name, status, last_synced_at, last_error)
       VALUES (@userId, @wazzupUserId, @name, 'failed', '', @lastError)
       ON CONFLICT(user_id) DO UPDATE SET
        wazzup_user_id = excluded.wazzup_user_id,
        name = excluded.name,
        status = excluded.status,
        last_error = excluded.last_error`
    )
    users.forEach((user) => {
      statement.run({
        userId: user.id,
        wazzupUserId: String(user.id),
        name: clean(user.name) || clean(user.login) || `User ${user.id}`,
        lastError: error,
      })
    })
  })

  save()
}

function normalizeUserRole(value: unknown): UserRole {
  const role = clean(value)
  return role === "manager" || role === "florist" ? role : "owner"
}

function getDealCustomerWazzupContext(customerId: number | null) {
  if (!customerId) {
    return null
  }

  return initDb()
    .prepare(
      `SELECT COALESCE(name, '') as name, COALESCE(phone, '') as phone,
        COALESCE(normalized_phone, '') as normalized_phone,
        COALESCE(wazzup_chat_type, '') as wazzup_chat_type,
        COALESCE(wazzup_chat_id, '') as wazzup_chat_id,
        COALESCE(wazzup_channel_id, '') as wazzup_channel_id
       FROM customers
       WHERE id = ?
       LIMIT 1`
    )
    .get(customerId) as
    | {
        name: string
        phone: string
        normalized_phone: string
        wazzup_chat_type: string
        wazzup_chat_id: string
        wazzup_channel_id: string
      }
    | undefined
}

function targetName(deal: Pick<Deal, "customerName" | "customerPhone" | "title">) {
  return clean(deal.customerName) || clean(deal.customerPhone) || clean(deal.title)
}

function normalizeChatId(chatType: string, chatId: string) {
  return chatType === "whatsapp" || chatType === "viber" ? chatId.replace(/\D/g, "") : chatId
}

function buildWebhookUrl(appUrl: string) {
  return appUrl ? `${appUrl.replace(/\/+$/, "")}/api/wazzup/webhook` : wazzupWebhookTargetUrl
}

function buildSecureWebhookUrl(webhookUrl: string, crmKey: string) {
  const baseUrl = clean(webhookUrl) || wazzupWebhookTargetUrl
  const key = clean(crmKey)
  if (!key) {
    return stripWebhookSecret(baseUrl)
  }

  const [base, hash = ""] = baseUrl.split("#", 2)
  const [path, query = ""] = base.split("?", 2)
  const params = new URLSearchParams(query)
  params.set("key", key)
  const nextUrl = `${path}?${params.toString()}`
  return hash ? `${nextUrl}#${hash}` : nextUrl
}

function stripWebhookSecret(webhookUrl: string) {
  const value = clean(webhookUrl)
  if (!value) {
    return ""
  }

  const [base, hash = ""] = value.split("#", 2)
  const [path, query = ""] = base.split("?", 2)
  if (!query) {
    return value
  }

  const params = new URLSearchParams(query)
  params.delete("key")
  params.delete("crmKey")
  const nextQuery = params.toString()
  const nextUrl = nextQuery ? `${path}?${nextQuery}` : path
  return hash ? `${nextUrl}#${hash}` : nextUrl
}

function maskWebhookUrl(webhookUrl: string, secret = "") {
  const value = clean(webhookUrl)
  const key = clean(secret)
  if (key) {
    return value.replaceAll(key, maskSecret(key) ?? "••••")
  }

  return value.replace(/([?&](?:key|crmKey)=)([^&#]+)/gi, (_match, prefix: string, token: string) => {
    const decoded = decodeURIComponent(token)
    return `${prefix}${encodeURIComponent(maskSecret(decoded) ?? "••••")}`
  })
}

function maskSecret(value: string) {
  const secret = clean(value)
  if (!secret) {
    return null
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}••••${secret.slice(-2)}`
  }

  return `${secret.slice(0, 4)}••••••${secret.slice(-4)}`
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}
