import { AccessDenied } from "@/components/access-denied"
import { AnalyticsScreen, type AnalyticsTab } from "@/components/analytics/analytics-screen"
import { CrmShell } from "@/components/crm-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getAnalyticsOperations, getAnalyticsOverview, getAnalyticsSales, getAnalyticsSuppliers, getAnalyticsWriteOffs } from "@/lib/db"
import { FullscreenShell } from "@/components/analytics/fullscreen-shell"

export const dynamic = "force-dynamic"

const TABS = new Set<AnalyticsTab>(["overview", "sales", "suppliers", "writeoffs", "operations"])

const str = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined)

// BI-аналитика склада и продаж: вкладка и период — в URL (?tab=&preset= | &from=&to=),
// данные считаются на сервере только для открытой вкладки.
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const params = await searchParams
  const rawTab = String(params.tab ?? "overview")
  const tab: AnalyticsTab = TABS.has(rawTab as AnalyticsTab) ? (rawTab as AnalyticsTab) : "overview"
  const rangeInput = {
    preset: typeof params.preset === "string" ? params.preset : undefined,
    from: typeof params.from === "string" ? params.from : undefined,
    to: typeof params.to === "string" ? params.to : undefined,
  }

  // ?full=1 — таблица в отдельном окне: без меню и вкладок.
  const full = str(params.full) === "1"

  // key={tab}: при смене вкладки локальное состояние экрана (поиск, чипы) начинается заново.
  const screen =
    tab === "sales" ? (
      <AnalyticsScreen key={tab} tab="sales" data={getAnalyticsSales(rangeInput)} full={full} />
    ) : tab === "suppliers" ? (
      <AnalyticsScreen key={tab} tab="suppliers" data={getAnalyticsSuppliers(rangeInput)} full={full} />
    ) : tab === "writeoffs" ? (
      <AnalyticsScreen key={tab} tab="writeoffs" data={getAnalyticsWriteOffs(rangeInput)} full={full} />
    ) : tab === "operations" ? (
      <AnalyticsScreen
        key={tab}
        tab="operations"
        data={getAnalyticsOperations(rangeInput, {
          type: str(params.type),
          category: str(params.category),
          product: str(params.product),
          reason: str(params.reason),
          supplier: str(params.supplier),
          query: str(params.q),
          page: str(params.page),
        })}
        full={full}
      />
    ) : (
      <AnalyticsScreen key={tab} tab="overview" data={getAnalyticsOverview(rangeInput)} full={full} />
    )

  if (full) {
    return <FullscreenShell title="Аналитика">{screen}</FullscreenShell>
  }

  return (
    <CrmShell
      user={user}
      active="analytics"
      title="Аналитика"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      {screen}
    </CrmShell>
  )
}
