import { getCurrentUser } from "@/lib/auth"
import { getChatAvatarUri } from "@/lib/db"
import { fetchRemoteMedia, MediaFetchError } from "@/lib/media-fetch"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Аватар контакта из Wazzup — через серверный прокси по id диалога (внешняя ссылка не утекает в
// клиент, а протухший URL даёт 404 и запасную «буквенную» аватарку). Кэш приватный, сутки.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.role === "florist") {
    return new Response("Forbidden", { status: 403 })
  }

  const { id: rawId } = await params
  const chatId = Number(rawId)
  if (!Number.isInteger(chatId) || chatId <= 0) {
    return new Response("Bad request", { status: 400 })
  }

  const uri = getChatAvatarUri(chatId)
  if (!uri) {
    return new Response("Not found", { status: 404 })
  }

  try {
    const { bytes, contentType } = await fetchRemoteMedia(uri, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000 })
    if (!contentType.startsWith("image/")) {
      return new Response("Not found", { status: 404 })
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
        "Content-Length": String(bytes.byteLength),
      },
    })
  } catch (error) {
    return new Response(error instanceof MediaFetchError ? error.message : "Fetch error", { status: 404 })
  }
}
