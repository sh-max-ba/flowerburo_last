import { AccessDenied } from "@/components/access-denied"
import { BouquetsPage } from "@/components/bouquets/bouquets-page"
import { CrmShell } from "@/components/crm-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { buildShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDashboardData } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  if (user.role !== "owner" && user.role !== "manager") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()

  return (
    <CrmShell
      user={user}
      active="bouquets"
      title="Букеты"
      shiftContext={buildShiftShellContext(user, data)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <BouquetsPage products={data.products} bouquets={data.bouquetTemplates} />
    </CrmShell>
  )
}
