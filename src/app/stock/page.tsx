import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { StockPage } from "@/components/stock/stock-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { buildShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDashboardData, listArchivedProducts } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()
  const archivedProducts = listArchivedProducts()

  return (
    <CrmShell
      user={user}
      active="stock"
      title="Склад"
      shiftContext={buildShiftShellContext(user, data)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <StockPage
        products={data.products}
        archivedProducts={archivedProducts}
        negativeStockCount={data.stats.negativeStockCount}
        suppliers={data.suppliers}
      />
    </CrmShell>
  )
}
