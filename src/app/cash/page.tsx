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
  // Доступ к кассе: owner/manager — всегда; florist — при ЛЮБОЙ открытой смене.
  const canAccessCash = await canUseCash(user)
  const data = getDashboardData()
  // Chicken-and-egg: без открытой смены canAccessCash=false, но флористу нужно попасть на страницу,
  // чтобы ОТКРЫТЬ смену. Пускаем florist'а, когда открытой смены нет; кассовые операции при этом
  // всё равно заблокированы requireCashAccess (canUseCash=false без смены).
  const floristCanOpenShift = user.role === "florist" && !data.stats.openShift
  if (!canAccessSection("sales", user.role, canAccessCash) && !floristCanOpenShift) {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

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
