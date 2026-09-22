import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  getBouquetTemplate,
  getChatById,
  getWazzupChatRevision,
  getWazzupMessageById,
  listWazzupChatMessages,
  setChatChannel,
  touchChatOnMessage,
  upsertOutboundWazzupMessage,
  type ChatSummary,
  type CurrentUser,
  type WazzupMessage,
} from "@/lib/db"
import { fetchRemoteMedia } from "@/lib/media-fetch"
import { storeOrderImage } from "@/lib/order-image-files"
import { formatOrderForChat } from "@/lib/order-message"
import { getOrderById } from "@/lib/crm"
import type { OrderImage, OrderImageKind } from "@/lib/db"
import { getSafeBouquetImagePath } from "@/lib/product-images"
import {
  buildBouquetMessageText,
  getAbsoluteBouquetImageUrl,
  getWazzupSettingsForServer,
  postWazzupMessage,
  resolveActiveChannelForChatType,
  safeWazzupBouquetSendErrorMessage,
  toAbsoluteAppUrl,
} from "@/lib/wazzup"

// Серверная логика единого окна чатов: лента диалога и отправка в него (текст, вложение, букет,
// пересылка). Цель — строка `chats` (тип, id, канал), а не сделка. Wazzup API вызывается только
// здесь (ключи на сервере); в БД пишем исходящее сразу, эхо-вебхук потом сольётся по messageId.

export type ChatFeedResult =
  | { status: "ok"; chat: ChatSummary; messages: WazzupMessage[]; revision: string }
  | { status: "not_found" | "error"; message: string }

export type ChatFeedProbeResult = { status: "ok"; revision: string } | { status: "not_found" | "error"; message: string }

export type SendChatMessageOptions = {
  text?: string
  contentUri?: string
  messageType?: string
  fileName?: string
  refMessageId?: string
  quotedText?: string
  forwarded?: boolean
}

const chatUploadsDir = path.join(process.cwd(), "public", "uploads", "chat")

export function getChatFeed(chatRowId: number): ChatFeedResult {
  const chat = getChatById(chatRowId)
  if (!chat) {
    return { status: "not_found", message: "Диалог не найден." }
  }
  const identity = { dealId: null, chatType: chat.chatType, chatId: chat.chatId }
  return {
    status: "ok",
    chat,
    messages: listWazzupChatMessages(identity, { limit: 300 }),
    revision: getWazzupChatRevision(identity),
  }
}

export function getChatFeedProbe(chatRowId: number): ChatFeedProbeResult {
  const chat = getChatById(chatRowId)
  if (!chat) {
    return { status: "not_found", message: "Диалог не найден." }
  }
  return { status: "ok", revision: getWazzupChatRevision({ dealId: null, chatType: chat.chatType, chatId: chat.chatId }) }
}

async function resolveSendTarget(chat: ChatSummary) {
  const settings = getWazzupSettingsForServer()
  if (!settings.isEnabled) {
    throw new Error("Интеграция Wazzup выключена в настройках.")
  }
  if (!settings.apiKey) {
    throw new Error("Wazzup API key не настроен на сервере.")
  }
  const channelId = chat.channelId || (await resolveActiveChannelForChatType(chat.chatType))
  if (!channelId) {
    throw new Error("Нет активного канала Wazzup для этого мессенджера — подключите канал в настройках.")
  }
  return { channelId }
}

// Одно сообщение в диалог: текст ИЛИ вложение (в /v3/message они взаимоисключающи). Уникальный
// crmMessageId на вызов даёт идемпотентность при сетевом ретрае.
export async function sendChatMessage(
  chatRowId: number,
  currentUser: CurrentUser,
  options: SendChatMessageOptions
): Promise<{ ok: true; messageId: string; repeated: boolean }> {
  const chat = getChatById(chatRowId)
  if (!chat) {
    throw new Error("Диалог не найден.")
  }
  const text = clean(options.text ?? "")
  const rawContentUri = clean(options.contentUri ?? "")
  if (!text && !rawContentUri) {
    throw new Error("Введите текст сообщения.")
  }
  if (text && rawContentUri) {
    throw new Error("Нельзя отправить текст и вложение одним сообщением.")
  }
  if (chat.chatType === "instagram" && text.length > 1000) {
    throw new Error("Instagram принимает не больше 1000 символов в сообщении.")
  }

  try {
    const { channelId } = await resolveSendTarget(chat)
    const contentUri = rawContentUri ? toAbsoluteAppUrl(rawContentUri) : ""
    const messageType = contentUri ? clean(options.messageType) || "document" : "text"
    const refMessageId = clean(options.refMessageId ?? "")
    const crmMessageId = `chat-${chat.id}-${crypto.randomUUID()}`
    const result = await postWazzupMessage({
      channelId,
      chatType: chat.chatType,
      chatId: chat.chatId,
      crmUserId: String(currentUser.id),
      crmMessageId,
      ...(contentUri ? { contentUri } : { text }),
      ...(refMessageId ? { refMessageId } : {}),
    })

    const dateTime = new Date().toISOString()
    if (!result.repeated && result.messageId) {
      upsertOutboundWazzupMessage({
        messageId: result.messageId,
        crmMessageId,
        dealId: null,
        customerId: chat.customerId,
        channelId,
        chatType: chat.chatType,
        chatId: result.chatId || chat.chatId,
        messageType,
        text: contentUri ? null : text,
        contentUri: contentUri || null,
        authorName: currentUser.name,
        quotedMessageId: refMessageId || null,
        quotedText: refMessageId ? clean(options.quotedText ?? "") : null,
        forwarded: Boolean(options.forwarded),
        fileName: clean(options.fileName ?? "") || null,
        dateTime,
      })
    }
    touchChatOnMessage({
      chatType: chat.chatType,
      chatId: chat.chatId,
      channelId,
      direction: "outbound",
      messageType,
      text: contentUri ? "" : text,
      dateTime,
      author: { id: currentUser.id, name: currentUser.name },
    })
    setChatChannel(chat.id, channelId)

    return { ok: true, messageId: result.messageId, repeated: result.repeated }
  } catch (error) {
    throw new Error(safeWazzupBouquetSendErrorMessage(error))
  }
}

// Букет из каталога: фото (если есть) и затем текст с ценой и описанием.
export async function sendBouquetToChat(chatRowId: number, bouquetId: number, currentUser: CurrentUser) {
  const bouquet = getBouquetTemplate(bouquetId)
  if (!bouquet || !bouquet.isActive) {
    throw new Error("Активный букет не найден.")
  }
  const imagePath = getSafeBouquetImagePath(bouquet.imagePath)
  if (clean(bouquet.imagePath) && !imagePath) {
    throw new Error("Фото букета недоступно.")
  }
  if (imagePath) {
    await sendChatMessage(chatRowId, currentUser, {
      contentUri: getAbsoluteBouquetImageUrl(imagePath),
      messageType: "image",
      fileName: `${bouquet.name}.jpg`,
    })
  }
  await sendChatMessage(chatRowId, currentUser, { text: buildBouquetMessageText(bouquet) })
}

// Состав заказа клиенту одним сообщением (разметка мессенджера, см. order-message.ts).
export async function sendOrderSummaryToChat(chatRowId: number, orderId: number, currentUser: CurrentUser) {
  const order = getOrderById(orderId)
  if (!order) {
    throw new Error("Заказ не найден.")
  }
  const chat = getChatById(chatRowId)
  if (!chat) {
    throw new Error("Диалог не найден.")
  }
  if (order.customerId && chat.customerId && order.customerId !== chat.customerId) {
    throw new Error("Этот заказ принадлежит другому клиенту.")
  }
  return sendChatMessage(chatRowId, currentUser, { text: formatOrderForChat(order) })
}

// Пересылка: у Wazzup нет нативного forward — отправляем содержимое заново. Вложение сначала
// забираем к себе (ссылки Wazzup на контент протухают), затем шлём публичный URL нашего файла.
export async function forwardChatMessage(messageRowId: number, targetChatRowId: number, currentUser: CurrentUser) {
  const message = getWazzupMessageById(messageRowId)
  if (!message) {
    throw new Error("Сообщение не найдено.")
  }
  const target = getChatById(targetChatRowId)
  if (!target) {
    throw new Error("Диалог для пересылки не найден.")
  }
  const text = clean(message.text)
  const contentUri = clean(message.contentUri)
  if (!text && !contentUri) {
    throw new Error("В этом сообщении нечего пересылать.")
  }

  if (contentUri) {
    const localPath = await localizeRemoteMedia(contentUri, message.messageId || String(message.id))
    await sendChatMessage(target.id, currentUser, {
      contentUri: localPath,
      messageType: message.messageType || "document",
      fileName: message.fileName || fileNameFromUri(contentUri),
      forwarded: true,
    })
  }
  if (text) {
    await sendChatMessage(target.id, currentUser, { text, forwarded: true })
  }
}

// Вложение из чата → изображение заказа (фото-референс или чек). Забираем байты (свой файл — с
// диска, Wazzup — по ссылке), прогоняем через общую обработку и создаём строку order_images,
// ожидающую привязки; форма заказа получит её id через orderImageIds.
export async function attachChatMediaToOrder(
  messageRowId: number,
  kind: OrderImageKind,
  currentUser: CurrentUser
): Promise<OrderImage> {
  const message = getWazzupMessageById(messageRowId)
  if (!message || !clean(message.contentUri)) {
    throw new Error("В этом сообщении нет вложения.")
  }
  if (message.messageType !== "image") {
    throw new Error("К заказу можно прикрепить только фото.")
  }
  const { bytes, contentType } = await readChatMedia(message.contentUri)
  return storeOrderImage({
    bytes,
    mimeType: contentType,
    originalName: message.fileName || fileNameFromUri(message.contentUri) || "chat-photo.jpg",
    kind,
    userId: currentUser.id,
  })
}

async function readChatMedia(uri: string): Promise<{ bytes: Buffer; contentType: string }> {
  const appUrl = clean(process.env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, "")
  const relative = uri.startsWith("/uploads/") ? uri : appUrl && uri.startsWith(`${appUrl}/uploads/`) ? uri.slice(appUrl.length) : ""
  const match = /^\/uploads\/([a-z0-9_-]+)\/([a-z0-9._-]+)$/i.exec(relative.split("?")[0] ?? "")
  if (match && !match[2].includes("..")) {
    const bytes = await fs.readFile(path.join(process.cwd(), "public", "uploads", match[1], match[2]))
    return { bytes, contentType: "image/*" }
  }
  const remote = await fetchRemoteMedia(uri, { maxBytes: 15 * 1024 * 1024 })
  return { bytes: Buffer.from(remote.bytes), contentType: remote.contentType }
}

// Копия удалённого файла в public/uploads/chat: имя — по хэшу исходного messageId, чтобы повторная
// пересылка одного и того же не плодила файлы.
async function localizeRemoteMedia(remoteUri: string, key: string): Promise<string> {
  // Наш собственный файл (уже под NEXT_PUBLIC_APP_URL или относительный путь) — отдаём как есть.
  const appUrl = clean(process.env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, "")
  if (remoteUri.startsWith("/uploads/")) {
    return remoteUri
  }
  if (appUrl && remoteUri.startsWith(`${appUrl}/uploads/`)) {
    return remoteUri.slice(appUrl.length)
  }

  const { bytes, contentType } = await fetchRemoteMedia(remoteUri, { maxBytes: 10 * 1024 * 1024 })
  const ext = extensionFor(contentType, remoteUri)
  const filename = `fwd-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}${ext}`
  await fs.mkdir(chatUploadsDir, { recursive: true })
  const filePath = path.join(chatUploadsDir, filename)
  try {
    await fs.writeFile(filePath, bytes, { flag: "wx" })
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error
    }
  }
  return `/uploads/chat/${filename}`
}

const extensionByMime: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/webm": ".webm",
  "application/pdf": ".pdf",
}

function extensionFor(contentType: string, uri: string) {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? ""
  if (extensionByMime[mime]) {
    return extensionByMime[mime]
  }
  const fromUri = path.extname(fileNameFromUri(uri)).toLowerCase()
  return /^\.[a-z0-9]{1,5}$/.test(fromUri) ? fromUri : ".bin"
}

export function fileNameFromUri(uri: string) {
  try {
    const pathname = new URL(uri).pathname
    return decodeURIComponent(pathname.split("/").pop() ?? "")
  } catch {
    return uri.split("/").pop() ?? ""
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}
