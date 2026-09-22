"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react"
import type { AnalyticsOperations, OperationKind, OperationRow, OperationTypeFilter } from "@/lib/db"
import { deliveryTypeLabel, getPaymentMethodLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { formatInstantShort, formatQty, formatSignedQty, plural } from "./format"
import { productCardHref } from "./links"
import { FilterChips } from "@/components/screen-header"
import { ActiveFilters, FilterCombobox, OpenInWindowLink, Pagination, TableToolbar } from "./table-chrome"

const KIND_LABEL: Record<OperationKind, string> = {
  sale: "Чек",
  order: "Заказ",
  receipt: "Приход",
  writeoff: "Списание",
  inventory: "Инвентаризация",
}

const KIND_TONE: Record<OperationKind, "neutral" | "violet" | "success" | "orange" | "outline"> = {
  sale: "neutral",
  order: "violet",
  receipt: "success",
  writeoff: "orange",
  inventory: "outline",
}

// Чипы типов операций над таблицей: счётчик — по всей выборке с текущими товарными фильтрами.
const TYPE_CHIPS: Array<{ value: OperationTypeFilter; label: string; kinds: OperationKind[] }> = [
  { value: "all", label: "Все", kinds: ["sale", "order", "receipt", "writeoff", "inventory"] },
  { value: "sale", label: "Чеки", kinds: ["sale"] },
  { value: "order", label: "Заказы", kinds: ["order"] },
  { value: "receipt", label: "Приходы", kinds: ["receipt"] },
  { value: "writeoff", label: "Списания", kinds: ["writeoff"] },
  { value: "inventory", label: "Инвентаризации", kinds: ["inventory"] },
]

const DOCS_FORMS: [string, string, string] = ["операция", "операции", "операций"]

// Пояснение к строке: клиент и способ оплаты у чека, клиент и доставка у заказа, поставщик у прихода,
// причина у списания.
function explain(row: OperationRow): { title: string; meta: string } {
  switch (row.kind) {
    case "sale":
      return { title: row.title || "Без клиента", meta: [getPaymentMethodLabel(row.meta), row.reversed ? "сторнирован" : ""].filter(Boolean).join(" · ") }
    case "order":
      return { title: row.title || "Без клиента", meta: row.meta ? deliveryTypeLabel(row.meta) : "" }
    case "receipt":
      return { title: row.title, meta: row.meta }
    case "writeoff":
      return { title: row.title, meta: row.meta }
    default:
      return { title: row.qty === 0 ? "Без расхождений" : row.qty > 0 ? "Излишки" : "Недостача", meta: "" }
  }
}

/**
 * Журнал операций за период с фильтрами из URL: тип, категория, товар, причина списания,
 * поставщик, поиск. Строка раскрывается по клику — позиции документа; акты открываются страницей.
 */
export function OperationsTab({ data }: { data: AnalyticsOperations }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { filters, rows, totals, page, pageSize, total } = data
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "" || value === "all") params.delete(key)
      else params.set(key, value)
    }
    if (!("page" in next)) params.delete("page")
    router.push(`${pathname}?${params.toString()}`)
  }

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const totalsByKind = new Map(totals.map((entry) => [entry.kind, entry]))
  // Сумма по списку: только виды, попавшие под фильтр типа.
  const listKinds: OperationKind[] =
    filters.type === "all" ? ["sale", "order", "receipt", "writeoff", "inventory"] : filters.type === "sales" ? ["sale", "order"] : [filters.type]
  const grandAmount = totals.filter((entry) => listKinds.includes(entry.kind)).reduce((sum, entry) => sum + entry.amount, 0)

  const chips = [
    ...(filters.product ? [{ key: "product", label: `Товар: ${filters.productName}`, onRemove: () => push({ product: null }) }] : []),
    ...(filters.query ? [{ key: "q", label: `Поиск: ${filters.query}`, onRemove: () => push({ q: null }) }] : []),
  ]

  // Подпись итога по выбранному типу: сумма и штуки (у инвентаризации — знак разницы).
  const summary = listKinds
    .map((kind) => totalsByKind.get(kind))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  const summaryQty = summary.reduce((sum, entry) => sum + entry.qty, 0)
  const totalLabel =
    filters.type === "inventory"
      ? `${grandAmount >= 0 ? "+" : "−"}${formatMoney(Math.abs(grandAmount))}`
      : `${formatMoney(grandAmount)}${summaryQty > 0 ? ` · ${formatQty(summaryQty)} шт` : ""}`

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex min-w-0 flex-col rounded-2xl bg-background shadow-xs">
        {/* Тип операции — чипы со счётчиками, ниже — фильтры по товару и итог выборки. */}
        <div className="px-3 pt-3">
          <FilterChips
            value={filters.type === "sales" ? "all" : filters.type}
            options={TYPE_CHIPS.map((chip) => ({
              value: chip.value,
              label: chip.label,
              count: chip.kinds.reduce((sum, kind) => sum + (totalsByKind.get(kind)?.count ?? 0), 0),
            }))}
            onValueChange={(value) => push({ type: value })}
          />
        </div>
        <TableToolbar
          className="pt-1"
          left={
            <>
              <FilterCombobox
                label="Категория"
                value={filters.category || "all"}
                allLabel="Все категории"
                options={data.categories.map((name) => ({ value: name, label: name }))}
                onValueChange={(value) => push({ category: value })}
                searchPlaceholder="Найти категорию"
              />
              <FilterCombobox
                label="Поставщик"
                value={filters.supplier || "all"}
                allLabel="Все поставщики"
                options={data.suppliers.map((row) => ({ value: String(row.id), label: row.name }))}
                onValueChange={(value) => push({ supplier: value })}
                searchPlaceholder="Найти поставщика"
              />
              <FilterCombobox
                label="Причина списания"
                value={filters.reason || "all"}
                allLabel="Все причины"
                options={data.reasons.map((name) => ({ value: name, label: name }))}
                onValueChange={(value) => push({ reason: value })}
                searchPlaceholder="Найти причину"
              />
              <ActiveFilters chips={chips} />
            </>
          }
          right={
            <>
              <span className="tabular-nums">
                {total} {plural(total, DOCS_FORMS)}
                {total > 0 ? ` · ${totalLabel}` : ""}
              </span>
              <OpenInWindowLink />
            </>
          }
        />

        {rows.length === 0 ? (
          <Empty className="min-h-48">
            <EmptyHeader>
              <EmptyTitle>Операций не найдено</EmptyTitle>
              <EmptyDescription>Измените период или снимите фильтры.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="@container/ops min-w-0 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-[11px] font-medium text-muted-foreground uppercase">
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Дата</th>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Операция</th>
                  <th className="w-full min-w-32 px-3 py-2 text-left font-medium">Пояснение</th>
                  <th className="hidden px-3 py-2 text-right font-medium whitespace-nowrap @3xl/ops:table-cell">Позиций</th>
                  <th className="hidden px-3 py-2 text-right font-medium whitespace-nowrap @3xl/ops:table-cell">Кол-во</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Сумма</th>
                  <th className="hidden px-3 py-2 text-left font-medium whitespace-nowrap @4xl/ops:table-cell">Кто</th>
                  <th className="w-0 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const open = expanded.has(row.key)
                  const { title, meta } = explain(row)
                  const Chevron = open ? ChevronDownIcon : ChevronRightIcon
                  return (
                    <OperationRows
                      key={row.key}
                      row={row}
                      open={open}
                      title={title}
                      meta={meta}
                      Chevron={Chevron}
                      onToggle={() => toggle(row.key)}
                      range={data.range}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPageChange={(next) => push({ page: String(next) })} />
      </section>

      <p className="text-xs text-muted-foreground">
        Чеки — по дате продажи, заказы — по дате выдачи (сумма без доставки), приходы и списания — по дате операции,
        инвентаризации — по дате проведения (сумма — разница факта и учёта по себестоимости). Сторнированные чеки
        показаны с пометкой и в итоги не входят.
      </p>
    </div>
  )
}

function OperationRows({
  row,
  open,
  title,
  meta,
  Chevron,
  onToggle,
  range,
}: {
  row: OperationRow
  open: boolean
  title: string
  meta: string
  Chevron: typeof ChevronDownIcon
  onToggle: () => void
  range: AnalyticsOperations["range"]
}) {
  const amountClass =
    row.kind === "inventory" ? (row.amount < 0 ? "text-red-600" : row.amount > 0 ? "text-emerald-700" : "text-muted-foreground") : row.reversed ? "text-muted-foreground line-through" : ""
  return (
    <>
      <tr
        className={cn("cursor-pointer border-t border-border/40 transition-colors hover:bg-muted/40", open && "bg-muted/30", row.reversed && "text-muted-foreground")}
        onClick={onToggle}
        aria-expanded={open}
      >
        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
          <span className="flex items-center gap-2">
            <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {formatInstantShort(row.at)}
          </span>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {/* В узкой таблице номер уходит под бейдж, чтобы не раздвигать колонку. */}
          <span className="flex flex-col items-start gap-0.5 @3xl/ops:flex-row @3xl/ops:items-center @3xl/ops:gap-2">
            <Badge variant={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
            <span className="font-medium">{row.kind === "sale" ? `#${row.id}` : row.number}</span>
          </span>
        </td>
        <td className="w-full max-w-0 min-w-32 px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate">
              {title}
              {meta ? <span className="text-xs text-muted-foreground"> · {meta}</span> : null}
            </div>
            {row.comment ? <div className="truncate text-xs text-muted-foreground">{row.comment}</div> : null}
          </div>
        </td>
        <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground @3xl/ops:table-cell">{row.itemsCount}</td>
        <td className="hidden px-3 py-2.5 text-right tabular-nums @3xl/ops:table-cell">{row.kind === "inventory" ? formatSignedQty(row.qty) : formatQty(row.qty)}</td>
        <td className={cn("px-3 py-2.5 text-right font-medium tabular-nums whitespace-nowrap", amountClass)}>
          {row.kind === "inventory" ? `${row.amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(row.amount))}` : formatMoney(row.amount)}
        </td>
        <td className="hidden max-w-32 truncate px-3 py-2.5 text-muted-foreground @4xl/ops:table-cell">{row.userName || "—"}</td>
        <td className="px-2 py-2.5 text-right">
          {row.href ? (
            <Link
              href={row.href}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Открыть документ"
              aria-label="Открыть документ"
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLinkIcon className="size-4" aria-hidden />
            </Link>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-border/25 bg-muted/15">
          <td colSpan={8} className="px-4 py-2 pl-10">
            {row.items.length === 0 ? (
              <span className="text-xs text-muted-foreground">Позиций нет</span>
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {row.items.map((item, index) => (
                    <tr key={`${row.key}:${index}`} className="border-t border-border/20 first:border-t-0">
                      <td className="py-1.5 pr-3">
                        {item.productCode ? (
                          <Link href={productCardHref(item.productCode, range)} className="underline-offset-4 hover:underline">
                            {item.productName}
                          </Link>
                        ) : (
                          item.productName
                        )}
                        <span className="ml-2 text-xs text-muted-foreground">{item.category}</span>
                        {item.comment ? <span className="ml-2 text-xs text-muted-foreground">· {item.comment}</span> : null}
                      </td>
                      <td className="w-20 py-1.5 text-right tabular-nums">{row.kind === "inventory" ? formatSignedQty(item.qty) : formatQty(item.qty)}</td>
                      <td className="hidden w-28 py-1.5 text-right tabular-nums text-muted-foreground @2xl/ops:table-cell">{formatMoney(item.unitPrice)}</td>
                      <td className="w-32 py-1.5 text-right tabular-nums">{formatMoney(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      ) : null}
    </>
  )
}
