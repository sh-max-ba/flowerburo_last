import { requireUser } from "@/lib/auth"
import { getOrdersActivityRevision } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  await requireUser()

  return Response.json(
    { revision: getOrdersActivityRevision() },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  )
}
