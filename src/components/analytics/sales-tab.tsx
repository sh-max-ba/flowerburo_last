"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { AnalyticsSales, SalesReportRow } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { DataView, type DataViewColumn } from "@/components/data-view"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { BarList, Panel } from "./bar-list"
import { TrendChart } from "./charts"
import { formatCompactMoney, formatPercent, formatQty, ORDERS_FORMS, percentOf, plural, POSITIONS_FORMS, SALES_FORMS, SERIES_COLORS } from "./format"
import { operationsHref, productCardHref } from "./links"
import { moneyValue } from "./overview-tab"
import { StatTile } from "./stat-tile"
import { ActiveFilters, FilterCombobox, OpenInWindowLink, Pagination, RangeFilter, TableToolbar, usePagination } from "./table-chrome"

export function SalesTab({ data, query }: { data: AnalyticsSales; query: string }) {
  const router = useRouter()
  const { totals, previous, series, report, range } = data
  const [category, setCategory] = useState("all")
  const [revenueRange, setRevenueRange] = useState({ from: "", to: "" })
  const [marginFilter, setMarginFilter] = useState("all")
  const days = series.map((point) => point.day)

  const categories = useMemo(() => report.byCategory.map((row) => ({ value: row.category, label: row.category })), [report.byCategory])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const min = Number(revenueRange.from) || 0
    const max = revenueRange.to ? Number(revenueRange.to) : Number.POSITIVE_INFINITY
    return report.byProduct.filter((row) => {
      if (category !== "all" && row.category !== category) return false
      if (q && !`${row.productName} ${row.productCode}`.toLowerCase().includes(q)) return false
      if (row.revenue < min || row.revenue > max) return false
      if (marginFilter === "negative" && row.margin >= 0) return false
      if (marginFilter === "low" && (row.revenue <= 0 || row.margin / row.revenue >= 0.3)) return false
      if (marginFilter === "high" && (row.revenue <= 0 || row.margin / row.revenue < 0.5)) return false
      return true
    })
  }, [report.byProduct, category, query, revenueRange, marginFilter])

  const { page, pageCount, pageRows, setPage, total, pageSize } = usePagination(rows)
  const filteredRevenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const filtered = category !== "all" || query.trim() !== "" || revenueRange.from !== "" || revenueRange.to !== "" || marginFilter !== "all"

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
        hideBelow: "5xl",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.revenue,
        defaultDirection: "desc",
        cell: (row) => <span className="text-muted-foreground">{formatPercent(percentOf(row.revenue, report.totals.revenue), 1)}</span>,
      },
      {
        key: "avgPrice",
        header: "Ср. цена",
        align: "right",
        hideBelow: "4xl",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => (row.qty > 0 ? row.revenue / row.qty : null),
        defaultDirection: "desc",
        cell: (row) => <span className="text-muted-foreground">{row.qty > 0 ? formatMoney(row.revenue / row.qty) : "—"}</span>,
      },
      {
        key: "avgCost",
        header: "Ср. себест.",
        align: "right",
        hideBelow: "4xl",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => (row.qty > 0 ? row.cost / row.qty : null),
        defaultDirection: "desc",
        cell: (row) => <span className="text-muted-foreground">{row.qty > 0 ? formatMoney(row.cost / row.qty) : "—"}</span>,
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
        cell: (row) => (
          <span className={cn(row.margin < 0 && "text-red-600")}>
            {formatMoney(row.margin)}
            <span className="ml-1 text-xs text-muted-foreground">{row.revenue > 0 ? formatPercent(percentOf(row.margin, row.revenue)) : ""}</span>
          </span>
        ),
      },
    ],
    [report.totals.revenue]
  )

  // Категория и наценка видны в самих кнопках; чипом показываем только диапазон выручки.
  const chips = revenueRange.from || revenueRange.to
    ? [{ key: "revenue", label: `Выручка ${revenueRange.from || "0"}–${revenueRange.to || "∞"}`, onRemove: () => setRevenueRange({ from: "", to: "" }) }]
    : []

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
        hint={`${totals.salesCount} ${plural(totals.salesCount, SALES_FORMS)} · ${totals.ordersCount} ${plural(totals.ordersCount, ORDERS_FORMS)} → операции`}
        href={operationsHref(range, { type: "sales" })}
      />
      <StatTile
        className="xl:col-span-3"
        label="Наценка"
        value={moneyValue(totals.margin)}
        unit="сом"
        delta={{ current: totals.margin, previous: previous.margin }}
        hint={`${formatPercent(percentOf(totals.margin, totals.revenue))} от выручки · себестоимость ${formatCompactMoney(totals.cost)}`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Продано"
        value={formatQty(totals.soldQty)}
        unit="шт"
        delta={{ current: totals.soldQty, previous: previous.soldQty }}
        spark={series.map((point) => point.soldQty)}
        sparkColor={SERIES_COLORS.revenue}
        hint={`${report.byProduct.length} ${plural(report.byProduct.length, POSITIONS_FORMS)} · ср. себестоимость ${
          totals.soldQty > 0 ? formatMoney(totals.cost / totals.soldQty) : "—"
        }/шт`}
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

      <Panel title="По категориям" subtitle="Клик — операции категории" className="md:col-span-2 xl:col-span-4">
        <BarList
          items={report.byCategory.slice(0, 8).map((row) => ({
            key: row.category,
            label: row.category,
            value: row.revenue,
            href: operationsHref(range, { type: "sales", category: row.category }),
          }))}
          formatValue={formatCompactMoney}
          scale="total"
          color={SERIES_COLORS.revenue}
        />
      </Panel>

      <section className="flex min-w-0 flex-col rounded-2xl bg-background shadow-xs md:col-span-2 xl:col-span-12">
        <TableToolbar
          left={
            <>
              <FilterCombobox
                label="Категория"
                value={category}
                allLabel="Все категории"
                options={categories}
                onValueChange={(value) => {
                  setCategory(value)
                  setPage(1)
                }}
                searchPlaceholder="Найти категорию"
              />
              <FilterCombobox
                label="Наценка"
                value={marginFilter}
                allLabel="Любая наценка"
                options={MARGIN_OPTIONS.filter((option) => option.value !== "all")}
                onValueChange={(value) => {
                  setMarginFilter(value)
                  setPage(1)
                }}
              />
              <RangeFilter
                label="Выручка от–до"
                from={revenueRange.from}
                to={revenueRange.to}
                onChange={(next) => {
                  setRevenueRange(next)
                  setPage(1)
                }}
              />
              <ActiveFilters chips={chips} />
            </>
          }
          right={
            <>
              <span className="tabular-nums">
                {rows.length} {plural(rows.length, POSITIONS_FORMS)}
                {filtered ? ` · ${formatMoney(filteredRevenue)}` : ""}
              </span>
              <OpenInWindowLink />
            </>
          }
        />
        <DataView
          rows={pageRows}
          columns={columns}
          getRowKey={(row) => row.productCode || `custom:${row.productName}`}
          defaultSort={{ key: "revenue", direction: "desc" }}
          stickyHeader={false}
          onRowSelect={(row) =>
            router.push(row.productCode ? operationsHref(range, { type: "sales", product: row.productCode }) : operationsHref(range, { type: "sales", query: row.productName }))
          }
          rowActions={(row) =>
            row.productCode ? (
              <a
                href={productCardHref(row.productCode, range)}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Карточка товара"
              >
                карточка
              </a>
            ) : null
          }
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
                <EmptyDescription>Измените период, фильтры или поиск.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
        <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPageChange={setPage} />
      </section>

      <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-12">
        Клик по товару или категории открывает список чеков и заказов с ним за период (вкладка «Операции»). Себестоимость и
        наценка — по текущей себестоимости карточек товаров; «ср. себест.» — себестоимость на единицу проданного.
      </p>
    </div>
  )
}

const MARGIN_OPTIONS = [
  { value: "all", label: "Любая наценка" },
  { value: "negative", label: "Отрицательная" },
  { value: "low", label: "Ниже 30 %" },
  { value: "high", label: "50 % и выше" },
]
