import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { ReadyOrdersPage } from "@/components/orders/ready-orders-page"
import { buildShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { canUseCash, getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getDashboardData, getOrderPaymentBreakdowns } from "@/lib/db"
import { canAccessSection } from "@/lib/nav"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  // Готовые заказы: выдача / передача курьеру / закрытие. Доступ: owner + manager.
  const canAccessCash = await canUseCash(user)
  if (!canAccessSection("ready-orders", user.role, canAccessCash)) {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()
  // Разбивка принятых оплат по способам — комбинированная оплата видна на выдаче явно.
  const readyOrderIds = data.orders
    .filter((order) => order.status === "Готов" || order.status === "Передан курьеру")
    .map((order) => order.id)
  const paymentsByOrder = getOrderPaymentBreakdowns(readyOrderIds)

  return (
    <CrmShell
      user={user}
      active="ready-orders"
      title="Готовые заказы"
      shiftContext={buildShiftShellContext(user, data)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <ReadyOrdersPage orders={data.orders} openShift={data.stats.openShift} paymentsByOrder={paymentsByOrder} />
    </CrmShell>
  )
}
