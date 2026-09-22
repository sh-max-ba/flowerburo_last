import { requireUser } from "@/lib/auth"
import { getStockDocument } from "@/lib/db"

export const dynamic = "force-dynamic"

// Позиции акта для боковой панели списка (owner-only). Список актов не тянет items,
// поэтому drawer подгружает их по клику отсюда — без превращения детали в отдельный переход.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return Response.json({ error: "forbidden" }, { status: 403 })
  }

  const { id } = await params
  const documentId = Number(id)
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return Response.json({ error: "bad request" }, { status: 400 })
  }

  try {
    const document = getStockDocument(documentId)
    return Response.json(
      { type: document.type, items: document.items },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    )
  } catch {
    return Response.json({ error: "not found" }, { status: 404 })
  }
}
