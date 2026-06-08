import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Wazzup лимит контента — 10 МБ (MESSAGES_CONTENT_SIZE_EXCEEDED), держимся в нём.
const maxFileSize = 10 * 1024 * 1024
const uploadsDir = path.join(process.cwd(), "public", "uploads", "voice")
// MediaRecorder обычно отдаёт audio/webm (Chrome) или audio/ogg (Firefox).
const allowedTypes = new Map<string, string>([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
])

// Принимает записанное голосовое, сохраняет в public/uploads/voice и возвращает путь, который потом
// уходит в Wazzup как contentUri (абсолютизируется через NEXT_PUBLIC_APP_URL при отправке).
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user || (user.role !== "owner" && user.role !== "manager")) {
    return Response.json({ ok: false, message: "Недостаточно прав." }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json({ ok: false, message: "Файл не передан." }, { status: 400 })
  }
  if (file.size <= 0) {
    return Response.json({ ok: false, message: "Пустая запись." }, { status: 400 })
  }
  if (file.size > maxFileSize) {
    return Response.json({ ok: false, message: "Голосовое не больше 10 MB." }, { status: 400 })
  }

  const ext = allowedTypes.get(file.type.split(";")[0]?.trim() ?? "")
  if (!ext) {
    return Response.json({ ok: false, message: "Неподдерживаемый формат аудио." }, { status: 400 })
  }

  await fs.mkdir(uploadsDir, { recursive: true })
  const filename = `voice-${crypto.randomBytes(8).toString("hex")}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(path.join(uploadsDir, filename), buffer, { flag: "wx" })

  return Response.json({ ok: true, path: `/uploads/voice/${filename}` })
}
