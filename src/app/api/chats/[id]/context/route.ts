import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { canAccessSection } from "@/lib/nav"
import { getCustomer, getCustomerStats, listCustomerChanges, listCustomerOrders } from "@/lib/crm"
import { getChatById } from "@/lib/db"

export const dynamic = "force-dynamic"

const noStoreHeaders = { "Cache-Control": "no-store" }

// Контекст диалога для правой панели: карточка клиента, сводка, история правок и заказы.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || !canAccessSection("chats", user.role, false)) {
    return NextResponse.json({ status: "error", message: "Недостаточно прав." }, { status: 401, headers: noStoreHeaders })
  }

  const { id: rawId } = await params
  const chatId = Number(rawId)
  const chat = Number.isInteger(chatId) && chatId > 0 ? getChatById(chatId) : null
  if (!chat) {
    return NextResponse.json({ status: "not_found", message: "Диалог не найден." }, { status: 404, headers: noStoreHeaders })
  }

  const customer = chat.customerId ? getCustomer(chat.customerId) : null
  return NextResponse.json(
    {
      status: "ok",
      chat,
      customer,
      stats: customer ? getCustomerStats(customer.id) : null,
      changes: customer ? listCustomerChanges(customer.id) : [],
      orders: customer ? listCustomerOrders(customer.id) : [],
    },
    { headers: noStoreHeaders }
  )
}
