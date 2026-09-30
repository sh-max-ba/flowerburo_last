import fs from "node:fs/promises"
import path from "node:path"
import { type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { canAccessSection } from "@/lib/nav"
import { getWazzupMessageMedia } from "@/lib/db"
import { chatUploadContentTypes } from "@/lib/chat-uploads"
import { fetchRemoteMedia, MediaFetchError } from "@/lib/media-fetch"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_BYTES = 25 * 1024 * 1024

// Прокси медиа сообщений: content_uri от Wazzup может протухать и не должен утекать в клиент как
// внешняя ссылка. Тянем по id строки wazzup_messages (а не по произвольному URL из запроса), под
// auth раздела «Чаты» — поэтому подделать цель нельзя. Короткий приватный кэш гасит повторные тяги.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !canAccessSection("chats", user.role, false)) {
    return new Response("Forbidden", { status: 403 })
  }

  const id = Number(request.nextUrl.searchParams.get("id"))
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("Bad request", { status: 400 })
  }

  const media = getWazzupMessageMedia(id)
  if (!media) {
    return new Response("Not found", { status: 404 })
  }

  // Наши собственные вложения (голосовые, файлы чата, фото букетов) лежат на диске — отдаём их без
  // обращения к себе же по HTTP.
  const local = await readLocalUpload(media.contentUri)
  if (local) {
    return new Response(local.bytes, {
      status: 200,
      headers: {
        "Content-Type": local.contentType,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(local.bytes.byteLength),
      },
    })
  }

  try {
    const { bytes, contentType } = await fetchRemoteMedia(media.contentUri, { maxBytes: MAX_BYTES })
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
        "Content-Length": String(bytes.byteLength),
      },
    })
  } catch (error) {
    if (error instanceof MediaFetchError) {
      return new Response(error.message, { status: mediaErrorStatus(error.code) })
    }
    return new Response("Fetch error", { status: 504 })
  }
}

function mediaErrorStatus(code: MediaFetchError["code"]): number {
  switch (code) {
    case "invalid_url":
      return 400
    case "too_large":
      return 413
    case "upstream":
      return 502
    default:
      return 504
  }
}

const localContentTypes: Record<string, string> = {
  ...chatUploadContentTypes,
  webm: "audio/webm",
  wav: "audio/wav",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
}

// Путь /uploads/<dir>/<file> под NEXT_PUBLIC_APP_URL (или относительный) → файл из public/uploads.
async function readLocalUpload(uri: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "")
  let relative = ""
  if (uri.startsWith("/uploads/")) {
    relative = uri
  } else if (appUrl && uri.startsWith(`${appUrl}/uploads/`)) {
    relative = uri.slice(appUrl.length)
  } else {
    return null
  }
  const match = /^\/uploads\/([a-z0-9_-]+)\/([a-z0-9._-]+)$/i.exec(relative.split("?")[0] ?? "")
  if (!match || match[2].includes("..")) {
    return null
  }
  const ext = match[2].split(".").pop()?.toLowerCase() ?? ""
  const contentType = localContentTypes[ext]
  if (!contentType) {
    return null
  }
  try {
    const file = await fs.readFile(path.join(process.cwd(), "public", "uploads", match[1], match[2]))
    return { bytes: new Uint8Array(file), contentType }
  } catch {
    return null
  }
}
