import fs from "node:fs/promises"
import path from "node:path"
import { getCurrentUser } from "@/lib/auth"
import { canViewGuide, guideOfShotFile } from "@/lib/guides/access"

export const runtime = "nodejs"

// Кадры руководств лежат вне public/: на экранах администратора — выручка и долги
// поставщикам, поэтому кадр отдаётся только тому, кому доступно его руководство.
const shotsDir = path.join(process.cwd(), "content", "guides", "shots")

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  if (!/^[a-z0-9-]+(@2x)?\.webp$/.test(file)) {
    return new Response("Not found", { status: 404 })
  }

  const user = await getCurrentUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const guide = guideOfShotFile(file)
  if (!guide || !canViewGuide(user.role, guide)) {
    return new Response("Not found", { status: 404 })
  }

  try {
    const data = await fs.readFile(path.join(shotsDir, file))
    return new Response(data, {
      headers: {
        "Content-Type": "image/webp",
        // Кадр меняется только с новой версией приложения (пересъёмка) — неделя в кэше браузера.
        "Cache-Control": "private, max-age=604800",
      },
    })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}
