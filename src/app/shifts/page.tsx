import { ShiftsPage } from "@/components/shifts/shift-pages"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { buildShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getDashboardData } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()

  return (
    <CrmShell
      user={user}
      active="shifts"
      title="Смены"
      shiftContext={buildShiftShellContext(user, data)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <ShiftsPage data={data} />
    </CrmShell>
  )
}
