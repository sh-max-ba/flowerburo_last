import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { getCurrentUser } from "@/lib/auth"
import { chatUploadTypes, maxChatUploadSize } from "@/lib/chat-uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uploadsDir = path.join(process.cwd(), "public", "uploads", "chat")

// Вложение в чат (фото, видео, документ): сохраняем в public/uploads/chat и возвращаем путь, который
// уходит в Wazzup как contentUri (абсолютизируется через NEXT_PUBLIC_APP_URL при отправке) и
// тип сообщения по MIME. Лимит 10 MB — лимит контента Wazzup (MESSAGES_CONTENT_SIZE_EXCEEDED).
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user || (user.role !== "owner" && user.role !== "manager")) {
    return Response.json({ ok: false, message: "Недостаточно прав." }, { status: 403 })
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
  if (file.size > maxChatUploadSize) {
    return Response.json({ ok: false, message: "Файл не больше 10 MB — такой лимит у мессенджеров." }, { status: 400 })
  }

  const mime = file.type.split(";")[0]?.trim().toLowerCase() ?? ""
  const kind = chatUploadTypes.get(mime)
  if (!kind) {
    return Response.json(
      { ok: false, message: "Такой тип файла отправить нельзя. Подойдут фото, видео, PDF и документы Office." },
      { status: 400 }
    )
  }

  await fs.mkdir(uploadsDir, { recursive: true })
  const filename = `chat-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${kind.ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(path.join(uploadsDir, filename), buffer, { flag: "wx" })

  return Response.json({
    ok: true,
    path: `/uploads/chat/${filename}`,
    messageType: kind.messageType,
    name: file.name || filename,
    size: file.size,
  })
}
