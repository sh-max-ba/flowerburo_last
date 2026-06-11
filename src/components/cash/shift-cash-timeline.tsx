"use client"

import { Fragment, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDownIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { updatePaymentMethodAction } from "@/app/actions"
import type { PaymentMethod, ShiftDetails } from "@/lib/db"
import { cashTransactionTypeLabel, getPaymentMethodLabel, paymentMethodOptions } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { formatInstant } from "@/lib/datetime"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { LineComposition, type CompositionItem } from "@/components/cash/line-composition"

// Минимальный набор полей строки единой ленты кассы за смену.
type TimelineRow = {
  key: string
  createdAt: string
  typeLabel: string
  reference: string
  amount: number
  paymentMethod: PaymentMethod
  outflow: boolean
  refund: boolean
  // Сторнированная продажа: бейдж «сторнировано», способ оплаты только текстом (selectа нет).
  reversed?: boolean
  customer: string
  items: CompositionItem[] | null
  editTarget: { target: "sale" | "transaction"; id: number } | null
}

// Единая хронология кассы за смену: продажи, оплаты по заказам, возвраты и ручные
// внесения/изъятия в одной ленте по времени. Возвраты и изъятия показаны со знаком
// «минус» (возврат — ещё и красным бейджем). Строки продаж/заказов раскрываются
// составом; способ оплаты правится там, где это допустимо (продажа и приход по заказу),
// у возвратов/изъятий метод показан текстом. Используется на кассе («Касса за смену»)
// и на странице смены /shifts/[id] (там editable=false).
export function ShiftCashTimeline({
  detail,
  editable,
}: {
  detail: ShiftDetails | null
  editable: boolean
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const rows = useMemo(() => buildTimelineRows(detail), [detail])
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          if (row.outflow) {
            acc.outflow += row.amount
          } else {
            acc.inflow += row.amount
          }
          return acc
        },
        { inflow: 0, outflow: 0 }
      ),
    [rows]
  )

  if (!rows.length) {
    return (
      <Empty className="min-h-24 py-4">
        <EmptyHeader>
          <EmptyTitle>Операций пока нет</EmptyTitle>
          <EmptyDescription>
            Здесь появятся продажи, оплаты по заказам, возвраты и внесения/изъятия смены — строку с составом можно раскрыть.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-zinc-200">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead>Операция</TableHead>
            <TableHead>Заказ / продажа</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead>Оплата</TableHead>
            <TableHead>Клиент</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expandable = row.items !== null
            const isOpen = openKey === row.key

            return (
              <Fragment key={row.key}>
                <TableRow
                  className={cn(expandable && "cursor-pointer")}
                  onClick={expandable ? () => setOpenKey(isOpen ? null : row.key) : undefined}
                >
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {expandable ? (
                        <ChevronDownIcon
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isOpen && "rotate-180"
                          )}
                        />
                      ) : (
                        <span className="inline-block size-4 shrink-0" />
                      )}
                      <span className="whitespace-nowrap">{dateTime(row.createdAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={row.refund ? "destructive" : "outline"}>{row.typeLabel}</Badge>
                    {row.reversed && (
                      <Badge variant="outline" className="ml-1 border-red-200 bg-red-50 text-red-700">
                        сторнировано
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{row.reference}</TableCell>
                  <TableCell
                    className={cn(
                      "whitespace-nowrap text-right font-medium tabular-nums",
                      row.outflow && "text-red-600"
                    )}
                  >
                    {row.outflow ? "−" : "+"}
                    {formatMoney(row.amount)}
                  </TableCell>
                  <TableCell>
                    {row.editTarget ? (
                      <PaymentMethodCell
                        target={row.editTarget.target}
                        id={row.editTarget.id}
                        method={row.paymentMethod}
                        editable={editable}
                      />
                    ) : (
                      <span className="whitespace-nowrap">{getPaymentMethodLabel(row.paymentMethod)}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-32 truncate">{row.customer || "-"}</TableCell>
                </TableRow>
                {expandable && isOpen && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30 p-0">
                      <LineComposition items={row.items ?? []} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="font-medium">
              Итого за смену
            </TableCell>
            <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
              +{formatMoney(totals.inflow)}
              {totals.outflow >= 0.01 && <span className="text-red-600"> · −{formatMoney(totals.outflow)}</span>}
            </TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

// Сборка строк единой ленты: продажи (detail.sales), оплаты/возвраты по заказам
// (detail.relatedOrders — order_id != null, любой тип) и ручные внесения/изъятия
// (cash_transactions без привязки к заказу/продаже). Сортировка по времени, новые сверху.
function buildTimelineRows(detail: ShiftDetails | null): TimelineRow[] {
  if (!detail) {
    return []
  }

  const rows: TimelineRow[] = []

  for (const sale of detail.sales) {
    const reversed = Boolean(sale.reversedAt)
    rows.push({
      key: `sale-${sale.id}`,
      createdAt: sale.createdAt,
      typeLabel: "Продажа",
      reference: `Продажа #${sale.id}`,
      amount: sale.total,
      paymentMethod: sale.paymentMethod,
      outflow: false,
      refund: false,
      reversed,
      customer: sale.customerName,
      items: sale.items,
      // У сторнированной продажи способ оплаты заморожен: возврат повторил исходный метод,
      // правка разбалансирует пару «приход+возврат» (сервер такую правку тоже отклоняет).
      editTarget: reversed ? null : { target: "sale", id: sale.id },
    })
  }

  for (const order of detail.relatedOrders) {
    const refund = order.type === "cash_refund"
    const outflow = refund || order.type === "cash_out"
    const isPayment =
      order.type === "prepayment" || order.type === "order_payment" || order.type === "deal_payment"
    rows.push({
      key: `order-${order.transactionId}`,
      createdAt: order.createdAt,
      typeLabel: cashTransactionTypeLabel(order.type),
      reference: order.number || `Заказ #${order.orderId}`,
      amount: order.amount,
      paymentMethod: order.paymentMethod,
      outflow,
      refund,
      customer: order.customer,
      items: order.items,
      editTarget: isPayment ? { target: "transaction", id: order.transactionId } : null,
    })
  }

  // Возвраты по сторно продаж (sale_id != null, к заказу не привязаны) — раньше эти
  // проводки не попадали ни в одну ветку ленты, и минус по кассе выглядел «ниоткуда».
  for (const tx of detail.cashTransactions) {
    if (tx.type !== "cash_refund" || tx.saleId === null || tx.orderId !== null) {
      continue
    }
    rows.push({
      key: `sale-refund-${tx.id}`,
      createdAt: tx.createdAt,
      typeLabel: cashTransactionTypeLabel(tx.type),
      reference: `Продажа #${tx.saleId}`,
      amount: tx.amount,
      paymentMethod: tx.paymentMethod,
      outflow: true,
      refund: true,
      customer: "",
      items: null,
      editTarget: null,
    })
  }

  for (const tx of detail.cashTransactions) {
    if (tx.orderId !== null || tx.saleId !== null) {
      continue
    }
    if (tx.type !== "cash_in" && tx.type !== "cash_out") {
      continue
    }
    rows.push({
      key: `cash-${tx.id}`,
      createdAt: tx.createdAt,
      typeLabel: cashTransactionTypeLabel(tx.type),
      reference: "—",
      amount: tx.amount,
      paymentMethod: tx.paymentMethod,
      outflow: tx.type === "cash_out",
      refund: false,
      customer: "",
      items: null,
      editTarget: null,
    })
  }

  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

function PaymentMethodCell({
  target,
  id,
  method,
  editable,
}: {
  target: "sale" | "transaction"
  id: number
  method: PaymentMethod
  editable: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (!editable) {
    return <span className="whitespace-nowrap">{getPaymentMethodLabel(method)}</span>
  }

  function handleChange(next: string | null) {
    const value = next ?? ""
    if (!value || value === method || pending) {
      return
    }
    const formData = new FormData()
    formData.set("target", target)
    formData.set("id", String(id))
    formData.set("paymentMethod", value)
    startTransition(async () => {
      const result = await updatePaymentMethodAction(formData)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
      <Select value={method} onValueChange={handleChange}>
        <SelectTrigger
          className="h-8 w-[124px] text-xs"
          disabled={pending}
          onClick={(event) => event.stopPropagation()}
        >
          {pending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <SelectValue>{(value) => getPaymentMethodLabel(String(value ?? method))}</SelectValue>
          )}
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            {paymentMethodOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </span>
  )
}

// Метки времени (created_at — UTC из БД, показываем в поясе магазина).
function dateTime(value: string) {
  return formatInstant(value)
}
