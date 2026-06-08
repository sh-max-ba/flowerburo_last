import { type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getWazzupMessageMedia } from "@/lib/db"
import { fetchRemoteMedia, MediaFetchError } from "@/lib/media-fetch"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_BYTES = 25 * 1024 * 1024

// Прокси медиа сообщений: content_uri от Wazzup может протухать и не должен утекать в клиент как
// внешняя ссылка. Тянем по id строки wazzup_messages (а не по произвольному URL из запроса), под
// auth owner+manager — поэтому подделать цель нельзя. Короткий приватный кэш гасит повторные тяги.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role === "florist") {
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
