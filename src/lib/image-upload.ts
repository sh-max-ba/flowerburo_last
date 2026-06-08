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
