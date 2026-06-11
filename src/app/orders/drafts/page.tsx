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
  // Черновики заказов: owner + manager (флористы их не видят — серверная граница в actions.ts).
  const canAccessCash = await canUseCash(user)
  if (!canAccessSection("order-drafts", user.role, canAccessCash)) {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()
  const drafts = listOrderDrafts()

  return (
    <CrmShell
      user={user}
      active="order-drafts"
      title="Черновики"
      shiftContext={buildShiftShellContext(user, data)}
      canAccessCash={canAccessCash}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <DraftsPage
        drafts={drafts}
        products={data.products}
        bouquets={data.bouquetTemplates}
        hasOpenShift={Boolean(data.stats.openShift)}
      />
    </CrmShell>
  )
}
