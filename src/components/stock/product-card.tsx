"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeftIcon, CalendarClockIcon, HistoryIcon, PencilIcon, PlusCircleIcon } from "lucide-react"
import type { ProductCardData, ProductCardMovement } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { BarList, Panel } from "@/components/analytics/bar-list"
import { ColumnChart, TrendChart } from "@/components/analytics/charts"
import {
  DOCS_FORMS,
  formatCompactMoney,
  formatInstantDate,
  formatInstantShort,
  formatPercent,
  formatQty,
  formatSignedQty,
  ORDERS_FORMS,
  percentOf,
  plural,
  SALES_FORMS,
  SERIES_COLORS,
  SUPPLIERS_FORMS,
} from "@/components/analytics/format"
import { PeriodPicker } from "@/components/analytics/period-picker"
import { SalesDrilldownSheet, type DrillTarget } from "@/components/analytics/sales-drilldown-sheet"
import { StatTile } from "@/components/analytics/stat-tile"
import { DataView, type DataViewColumn } from "@/components/data-view"
import { ProductThumbnail } from "@/components/products/product-thumbnail"
import { ScreenBody } from "@/components/screen-body"
import { FilterChips, HeaderAction, HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

type Kind = ProductCardMovement["kind"]
type KindFilter = "all" | Kind

const KIND_LABELS: Record<Kind, string> = {
  sale: "Продажа",
  receipt: "Приход",
  write_off: "Списание",
  adjustment: "Корректировка",
  inventory: "Инвентаризация",
  import: "Импорт",
}

const KIND_ORDER: Kind[] = ["sale", "receipt", "write_off", "adjustment", "inventory", "import"]

const PAGE_SIZE = 40

function kindTone(movement: ProductCardMovement): "neutral" | "success" | "orange" | "violet" {
  switch (movement.kind) {
    case "sale":
      return "neutral"
    case "receipt":
      return movement.qty >= 0 ? "success" : "orange"
    case "write_off":
      return movement.qty <= 0 ? "orange" : "success"
    case "import":
    case "inventory":
      return "violet"
    default:
      return movement.qty > 0 ? "success" : movement.qty < 0 ? "orange" : "neutral"
  }
}

// Подпись движения: тип + уточнение (сторно, откат/корректировка акта).
function movementLabel(movement: ProductCardMovement): string {
  const base = KIND_LABELS[movement.kind]
  if (movement.kind === "sale") {
    return movement.type === "order_fulfill" ? "Заказ" : "Продажа"
  }
  if (movement.type === "adjustment" && (movement.kind === "receipt" || movement.kind === "write_off")) {
    return movement.note.startsWith("Откат") ? `${base} · откат` : `${base} · корректировка`
  }
  if (movement.kind === "adjustment" && movement.note.startsWith("Сторно")) {
    return "Сторно продажи"
  }
  return base
}

// Связь движения: акт — ссылка на страницу акта; чек/заказ — кнопка, раскрывающая документ в панели.
function movementSource(movement: ProductCardMovement, onOpenDoc?: (target: DrillTarget) => void) {
  if (movement.documentId !== null) {
    return (
      <Link href={`/stock/acts/${movement.documentId}`} className="font-medium underline-offset-4 hover:underline">
        {movement.documentNumber ?? `Акт #${movement.documentId}`}
      </Link>
    )
  }
  const ref =
    movement.saleId !== null
      ? { source: "sale" as const, id: movement.saleId, label: `Чек #${movement.saleId}` }
      : movement.orderId !== null
        ? { source: "order" as const, id: movement.orderId, label: `Заказ #${movement.orderId}` }
        : null
  if (!ref) return <span className="text-muted-foreground">—</span>
  if (!onOpenDoc) return <span>{ref.label}</span>
  return (
    <button
      type="button"
      className="font-medium underline-offset-4 hover:underline"
      onClick={() => onOpenDoc({ kind: "document", source: ref.source, id: ref.id })}
    >
      {ref.label}
    </button>
  )
}

/**
 * Карточка товара: остатки и цены, показатели за период (продано / поступило / списано), график
 * остатка и продаж по дням, поставщики товара с ценами и журнал движений с фильтром по типу.
 * Период общий с аналитикой (?preset= | ?from=&to=).
 */
export function ProductCard({ data }: { data: ProductCardData }) {
  const { product, period, previous, series, suppliers, movements, range } = data
  const [kind, setKind] = useState<KindFilter>("all")
  const [drill, setDrill] = useState<DrillTarget | null>(null)
  const days = series.map((point) => point.day)

  // «Продано» → список чеков и заказов с этим товаром за период.
  function openSales() {
    setDrill({
      kind: "product",
      productCode: product.code,
      productName: product.name,
      lines: data.sales.map((line) => ({
        source: line.source,
        sourceId: line.sourceId,
        label: line.label,
        soldAt: line.soldAt,
        customer: line.customer,
        qty: line.qty,
        total: line.total,
      })),
    })
  }
  const marginPct = product.salePrice > 0 ? percentOf(product.salePrice - product.costPrice, product.salePrice) : 0
  const netChange = period.closingStock - period.openingStock

  const kindCounts = useMemo(() => {
    const counts = new Map<Kind, number>()
    for (const movement of movements) counts.set(movement.kind, (counts.get(movement.kind) ?? 0) + 1)
    return counts
  }, [movements])

  const filteredMovements = useMemo(
    () => (kind === "all" ? movements : movements.filter((movement) => movement.kind === kind)),
    [movements, kind]
  )
  // Журнал раскрывается порциями: у ходового товара сотни движений за месяц.
  const [shown, setShown] = useState(PAGE_SIZE)
  const visibleMovements = filteredMovements.slice(0, shown)
  const hiddenCount = filteredMovements.length - visibleMovements.length

  const columns = useMemo<DataViewColumn<ProductCardMovement>[]>(
    () => [
      {
        key: "date",
        header: "Дата",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.createdAt,
        defaultDirection: "desc",
        cell: (row) => formatInstantShort(row.createdAt),
      },
      {
        key: "type",
        header: "Тип",
        className: "whitespace-nowrap",
        sortValue: (row) => KIND_ORDER.indexOf(row.kind),
        cell: (row) => <Badge variant={kindTone(row)}>{movementLabel(row)}</Badge>,
      },
      {
        key: "qty",
        header: "Кол-во",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.qty,
        defaultDirection: "desc",
        cell: (row) => (
          <span className={cn("font-medium", row.qty > 0 ? "text-emerald-700" : row.qty < 0 ? "text-orange-600" : "text-foreground")}>
            {formatSignedQty(row.qty)}
          </span>
        ),
      },
      {
        key: "stock",
        header: "Остаток",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        cell: (row) =>
          row.beforeStock === null && row.afterStock === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span>
              <span className="text-muted-foreground">{row.beforeStock === null ? "—" : formatQty(row.beforeStock)}</span>
              <span className="mx-1 text-muted-foreground">→</span>
              <span className={cn("font-medium", (row.afterStock ?? 0) < 0 && "text-red-600")}>
                {row.afterStock === null ? "—" : formatQty(row.afterStock)}
              </span>
            </span>
          ),
      },
      {
        key: "source",
        header: "Связь",
        hideBelow: "3xl",
        className: "whitespace-nowrap",
        cell: (row) => (
          <span className="flex min-w-0 flex-col">
            {movementSource(row, setDrill)}
            {row.supplierName ? <span className="truncate text-xs text-muted-foreground">{row.supplierName}</span> : null}
          </span>
        ),
      },
      {
        key: "user",
        header: "Кто",
        hideBelow: "5xl",
        sortValue: (row) => row.userName,
        cell: (row) => <span className="block max-w-28 truncate text-muted-foreground">{row.userName || "—"}</span>,
      },
      {
        key: "note",
        header: "Комментарий",
        grow: true,
        hideBelow: "4xl",
        cell: (row) => <span className="block truncate text-muted-foreground">{row.note || "—"}</span>,
      },
    ],
    []
  )

  return (
    <>
      <ScreenHeader
        title={product.name}
        leading={
          <>
            <HeaderAction icon={ArrowLeftIcon} label="Товары" href="/stock" className="pr-2" />
            <span className="mx-0.5 h-5 w-px shrink-0 bg-border/60" aria-hidden />
            <PeriodPicker range={range} showDates />
          </>
        }
        meta={`остаток ${formatQty(product.stock)} · доступно ${formatQty(product.available)}`}
        actions={
          <>
            {product.trackLots ? <HeaderAction icon={CalendarClockIcon} label="Партии" href="/stock/lots" /> : null}
            <HeaderAction
              icon={HistoryIcon}
              label="История склада"
              href={`/history/stock?view=moves&query=${encodeURIComponent(product.code)}&dateFrom=${range.from}&dateTo=${range.to}`}
            />
            <HeaderAction icon={PencilIcon} label="Редактировать" href={`/stock?edit=${encodeURIComponent(product.code)}`} />
          </>
        }
        primaryAction={<HeaderPrimaryAction icon={PlusCircleIcon} label="Пополнить" href="/stock?new=stock_in" />}
        tabs={null}
      />

      <ScreenBody surface={false} className="gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
          {/* Паспорт товара: остатки и цены на сейчас. */}
          <section className="flex min-w-0 flex-col gap-4 rounded-2xl bg-background p-4 shadow-xs md:col-span-2 xl:col-span-6">
            <div className="flex items-start gap-4">
              <ProductThumbnail name={product.name} imagePath={product.imagePath} size="xl" className="size-20 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg leading-tight font-semibold">{product.name}</h2>
                  {!product.isActive ? <Badge variant="outline">В архиве</Badge> : null}
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">{product.categoryPath || "Без категории"}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                  <span>Код {product.code}</span>
                  {product.article ? <span>Артикул {product.article}</span> : null}
                  <span>Ед. {product.unit}</span>
                  {product.vaseLifeDays ? <span>Стойкость {product.vaseLifeDays} дн.</span> : null}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Fact label="Остаток" value={formatQty(product.stock)} tone={product.stock < 0 ? "danger" : "default"} />
              <Fact label="Резерв" value={formatQty(product.reserved)} muted={product.reserved === 0} />
              <Fact label="Доступно" value={formatQty(product.available)} tone={product.available < 0 ? "danger" : product.available <= 3 ? "warning" : "default"} />
              <Fact label="Ожидается" value={formatQty(product.expected)} muted={product.expected === 0} />
              <Fact label="Себестоимость" value={formatMoney(product.costPrice)} />
              <Fact label="Цена продажи" value={formatMoney(product.salePrice)} />
              <Fact label="Наценка" value={product.salePrice > 0 ? formatPercent(marginPct) : "—"} sub={product.salePrice > 0 ? formatMoney(product.salePrice - product.costPrice) : undefined} />
              <Fact label="Сумма остатка" value={formatMoney(Math.max(0, product.stock) * product.costPrice)} sub="по себест." />
            </dl>
          </section>

          {/* Показатели периода. */}
          <div className="grid grid-cols-2 gap-4 md:col-span-2 xl:col-span-6">
            <StatTile
              label="Продано"
              value={formatQty(period.soldQty)}
              unit={product.unit}
              delta={{ current: period.soldQty, previous: previous.soldQty }}
              spark={series.map((point) => point.soldQty)}
              sparkColor={SERIES_COLORS.revenue}
              hint={`${formatMoney(period.revenue)} · ${period.salesCount} ${plural(period.salesCount, SALES_FORMS)} · ${period.ordersCount} ${plural(period.ordersCount, ORDERS_FORMS)} → открыть`}
              onClick={openSales}
            />
            <StatTile
              label="Поступило"
              value={formatQty(period.receivedQty)}
              unit={product.unit}
              delta={{ current: period.receivedQty, previous: previous.receivedQty }}
              spark={series.map((point) => point.receivedQty)}
              sparkColor={SERIES_COLORS.purchases}
              hint={`${formatMoney(period.receivedSum)} · ${period.receiptDocs} ${plural(period.receiptDocs, DOCS_FORMS)}${period.receivedQty > 0 ? ` · ${formatMoney(period.receivedSum / period.receivedQty)}/${product.unit}` : ""}`}
            />
            <StatTile
              label="Списано"
              value={formatQty(period.writtenOffQty)}
              unit={product.unit}
              delta={{ current: period.writtenOffQty, previous: previous.writtenOffQty, upIsGood: false }}
              spark={series.map((point) => point.writtenOffQty)}
              sparkColor={SERIES_COLORS.writeOffs}
              hint={`${formatMoney(period.writtenOffCost)}${period.receivedQty > 0 ? ` · ${formatPercent(percentOf(period.writtenOffQty, period.receivedQty))} от поступлений` : ""}`}
            />
            <StatTile
              label="Остаток за период"
              value={`${formatQty(period.openingStock)} → ${formatQty(period.closingStock)}`}
              hint={`${netChange >= 0 ? "+" : "−"}${formatQty(Math.abs(netChange))} ${product.unit}${period.adjustmentQty !== 0 ? ` · корректировки ${formatSignedQty(period.adjustmentQty)}` : ""}`}
            />
          </div>

          <Panel title="Остаток по дням" subtitle="На конец дня, по журналу движений" className="md:col-span-2 xl:col-span-7">
            <TrendChart
              days={days}
              series={[{ key: "stock", label: "Остаток", color: SERIES_COLORS.stock, values: series.map((point) => point.stock) }]}
              formatValue={(value) => `${formatQty(value)} ${product.unit}`}
              formatTick={(value) => formatQty(value, 0)}
              area
            />
          </Panel>

          <Panel title="Продажи по дням" subtitle="Чеки и выданные заказы" className="md:col-span-2 xl:col-span-5">
            <ColumnChart
              days={days}
              values={series.map((point) => point.soldQty)}
              label="Продано"
              color={SERIES_COLORS.revenue}
              formatValue={(value) => `${formatQty(value)} ${product.unit}`}
              formatTick={(value) => formatQty(value, 0)}
            />
          </Panel>

          <Panel
            title="Поставщики за период"
            subtitle={
              suppliers.length
                ? `${suppliers.length} ${plural(suppliers.length, SUPPLIERS_FORMS)} · ${formatQty(period.receivedQty)} ${product.unit} на ${formatCompactMoney(period.receivedSum)}`
                : undefined
            }
            className="md:col-span-2 xl:col-span-7"
          >
            {suppliers.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Проведённых приходов за период нет</div>
            ) : (
              <div className="@container/suppliers -mx-1 min-w-0 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-[11px] font-medium text-muted-foreground uppercase">
                      <th className="px-1 py-1.5 text-left font-medium">Поставщик</th>
                      <th className="px-2 py-1.5 text-right font-medium">Кол-во</th>
                      <th className="hidden px-2 py-1.5 text-right font-medium @md/suppliers:table-cell">Доля</th>
                      <th className="px-2 py-1.5 text-right font-medium">Сумма</th>
                      <th className="hidden px-2 py-1.5 text-right font-medium @lg/suppliers:table-cell">Средняя</th>
                      <th className="px-2 py-1.5 text-right font-medium">Посл. цена</th>
                      <th className="hidden px-1 py-1.5 text-right font-medium @xl/suppliers:table-cell">Посл. приход</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((row) => (
                      <tr key={row.supplierId ?? "none"} className="border-t border-border/40">
                        <td className="px-1 py-2">
                          {row.supplierId !== null ? (
                            <Link href={`/suppliers/${row.supplierId}`} className="block truncate font-medium underline-offset-4 hover:underline">
                              {row.supplierName}
                            </Link>
                          ) : (
                            <span className="block truncate text-muted-foreground">{row.supplierName}</span>
                          )}
                          <span className="block text-xs text-muted-foreground">
                            {row.docsCount} {plural(row.docsCount, DOCS_FORMS)}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(row.qty)}</td>
                        <td className="hidden px-2 py-2 text-right tabular-nums text-muted-foreground @md/suppliers:table-cell">{formatPercent(row.share)}</td>
                        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(row.goodsSum)}</td>
                        <td className="hidden px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground @lg/suppliers:table-cell">{formatMoney(row.avgCost)}</td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right tabular-nums whitespace-nowrap",
                            row.lastCost > row.avgCost * 1.05 ? "text-red-600" : row.lastCost < row.avgCost * 0.95 ? "text-emerald-700" : ""
                          )}
                        >
                          {formatMoney(row.lastCost)}
                        </td>
                        <td className="hidden px-1 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground @xl/suppliers:table-cell">
                          {formatInstantDate(row.lastAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Последние закупочные цены" subtitle="Все проведённые приходы, независимо от периода" className="md:col-span-2 xl:col-span-5">
            <BarList
              items={data.recentCosts.map((row) => ({
                key: `${row.documentId}-${row.at}`,
                label: `${formatInstantDate(row.at)} · ${row.supplierName}`,
                value: row.unitCost,
                meta: row.documentNumber,
                href: `/stock/acts/${row.documentId}`,
              }))}
              formatValue={formatMoney}
              showShare={false}
              color={SERIES_COLORS.purchases}
              empty="Приходов по товару ещё не было"
            />
          </Panel>

          {/* Журнал движений товара за период. */}
          <section className="flex min-w-0 flex-col rounded-2xl bg-background shadow-xs md:col-span-2 xl:col-span-12">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
              <FilterChips
                value={kind}
                options={[
                  { value: "all", label: "Все движения", count: movements.length },
                  ...KIND_ORDER.filter((entry) => kindCounts.has(entry)).map((entry) => ({
                    value: entry,
                    label: KIND_LABELS[entry] + (entry === "sale" ? " и заказы" : ""),
                    count: kindCounts.get(entry),
                  })),
                ]}
                onValueChange={(value) => {
                  setKind(value)
                  setShown(PAGE_SIZE)
                }}
              />
              {data.movementsTruncated ? (
                <span className="px-1 text-xs text-muted-foreground">показаны последние {movements.length} — сузьте период</span>
              ) : null}
            </div>
            <DataView
              rows={visibleMovements}
              columns={columns}
              getRowKey={(row) => row.id}
              stickyHeader={false}
              renderCard={(row) => (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={kindTone(row)}>{movementLabel(row)}</Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">{formatInstantShort(row.createdAt)}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{row.note || movementSource(row)}</div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <div className={cn("font-medium", row.qty > 0 ? "text-emerald-700" : row.qty < 0 ? "text-orange-600" : "")}>
                      {formatSignedQty(row.qty)}
                    </div>
                    <div className="text-xs text-muted-foreground">→ {row.afterStock === null ? "—" : formatQty(row.afterStock)}</div>
                  </div>
                </div>
              )}
              empty={
                <Empty className="min-h-40">
                  <EmptyHeader>
                    <EmptyTitle>Движений нет</EmptyTitle>
                    <EmptyDescription>За выбранный период по товару не было операций этого типа.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              }
            />
            {hiddenCount > 0 ? (
              <div className="flex items-center justify-center gap-3 border-t border-border/40 px-4 py-3 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  показано {visibleMovements.length} из {filteredMovements.length}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShown((value) => value + PAGE_SIZE)}>
                  Показать ещё {Math.min(PAGE_SIZE, hiddenCount)}
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </ScreenBody>

      <SalesDrilldownSheet target={drill} onClose={() => setDrill(null)} range={range} />
    </>
  )
}

function Fact({
  label,
  value,
  sub,
  tone = "default",
  muted = false,
}: {
  label: string
  value: string
  sub?: string
  tone?: "default" | "warning" | "danger"
  muted?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate text-base font-semibold tabular-nums",
          tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : muted ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {value}
      </dd>
      {sub ? <dd className="truncate text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  )
}
