import { requireUser } from "@/lib/auth"
import { getReadyOrdersActionCount } from "@/lib/db"
import { canAccessSection } from "@/lib/nav"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await requireUser()
  const count = canAccessSection("ready-orders", user.role, false) ? getReadyOrdersActionCount() : 0

  return Response.json(
    { count },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  )
}
