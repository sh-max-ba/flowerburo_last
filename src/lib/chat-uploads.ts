// Допустимые вложения чата: MIME → расширение на диске и тип сообщения Wazzup
// (image / video / audio / document — см. references/webhooks.md, поле type).
export const maxChatUploadSize = 10 * 1024 * 1024

export const chatUploadTypes = new Map<string, { ext: string; messageType: "image" | "video" | "audio" | "document" }>([
  ["image/jpeg", { ext: "jpg", messageType: "image" }],
  ["image/png", { ext: "png", messageType: "image" }],
  ["image/webp", { ext: "webp", messageType: "image" }],
  ["image/gif", { ext: "gif", messageType: "image" }],
  ["video/mp4", { ext: "mp4", messageType: "video" }],
  ["video/quicktime", { ext: "mov", messageType: "video" }],
  ["video/webm", { ext: "webm", messageType: "video" }],
  ["audio/mpeg", { ext: "mp3", messageType: "audio" }],
  ["audio/mp4", { ext: "m4a", messageType: "audio" }],
  ["audio/ogg", { ext: "ogg", messageType: "audio" }],
  ["audio/webm", { ext: "weba", messageType: "audio" }],
  ["application/pdf", { ext: "pdf", messageType: "document" }],
  ["application/msword", { ext: "doc", messageType: "document" }],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", { ext: "docx", messageType: "document" }],
  ["application/vnd.ms-excel", { ext: "xls", messageType: "document" }],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { ext: "xlsx", messageType: "document" }],
  ["text/plain", { ext: "txt", messageType: "document" }],
])

// Обратная карта для раздачи файлов из public/uploads/chat по расширению.
export const chatUploadContentTypes: Record<string, string> = Object.fromEntries(
  Array.from(chatUploadTypes.entries()).map(([mime, kind]) => [kind.ext, mime])
)
// Пересланные вложения (localizeRemoteMedia) могут иметь другие расширения.
Object.assign(chatUploadContentTypes, { bin: "application/octet-stream", jpeg: "image/jpeg" })
