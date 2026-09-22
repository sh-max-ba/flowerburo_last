"use client"

import { Fragment, useMemo, useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import type { SalePaymentMethod, ShiftDetails } from "@/lib/db"
import { cashTransactionTypeLabel, getPaymentMethodLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { formatInstant } from "@/lib/datetime"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { LineComposition, type CompositionItem } from "@/components/cash/line-composition"

// Чек смены: прямая продажа кассы или оплата по заказу (предоплата/доплата). Возвраты и
// ручные внесения/изъятия сюда НЕ входят — они в полной ленте «Все операции».
type Receipt = {
  key: string
  createdAt: string
  reference: string
  kindLabel: string
  customer: string
  total: number
  paymentMethod: SalePaymentMethod
  reversed: boolean
  items: CompositionItem[]
  // Для частичной оплаты заказа (предоплата/доплата): сумма строки — это платёж, а раскрытый
  // состав — весь заказ. Поясняем, чтобы число и состав не выглядели рассогласованными.
  paymentNote?: string
}

function methodLabel(method: SalePaymentMethod) {
  return method === "mixed" ? "Смешанная" : getPaymentMethodLabel(method)
}

function buildReceipts(detail: ShiftDetails | null): Receipt[] {
  if (!detail) {
    return []
  }

  const receipts: Receipt[] = []

  for (const sale of detail.sales) {
    receipts.push({
      key: `sale-${sale.id}`,
      createdAt: sale.createdAt,
      reference: `Чек #${sale.id}`,
      kindLabel: "Продажа",
      customer: sale.customerName,
      total: sale.total,
      paymentMethod: sale.paymentMethod,
      reversed: Boolean(sale.reversedAt),
      items: sale.items,
    })
  }

  for (const order of detail.relatedOrders) {
    // Только приходы по заказам — возвраты/изъятия остаются в полной ленте.
    if (order.type !== "prepayment" && order.type !== "order_payment" && order.type !== "deal_payment") {
      continue
    }
    // Сумма строки — платёж именно этой смены (order.amount), а не весь заказ. Если он отличается
    // от итога заказа (частичная предоплата/доплата), помечаем — раскрытый состав показывает заказ целиком.
    const partial = order.total > 0 && Math.abs(order.amount - order.total) >= 0.01
    receipts.push({
      key: `order-${order.transactionId}`,
      createdAt: order.createdAt,
      reference: order.number || `Заказ #${order.orderId}`,
      kindLabel: cashTransactionTypeLabel(order.type),
      customer: order.customer,
      total: order.amount,
      paymentMethod: order.paymentMethod,
      reversed: false,
      items: order.items,
      paymentNote: partial
        ? `В эту смену оплачено ${formatMoney(order.amount)} из ${formatMoney(order.total)} — ниже весь состав заказа`
        : undefined,
    })
  }

  return receipts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

// Список «Чеки за смену»: что продали и какие оплаты по заказам прошли. Строка раскрывается
// составом (LineComposition). Только для чтения — правка способа оплаты живёт в полной ленте.
export function ShiftReceiptsList({ detail }: { detail: ShiftDetails | null }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const receipts = useMemo(() => buildReceipts(detail), [detail])

  if (!receipts.length) {
    return (
      <Empty className="min-h-24 py-4">
        <EmptyHeader>
          <EmptyTitle>Чеков пока нет</EmptyTitle>
          <EmptyDescription>Здесь появятся продажи и оплаты по заказам этой смены.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl bg-muted/30">
      <div className="max-h-96 divide-y divide-zinc-100 overflow-y-auto lg:max-h-[34rem]">
        {receipts.map((receipt) => {
          const expandable = receipt.items.length > 0
          const open = openKey === receipt.key
          return (
            <Fragment key={receipt.key}>
              <div
                role={expandable ? "button" : undefined}
                tabIndex={expandable ? 0 : undefined}
                onClick={expandable ? () => setOpenKey(open ? null : receipt.key) : undefined}
                onKeyDown={
                  expandable
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          setOpenKey(open ? null : receipt.key)
                        }
                      }
                    : undefined
                }
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2",
                  expandable && "cursor-pointer hover:bg-zinc-50"
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                    {expandable && (
                      <ChevronDownIcon
                        className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                      />
                    )}
                    <span className="truncate">{receipt.reference}</span>
                    {receipt.reversed && (
                      <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                        сторно
                      </Badge>
                    )}
                  </div>
                  {/* У оплат по заказу тип (предоплата/доплата) показываем всегда: две строки одного
                      заказа с одинаковым способом иначе неотличимы. У продаж — только без имени клиента. */}
                  <div className="truncate text-xs text-muted-foreground">
                    {formatInstant(receipt.createdAt, { date: false, time: true })}
                    {receipt.kindLabel !== "Продажа" && ` · ${receipt.kindLabel}`}
                    {receipt.customer ? ` · ${receipt.customer}` : receipt.kindLabel === "Продажа" ? ` · ${receipt.kindLabel}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-xs font-normal">
                    {methodLabel(receipt.paymentMethod)}
                  </Badge>
                  <span
                    className={cn(
                      "min-w-16 text-right text-sm font-medium tabular-nums",
                      receipt.reversed && "text-muted-foreground line-through"
                    )}
                  >
                    {formatMoney(receipt.total)}
                  </span>
                </div>
              </div>
              {expandable && open && (
                <div className="bg-muted/30">
                  {receipt.paymentNote && (
                    <div className="px-3 pt-2 text-xs text-muted-foreground">{receipt.paymentNote}</div>
                  )}
                  <LineComposition items={receipt.items} />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
