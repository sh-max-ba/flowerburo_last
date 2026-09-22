import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { SHOP_TIME_ZONE } from "@/lib/datetime"
import { getTrackLotsEnabled, listActiveLots, listExpiringLots } from "@/lib/db"
import { StockLotsClient } from "@/components/stock/stock-lots-client"

export const dynamic = "force-dynamic"

export default async function StockLotsPage() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const enabled = getTrackLotsEnabled()
  // listExpiringLots / listActiveLots выполняют FEFO-сверку партий к остаткам перед выборкой.
  const expiring = listExpiringLots({ withinDays: 7 })
  const lots = listActiveLots()
  const todayISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  return (
    <CrmShell
      user={user}
      active="stock-lots"
      title="Партии и сроки"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <StockLotsClient enabled={enabled} expiring={expiring} lots={lots} todayISO={todayISO} />
    </CrmShell>
  )
}
