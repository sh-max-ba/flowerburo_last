// Изображения-референсы заказа (фото от клиента, скриншот из чата, пример букета).
// Модуль общий для клиента и сервера — только константы и чистые помощники без node-зависимостей.

export const orderImagePublicPathPrefix = "/uploads/orders/"

// Сколько изображений можно прикрепить к одному заказу.
export const maxOrderImages = 10

// Лимит исходного файла. Фото с телефона — 3–12 MB; nginx пропускает до 16 MB (client_max_body_size).
export const maxOrderImageFileSize = 15 * 1024 * 1024

// Имя скрытого поля формы: список id изображений через запятую. Само присутствие поля означает,
// что форма «знает» про изображения (старая вкладка без поля не должна молча стирать прикреплённое).
export const orderImageIdsFieldName = "orderImageIds"

export function getSafeOrderImagePath(value: unknown) {
  if (typeof value !== "string") {
    return ""
  }
  const imagePath = value.trim()
  if (!imagePath.startsWith(orderImagePublicPathPrefix)) {
    return ""
  }
  const filename = imagePath.slice(orderImagePublicPathPrefix.length)
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return ""
  }
  return imagePath
}

// «12,15, 3» -> [12, 15, 3]; мусор и дубли отбрасываем, порядок сохраняем (это порядок показа).
export function parseOrderImageIds(value: unknown): number[] {
  if (typeof value !== "string") {
    return []
  }
  const seen = new Set<number>()
  const ids: number[] = []
  for (const part of value.split(",")) {
    const id = Number(part.trim())
    if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}
