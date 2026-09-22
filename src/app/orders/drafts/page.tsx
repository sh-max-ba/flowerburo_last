import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { DraftsPage } from "@/components/orders/drafts-page"
import { buildShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { canUseCash, getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getDashboardData, listOrderDrafts } from "@/lib/db"
import { canAccessSection } from "@/lib/nav"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  // Черновики заказов доступны всем ролям, включая флориста, — и на просмотр, и на изменение.
  const canAccessCash = await canUseCash(user)
  if (!canAccessSection("order-drafts", user.role, canAccessCash)) {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()
  const drafts = listOrderDrafts()
  const workOrdersCount = data.orders.filter((order) =>
    order.status === "Новый" || order.status === "В работе" || order.status === "Готов"
  ).length

  return (
    <CrmShell
      user={user}
      active="order-drafts"
      title="Черновики"
      shiftContext={buildShiftShellContext(user, data)}
      canAccessCash={canAccessCash}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
      subnavCounts={{ orders: workOrdersCount, "order-drafts": drafts.length }}
    >
      <DraftsPage
        drafts={drafts}
        products={data.products}
        bouquets={data.bouquetTemplates}
      />
    </CrmShell>
  )
}
