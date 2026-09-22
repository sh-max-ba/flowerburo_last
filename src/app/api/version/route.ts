import { getBuildId } from "@/lib/build-id"

// Живой build-id сервера. Без авторизации и без обращения к БД — максимально дёшево,
// чтобы вкладки могли часто сверять версию (см. VersionWatcher).
export const dynamic = "force-dynamic"

export function GET() {
  return Response.json(
    { buildId: getBuildId() },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  )
}
