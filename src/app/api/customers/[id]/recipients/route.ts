import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { listCustomerRecipients } from "@/lib/db"
import { canAccessSection } from "@/lib/nav"

export const dynamic = "force-dynamic"

const noStoreHeaders = { "Cache-Control": "no-store" }

// Получатели клиента для окна заказа: выбрать получателя одним нажатием.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || !canAccessSection("clients", user.role, false)) {
    return NextResponse.json({ status: "error", message: "Недостаточно прав." }, { status: 401, headers: noStoreHeaders })
  }
  const { id } = await params
  const customerId = Number(id)
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return NextResponse.json({ status: "error", message: "Клиент не найден." }, { status: 404, headers: noStoreHeaders })
  }
  return NextResponse.json({ status: "ok", recipients: listCustomerRecipients(customerId) }, { headers: noStoreHeaders })
}
