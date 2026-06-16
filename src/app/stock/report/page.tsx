import Link from "next/link"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { buttonVariants } from "@/components/ui/button"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { listActiveProductsForReport } from "@/lib/db"
import { StockReportClient } from "@/components/stock/stock-report-client"

export const dynamic = "force-dynamic"

export default async function StockReportPage() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const products = listActiveProductsForReport()

  return (
    <CrmShell
      user={user}
      active="stock-report"
      title="Остатки"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/warehouse/export" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Выгрузить в Excel
        </Link>
        <Link href="/stock" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          На склад
        </Link>
      </div>

      <StockReportClient products={products} />
    </CrmShell>
  )
}
