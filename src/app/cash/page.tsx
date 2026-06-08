import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { CashPage } from "@/components/cash/cash-page"
import { buildShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { canUseCash, getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getActiveFlorists, getDashboardData } from "@/lib/db"
import { canAccessSection } from "@/lib/nav"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  // Доступ к кассе: owner/manager — всегда; florist — только при открытой ночной смене.
  const canAccessCash = await canUseCash(user)
  if (!canAccessSection("sales", user.role, canAccessCash)) {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()
  const activeFlorists = getActiveFlorists()

  return (
    <CrmShell
      user={user}
      active="sales"
      title="Касса"
      shiftContext={buildShiftShellContext(user, data, activeFlorists)}
      canAccessCash={canAccessCash}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <CashPage data={data} />
    </CrmShell>
  )
}
