import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { StockPage } from "@/components/stock/stock-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { buildShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDashboardData, getOrderSettings, listArchivedProducts } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()
  const archivedProducts = listArchivedProducts()
  const defaultAllocationMethod = getOrderSettings().defaultAllocationMethod

  return (
    <CrmShell
      user={user}
      active="stock"
      title="Склад"
      shiftContext={buildShiftShellContext(user, data)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      subnavCounts={{ stock: data.products.length }}
      header="page"
      layout="fill"
    >
      <StockPage
        products={data.products}
        archivedProducts={archivedProducts}
        suppliers={data.suppliers}
        defaultAllocationMethod={defaultAllocationMethod}
      />
    </CrmShell>
  )
}
