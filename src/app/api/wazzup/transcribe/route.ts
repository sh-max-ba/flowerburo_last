import { type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getWazzupTranscriptionSource, saveWazzupMessageTranscript } from "@/lib/db"
import { fetchRemoteMedia, MediaFetchError } from "@/lib/media-fetch"
import { transcribeAudioToText, TranscriptionError } from "@/lib/transcription"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// OpenAI принимает аудио до 25 МБ.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

// Один эндпоинт на обе фичи. Только owner+manager (как медиа/голос). Два режима:
//   • multipart `file`        — разовая надиктовка (текст в поле ввода), без кэша;
//   • JSON `{ messageId }`     — расшифровка существующего голосового, с кэшем в БД.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role === "florist") {
    return Response.json({ ok: false, message: "Недостаточно прав." }, { status: 403 })
  }

  try {
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("multipart/form-data")) {
      return await transcribeUpload(request)
    }
    return await transcribeExisting(request)
  } catch (error) {
    return errorResponse(error)
  }
}

// Надиктовка: распознаём записанный фрагмент и возвращаем текст (отправку не делаем — её решает клиент).
async function transcribeUpload(request: NextRequest): Promise<Response> {
  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File) || file.size <= 0) {
    return Response.json({ ok: false, message: "Пустая запись." }, { status: 400 })
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json({ ok: false, message: "Запись слишком большая для распознавания." }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = file.type || "audio/webm"
  const text = await transcribeAudioToText({
    bytes,
    filename: audioFilename(file.name, contentType, "voice"),
    contentType,
  })
  return Response.json({ ok: true, text })
}

// Расшифровка существующего голосового: если уже в кэше — отдаём сразу; иначе тянем аудио по id строки
// (через общий медиа-фетч с SSRF-guard), распознаём и сохраняем результат на сообщении.
async function transcribeExisting(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { messageId?: unknown } | null
  const id = Number(body?.messageId)
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ ok: false, message: "Сообщение не найдено." }, { status: 400 })
  }

  const source = getWazzupTranscriptionSource(id)
  if (!source) {
    return Response.json({ ok: false, message: "Сообщение не найдено." }, { status: 404 })
  }
  if (source.transcript) {
    return Response.json({ ok: true, text: source.transcript, cached: true })
  }

  let media: { bytes: Uint8Array<ArrayBuffer>; contentType: string }
  try {
    media = await fetchRemoteMedia(source.contentUri, { maxBytes: MAX_AUDIO_BYTES })
  } catch (error) {
    if (error instanceof MediaFetchError) {
      return Response.json({ ok: false, message: "Не удалось получить аудио сообщения." }, { status: 502 })
    }
    throw error
  }

  const text = await transcribeAudioToText({
    bytes: media.bytes,
    filename: audioFilename("", media.contentType, `message-${id}`),
    contentType: media.contentType,
  })
  saveWazzupMessageTranscript(id, text)
  return Response.json({ ok: true, text })
}

function errorResponse(error: unknown): Response {
  if (error instanceof TranscriptionError) {
    const status =
      error.code === "no_key" || error.code === "auth" ? 500 : error.code === "empty" ? 422 : 502
    return Response.json({ ok: false, message: error.message }, { status })
  }
  return Response.json({ ok: false, message: "Не удалось распознать речь." }, { status: 500 })
}

// OpenAI определяет формат по расширению имени файла — даём корректное по content-type.
const extByType = new Map<string, string>([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/oga", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "m4a"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/flac", "flac"],
])

function audioFilename(originalName: string, contentType: string, fallbackBase: string): string {
  if (originalName && /\.[a-z0-9]+$/i.test(originalName)) {
    return originalName
  }
  const ext = extByType.get((contentType.split(";")[0] ?? "").trim().toLowerCase()) ?? "webm"
  return `${fallbackBase}.${ext}`
}
