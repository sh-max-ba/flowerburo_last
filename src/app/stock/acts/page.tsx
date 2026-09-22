import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { StockActsTable } from "@/components/stock/stock-acts-table"
import { StockActsToolbar } from "@/components/stock/stock-acts-toolbar"
import { ScreenBody } from "@/components/screen-body"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { listStockDocuments, listSuppliers } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function StockActsPage({ searchParams }: PageProps<"/stock/acts">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const params = await searchParams
  const type = String(params.type ?? "all")
  const status = String(params.status ?? "all")
  const query = String(params.query ?? "")
  const supplier = String(params.supplier ?? "all")
  const dateFrom = String(params.dateFrom ?? "")
  const dateTo = String(params.dateTo ?? "")
  const sumFrom = String(params.sumFrom ?? "")
  const sumTo = String(params.sumTo ?? "")
  const documents = listStockDocuments({ type, status, query, supplierId: supplier, dateFrom, dateTo, sumFrom, sumTo })
  const suppliers = listSuppliers()

  return (
    <CrmShell
      user={user}
      active="stock-acts"
      title="Акты склада"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      subnavCounts={{ "stock-acts": documents.length }}
      header="page"
      layout="fill"
    >
      <StockActsToolbar
        suppliers={suppliers}
        query={query}
        status={status}
        type={type}
        supplier={supplier}
        dateFrom={dateFrom}
        dateTo={dateTo}
        sumFrom={sumFrom}
        sumTo={sumTo}
      />
      <ScreenBody>
        <StockActsTable documents={documents} />
      </ScreenBody>
    </CrmShell>
  )
}
