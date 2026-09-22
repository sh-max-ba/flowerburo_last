import type { OrderImage } from "@/lib/db"

// Загрузка фото на /api/.../image. Ответ разбираем аккуратно: при НЕ-JSON (например,
// HTML-страница «413 Request Entity Too Large» от nginx, когда файл больше лимита прокси)
// или ошибочном статусе бросаем понятное сообщение, а не «Unexpected token '<', "<html>…»».
export async function uploadImageFile(url: string, file: File): Promise<string> {
  const formData = new FormData()
  formData.set("file", file)

  const response = await fetch(url, { method: "POST", body: formData })

  let payload: { ok?: boolean; message?: string; imagePath?: string } | null = null
  try {
    const text = await response.text()
    payload = text ? (JSON.parse(text) as { ok?: boolean; message?: string; imagePath?: string }) : null
  } catch {
    // Тело не JSON (HTML-страница ошибки от прокси/сервера) — оставляем payload = null.
    payload = null
  }

  if (!response.ok || !payload?.ok || !payload.imagePath) {
    const fallback =
      response.status === 413
        ? "Файл слишком большой для загрузки."
        : "Не удалось загрузить фото. Попробуйте ещё раз."
    throw new Error(payload?.message || fallback)
  }

  return payload.imagePath
}

// Загрузка изображения к заказу на POST /api/orders/images с прогрессом (XHR — у fetch прогресса
// отправки нет, а фото с телефона на мобильном интернете уходит секунды). Возвращает строку
// order_images «ожидает привязки» — форма заказа отправит её id в orderImageIds.
export function uploadOrderImageFile(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<OrderImage> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.set("file", file)

    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/orders/images")
    xhr.responseType = "text"
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(1, event.loaded / event.total))
      }
    }
    xhr.onerror = () => reject(new Error("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз."))
    xhr.onabort = () => reject(new Error("Загрузка отменена."))
    xhr.onload = () => {
      type Payload = { ok?: boolean; message?: string; image?: OrderImage }
      let payload: Payload | null = null
      try {
        payload = xhr.responseText ? (JSON.parse(xhr.responseText) as Payload) : null
      } catch {
        payload = null
      }
      if (xhr.status < 200 || xhr.status >= 300 || !payload?.ok || !payload.image) {
        const fallback =
          xhr.status === 413
            ? "Файл слишком большой для загрузки."
            : "Не удалось загрузить изображение. Попробуйте ещё раз."
        reject(new Error(payload?.message || fallback))
        return
      }
      resolve(payload.image)
    }
    xhr.send(formData)
  })
}
