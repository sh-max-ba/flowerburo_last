import { getCurrentUser } from "@/lib/auth"
import { OrderImageError, storeOrderImage } from "@/lib/order-image-files"
import { maxOrderImageFileSize } from "@/lib/order-images"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Загрузка изображения к заказу из формы. Поле kind — «photo» (по умолчанию) или «receipt» (чек).
// Обработка и запись строки order_images (order_id = NULL до сохранения формы) — в
// src/lib/order-image-files.ts, общем с вложениями из чата.
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ ok: false, message: "Нужно войти в систему." }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ ok: false, message: "Не удалось прочитать файл." }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json({ ok: false, message: "Файл не передан." }, { status: 400 })
  }
  if (file.size <= 0) {
    return Response.json({ ok: false, message: "Файл пустой." }, { status: 400 })
  }
  if (file.size > maxOrderImageFileSize) {
    return Response.json(
      { ok: false, message: `Файл слишком большой — до ${Math.round(maxOrderImageFileSize / 1024 / 1024)} MB.` },
      { status: 400 }
    )
  }

  const kind = formData.get("kind") === "receipt" ? "receipt" : "photo"
  try {
    const image = await storeOrderImage({
      bytes: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      originalName: file.name,
      kind,
      userId: user.id,
    })
    return Response.json({ ok: true, image })
  } catch (error) {
    if (error instanceof OrderImageError) {
      return Response.json({ ok: false, message: error.message }, { status: 400 })
    }
    throw error
  }
}
