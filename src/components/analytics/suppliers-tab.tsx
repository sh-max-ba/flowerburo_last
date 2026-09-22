"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BanknoteIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import type { AnalyticsSuppliers, SupplierPositionRow } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { FilterChips } from "@/components/screen-header"
import { SupplierPaymentDialog } from "@/components/suppliers/supplier-payment-dialog"
import { Button } from "@/components/ui/button"
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
  supplierId: number | null
  docsCount: number
  qty: number
  goodsSum: number
  landedSum: number
  writeOffQty: number
  writeOffCost: number
  // Долг на сегодня — только у группировки по поставщикам.
  debtNow?: number
  rows: SupplierPositionRow[]
}

const supplierKey = (row: { supplierId: number | null }) => (row.supplierId === null ? "none" : String(row.supplierId))

// Позиции по поставщикам в обе стороны: «поставщик → его товары» и «товар → кто его поставлял».
// Одна выборка с сервера, группировка на клиенте; строка группы раскрывается по клику.
// Списания — оценка: списание товара делится между поставщиками пропорционально их поставкам.
export function SuppliersTab({ data, query }: { data: AnalyticsSuppliers; query: string }) {
  const { totals, suppliers, positions, series, range } = data
  const [mode, setMode] = useState<GroupMode>("supplier")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState<{ supplierId: number; supplierName: string } | null>(null)
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
          supplierId: mode === "supplier" ? row.supplierId : null,
          docsCount: 0,
          qty: 0,
          goodsSum: 0,
          landedSum: 0,
          writeOffQty: 0,
          writeOffCost: 0,
          debtNow: supplier?.debtNow,
          rows: [],
        }
        map.set(key, group)
      }
      group.rows.push(row)
      group.qty += row.qty
      group.goodsSum += row.goodsSum
      group.landedSum += row.landedSum
      group.writeOffQty += row.writeOffQty
      group.writeOffCost += row.writeOffCost
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

  const visible = useMemo(
    () =>
      groups.reduce(
        (acc, group) => {
          acc.docsCount += group.docsCount
          acc.qty += group.qty
          acc.goodsSum += group.goodsSum
          acc.writeOffQty += group.writeOffQty
          acc.writeOffCost += group.writeOffCost
          acc.debtNow += group.debtNow ?? 0
          return acc
        },
        { docsCount: 0, qty: 0, goodsSum: 0, writeOffQty: 0, writeOffCost: 0, debtNow: 0 }
      ),
    [groups]
  )

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

  const payingDocuments = paying ? data.debtDocuments.filter((document) => document.supplierId === paying.supplierId) : []

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
        label="Списания поставок"
        value={moneyValue(totals.writeOffCost)}
        unit="сом"
        hint={`${formatQty(totals.writeOffQty)} шт · ${formatPercent(percentOf(totals.writeOffCost, totals.goodsTotal), 1)} от закупок${
          totals.writeOffUnattributedCost > 0 ? ` · без поставщика ${formatCompactMoney(totals.writeOffUnattributedCost)}` : ""
        }`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Оплачено поставщикам"
        value={moneyValue(totals.paidAmount)}
        unit="сом"
        hint={
          totals.debt > 0
            ? `не оплачено по приходам периода ${formatMoney(totals.debt)} · расходы ${formatCompactMoney(totals.overheadTotal)}`
            : `приходы периода оплачены · расходы ${formatCompactMoney(totals.overheadTotal)}`
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
            {query.trim() ? ` · ${formatMoney(visible.goodsSum)}` : ""}
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
            <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-[11px] font-medium text-muted-foreground uppercase">
                  <th className="px-4 py-2 text-left font-medium">{mode === "supplier" ? "Поставщик" : "Товар"}</th>
                  <th className="hidden px-3 py-2 text-right font-medium @4xl/positions:table-cell">Актов</th>
                  <th className="px-3 py-2 text-right font-medium">Кол-во</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                  <th className="hidden px-3 py-2 text-right font-medium @5xl/positions:table-cell">Доля</th>
                  <th className="hidden px-3 py-2 text-right font-medium @3xl/positions:table-cell">Списания</th>
                  <th className="hidden px-3 py-2 text-right font-medium @4xl/positions:table-cell">Цена, посл.</th>
                  {mode === "supplier" ? <th className="hidden px-3 py-2 text-right font-medium @3xl/positions:table-cell">Долг</th> : null}
                  <th className="hidden px-3 py-2 text-right font-medium @6xl/positions:table-cell">Последний приход</th>
                  {mode === "supplier" ? <th className="w-0 px-2 py-2" /> : null}
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
                      share={percentOf(group.goodsSum, visible.goodsSum)}
                      lastAt={lastAt}
                      lastCost={lastRow?.lastCost ?? 0}
                      onToggle={() => toggle(group.key)}
                      onPay={
                        mode === "supplier" && group.supplierId !== null && (group.debtNow ?? 0) > 0
                          ? () => setPaying({ supplierId: group.supplierId as number, supplierName: group.label })
                          : undefined
                      }
                      range={range}
                    />
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/60 bg-muted/30 font-medium">
                  <td className="px-4 py-2.5">
                    Итого · {groups.length} {plural(groups.length, mode === "supplier" ? SUPPLIERS_FORMS : POSITIONS_FORMS)}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums @4xl/positions:table-cell">{mode === "supplier" ? visible.docsCount : ""}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{formatQty(visible.qty)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{formatMoney(visible.goodsSum)}</td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground @5xl/positions:table-cell">100 %</td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap @3xl/positions:table-cell">
                    {formatMoney(visible.writeOffCost)}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {formatQty(visible.writeOffQty)} шт · {formatPercent(percentOf(visible.writeOffCost, visible.goodsSum), 1)}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2.5 @4xl/positions:table-cell" />
                  {mode === "supplier" ? (
                    <td className={cn("hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap @3xl/positions:table-cell", visible.debtNow > 0 && "text-red-600")}>
                      {visible.debtNow > 0 ? formatMoney(visible.debtNow) : "—"}
                    </td>
                  ) : null}
                  <td className="hidden px-3 py-2.5 @6xl/positions:table-cell" />
                  {mode === "supplier" ? <td className="px-2 py-2.5" /> : null}
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-12">
        Суммы — стоимость товаров по строкам проведённых приходных актов (без накладных расходов) по дате операции.
        Списания — оценка: списание товара за период делится между поставщиками пропорционально их поставкам этого
        товара за период. Долг — товары минус оплачено поставщику; «сейчас» — по всем проведённым приходам на сегодня.
        Погашение записывается в журнал оплат поставщика.
      </p>

      {paying ? (
        <SupplierPaymentDialog
          supplierId={paying.supplierId}
          supplierName={paying.supplierName}
          debtDocuments={payingDocuments}
          hasOpenShift={data.hasOpenShift}
          open
          onOpenChange={(open) => {
            if (!open) setPaying(null)
          }}
        />
      ) : null}
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
  onPay,
  range,
}: {
  group: Group
  mode: GroupMode
  open: boolean
  share: number
  lastAt: string | null
  lastCost: number
  onToggle: () => void
  onPay?: () => void
  range: AnalyticsSuppliers["range"]
}) {
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon
  const writeOffPct = percentOf(group.writeOffCost, group.goodsSum)
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
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
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
                {mode === "supplier" && group.supplierId !== null ? (
                  <Link
                    href={`/stock/acts?type=stock_in&supplier=${group.supplierId}&dateFrom=${range.from}&dateTo=${range.to}`}
                    className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    акты
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
        <td className="hidden px-3 py-2.5 text-right tabular-nums @4xl/positions:table-cell">{group.docsCount}</td>
        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{formatQty(group.qty)}</td>
        <td className="px-3 py-2.5 text-right font-medium tabular-nums whitespace-nowrap">{formatMoney(group.goodsSum)}</td>
        <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground @5xl/positions:table-cell">{formatPercent(share, 1)}</td>
        <td className="hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap @3xl/positions:table-cell">
          {group.writeOffCost > 0 ? (
            <>
              <span className={cn(writeOffPct >= 15 ? "text-red-600" : writeOffPct >= 7 ? "text-amber-700" : "")}>{formatMoney(group.writeOffCost)}</span>
              <span className="block text-xs text-muted-foreground">
                {formatQty(group.writeOffQty)} шт · {formatPercent(writeOffPct, 1)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        {/* Цена у товара — из последнего прихода; у поставщика цены разные по позициям — см. строки. */}
        <td className="hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap @4xl/positions:table-cell">
          {mode === "product" ? formatMoney(lastCost) : <span className="text-muted-foreground">—</span>}
        </td>
        {mode === "supplier" ? (
          <td className={cn("hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap @3xl/positions:table-cell", (group.debtNow ?? 0) > 0 ? "text-red-600" : "text-muted-foreground")}>
            {(group.debtNow ?? 0) > 0 ? formatMoney(group.debtNow ?? 0) : "—"}
          </td>
        ) : null}
        <td className="hidden px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-muted-foreground @6xl/positions:table-cell">
          {formatInstantDate(lastAt)}
        </td>
        {mode === "supplier" ? (
          <td className="px-2 py-1.5 text-right">
            {onPay ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="whitespace-nowrap text-muted-foreground"
                onClick={(event) => {
                  event.stopPropagation()
                  onPay()
                }}
                title="Погасить долг"
                aria-label="Погасить долг"
              >
                <BanknoteIcon className="size-4" aria-hidden />
                <span className="hidden @5xl/positions:inline">Погасить</span>
              </Button>
            ) : null}
          </td>
        ) : null}
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
              <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground @4xl/positions:table-cell">{row.docsCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatQty(row.qty)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(row.goodsSum)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground @5xl/positions:table-cell">
                {formatPercent(percentOf(row.goodsSum, group.goodsSum), 0)}
              </td>
              <td className="hidden px-3 py-2 text-right tabular-nums whitespace-nowrap @3xl/positions:table-cell">
                {row.writeOffCost > 0 ? (
                  <>
                    {formatMoney(row.writeOffCost)}
                    <span className="block text-xs text-muted-foreground">{formatQty(row.writeOffQty)} шт</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="hidden px-3 py-2 text-right tabular-nums whitespace-nowrap @4xl/positions:table-cell">{formatMoney(row.lastCost)}</td>
              {mode === "supplier" ? <td className="hidden @3xl/positions:table-cell" /> : null}
              <td className="hidden px-3 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground @6xl/positions:table-cell">
                {formatInstantDate(row.lastAt)}
              </td>
              {mode === "supplier" ? <td /> : null}
            </tr>
          ))
        : null}
    </>
  )
}
