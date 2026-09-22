"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { AnalyticsSales, SalesReportRow } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { DataView, type DataViewColumn } from "@/components/data-view"
import { FilterChips } from "@/components/screen-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { BarList, Panel } from "./bar-list"
import { TrendChart } from "./charts"
import { formatCompactMoney, formatPercent, formatQty, ORDERS_FORMS, percentOf, plural, POSITIONS_FORMS, SALES_FORMS, SERIES_COLORS } from "./format"
import { productCardHref } from "./links"
import { moneyValue } from "./overview-tab"
import { StatTile } from "./stat-tile"

export function SalesTab({ data, query }: { data: AnalyticsSales; query: string }) {
  const router = useRouter()
  const { totals, previous, series, report, range } = data
  const [category, setCategory] = useState("all")
  const days = series.map((point) => point.day)

  const categories = useMemo(() => report.byCategory.map((row) => row.category), [report.byCategory])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return report.byProduct.filter((row) => {
      if (category !== "all" && row.category !== category) return false
      if (q && !`${row.productName} ${row.productCode}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [report.byProduct, category, query])

  const filteredRevenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const filtered = category !== "all" || query.trim() !== ""

  const columns = useMemo<DataViewColumn<SalesReportRow>[]>(
    () => [
      {
        key: "product",
        header: "Товар",
        grow: true,
        sortValue: (row) => row.productName,
        cell: (row) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.productName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.productCode ? `${row.productCode} · ${row.category}` : "нетоварная позиция"}
            </div>
          </div>
        ),
      },
      {
        key: "qty",
        header: "Кол-во",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.qty,
        defaultDirection: "desc",
        cell: (row) => formatQty(row.qty),
      },
      {
        key: "revenue",
        header: "Выручка",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.revenue,
        defaultDirection: "desc",
        cell: (row) => <span className="font-medium">{formatMoney(row.revenue)}</span>,
      },
      {
        key: "share",
        header: "Доля",
        align: "right",
        hideBelow: "4xl",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.revenue,
        defaultDirection: "desc",
        cell: (row) => <span className="text-muted-foreground">{formatPercent(percentOf(row.revenue, report.totals.revenue), 1)}</span>,
      },
      {
        key: "cost",
        header: "Себест.",
        align: "right",
        hideBelow: "3xl",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.cost,
        defaultDirection: "desc",
        cell: (row) => <span className="text-muted-foreground">{formatMoney(row.cost)}</span>,
      },
      {
        key: "margin",
        header: "Наценка",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.margin,
        defaultDirection: "desc",
        cell: (row) => <span className={cn(row.margin < 0 && "text-red-600")}>{formatMoney(row.margin)}</span>,
      },
      {
        key: "marginPct",
        header: "%",
        align: "right",
        hideBelow: "5xl",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => (row.revenue > 0 ? row.margin / row.revenue : null),
        defaultDirection: "desc",
        cell: (row) => (
          <span className={cn("text-muted-foreground", row.margin < 0 && "text-red-600")}>
            {row.revenue > 0 ? formatPercent(percentOf(row.margin, row.revenue)) : "—"}
          </span>
        ),
      },
    ],
    [report.totals.revenue]
  )

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
      <StatTile
        className="xl:col-span-3"
        label="Выручка"
        value={moneyValue(totals.revenue)}
        unit="сом"
        delta={{ current: totals.revenue, previous: previous.revenue }}
        spark={series.map((point) => point.revenue)}
        sparkColor={SERIES_COLORS.revenue}
        hint={`${totals.salesCount} ${plural(totals.salesCount, SALES_FORMS)} · ${totals.ordersCount} ${plural(totals.ordersCount, ORDERS_FORMS)}`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Наценка"
        value={moneyValue(totals.margin)}
        unit="сом"
        delta={{ current: totals.margin, previous: previous.margin }}
        hint={`${formatPercent(percentOf(totals.margin, totals.revenue))} от выручки`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Продано"
        value={formatQty(totals.soldQty)}
        unit="шт"
        delta={{ current: totals.soldQty, previous: previous.soldQty }}
        spark={series.map((point) => point.soldQty)}
        sparkColor={SERIES_COLORS.revenue}
        hint={`${report.byProduct.length} ${plural(report.byProduct.length, POSITIONS_FORMS)}`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Средний чек"
        value={moneyValue(totals.salesCount + totals.ordersCount > 0 ? totals.revenue / (totals.salesCount + totals.ordersCount) : 0)}
        unit="сом"
        delta={{
          current: totals.salesCount + totals.ordersCount > 0 ? totals.revenue / (totals.salesCount + totals.ordersCount) : 0,
          previous: previous.salesCount + previous.ordersCount > 0 ? previous.revenue / (previous.salesCount + previous.ordersCount) : 0,
        }}
        hint={
          report.totals.refundedCount > 0
            ? `возвраты ${report.totals.refundedCount} · −${formatCompactMoney(report.totals.refundedAmount)}`
            : "чеки кассы и выданные заказы"
        }
      />

      <Panel title="Выручка и себестоимость по дням" className="md:col-span-2 xl:col-span-8">
        <TrendChart
          days={days}
          series={[
            { key: "revenue", label: "Выручка", color: SERIES_COLORS.revenue, values: series.map((p) => p.revenue) },
            { key: "cost", label: "Себестоимость", color: SERIES_COLORS.cost, values: series.map((p) => p.cost) },
          ]}
          formatValue={formatMoney}
          formatTick={formatCompactMoney}
        />
      </Panel>

      <Panel title="По категориям" className="md:col-span-2 xl:col-span-4">
        <BarList
          items={report.byCategory.slice(0, 8).map((row) => ({
            key: row.category,
            label: row.category,
            value: row.revenue,
          }))}
          formatValue={formatCompactMoney}
          scale="total"
          color={SERIES_COLORS.revenue}
        />
      </Panel>

      <section className="flex min-w-0 flex-col rounded-2xl bg-background shadow-xs md:col-span-2 xl:col-span-12">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
          <FilterChips
            value={category}
            options={[{ value: "all", label: "Все категории" }, ...categories.map((name) => ({ value: name, label: name }))]}
            onValueChange={setCategory}
          />
          <span className="px-1 text-xs text-muted-foreground tabular-nums">
            {rows.length} {plural(rows.length, POSITIONS_FORMS)}
            {filtered ? ` · ${formatMoney(filteredRevenue)}` : ""}
          </span>
        </div>
        <DataView
          rows={rows}
          columns={columns}
          getRowKey={(row) => row.productCode || `custom:${row.productName}`}
          defaultSort={{ key: "revenue", direction: "desc" }}
          stickyHeader={false}
          onRowSelect={(row) => {
            if (row.productCode) router.push(productCardHref(row.productCode, range))
          }}
          rowClassName={(row) => (row.productCode ? undefined : "cursor-default")}
          renderCard={(row) => (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{row.productName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {formatQty(row.qty)} шт · {row.category}
                </div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <div className="font-medium">{formatMoney(row.revenue)}</div>
                <div className={cn("text-xs text-muted-foreground", row.margin < 0 && "text-red-600")}>
                  наценка {formatMoney(row.margin)}
                </div>
              </div>
            </div>
          )}
          empty={
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>Продаж не найдено</EmptyTitle>
                <EmptyDescription>Измените период, категорию или поиск.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      </section>
    </div>
  )
}
