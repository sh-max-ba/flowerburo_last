import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { DashboardPage } from "@/components/dashboard/dashboard-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getOwnerDashboardData } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>
}) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const params = await searchParams
  const data = getOwnerDashboardData({
    preset: params.preset,
    from: params.from,
    to: params.to,
  })

  return (
    <CrmShell
      user={user}
      active="dashboard"
      title="Дашборд"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
    >
      <DashboardPage data={data} />
    </CrmShell>
  )
}
