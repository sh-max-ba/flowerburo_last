// Серверная тяга удалённого медиа по URL из БД (content_uri сообщений Wazzup). Общая для медиа-прокси
// и расшифровки голосовых, чтобы не дублировать SSRF-guard, таймаут и ограничение размера.
// ВАЖНО: вызывающий передаёт URL, взятый ИЗ строки wazzup_messages по id, — не произвольный из запроса.

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 25 * 1024 * 1024

export type MediaFetchErrorCode = "invalid_url" | "upstream" | "too_large" | "timeout" | "fetch"

export class MediaFetchError extends Error {
  constructor(
    readonly code: MediaFetchErrorCode,
    message: string
  ) {
    super(message)
    this.name = "MediaFetchError"
  }
}

export async function fetchRemoteMedia(
  rawUrl: string,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  const maxBytes = options.maxBytes ?? MAX_BYTES

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new MediaFetchError("invalid_url", "Invalid media url")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new MediaFetchError("invalid_url", "Invalid media url")
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS)
  try {
    const upstream = await fetch(url, { signal: controller.signal, redirect: "follow" })
    if (!upstream.ok) {
      throw new MediaFetchError("upstream", "Upstream error")
    }

    const contentLength = upstream.headers.get("content-length")
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new MediaFetchError("too_large", "Too large")
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw new MediaFetchError("too_large", "Too large")
    }

    return { bytes, contentType: upstream.headers.get("content-type") ?? "application/octet-stream" }
  } catch (error) {
    if (error instanceof MediaFetchError) {
      throw error
    }
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
    throw new MediaFetchError(aborted ? "timeout" : "fetch", aborted ? "Timeout" : "Fetch error")
  } finally {
    clearTimeout(timer)
  }
}
