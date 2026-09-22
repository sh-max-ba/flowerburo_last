"use client"

import { useState } from "react"
import { DownloadIcon, LayoutDashboardIcon, MinusCircleIcon, ReceiptTextIcon, TruckIcon } from "lucide-react"
import type { AnalyticsOverview, AnalyticsSales, AnalyticsSuppliers, AnalyticsWriteOffs } from "@/lib/db"
import { ScreenBody } from "@/components/screen-body"
import { HeaderAction, ScreenHeader } from "@/components/screen-header"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { DAYS_FORMS, formatRangeLabel, plural } from "./format"
import { tabHref, type AnalyticsTab } from "./links"
import { PeriodPicker } from "./period-picker"
import { OverviewTab } from "./overview-tab"
import { SalesTab } from "./sales-tab"
import { SuppliersTab } from "./suppliers-tab"
import { WriteOffsTab } from "./writeoffs-tab"

export type { AnalyticsTab }

export type AnalyticsScreenProps =
  | { tab: "overview"; data: AnalyticsOverview }
  | { tab: "sales"; data: AnalyticsSales }
  | { tab: "suppliers"; data: AnalyticsSuppliers }
  | { tab: "writeoffs"; data: AnalyticsWriteOffs }

const SEARCH_PLACEHOLDER: Record<AnalyticsTab, string> = {
  overview: "",
  sales: "Поиск по товару или коду",
  suppliers: "Поиск по поставщику или товару",
  writeoffs: "Поиск по товару, акту или причине",
}

/**
 * Экран «Аналитика»: одна карточка-шапка (период слева, поиск, вкладки справа) и рабочая область
 * с плитками, графиками и таблицами выбранной вкладки. Данные вкладки приходят с сервера,
 * поиск и локальные фильтры — на клиенте.
 */
export function AnalyticsScreen(props: AnalyticsScreenProps) {
  const { tab, data } = props
  const range = data.range
  const [query, setQuery] = useState("")

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
        meta={
          tab === "overview"
            ? `${range.days} ${plural(range.days, DAYS_FORMS)} · ${formatRangeLabel(range.from, range.to)}`
            : undefined
        }
        actions={exportHref ? <HeaderAction icon={DownloadIcon} label="Excel" href={exportHref} /> : undefined}
        tabs={tabs}
        tabsPlacement="inline"
      />

      <ScreenBody surface={false} className="gap-4">
        {props.tab === "overview" ? <OverviewTab data={props.data} /> : null}
        {props.tab === "sales" ? <SalesTab data={props.data} query={query} /> : null}
        {props.tab === "suppliers" ? <SuppliersTab data={props.data} query={query} /> : null}
        {props.tab === "writeoffs" ? <WriteOffsTab data={props.data} query={query} /> : null}
      </ScreenBody>
    </>
  )
}
