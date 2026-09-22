"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import type { AnalyticsSuppliers, SupplierPositionRow } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { FilterChips } from "@/components/screen-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { BarList, Panel } from "./bar-list"
import { TrendChart } from "./charts"
import {
  DOCS_FORMS,
  formatCompactMoney,
  formatInstantDate,
  formatPercent,
  formatQty,
  percentOf,
  plural,
  POSITIONS_FORMS,
  SERIES_COLORS,
  SUPPLIERS_FORMS,
} from "./format"
import { productCardHref } from "./links"
import { moneyValue } from "./overview-tab"
import { StatTile } from "./stat-tile"

type GroupMode = "supplier" | "product"

type Group = {
  key: string
  label: string
  href?: string
  sub?: string
  docsCount: number
  qty: number
  goodsSum: number
  landedSum: number
  // Долг только у группировки по поставщикам.
  debt?: number
  debtNow?: number
  rows: SupplierPositionRow[]
}

const supplierKey = (row: { supplierId: number | null }) => (row.supplierId === null ? "none" : String(row.supplierId))

// Позиции по поставщикам в обе стороны: «поставщик → его товары» и «товар → кто его поставлял».
// Одна выборка с сервера, группировка на клиенте; строка группы раскрывается по клику.
export function SuppliersTab({ data, query }: { data: AnalyticsSuppliers; query: string }) {
  const { totals, suppliers, positions, series, range } = data
  const [mode, setMode] = useState<GroupMode>("supplier")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const days = series.map((point) => point.day)

  const filteredPositions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return positions
    return positions.filter((row) => `${row.supplierName} ${row.productName} ${row.productCode}`.toLowerCase().includes(q))
  }, [positions, query])

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const row of filteredPositions) {
      const key = mode === "supplier" ? supplierKey(row) : row.productCode
      let group = map.get(key)
      if (!group) {
        const supplier = mode === "supplier" ? suppliers.find((entry) => supplierKey(entry) === key) : undefined
        group = {
          key,
          label: mode === "supplier" ? row.supplierName : row.productName,
          href:
            mode === "supplier"
              ? row.supplierId !== null
                ? `/suppliers/${row.supplierId}`
                : undefined
              : productCardHref(row.productCode, range),
          sub: mode === "product" ? row.categoryPath.split("/")[0] || "Без категории" : undefined,
          docsCount: 0,
          qty: 0,
          goodsSum: 0,
          landedSum: 0,
          debt: supplier?.debt,
          debtNow: supplier?.debtNow,
          rows: [],
        }
        map.set(key, group)
      }
      group.rows.push(row)
      group.qty += row.qty
      group.goodsSum += row.goodsSum
      group.landedSum += row.landedSum
    }
    // Число актов группы: у поставщика — из сводки за период (акты без строк тоже считаются),
    // у товара — сумма по поставщикам.
    for (const group of map.values()) {
      if (mode === "supplier") {
        group.docsCount = suppliers.find((entry) => supplierKey(entry) === group.key)?.docsCount ?? 0
        group.rows.sort((a, b) => b.goodsSum - a.goodsSum)
      } else {
        group.docsCount = group.rows.reduce((sum, row) => sum + row.docsCount, 0)
        group.rows.sort((a, b) => b.qty - a.qty)
      }
    }
    return [...map.values()].sort((a, b) => b.goodsSum - a.goodsSum || a.label.localeCompare(b.label, "ru"))
  }, [filteredPositions, mode, suppliers, range])

  const visibleGoods = groups.reduce((sum, group) => sum + group.goodsSum, 0)

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const shares = useMemo(() => {
    const rows = suppliers.map((row) => ({
      key: row.supplierId === null ? "none" : String(row.supplierId),
      label: row.supplierName,
      value: row.goodsTotal,
      meta: `${row.docsCount} ${plural(row.docsCount, DOCS_FORMS)}`,
      href: row.supplierId !== null ? `/suppliers/${row.supplierId}` : undefined,
    }))
    if (rows.length <= 9) return rows
    const tail = rows.slice(8)
    return [
      ...rows.slice(0, 8),
      { key: "__other__", label: `Прочие · ${tail.length}`, value: tail.reduce((sum, row) => sum + row.value, 0), meta: "", href: undefined },
    ]
  }, [suppliers])

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
      <StatTile
        className="xl:col-span-3"
        label="Закупки"
        value={moneyValue(totals.goodsTotal)}
        unit="сом"
        delta={{ current: totals.goodsTotal, previous: data.previousGoodsTotal, upIsGood: false }}
        spark={series.map((point) => point.purchases)}
        sparkColor={SERIES_COLORS.purchases}
        hint={`${totals.docsCount} ${plural(totals.docsCount, DOCS_FORMS)} · ${totals.suppliersCount} ${plural(totals.suppliersCount, SUPPLIERS_FORMS)} · ${totals.positionsCount} ${plural(totals.positionsCount, POSITIONS_FORMS)}`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Накладные расходы"
        value={moneyValue(totals.overheadTotal)}
        unit="сом"
        hint={`${formatPercent(percentOf(totals.overheadTotal, totals.goodsTotal), 1)} от закупок · итого ${formatCompactMoney(totals.landedTotal)}`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Оплачено поставщикам"
        value={moneyValue(totals.paidAmount)}
        unit="сом"
        hint={
          totals.debt > 0
            ? `не оплачено по приходам периода ${formatMoney(totals.debt)}`
            : "приходы периода оплачены полностью"
        }
      />
      <StatTile
        className="xl:col-span-3"
        label="Долг поставщикам сейчас"
        value={moneyValue(totals.debtNow)}
        unit="сом"
        hint="по всем проведённым приходам, не зависит от периода"
        href="/stock/acts?type=stock_in"
      />

      <Panel title="Закупки по дням" className="md:col-span-2 xl:col-span-7">
        <TrendChart
          days={days}
          series={[{ key: "purchases", label: "Закупки", color: SERIES_COLORS.purchases, values: series.map((p) => p.purchases) }]}
          formatValue={formatMoney}
          formatTick={formatCompactMoney}
          area
          heightClassName="h-48 sm:h-64"
        />
      </Panel>

      <Panel title="Доля поставщиков" subtitle="По стоимости товаров в проведённых приходах" className="md:col-span-2 xl:col-span-5">
        <BarList items={shares} formatValue={formatCompactMoney} scale="total" color={SERIES_COLORS.purchases} empty="Проведённых приходов за период нет" />
      </Panel>

      <section className="flex min-w-0 flex-col rounded-2xl bg-background shadow-xs md:col-span-2 xl:col-span-12">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
          <FilterChips
            value={mode}
            options={[
              { value: "supplier", label: "По поставщикам", count: mode === "supplier" ? groups.length : undefined },
              { value: "product", label: "По товарам", count: mode === "product" ? groups.length : undefined },
            ]}
            onValueChange={(value) => {
              setMode(value)
              setExpanded(new Set())
            }}
          />
          <span className="px-1 text-xs text-muted-foreground tabular-nums">
            {groups.length} {plural(groups.length, mode === "supplier" ? SUPPLIERS_FORMS : POSITIONS_FORMS)}
            {query.trim() ? ` · ${formatMoney(visibleGoods)}` : ""}
          </span>
        </div>

        {groups.length === 0 ? (
          <Empty className="min-h-40">
            <EmptyHeader>
              <EmptyTitle>Приходов не найдено</EmptyTitle>
              <EmptyDescription>Измените период или поиск. Учитываются только проведённые приходные акты.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="@container/positions min-w-0">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-[11px] font-medium text-muted-foreground uppercase">
                  <th className="px-4 py-2 text-left font-medium">{mode === "supplier" ? "Поставщик" : "Товар"}</th>
                  <th className="hidden px-3 py-2 text-right font-medium @3xl/positions:table-cell">Актов</th>
                  <th className="px-3 py-2 text-right font-medium">Кол-во</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                  <th className="hidden px-3 py-2 text-right font-medium @4xl/positions:table-cell">Доля</th>
                  <th className="hidden px-3 py-2 text-right font-medium @2xl/positions:table-cell">Цена, посл.</th>
                  {mode === "supplier" ? (
                    <th className="hidden px-3 py-2 text-right font-medium @4xl/positions:table-cell">Долг</th>
                  ) : null}
                  <th className="hidden px-3 py-2 text-right font-medium @5xl/positions:table-cell">Последний приход</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const open = expanded.has(group.key)
                  const lastAt = group.rows.reduce<string | null>((max, row) => (row.lastAt && (!max || row.lastAt > max) ? row.lastAt : max), null)
                  const lastRow = group.rows.reduce<SupplierPositionRow | null>((best, row) => (!best || (row.lastAt ?? "") > (best.lastAt ?? "") ? row : best), null)
                  return (
                    <GroupRows
                      key={group.key}
                      group={group}
                      mode={mode}
                      open={open}
                      share={percentOf(group.goodsSum, visibleGoods)}
                      lastAt={lastAt}
                      lastCost={lastRow?.lastCost ?? 0}
                      onToggle={() => toggle(group.key)}
                      range={range}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-12">
        Суммы — стоимость товаров по строкам проведённых приходных актов (без накладных расходов) по дате операции.
        Долг — товары минус оплачено поставщику; «сейчас» — по всем проведённым приходам на сегодня.
      </p>
    </div>
  )
}

function GroupRows({
  group,
  mode,
  open,
  share,
  lastAt,
  lastCost,
  onToggle,
  range,
}: {
  group: Group
  mode: GroupMode
  open: boolean
  share: number
  lastAt: string | null
  lastCost: number
  onToggle: () => void
  range: AnalyticsSuppliers["range"]
}) {
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon
  return (
    <>
      <tr
        className={cn("cursor-pointer border-t border-border/40 transition-colors hover:bg-muted/40", open && "bg-muted/30")}
        onClick={onToggle}
        aria-expanded={open}
      >
        <td className="px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{group.label}</span>
                {group.href ? (
                  <Link
                    href={group.href}
                    className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {mode === "supplier" ? "карточка" : "товар"}
                  </Link>
                ) : null}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {group.sub ? `${group.sub} · ` : ""}
                {group.rows.length} {plural(group.rows.length, mode === "supplier" ? POSITIONS_FORMS : SUPPLIERS_FORMS)}
              </div>
            </div>
          </div>
        </td>
        <td className="hidden px-3 py-2.5 text-right tabular-nums @3xl/positions:table-cell">{group.docsCount}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{formatQty(group.qty)}</td>
        <td className="px-3 py-2.5 text-right font-medium tabular-nums whitespace-nowrap">{formatMoney(group.goodsSum)}</td>
        <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground @4xl/positions:table-cell">{formatPercent(share, 1)}</td>
        {/* Цена у товара — из последнего прихода; у поставщика цены разные по позициям — см. строки. */}
        <td className="hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap @2xl/positions:table-cell">
          {mode === "product" ? formatMoney(lastCost) : <span className="text-muted-foreground">—</span>}
        </td>
        {mode === "supplier" ? (
          <td className={cn("hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap @4xl/positions:table-cell", (group.debtNow ?? 0) > 0 ? "text-red-600" : "text-muted-foreground")}>
            {(group.debtNow ?? 0) > 0 ? formatMoney(group.debtNow ?? 0) : "—"}
          </td>
        ) : null}
        <td className="hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-muted-foreground @5xl/positions:table-cell">
          {formatInstantDate(lastAt)}
        </td>
      </tr>
      {open
        ? group.rows.map((row) => (
            <tr key={`${group.key}:${row.productCode}:${row.supplierId ?? "none"}`} className="border-t border-border/25 bg-muted/15 text-[13px]">
              <td className="py-2 pr-4 pl-10">
                <div className="min-w-0">
                  <Link
                    href={mode === "supplier" ? productCardHref(row.productCode, range) : row.supplierId !== null ? `/suppliers/${row.supplierId}` : "#"}
                    className={cn("block truncate underline-offset-4 hover:underline", mode === "product" && row.supplierId === null && "pointer-events-none")}
                  >
                    {mode === "supplier" ? row.productName : row.supplierName}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">
                    {mode === "supplier" ? `${row.categoryPath.split("/")[0] || "Без категории"} · ` : ""}
                    {row.maxCost !== row.minCost
                      ? `цена ${formatQty(row.minCost)}–${formatQty(row.maxCost)} сом`
                      : `цена ${formatMoney(row.minCost)}`}
                  </div>
                </div>
              </td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground @3xl/positions:table-cell">{row.docsCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatQty(row.qty)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(row.goodsSum)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground @4xl/positions:table-cell">
                {formatPercent(percentOf(row.goodsSum, group.goodsSum), 0)}
              </td>
              <td className="hidden px-3 py-2 text-right tabular-nums whitespace-nowrap @2xl/positions:table-cell">{formatMoney(row.lastCost)}</td>
              {mode === "supplier" ? <td className="hidden @4xl/positions:table-cell" /> : null}
              <td className="hidden px-3 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground @5xl/positions:table-cell">
                {formatInstantDate(row.lastAt)}
              </td>
            </tr>
          ))
        : null}
    </>
  )
}
