import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { OrdersPage } from "@/components/orders/orders-page"
import { buildShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { canUseCash, getDefaultPathForRole, requireUser } from "@/lib/auth"
import { countOrderDrafts, getDashboardData } from "@/lib/db"
import { canAccessSection } from "@/lib/nav"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  // Стол заказов — главный экран флориста (дефолтный лендинг /orders).
  // Доступ: owner + manager + florist.
  const canAccessCash = await canUseCash(user)
  if (!canAccessSection("orders", user.role, canAccessCash)) {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()
  // Черновики живут на /orders/drafts (owner/manager); здесь — только счётчик для бейджа-ссылки.
  const canManageDrafts = user.role === "owner" || user.role === "manager"
  const draftsCount = canManageDrafts ? countOrderDrafts() : 0

  return (
    <CrmShell
      user={user}
      active="orders"
      title="Стол заказов"
      shiftContext={buildShiftShellContext(user, data)}
      canAccessCash={canAccessCash}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <OrdersPage
        orders={data.orders}
        products={data.products}
        bouquets={data.bouquetTemplates}
        hasOpenShift={Boolean(data.stats.openShift)}
        draftsCount={draftsCount}
        canManageDrafts={canManageDrafts}
      />
    </CrmShell>
  )
}
