import fs from "node:fs/promises"
import path from "node:path"

export const runtime = "nodejs"

// Раздача изображений заказов. Имена файлов уникальны (timestamp + random), поэтому кэш
// можно держать долго: обновление = новый файл с новым именем.
const uploadsDir = path.join(process.cwd(), "public", "uploads", "orders")
const contentTypes: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
}
const cacheControl = "public, max-age=31536000, immutable"

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename: rawFilename } = await params
  const filename = String(rawFilename ?? "")
  const contentType = getContentType(filename)

  if (!contentType || !isSafeFilename(filename)) {
    return new Response("Not found", { status: 404 })
  }

  try {
    const file = await fs.readFile(path.join(uploadsDir, filename))
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename: rawFilename } = await params
  const filename = String(rawFilename ?? "")
  const contentType = getContentType(filename)

  if (!contentType || !isSafeFilename(filename)) {
    return new Response(null, { status: 404 })
  }

  try {
    const stat = await fs.stat(path.join(uploadsDir, filename))
    if (!stat.isFile()) {
      return new Response(null, { status: 404 })
    }
    return new Response(null, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Cache-Control": cacheControl,
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function isSafeFilename(filename: string) {
  return /^[a-z0-9._-]+$/i.test(filename) && !filename.includes("..")
}

function getContentType(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return contentTypes[ext] ?? null
}
