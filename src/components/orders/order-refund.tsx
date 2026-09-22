"use client"

import { useEffect, useState, useTransition } from "react"
import type React from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, ChevronDownIcon, RotateCcwIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { cancelOrderAction, findRefundablesAction, reverseCashTransactionAction } from "@/app/actions"
import type { OrderStatus, RefundableOrder, RefundableSale } from "@/lib/db"
import { getPaymentMethodLabel } from "@/lib/labels"
import { formatInstant } from "@/lib/datetime"
import { formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { OrderStatusBadge, Spinner } from "@/components/orders/order-shared"
import { HeaderAction } from "@/components/screen-header"

export type RefundItem = { name: string; qty: number }

// Единая цель возврата — и для заказа, и для прямой продажи, чтобы попап и список не различали
// «продажа/заказ» для пользователя. kind определяет, какой экшен проводит возврат.
export type RefundTarget = {
  kind: "order" | "sale"
  // Для заказа — id заказа (cancelOrderAction). Для продажи — saleId (только для отображения).
  id: number
  // Для продажи — id денежной проводки (type='sale'), на которую слать сторно.
  reverseCashTxId?: number
  label: string
  customer: string
  status?: string
  paid: number
  createdAt?: string
  deliveryType?: string
  courierPayout?: number
  deliveryPayoutPaid?: boolean
  // pending — отложенная предоплата заказа: принята при создании, в кассу ещё не проведена
  // (проводится при выдаче). При отмене по ней кассового возврата нет.
  payments: Array<{ paymentMethod: string; amount: number; pending?: boolean }>
  items: RefundItem[]
}

const REASON_PRESETS = ["Брак/некондиция", "Клиент передумал", "Ошибка в заказе", "Пересорт/подмена"]

export function refundTargetFromOrder(order: RefundableOrder): RefundTarget {
  return {
    kind: "order",
    id: order.id,
    label: order.number || `#${order.id}`,
    customer: order.customer || "Клиент не указан",
    status: order.status,
    paid: order.paid,
    createdAt: order.createdAt,
    deliveryType: order.deliveryType,
    courierPayout: order.courierPayout,
    deliveryPayoutPaid: order.deliveryPayoutPaid,
    payments: order.payments,
    items: order.items,
  }
}

export function refundTargetFromSale(sale: RefundableSale): RefundTarget {
  return {
    kind: "sale",
    id: sale.saleId,
    reverseCashTxId: sale.cashTransactionId,
    label: `Чек #${sale.saleId}`,
    customer: sale.customer || "Без имени",
    paid: sale.total,
    createdAt: sale.createdAt,
    payments: sale.payments,
    items: sale.items,
  }
}

const BUILT_STATUSES = new Set(["Готов", "Выдан", "Передан курьеру"])

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)))
}

// «5 000 Наличные + 3 000 Mbank» — из чего складывается возврат и каким способом он вернётся.
// Непроведённая предоплата (pending) показана отдельно — через кассу она не возвращается.
function refundBreakdown(target: RefundTarget): string {
  const parts = target.payments
    .filter((part) => part.amount > 0.009 && !part.pending)
    .map((part) => `${formatMoney(part.amount)} ${getPaymentMethodLabel(part.paymentMethod)}`)
  const covered = target.payments.reduce((sum, part) => sum + part.amount, 0)
  const remainder = target.paid - covered
  if (remainder > 0.009) {
    parts.push(`${formatMoney(remainder)} наличными`)
  }
  return parts.join(" + ")
}

// Отложенная предоплата заказа: сумма и способы, по которым кассовой операции не будет.
function pendingPrepaidBreakdown(target: RefundTarget) {
  const parts = target.payments.filter((part) => part.pending && part.amount > 0.009)
  return {
    total: parts.reduce((sum, part) => sum + part.amount, 0),
    label: parts.map((part) => `${formatMoney(part.amount)} ${getPaymentMethodLabel(part.paymentMethod)}`).join(" + "),
  }
}

function ItemsList({ items }: { items: RefundItem[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((item, index) => (
        <li key={`${item.name}-${index}`} className="flex justify-between gap-2">
          <span className="truncate text-zinc-700">{item.name || "—"}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">×{formatQty(item.qty)}</span>
        </li>
      ))}
    </ul>
  )
}

// Понятный попап «что и куда возвращается» + позиции + обязательная причина. Заказ →
// cancelOrderAction; продажа → reverseCashTransactionAction (сторно). Деньги — тем же способом.
export function RefundConfirmDialog({
  target,
  hasOpenShift,
  onDone,
  trigger,
  children,
}: {
  target: RefundTarget
  hasOpenShift: boolean
  onDone?: () => void
  trigger: React.ReactElement
  children: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [, startTransition] = useTransition()

  const isSale = target.kind === "sale"
  const willRefund = target.paid > 0.009
  const refundAmount = formatMoney(target.paid)
  // Часть, которая вернётся ЧЕРЕЗ КАССУ (проведённые деньги) — отложенная предоплата в кассу
  // не попадала, её возвращают клиенту без кассовой операции и без открытой смены.
  const pendingPrepaid = pendingPrepaidBreakdown(target)
  const cashRefund = Math.max(0, target.paid - pendingPrepaid.total)
  const willRefundThroughCash = cashRefund > 0.009
  const alreadyBuilt = target.kind === "order" && BUILT_STATUSES.has(target.status ?? "")
  const courierWarn =
    target.kind === "order" && (target.courierPayout ?? 0) > 0 && Boolean(target.deliveryPayoutPaid)
  const blockedByShift = willRefundThroughCash && !hasOpenShift
  const reasonMissing = reason.trim().length === 0

  function handleConfirm() {
    if (reasonMissing || blockedByShift) {
      return
    }
    const cleanReason = reason.trim()
    setOpen(false)
    startTransition(async () => {
      let result
      if (target.kind === "sale") {
        const formData = new FormData()
        formData.set("id", String(target.reverseCashTxId ?? 0))
        formData.set("reason", cleanReason)
        result = await reverseCashTransactionAction(formData)
      } else {
        result = await cancelOrderAction(target.id, cleanReason)
      }
      if (result.ok) {
        for (const message of result.messages ?? [result.message]) {
          toast.success(message)
        }
        onDone?.()
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setReason("")
        }
      }}
    >
      <AlertDialogTrigger render={trigger}>{children}</AlertDialogTrigger>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{willRefund ? "Оформить возврат?" : "Отменить заказ?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {target.label} · {target.customer}
            {target.createdAt ? ` · ${formatInstant(target.createdAt)}` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3">
          {willRefund ? (
            <div className="rounded-xl border bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">К возврату клиенту</div>
              <div className="text-2xl font-semibold tabular-nums text-zinc-900">{refundAmount}</div>
              {willRefundThroughCash && (
                <div className="mt-1 text-sm text-muted-foreground">Вернётся через кассу: {refundBreakdown(target)}</div>
              )}
              {pendingPrepaid.total > 0.009 && (
                <div className="mt-1 text-sm text-amber-800">
                  Предоплата {pendingPrepaid.label} в кассу не попадала — просто верните её клиенту, в кассе
                  ничего отмечать не нужно.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
              По заказу нет принятой оплаты — вернётся только статус «Отменён», деньги не двигаются.
            </div>
          )}

          {target.items.length > 0 && (
            <div className="rounded-xl border p-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Позиции к возврату</div>
              <ItemsList items={target.items} />
            </div>
          )}

          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {willRefundThroughCash && (
              <li>Деньги выйдут из текущей открытой смены; возврат за прошлую смену помечается «за смену #N».</li>
            )}
            {isSale ? (
              <li>Товар вернётся на склад, продажа исключится из выручки.</li>
            ) : alreadyBuilt ? (
              <li>Букет уже собран — товар на склад автоматически не возвращается.</li>
            ) : (
              <li>Бронь и списание склада откатятся автоматически.</li>
            )}
            {courierWarn && (
              <li className="text-amber-700">
                Выплата курьеру {formatMoney(target.courierPayout ?? 0)} не сторнируется автоматически — при
                необходимости отмените её отдельно.
              </li>
            )}
          </ul>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-900">
              Причина <span className="text-red-600">*</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {REASON_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-xs font-normal"
                  onClick={() => setReason(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="Укажите причину возврата…"
            />
          </div>

          {blockedByShift && (
            <Alert>
              <AlertTriangleIcon />
              <AlertTitle>Откройте смену</AlertTitle>
              <AlertDescription>Возврат денег проводится через кассу — сначала откройте смену.</AlertDescription>
            </Alert>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Назад</AlertDialogCancel>
          <AlertDialogAction
            render={<Button variant="destructive" disabled={blockedByShift || reasonMissing} />}
            onClick={handleConfirm}
          >
            {willRefund ? `Вернуть ${refundAmount}` : "Отменить заказ"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Строка единого списка возврата (продажа или заказ), отсортированного по времени.
type RefundRow =
  | { kind: "order"; createdAt: string; order: RefundableOrder }
  | { kind: "sale"; createdAt: string; sale: RefundableSale }

// Поиск чего угодно для возврата: и прямых продаж (Чек), и заказов, в одном списке. Пустой
// запрос — недавние; ввод ищет по номеру/чеку/имени/телефону. Каждая строка открывает попап.
export function RefundSearchSheet({
  hasOpenShift,
  triggerLabel = "Оформить возврат",
  trigger = "button",
}: {
  hasOpenShift: boolean
  triggerLabel?: string
  // "header" — кнопка-действие внутри поля шапки экрана (ghost, иконка + подпись на широком экране).
  trigger?: "button" | "header"
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<RefundRow[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    const handle = window.setTimeout(async () => {
      setLoading(true)
      const result = await findRefundablesAction(query)
      if (!active) {
        return
      }
      if (result.ok) {
        const merged: RefundRow[] = [
          ...result.data.orders.map((order) => ({ kind: "order" as const, createdAt: order.createdAt, order })),
          ...result.data.sales.map((sale) => ({ kind: "sale" as const, createdAt: sale.createdAt, sale })),
        ].sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
        setRows(merged)
      } else {
        toast.error(result.message)
        setRows([])
      }
      setLoading(false)
    }, query ? 300 : 0)

    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [open, query, reloadKey])

  return (
    <>
      {trigger === "header" ? (
        <HeaderAction icon={RotateCcwIcon} label={triggerLabel} onClick={() => setOpen(true)} />
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <RotateCcwIcon data-icon="inline-start" />
          {triggerLabel}
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setQuery("")
            setRows([])
          }
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Оформить возврат</SheetTitle>
            <SheetDescription>Найдите продажу или заказ — по номеру, чеку, имени клиента или телефону.</SheetDescription>
          </SheetHeader>

          <div className="px-4">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Чек, номер заказа, клиент или телефон"
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Ищем…
              </div>
            ) : rows.length === 0 ? (
              <Empty className="min-h-40">
                <EmptyHeader>
                  <EmptyTitle>{query ? "Ничего не найдено" : "Нет операций для возврата"}</EmptyTitle>
                  <EmptyDescription>
                    {query
                      ? "Проверьте номер чека/заказа, имя или телефон."
                      : "Здесь появятся недавние продажи и выданные заказы."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {rows.map((row) =>
                  row.kind === "sale" ? (
                    <RefundRowCard
                      key={`sale-${row.sale.saleId}`}
                      target={refundTargetFromSale(row.sale)}
                      badge={<Badge variant="outline">Продажа</Badge>}
                      subtitle={row.sale.phone || row.sale.customer || ""}
                      hasOpenShift={hasOpenShift}
                      onDone={() => setReloadKey((key) => key + 1)}
                    />
                  ) : (
                    <RefundRowCard
                      key={`order-${row.order.id}`}
                      target={refundTargetFromOrder(row.order)}
                      badge={<OrderStatusBadge status={row.order.status as OrderStatus} />}
                      subtitle={row.order.phone || ""}
                      hasOpenShift={hasOpenShift}
                      onDone={() => setReloadKey((key) => key + 1)}
                    />
                  )
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

// Нейтральная карточка: акцент на сумме и времени, раскрытие со списком позиций.
function RefundRowCard({
  target,
  badge,
  subtitle,
  hasOpenShift,
  onDone,
}: {
  target: RefundTarget
  badge: React.ReactNode
  subtitle: string
  hasOpenShift: boolean
  onDone: () => void
}) {
  const hasItems = target.items.length > 0
  const time = target.createdAt ? formatInstant(target.createdAt) : ""

  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-zinc-900">{target.customer}</span>
            {badge}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {target.label}
            {subtitle ? ` · ${subtitle}` : ""}
          </div>
          {time && <div className="text-xs text-muted-foreground">{time}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="text-lg font-semibold tabular-nums text-zinc-900">{formatMoney(target.paid)}</div>
          <RefundConfirmDialog
            target={target}
            hasOpenShift={hasOpenShift}
            onDone={onDone}
            trigger={<Button size="sm" variant="outline" />}
          >
            {target.paid > 0.009 ? "Вернуть" : "Отменить"}
          </RefundConfirmDialog>
        </div>
      </div>
      {hasItems && (
        <details className="group mt-2 border-t pt-2 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer select-none items-center gap-1 text-xs text-muted-foreground">
            <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
            Позиции ({target.items.length})
          </summary>
          <div className="mt-1.5">
            <ItemsList items={target.items} />
          </div>
        </details>
      )}
    </div>
  )
}
