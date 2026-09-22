"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeftIcon, ExternalLinkIcon, ReceiptTextIcon } from "lucide-react"
import type { AnalyticsRange, SalesDocument, SalesDocumentSource } from "@/lib/db"
import { deliveryTypeLabel, getPaymentMethodLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatInstantShort, formatQty, ORDERS_FORMS, plural, SALES_FORMS } from "./format"
import { productCardHref } from "./links"

export type DrillLine = {
  source: SalesDocumentSource
  sourceId: number
  label: string
  soldAt: string
  customer: string
  qty: number
  total: number
}

export type DrillDoc = {
  source: SalesDocumentSource
  sourceId: number
  label: string
  soldAt: string
  customer: string
  itemsCount: number
  total: number
}

export type DrillTarget =
  // Продажи одного товара: строки чеков/заказов, где он был.
  | { kind: "product"; productCode: string; productName: string; lines: DrillLine[] }
  // Все документы периода (чеки и выданные заказы).
  | { kind: "documents"; title: string; subtitle?: string; docs: DrillDoc[] }
  // Сразу конкретный документ (ссылка «Чек #N» из журнала движений).
  | { kind: "document"; source: SalesDocumentSource; id: number }

type SalesDrilldownSheetProps = {
  target: DrillTarget | null
  onClose: () => void
  range?: AnalyticsRange
}

type DocRef = { source: SalesDocumentSource; id: number }

// Группировка строк продаж по документу (для списка «чеки и заказы» из строк отчёта).
export function groupLinesToDocs(lines: DrillLine[]): DrillDoc[] {
  const map = new Map<string, DrillDoc>()
  for (const line of lines) {
    const key = `${line.source}:${line.sourceId}`
    const doc = map.get(key) ?? {
      source: line.source,
      sourceId: line.sourceId,
      label: line.label,
      soldAt: line.soldAt,
      customer: line.customer,
      itemsCount: 0,
      total: 0,
    }
    doc.itemsCount += 1
    doc.total += line.total
    map.set(key, doc)
  }
  return [...map.values()].sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0))
}

/**
 * Боковая панель «провалиться»: список чеков/заказов (по товару или за период) → конкретный
 * документ со всеми позициями (подгружается с сервера). Позиции ведут в карточки товаров.
 */
function initialDoc(target: DrillTarget | null): DocRef | null {
  return target?.kind === "document" ? { source: target.source, id: target.id } : null
}

export function SalesDrilldownSheet({ target, onClose, range }: SalesDrilldownSheetProps) {
  // Открытый документ привязан к цели: при смене цели (новый товар/список) начинаем со списка,
  // а прямое открытие документа — сразу с него. Сброс — при рендере, без эффекта.
  const [docState, setDocState] = useState<{ target: DrillTarget | null; doc: DocRef | null }>(() => ({ target, doc: initialDoc(target) }))
  if (docState.target !== target) {
    setDocState({ target, doc: initialDoc(target) })
  }
  const doc = docState.target === target ? docState.doc : initialDoc(target)
  const setDoc = (next: DocRef | null) => setDocState({ target, doc: next })
  const open = target !== null

  const canGoBack = target !== null && target.kind !== "document"

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent className="w-full sm:max-w-2xl">
        {target ? (
          doc ? (
            <DocumentView
              key={`${doc.source}:${doc.id}`}
              docRef={doc}
              range={range}
              onBack={canGoBack ? () => setDoc(null) : undefined}
            />
          ) : target.kind === "product" ? (
            <ProductLinesView target={target} range={range} onOpenDoc={setDoc} />
          ) : target.kind === "documents" ? (
            <DocumentsView target={target} onOpenDoc={setDoc} />
          ) : null
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ProductLinesView({
  target,
  range,
  onOpenDoc,
}: {
  target: Extract<DrillTarget, { kind: "product" }>
  range?: AnalyticsRange
  onOpenDoc: (doc: DocRef) => void
}) {
  const totals = useMemo(() => {
    const sales = new Set<number>()
    const orders = new Set<number>()
    let qty = 0
    let total = 0
    for (const line of target.lines) {
      if (line.source === "sale") sales.add(line.sourceId)
      else orders.add(line.sourceId)
      qty += line.qty
      total += line.total
    }
    return { salesCount: sales.size, ordersCount: orders.size, qty, total }
  }, [target.lines])

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <ReceiptTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{target.productName}</span>
        </SheetTitle>
        <SheetDescription>
          {formatQty(totals.qty)} шт на {formatMoney(totals.total)} · {totals.salesCount} {plural(totals.salesCount, SALES_FORMS)} ·{" "}
          {totals.ordersCount} {plural(totals.ordersCount, ORDERS_FORMS)}
        </SheetDescription>
      </SheetHeader>
      <div className="flex items-center gap-2 px-4">
        <Link
          href={productCardHref(target.productCode, range)}
          className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          Карточка товара
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </Link>
      </div>
      {target.lines.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">Продаж за период нет.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/40 px-2 pb-4">
          {target.lines.map((line, index) => (
            <li key={`${line.source}:${line.sourceId}:${index}`}>
              <button
                type="button"
                onClick={() => onOpenDoc({ source: line.source, id: line.sourceId })}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{line.label}</span>
                    <Badge variant={line.source === "sale" ? "neutral" : "violet"}>{line.source === "sale" ? "касса" : "заказ"}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {formatInstantShort(line.soldAt)}
                    {line.customer ? ` · ${line.customer}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="font-medium">{formatMoney(line.total)}</div>
                  <div className="text-xs text-muted-foreground">{formatQty(line.qty)} шт</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function DocumentsView({
  target,
  onOpenDoc,
}: {
  target: Extract<DrillTarget, { kind: "documents" }>
  onOpenDoc: (doc: DocRef) => void
}) {
  const [query, setQuery] = useState("")
  const docs = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return target.docs
    return target.docs.filter((doc) => `${doc.label} ${doc.customer}`.toLowerCase().includes(q))
  }, [target.docs, query])
  const total = docs.reduce((sum, doc) => sum + doc.total, 0)

  return (
    <>
      <SheetHeader>
        <SheetTitle>{target.title}</SheetTitle>
        <SheetDescription>
          {target.subtitle ? `${target.subtitle} · ` : ""}
          {docs.length} {plural(docs.length, ["документ", "документа", "документов"])} на {formatMoney(total)}
        </SheetDescription>
      </SheetHeader>
      <div className="px-4">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Номер или клиент"
          aria-label="Поиск по чекам и заказам"
          className="h-10 w-full rounded-lg bg-muted/55 px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15 sm:text-sm"
        />
      </div>
      <ul className="flex flex-col divide-y divide-border/40 px-2 pb-4">
        {docs.map((doc) => (
          <li key={`${doc.source}:${doc.sourceId}`}>
            <button
              type="button"
              onClick={() => onOpenDoc({ source: doc.source, id: doc.sourceId })}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{doc.label}</span>
                  <Badge variant={doc.source === "sale" ? "neutral" : "violet"}>{doc.source === "sale" ? "касса" : "заказ"}</Badge>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {formatInstantShort(doc.soldAt)}
                  {doc.customer ? ` · ${doc.customer}` : ""} · {doc.itemsCount} поз.
                </div>
              </div>
              <div className="shrink-0 font-medium tabular-nums">{formatMoney(doc.total)}</div>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function DocumentView({ docRef, range, onBack }: { docRef: DocRef; range?: AnalyticsRange; onBack?: () => void }) {
  const [document, setDocument] = useState<SalesDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Состояние сбрасывается сменой key у DocumentView (см. родителя) — здесь только загрузка.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/sales-documents?source=${docRef.source}&id=${docRef.id}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Не удалось загрузить документ")
        return (await response.json()) as SalesDocument
      })
      .then((data) => {
        if (!cancelled) setDocument(data)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить документ")
      })
    return () => {
      cancelled = true
    }
  }, [docRef])

  // Позиции букета группируем визуально по названию букета.
  const groups = useMemo(() => {
    if (!document) return []
    const map = new Map<string, SalesDocument["items"]>()
    for (const item of document.items) {
      const key = item.bouquetName || ""
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return [...map.entries()]
  }, [document])

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-1">
          {onBack ? (
            <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Назад к списку" className="-ml-1">
              <ArrowLeftIcon />
            </Button>
          ) : null}
          <SheetTitle>{document ? document.label : docRef.source === "sale" ? `Чек #${docRef.id}` : `Заказ #${docRef.id}`}</SheetTitle>
        </div>
        <SheetDescription>
          {document ? (
            <>
              {formatInstantShort(document.soldAt)}
              {document.customer ? ` · ${document.customer}` : ""}
              {document.phone ? ` · ${document.phone}` : ""}
            </>
          ) : error ? (
            error
          ) : (
            "Загружаем…"
          )}
        </SheetDescription>
      </SheetHeader>

      {document ? (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={document.source === "sale" ? "neutral" : "violet"}>{document.source === "sale" ? "Чек кассы" : "Заказ"}</Badge>
            <Badge variant={document.reversedAt ? "destructive" : "outline"}>{document.status}</Badge>
            <span className="text-muted-foreground">
              {document.source === "sale"
                ? getPaymentMethodLabel(document.paymentMethod)
                : document.paymentMethod
                  ? deliveryTypeLabel(document.paymentMethod)
                  : ""}
              {document.userName ? ` · ${document.userName}` : ""}
            </span>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-[11px] font-medium text-muted-foreground uppercase">
                <th className="py-1.5 text-left font-medium">Товар</th>
                <th className="px-2 py-1.5 text-right font-medium">Кол-во</th>
                <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">Цена</th>
                <th className="py-1.5 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([bouquet, items]) => (
                <BouquetRows key={bouquet || "__plain__"} bouquet={bouquet} items={items} range={range} />
              ))}
            </tbody>
            <tfoot className="text-sm">
              {document.discountTotal > 0 ? (
                <>
                  <tr className="border-t border-border/40 text-muted-foreground">
                    <td className="pt-2" colSpan={3}>
                      Позиции без скидки
                    </td>
                    <td className="pt-2 text-right tabular-nums">{formatMoney(document.itemsTotal)}</td>
                  </tr>
                  <tr className="text-muted-foreground">
                    <td colSpan={3}>Скидка</td>
                    <td className="text-right tabular-nums">−{formatMoney(document.discountTotal)}</td>
                  </tr>
                </>
              ) : null}
              {document.deliveryPrice > 0 ? (
                <tr className="text-muted-foreground">
                  <td colSpan={3}>Доставка</td>
                  <td className="text-right tabular-nums">{formatMoney(document.deliveryPrice)}</td>
                </tr>
              ) : null}
              <tr className="border-t border-border/40 font-semibold">
                <td className="pt-2" colSpan={3}>
                  Итого
                </td>
                <td className="pt-2 text-right tabular-nums">{formatMoney(document.total)}</td>
              </tr>
            </tfoot>
          </table>

          {document.note ? <p className="text-xs text-muted-foreground">{document.note}</p> : null}
        </div>
      ) : null}
    </>
  )
}

function BouquetRows({ bouquet, items, range }: { bouquet: string; items: SalesDocument["items"]; range?: AnalyticsRange }) {
  return (
    <>
      {bouquet ? (
        <tr>
          <td colSpan={4} className="pt-2 pb-0.5 text-xs font-medium text-muted-foreground">
            Букет · {bouquet}
          </td>
        </tr>
      ) : null}
      {items.map((item) => (
        <tr key={item.id} className="border-t border-border/25">
          <td className={cn("py-1.5", bouquet && "pl-3")}>
            {item.productCode ? (
              <Link href={productCardHref(item.productCode, range)} className="block truncate underline-offset-4 hover:underline">
                {item.productName}
              </Link>
            ) : (
              <span className="block truncate">{item.productName}</span>
            )}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(item.qty)}</td>
          <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground sm:table-cell">{formatMoney(item.unitPrice)}</td>
          <td className="py-1.5 text-right tabular-nums">{formatMoney(item.total)}</td>
        </tr>
      ))}
    </>
  )
}
