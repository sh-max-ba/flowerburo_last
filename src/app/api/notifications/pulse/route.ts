import { getCurrentUser } from "@/lib/auth"
import { initDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
}

// Монотонные «номера» для звуковых уведомлений: клиент сравнивает с прошлым значением
// и проигрывает звук при РОСТЕ (т.е. появился новый заказ/сделка), а не при любом
// изменении. MAX(id) монотонен и не реагирует на смену статуса/оплату.
// - orderSeq: новый заказ — для всех ролей (флорист на столе заказов, owner/manager).
// - dealSeq: новая входящая сделка из мессенджеров — только owner/manager (как бейдж
//   «Сделки»); флористу всегда 0, поэтому звук сделки у него не звучит.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ orderSeq: 0, dealSeq: 0 }, { status: 401, headers: noStoreHeaders })
  }

  const client = initDb()

  const orderRow = client.prepare("SELECT COALESCE(MAX(id), 0) as seq FROM orders").get() as
    | { seq: number }
    | undefined

  let dealSeq = 0
  if (user.role === "owner" || user.role === "manager") {
    const dealRow = client
      .prepare(
        "SELECT COALESCE(MAX(id), 0) as seq FROM deals WHERE source IN ('whatsapp', 'instagram', 'telegram')"
      )
      .get() as { seq: number } | undefined
    dealSeq = Number(dealRow?.seq ?? 0)
  }

  return Response.json(
    { orderSeq: Number(orderRow?.seq ?? 0), dealSeq },
    { headers: noStoreHeaders }
  )
}
