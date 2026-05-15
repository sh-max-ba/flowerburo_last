import { requireUser } from "@/lib/auth"
import { getReadyOrdersActionCount } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await requireUser()
  const count = user.role === "owner" || user.role === "manager" ? getReadyOrdersActionCount() : 0

  return Response.json(
    { count },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  )
}
