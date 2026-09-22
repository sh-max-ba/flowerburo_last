import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { SHOP_TIME_ZONE } from "@/lib/datetime"
import { listActiveProductsForReport, listActiveProductsForReportAsOf } from "@/lib/db"
import { StockReportClient } from "@/components/stock/stock-report-client"

export const dynamic = "force-dynamic"

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function StockReportPage({ searchParams }: PageProps<"/stock/report">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const todayISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  // Остатки «на дату»: валидная дата в прошлом переключает выборку на реконструкцию
  // по журналу движений; сегодняшняя или будущая дата эквивалентна текущему остатку.
  const params = await searchParams
  const rawDate = String(params.date ?? "")
  const asOfDate = DATE_ISO_RE.test(rawDate) && rawDate < todayISO ? rawDate : ""
  const products = asOfDate ? listActiveProductsForReportAsOf(asOfDate) : listActiveProductsForReport()

  return (
    <CrmShell
      user={user}
      active="stock-report"
      title="Остатки"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >

      <StockReportClient products={products} asOfDate={asOfDate} todayISO={todayISO} />
    </CrmShell>
  )
}
