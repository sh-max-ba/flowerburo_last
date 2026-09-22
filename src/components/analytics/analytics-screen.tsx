"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { DownloadIcon, LayoutDashboardIcon, ListIcon, MinusCircleIcon, ReceiptTextIcon, TruckIcon } from "lucide-react"
import type { AnalyticsOperations, AnalyticsOverview, AnalyticsSales, AnalyticsSuppliers, AnalyticsWriteOffs } from "@/lib/db"
import { ScreenBody } from "@/components/screen-body"
import { HeaderAction, ScreenHeader } from "@/components/screen-header"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { DAYS_FORMS, formatRangeLabel, plural } from "./format"
import { tabHref, type AnalyticsTab } from "./links"
import { PeriodPicker } from "./period-picker"
import { OperationsTab } from "./operations-tab"
import { OverviewTab } from "./overview-tab"
import { SalesTab } from "./sales-tab"
import { SuppliersTab } from "./suppliers-tab"
import { WriteOffsTab } from "./writeoffs-tab"

export type { AnalyticsTab }

export type AnalyticsScreenProps = (
  | { tab: "overview"; data: AnalyticsOverview }
  | { tab: "sales"; data: AnalyticsSales }
  | { tab: "suppliers"; data: AnalyticsSuppliers }
  | { tab: "writeoffs"; data: AnalyticsWriteOffs }
  | { tab: "operations"; data: AnalyticsOperations }
) & {
  // Отдельное окно: без меню и вкладок, только период, поиск и таблица.
  full?: boolean
}

const SEARCH_PLACEHOLDER: Record<AnalyticsTab, string> = {
  overview: "",
  sales: "Поиск по товару или коду",
  suppliers: "Поиск по поставщику или товару",
  writeoffs: "Поиск по товару, акту или причине",
  operations: "Номер, клиент, поставщик или комментарий",
}

/**
 * Экран «Аналитика»: одна карточка-шапка (период слева, поиск, вкладки справа) и рабочая область
 * с плитками, графиками и таблицами выбранной вкладки. Данные вкладки приходят с сервера,
 * поиск и локальные фильтры — на клиенте.
 */
export function AnalyticsScreen(props: AnalyticsScreenProps) {
  const { tab, data, full = false } = props
  const range = data.range
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // На вкладке «Операции» поиск серверный — живёт в URL (?q=) и применяется с задержкой ввода.
  const urlQuery = searchParams.get("q") ?? ""
  const [query, setQuery] = useState(tab === "operations" ? urlQuery : "")
  useEffect(() => {
    if (tab !== "operations" || query.trim() === urlQuery.trim()) return
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (query.trim()) params.set("q", query.trim())
      else params.delete("q")
      params.delete("page")
      router.replace(`${pathname}?${params.toString()}`)
    }, 350)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const tabs = (
    <SegmentedTabs
      aria-label="Разделы аналитики"
      value={tab}
      fill
      collapseLabels
      items={[
        { value: "overview", label: "Обзор", icon: LayoutDashboardIcon, href: tabHref("overview", range) },
        { value: "sales", label: "Продажи", icon: ReceiptTextIcon, href: tabHref("sales", range) },
        { value: "suppliers", label: "Поставщики", icon: TruckIcon, href: tabHref("suppliers", range) },
        { value: "writeoffs", label: "Списания", icon: MinusCircleIcon, href: tabHref("writeoffs", range) },
        { value: "operations", label: "Операции", icon: ListIcon, href: tabHref("operations", range) },
      ]}
    />
  )

  const exportHref =
    tab === "sales"
      ? `/history/stock/export?dateFrom=${range.from}&dateTo=${range.to}`
      : tab === "writeoffs"
        ? `/history/stock/export?view=moves&type=stock_out&dateFrom=${range.from}&dateTo=${range.to}`
        : null

  return (
    <>
      <ScreenHeader
        title="Аналитика"
        leading={<PeriodPicker range={range} />}
        search={
          tab === "overview"
            ? undefined
            : {
                value: query,
                onChange: setQuery,
                placeholder: SEARCH_PLACEHOLDER[tab],
                inputProps: { "aria-label": SEARCH_PLACEHOLDER[tab] },
              }
        }
        meta={full ? `${range.days} ${plural(range.days, DAYS_FORMS)} · ${formatRangeLabel(range.from, range.to)}` : undefined}
        actions={exportHref ? <HeaderAction icon={DownloadIcon} label="Excel" href={exportHref} /> : undefined}
        tabs={full ? null : tabs}
        tabsPlacement="row"
      />

      <ScreenBody surface={false} className="gap-4">
        {props.tab === "overview" ? <OverviewTab data={props.data} /> : null}
        {props.tab === "sales" ? <SalesTab data={props.data} query={query} /> : null}
        {props.tab === "suppliers" ? <SuppliersTab data={props.data} query={query} /> : null}
        {props.tab === "writeoffs" ? <WriteOffsTab data={props.data} query={query} /> : null}
        {props.tab === "operations" ? <OperationsTab data={props.data} /> : null}
      </ScreenBody>
    </>
  )
}
