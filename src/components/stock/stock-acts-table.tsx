"use client"

import { type ReactNode, useEffect, useState } from "react"
import Link from "next/link"
import { ChevronRightIcon, ClockIcon } from "lucide-react"
import {
  StockDocumentStatusBadge,
  StockDocumentStatusDot,
  StockDocumentTypeBadge,
  StockDocumentTypeIcon,
} from "@/components/stock/document-badges"
import { buttonVariants } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import type { StockDocument, StockDocumentItem } from "@/lib/db"
import { stockDocumentTypeLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"

export function StockActsTable({ documents }: { documents: StockDocument[] }) {
  const [selected, setSelected] = useState<StockDocument | null>(null)
  const [open, setOpen] = useState(false)
  // Вторичная строка дат (Создан · Проведён) — по умолчанию видна, тумблером скрывается.
  const [showTimes, setShowTimes] = useState(true)

  const totalPositions = documents.reduce((sum, document) => sum + document.itemsCount, 0)
  const stockInValue = documents
    .filter((document) => document.type === "stock_in")
    .reduce((sum, document) => sum + (document.landedTotal || document.goodsTotal || 0), 0)
  // Итоги по новым колонкам считаем по той же выборке, что и таблица, — иначе сводка разойдётся
  // с фильтрами. Долг ненулевой только у проведённых приходов (см. mapStockDocument).
  const supplierDebtTotal = documents.reduce((sum, document) => sum + document.supplierDebt, 0)
  const deliveryValue = documents.reduce((sum, document) => sum + document.deliveryTotal, 0)

  function openDrawer(document: StockDocument) {
    setSelected(document)
    setOpen(true)
  }

  return (
    <div className="@container/acts flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Актов <span className="font-semibold tabular-nums text-foreground">{documents.length}</span>
          </span>
          <span className="text-muted-foreground">
            Позиций <span className="font-semibold tabular-nums text-foreground">{totalPositions}</span>
          </span>
          <span className="text-muted-foreground">
            Сумма прихода{" "}
            <span className="font-semibold tabular-nums text-foreground">{formatMoney(stockInValue)}</span>
          </span>
          <span className="text-muted-foreground">
            Долг поставщикам{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                supplierDebtTotal > 0 ? "text-orange-600" : "text-foreground"
              )}
            >
              {formatMoney(supplierDebtTotal)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Доставка{" "}
            <span className="font-semibold tabular-nums text-foreground">{formatMoney(deliveryValue)}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowTimes((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-pressed={showTimes}
        >
          <ClockIcon className="size-3.5" />
          {showTimes ? "Скрыть даты создания" : "Показать даты создания"}
        </button>
      </div>

      {documents.length === 0 ? (
        <Empty className="min-h-56">
          <EmptyHeader>
            <EmptyTitle>Акты склада не найдены</EmptyTitle>
            <EmptyDescription>Измените фильтры или создайте акт кнопками выше.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <ColHead>Документ</ColHead>
              <ColHead>Статус</ColHead>
              <ColHead>Поставщик</ColHead>
              <ColHead>Дата операции</ColHead>
              <ColHead className="hidden @5xl/acts:table-cell">Ответственный</ColHead>
              <ColHead className="hidden text-right @4xl/acts:table-cell">Позиций</ColHead>
              <ColHead className="text-right">Сумма</ColHead>
              <ColHead className="hidden text-right @5xl/acts:table-cell">Долг поставщику</ColHead>
              <ColHead className="hidden text-right @6xl/acts:table-cell">Сумма доставки</ColHead>
              <ColHead className="hidden @7xl/acts:table-cell">Комментарий</ColHead>
              <ColHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => {
              const sum = document.landedTotal || document.goodsTotal
              return (
                <TableRow key={document.id} onClick={() => openDrawer(document)} className="cursor-pointer">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <StockDocumentTypeIcon type={document.type} />
                      <div className="min-w-0">
                        <div className="font-medium">{document.number}</div>
                        <div className="text-xs text-muted-foreground">{stockDocumentTypeLabel(document.type)}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StockDocumentStatusDot status={document.status} />
                  </TableCell>
                  <TableCell className="max-w-32 truncate">{document.supplierName || "—"}</TableCell>
                  <TableCell>
                    <div className="font-medium tabular-nums">
                      {formatOperation(document.operationAt ?? document.createdAt)}
                    </div>
                    {showTimes ? (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        Создан {formatTime(document.createdAt)}
                        {document.postedAt ? ` · Проведён ${formatTime(document.postedAt)}` : ""}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden @5xl/acts:table-cell">
                    <ResponsibleCell name={document.postedByName || document.createdByName} />
                  </TableCell>
                  <TableCell className="hidden text-right font-medium tabular-nums @4xl/acts:table-cell">{document.itemsCount}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium tabular-nums",
                      document.type === "stock_out" && sum ? "text-orange-600" : ""
                    )}
                  >
                    {sum ? formatMoney(sum) : "—"}
                  </TableCell>
                  {/* Долг = стоимость товаров − оплачено поставщику; только у проведённого прихода. */}
                  <TableCell
                    className={cn(
                      "hidden text-right tabular-nums @5xl/acts:table-cell",
                      document.supplierDebt > 0 ? "font-medium text-orange-600" : "text-muted-foreground"
                    )}
                  >
                    {document.supplierDebt > 0 ? formatMoney(document.supplierDebt) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums @6xl/acts:table-cell">
                    {document.deliveryTotal > 0 ? (
                      formatMoney(document.deliveryTotal)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden @7xl/acts:table-cell">
                    <span className="block max-w-64 truncate text-muted-foreground">{document.comment || "—"}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <ChevronRightIcon className="size-4" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="gap-0">
          {selected ? <StockActDrawer key={selected.id} document={selected} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ColHead({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <TableHead className={cn("text-[11px] font-medium text-muted-foreground uppercase", className)}>
      {children}
    </TableHead>
  )
}

function ResponsibleCell({ name }: { name?: string }) {
  const clean = (name ?? "").trim()
  const initial = clean ? clean[0]?.toUpperCase() : "—"
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-medium text-zinc-600">
        {initial}
      </span>
      <span className="max-w-32 truncate">{clean || "не зафиксирован"}</span>
    </div>
  )
}

function StockActDrawer({ document }: { document: StockDocument }) {
  const isStockIn = document.type === "stock_in"
  const hasOverhead = isStockIn && document.overheadTotal > 0
  const sum = document.landedTotal || document.goodsTotal
  const { items, error } = useActItems(document.id)

  return (
    <>
      <SheetHeader className="gap-2 border-b border-border/40">
        <div className="flex items-center gap-2 pr-8">
          <SheetTitle>Акт {document.number}</SheetTitle>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StockDocumentTypeBadge type={document.type} />
          <StockDocumentStatusBadge status={document.status} />
        </div>
        {document.comment ? <SheetDescription>{document.comment}</SheetDescription> : null}
      </SheetHeader>

      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Поставщик" value={document.supplierName || "—"} />
          <Field label="Позиций" value={String(document.itemsCount)} />
          <Field label="Создал" value={document.createdByName || "не зафиксирован"} />
          <Field label="Провёл" value={document.postedByName || "—"} />
        </dl>

        {sum || hasOverhead ? (
          <div className="flex flex-col gap-1 rounded-xl bg-muted/30 p-3 text-sm">
            {hasOverhead ? (
              <>
                <MoneyRow label="Стоимость товаров" value={document.goodsTotal} />
                <MoneyRow label="Накладные расходы" value={document.overheadTotal} />
                <div className="mt-1 border-t border-border/40 pt-1">
                  <MoneyRow label="Итого с расходами" value={document.landedTotal} strong />
                </div>
              </>
            ) : (
              <MoneyRow label="Сумма" value={sum} strong />
            )}
          </div>
        ) : null}

        {isStockIn ? (
          <div className="flex flex-col gap-1 rounded-xl bg-muted/30 p-3 text-sm">
            <MoneyRow label="Оплачено поставщику" value={document.paidAmount} />
            <MoneyRow label="Сумма доставки" value={document.deliveryTotal} />
            <div className="mt-1 border-t border-border/40 pt-1">
              <MoneyRow label="Долг поставщику" value={document.supplierDebt} strong />
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-muted-foreground">
            Позиции{document.itemsCount ? ` (${document.itemsCount})` : ""}
          </div>
          {error ? (
            <div className="text-sm text-muted-foreground">Не удалось загрузить позиции.</div>
          ) : items === null ? (
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-zinc-100" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">Позиции не заданы.</div>
          ) : (
            // shrink-0: из-за overflow-y-auto min-height flex-ребёнка равен 0 — на низких экранах
            // список сплющивается вместо того, чтобы шторка прокручивалась.
            <ul className="flex max-h-72 shrink-0 flex-col divide-y divide-border/40 overflow-y-auto rounded-lg bg-muted/30">
              {items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-900">{item.productName}</div>
                    <div className="truncate text-xs text-muted-foreground">{item.productCode}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular-nums">
                      {formatQty(item.qty)}
                      {isStockIn && item.defectQty > 0 ? (
                        <span className="text-xs text-orange-600"> · брак {formatQty(item.defectQty)}</span>
                      ) : null}
                    </div>
                    {isStockIn && item.unitCost > 0 ? (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatMoney(item.unitCost)}
                        {/* Себестоимость единицы годного (брак + накладные), если отличается от цены. */}
                        {item.landedUnitCost != null && formatMoney(item.landedUnitCost) !== formatMoney(item.unitCost)
                          ? ` · себест. ${formatMoney(item.landedUnitCost)}`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-muted-foreground">Хронология</div>
          <ol className="flex flex-col gap-2 text-sm">
            <TimelineRow label="Создан" at={document.createdAt} by={document.createdByName} />
            {document.postedAt ? (
              <TimelineRow label="Проведён" at={document.postedAt} by={document.postedByName} tone="success" />
            ) : null}
            {document.correctedAt ? (
              <TimelineRow label="Скорректирован" at={document.correctedAt} tone="violet" />
            ) : null}
            {document.cancelledAt ? (
              <TimelineRow label="Отменён" at={document.cancelledAt} tone="destructive" />
            ) : null}
          </ol>
        </div>

        {document.correctsDocumentId != null || document.correctedByDocumentId != null ? (
          <div className="flex flex-col gap-1 text-sm">
            {document.correctsDocumentId != null ? (
              <Link
                href={`/stock/acts/${document.correctsDocumentId}`}
                className="font-medium text-violet-700 underline"
              >
                Исходный акт (эта запись — корректировка)
              </Link>
            ) : null}
            {document.correctedByDocumentId != null ? (
              <Link
                href={`/stock/acts/${document.correctedByDocumentId}`}
                className="font-medium text-violet-700 underline"
              >
                Открыть корректировку
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <SheetFooter>
        <Link href={`/stock/acts/${document.id}`} className={buttonVariants({ size: "sm" })}>
          Открыть акт целиком
        </Link>
      </SheetFooter>
    </>
  )
}

// Позиции акта в списке не приходят (только itemsCount) — подгружаем по клику из owner-only роута.
function useActItems(documentId: number) {
  const [items, setItems] = useState<StockDocumentItem[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    // Drawer перемонтируется по key={document.id}, поэтому начальные null/false свежие —
    // синхронный сброс не нужен, setState только в async-колбэках (правило set-state-in-effect).
    let active = true
    const controller = new AbortController()
    fetch(`/api/stock/acts/${documentId}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { items?: unknown }) => {
        if (active) setItems(Array.isArray(data.items) ? (data.items as StockDocumentItem[]) : [])
      })
      .catch((err) => {
        if (active && !(err instanceof DOMException && err.name === "AbortError")) setError(true)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [documentId])

  return { items, error }
}

function formatQty(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-zinc-900">{value}</dd>
    </div>
  )
}

function MoneyRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  )
}

const TIMELINE_DOT: Record<string, string> = {
  default: "bg-zinc-300",
  success: "bg-emerald-500",
  violet: "bg-violet-500",
  destructive: "bg-red-500",
}

function TimelineRow({
  label,
  at,
  by,
  tone = "default",
}: {
  label: string
  at: string
  by?: string
  tone?: "default" | "success" | "violet" | "destructive"
}) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TIMELINE_DOT[tone]}`} />
      <div className="min-w-0">
        <div className="font-medium text-zinc-900">
          {label} <span className="font-normal text-muted-foreground tabular-nums">{formatDateTime(at)}</span>
        </div>
        {by ? <div className="text-xs text-muted-foreground">{by}</div> : null}
      </div>
    </li>
  )
}

function formatDateTime(value?: string | null) {
  if (!value) return "—"
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}

function formatOperation(value?: string | null) {
  if (!value) return "—"
  const date = parseDbInstant(value)
  return date
    ? date.toLocaleString("ru-RU", {
        timeZone: SHOP_TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : value
}

function formatTime(value?: string | null) {
  if (!value) return "—"
  const date = parseDbInstant(value)
  return date
    ? date.toLocaleTimeString("ru-RU", {
        timeZone: SHOP_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
      })
    : value
}
