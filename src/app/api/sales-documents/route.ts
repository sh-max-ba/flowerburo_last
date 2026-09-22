import { getCurrentUser } from "@/lib/auth"
import { getSalesDocument } from "@/lib/db"

export const dynamic = "force-dynamic"

// Документ продажи (чек кассы или заказ) с позициями — для раскрытия из аналитики и карточки
// товара. ?source=sale|order&id=123. Доступ: владелец и менеджер.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user || (user.role !== "owner" && user.role !== "manager")) {
    return Response.json({ error: "Нет доступа" }, { status: 403 })
  }
  const url = new URL(request.url)
  const source = url.searchParams.get("source")
  const id = Number(url.searchParams.get("id"))
  if ((source !== "sale" && source !== "order") || !Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  const document = getSalesDocument(source, id)
  if (!document) {
    return Response.json({ error: "Документ не найден" }, { status: 404 })
  }
  return Response.json(document, { headers: { "Cache-Control": "no-store, max-age=0" } })
}
