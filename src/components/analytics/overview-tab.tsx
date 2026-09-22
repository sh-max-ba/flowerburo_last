"use client"

import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import type { AnalyticsOverview } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { BarList, Panel } from "./bar-list"
import { TrendChart } from "./charts"
import {
  DOCS_FORMS,
  formatCompactMoney,
  formatPercent,
  formatQty,
  ORDERS_FORMS,
  percentOf,
  plural,
  SALES_FORMS,
  SERIES_COLORS,
} from "./format"
import { productCardHref, salesDocumentsHref, salesProductHref, tabHref } from "./links"
import { StatTile } from "./stat-tile"

// Значение плитки: число отдельно от единицы («3 828 563» + «сом»).
export function moneyValue(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(value)).replace(/ /g, " ")
}

export function OverviewTab({ data }: { data: AnalyticsOverview }) {
  const { totals, previous, series, stock } = data
  const days = series.map((point) => point.day)
  const marginPct = percentOf(totals.margin, totals.revenue)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
      {/* Ряд 1: четыре ключевые метрики периода с дельтой к прошлому периоду и спарклайном. */}
      <StatTile
        className="xl:col-span-3"
        label="Выручка"
        value={moneyValue(totals.revenue)}
        unit="сом"
        delta={{ current: totals.revenue, previous: previous.revenue }}
        spark={series.map((point) => point.revenue)}
        sparkColor={SERIES_COLORS.revenue}
        hint={`${totals.salesCount} ${plural(totals.salesCount, SALES_FORMS)} · ${totals.ordersCount} ${plural(totals.ordersCount, ORDERS_FORMS)} → открыть`}
        href={salesDocumentsHref(data.range)}
      />
      <StatTile
        className="xl:col-span-3"
        label="Наценка"
        value={moneyValue(totals.margin)}
        unit="сом"
        delta={{ current: totals.margin, previous: previous.margin }}
        hint={`${formatPercent(marginPct)} от выручки · себестоимость ${formatCompactMoney(totals.cost)}`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Закупки"
        value={moneyValue(totals.purchases)}
        unit="сом"
        delta={{ current: totals.purchases, previous: previous.purchases, upIsGood: false }}
        spark={series.map((point) => point.purchases)}
        sparkColor={SERIES_COLORS.purchases}
        hint={`${totals.purchaseDocs} ${plural(totals.purchaseDocs, DOCS_FORMS)} · с расходами ${formatCompactMoney(totals.purchasesLanded)}`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Списания"
        value={moneyValue(totals.writeOffs)}
        unit="сом"
        delta={{ current: totals.writeOffs, previous: previous.writeOffs, upIsGood: false }}
        spark={series.map((point) => point.writeOffs)}
        sparkColor={SERIES_COLORS.writeOffs}
        hint={`${formatQty(totals.writeOffQty)} шт · ${formatPercent(percentOf(totals.writeOffs, totals.purchases))} от закупок`}
      />

      {/* Ряд 2: динамика выручки и закупок на одной оси + снимок склада сейчас. */}
      <Panel title="Выручка и закупки по дням" className="md:col-span-2 xl:col-span-8">
        <TrendChart
          days={days}
          series={[
            { key: "revenue", label: "Выручка", color: SERIES_COLORS.revenue, values: series.map((p) => p.revenue) },
            { key: "purchases", label: "Закупки", color: SERIES_COLORS.purchases, values: series.map((p) => p.purchases) },
          ]}
          formatValue={formatMoney}
          formatTick={formatCompactMoney}
        />
      </Panel>

      <Panel
        title="Склад сейчас"
        subtitle="Активные товары по текущим ценам"
        className="md:col-span-2 xl:col-span-4"
        action={<PanelLink href="/stock/report" label="Остатки" />}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Metric label="По себестоимости" value={formatMoney(stock.costValue)} />
          <Metric label="По цене продажи" value={formatMoney(stock.saleValue)} />
          <Metric label="Позиций" value={`${stock.positions}`} sub={`${formatQty(stock.stockQty)} шт на складе`} />
          <Metric
            label="Требуют внимания"
            value={`${stock.lowCount + stock.negativeCount}`}
            sub={
              stock.lowCount + stock.negativeCount === 0
                ? "остатки в норме"
                : `${stock.negativeCount} в минусе · ${stock.lowCount} заканчиваются`
            }
            tone={stock.negativeCount > 0 ? "danger" : stock.lowCount > 0 ? "warning" : "default"}
          />
        </dl>
        {stock.attention.length > 0 ? (
          <ul className="mt-1 flex flex-col divide-y divide-border/30 border-t border-border/30 text-sm">
            {stock.attention.map((item) => (
              <li key={item.code}>
                <Link
                  href={productCardHref(item.code, data.range)}
                  className="flex items-center justify-between gap-3 py-1.5 transition-colors hover:text-brand-strong"
                >
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className={cn("shrink-0 text-xs font-medium tabular-nums", item.available < 0 ? "text-red-600" : "text-amber-600")}>
                    {item.available < 0 ? `${formatQty(item.available)} · в минусе` : `${formatQty(item.available)} · мало`}
                  </span>
                </Link>
              </li>
            ))}
            {stock.lowCount + stock.negativeCount > stock.attention.length ? (
              <li className="pt-1.5 text-xs text-muted-foreground">
                ещё {stock.lowCount + stock.negativeCount - stock.attention.length} — на{" "}
                <Link href="/stock" className="underline-offset-4 hover:underline">
                  складе
                </Link>
              </li>
            ) : null}
          </ul>
        ) : null}
      </Panel>

      {/* Ряд 3: разбивки — товары, категории, поставщики, причины списаний. */}
      <Panel
        title="Топ товаров по выручке"
        className="xl:col-span-6"
        action={<PanelLink href={tabHref("sales", data.range)} label="Все товары" />}
      >
        <BarList
          items={data.topProducts.map((row) => ({
            key: row.productCode || row.productName,
            label: row.productName,
            value: row.revenue,
            meta: `${formatQty(row.qty)} шт`,
            // Проваливаемся в продажи товара (чеки и заказы) на вкладке «Продажи».
            href: row.productCode ? salesProductHref(row.productCode, data.range) : undefined,
          }))}
          formatValue={formatMoney}
          showShare={false}
          color={SERIES_COLORS.revenue}
        />
      </Panel>

      <Panel title="Выручка по категориям" className="xl:col-span-6">
        <BarList
          items={data.byCategory.slice(0, 8).map((row) => ({
            key: row.key,
            label: row.label,
            value: row.value,
            meta: `${formatQty(row.count)} шт`,
          }))}
          formatValue={formatMoney}
          scale="total"
          color={SERIES_COLORS.revenue}
        />
      </Panel>

      <Panel
        title="Закупки по поставщикам"
        className="xl:col-span-6"
        action={<PanelLink href={tabHref("suppliers", data.range)} label="Подробнее" />}
      >
        <BarList
          items={data.bySupplier.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.value,
            meta: `${row.count} ${plural(row.count, DOCS_FORMS)}`,
          }))}
          formatValue={formatMoney}
          scale="total"
          color={SERIES_COLORS.purchases}
          empty="Проведённых приходов за период нет"
        />
      </Panel>

      <Panel
        title="Списания по причинам"
        className="xl:col-span-6"
        action={<PanelLink href={tabHref("writeoffs", data.range)} label="Подробнее" />}
      >
        <BarList
          items={data.byWriteOffReason.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.value,
            meta: `${row.count} ${plural(row.count, DOCS_FORMS)}`,
          }))}
          formatValue={formatMoney}
          scale="total"
          color={SERIES_COLORS.writeOffs}
          empty="Списаний за период нет"
        />
      </Panel>

      <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-12">
        Выручка — чеки кассы и выданные заказы (без доставки), как в кассе. Себестоимость и наценка — по текущей
        себестоимости карточек товаров. Закупки — проведённые приходные акты по дате операции, списания —
        проведённые расходные акты по закупочной цене строк. Дельты — к предыдущему периоду той же длины.
      </p>
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string
  value: string
  sub?: string
  tone?: "default" | "warning" | "danger"
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate text-lg font-semibold tabular-nums",
          tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-foreground"
        )}
      >
        {value}
      </dd>
      {sub ? <dd className="truncate text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  )
}

export function PanelLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group/link inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
      <ArrowRightIcon className="size-3.5 transition-transform group-hover/link:translate-x-0.5" aria-hidden />
    </Link>
  )
}
