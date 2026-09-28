"use client"

import { Fragment, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDownIcon, CreditCardIcon, HistoryIcon, TagIcon } from "lucide-react"
import { toast } from "sonner"
import { cancelOrderAction, reverseCashTransactionAction } from "@/app/actions"
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
import { FloristMark } from "@/components/florist-mark"
import { ScreenBody } from "@/components/screen-body"
import { HeaderAction, HeaderFilter, ScreenHeader } from "@/components/screen-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { LineComposition } from "@/components/cash/line-composition"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { cn, formatMoney } from "@/lib/utils"
import { useIsPhone } from "@/hooks/use-mobile"
import { cashTransactionTypeLabel, getPaymentMethodLabel, paymentMethodOptions } from "@/lib/labels"
import type { CashLedgerEntry, CashTransactionType } from "@/lib/db"
import { orderNumberLabel } from "@/lib/order-labels"

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "sale", label: "Продажа" },
  { value: "prepayment", label: "Предоплата" },
  { value: "order_payment", label: "Доплата по заказу" },
  { value: "deal_payment", label: "Оплата по сделке" },
  { value: "cash_in", label: "Внесение" },
  { value: "cash_out", label: "Изъятие / выплата" },
  { value: "cash_refund", label: "Возврат" },
]

// Возвраты и изъятия уменьшают кассу (показываем минусом), остальное — приход.
const OUTFLOW_TYPES = new Set<CashTransactionType>(["cash_out", "cash_refund"])

export function CashLedger({ entries, showStockHistoryLink = false }: { entries: CashLedgerEntry[]; showStockHistoryLink?: boolean }) {
  const [typeFilter, setTypeFilter] = useState("all")
  const [methodFilter, setMethodFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [openId, setOpenId] = useState<number | null>(null)
  const phone = useIsPhone()

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (typeFilter !== "all" && entry.type !== typeFilter) {
        return false
      }
      if (methodFilter !== "all" && entry.paymentMethod !== methodFilter) {
        return false
      }
      if (!needle) {
        return true
      }
      const haystack = [
        entry.orderNumber ?? "",
        entry.orderId ? orderNumberLabel({ id: entry.orderId, number: entry.orderNumber }) : "",
        entry.orderId ? `#${entry.orderId}` : "",
        entry.saleId ? `#${entry.saleId}` : "",
        entry.customerName,
        entry.userName,
        entry.comment,
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [entries, typeFilter, methodFilter, query])

  return (
    <>
      <ScreenHeader
        title="История кассы"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Поиск: заказ, клиент, кто, комментарий",
          inputProps: { "aria-label": "Поиск по истории кассы" },
        }}
        meta={`${filtered.length} из ${entries.length}`}
        actions={
          <>
            <HeaderFilter
              icon={TagIcon}
              label="Тип"
              value={typeFilter}
              allValue="all"
              options={[{ value: "all", label: "Все типы" }, ...TYPE_OPTIONS]}
              onValueChange={setTypeFilter}
            />
            <HeaderFilter
              icon={CreditCardIcon}
              label="Способ"
              value={methodFilter}
              allValue="all"
              options={[{ value: "all", label: "Все способы" }, ...paymentMethodOptions]}
              onValueChange={setMethodFilter}
            />
            {showStockHistoryLink ? <HeaderAction icon={HistoryIcon} label="История склада" href="/history/stock" /> : null}
          </>
        }
      />

      <ScreenBody className="px-1">
        {filtered.length === 0 ? (
          <Empty className="min-h-56">
            <EmptyHeader>
              <EmptyTitle>Ничего не найдено</EmptyTitle>
              <EmptyDescription>
                {entries.length === 0
                  ? "Кассовые операции появятся после продаж, оплат и возвратов."
                  : "Измените фильтры или поисковый запрос."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : phone ? (
          // Телефон: карточки вместо 8 колонок — тип и сумма крупно, время/способ/кто строкой ниже.
          <ul className="flex flex-col">
            {filtered.map((entry) => {
              const outflow = OUTFLOW_TYPES.has(entry.type)
              const expandable = isExpandable(entry)
              const isOpen = openId === entry.id
              return (
                <li key={entry.id} className="border-b border-border/40 last:border-b-0">
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 px-3 py-3 text-left outline-none focus-visible:bg-muted/50 disabled:opacity-100"
                    disabled={!expandable}
                    aria-expanded={expandable ? isOpen : undefined}
                    onClick={() => setOpenId(isOpen ? null : entry.id)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <Badge variant={entry.type === "cash_refund" ? "destructive" : "outline"}>
                        {cashTransactionTypeLabel(entry.type)}
                      </Badge>
                      <span className="flex items-center gap-1">
                        <span className={cn("text-base font-semibold tabular-nums", outflow ? "text-red-600" : "text-zinc-900")}>
                          {outflow ? "−" : "+"}
                          {formatMoney(entry.amount)}
                        </span>
                        {expandable ? (
                          <ChevronDownIcon
                            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
                            aria-hidden
                          />
                        ) : null}
                      </span>
                    </span>
                    {entry.orderId || entry.saleId || entry.customerName ? (
                      <span className="truncate text-sm">{renderLink(entry)}</span>
                    ) : null}
                    <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatDateTime(entry.createdAt)}</span>
                      <span>{getPaymentMethodLabel(entry.paymentMethod)}</span>
                      {entry.userName ? <span>{entry.userName}</span> : null}
                      <FloristMark role={entry.userRole} name={entry.userName} compact />
                      {entry.discountAmount > 0 ? (
                        <span className="text-emerald-700">скидка −{formatMoney(entry.discountAmount)}</span>
                      ) : null}
                    </span>
                    {entry.comment ? <span className="text-xs text-muted-foreground">{entry.comment}</span> : null}
                  </button>
                  {expandable && isOpen ? <div className="bg-muted/30">{renderEntryPanels(entry)}</div> : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Время</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Способ</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead className="text-right">Скидка</TableHead>
                  <TableHead>Связь</TableHead>
                  <TableHead>Кто</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((entry) => {
                  const outflow = OUTFLOW_TYPES.has(entry.type)
                  const expandable = isExpandable(entry)
                  const isOpen = openId === entry.id
                  return (
                    <Fragment key={entry.id}>
                      <TableRow
                        className={cn(expandable && "cursor-pointer")}
                        onClick={expandable ? () => setOpenId(isOpen ? null : entry.id) : undefined}
                      >
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            {expandable ? (
                              <ChevronDownIcon
                                className={cn("size-3.5 shrink-0 transition-transform", isOpen && "rotate-180")}
                              />
                            ) : (
                              <span className="inline-block size-3.5 shrink-0" />
                            )}
                            {formatDateTime(entry.createdAt)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={entry.type === "cash_refund" ? "destructive" : "outline"}>
                            {cashTransactionTypeLabel(entry.type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{getPaymentMethodLabel(entry.paymentMethod)}</TableCell>
                        <TableCell
                          className={`whitespace-nowrap text-right tabular-nums ${outflow ? "text-red-600" : "text-zinc-900"}`}
                        >
                          {outflow ? "−" : "+"}
                          {formatMoney(entry.amount)}
                        </TableCell>
                        {/* Скидка связанного документа: у предоплаты и доплаты по одному заказу
                            это одна и та же скидка заказа, а не доля конкретной проводки —
                            складывать колонку по строкам нельзя. У возвратов и выплат её нет. */}
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {entry.discountAmount > 0 ? (
                            <span
                              className="text-emerald-700"
                              title={
                                entry.totalBeforeDiscount > 0
                                  ? `Скидка документа. До скидки ${formatMoney(entry.totalBeforeDiscount)}`
                                  : "Скидка документа"
                              }
                            >
                              −{formatMoney(entry.discountAmount)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{renderLink(entry)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            {entry.userName || "—"}
                            <FloristMark role={entry.userRole} name={entry.userName} compact />
                          </span>
                        </TableCell>
                        <TableCell className="min-w-48 text-xs text-muted-foreground">{entry.comment || "—"}</TableCell>
                      </TableRow>
                      {expandable && isOpen && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30 p-0">
                            {renderEntryPanels(entry)}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </ScreenBody>
    </>
  )
}

function isExpandable(entry: CashLedgerEntry) {
  return entry.items.length > 0 || entry.orderId !== null || entry.type === "cash_in" || entry.type === "cash_out"
}

// Раскрытая строка: состав и действия (отмена заказа, отмена операции, сторно продажи).
function renderEntryPanels(entry: CashLedgerEntry) {
  return (
    <>
      {entry.items.length > 0 ? <LineComposition items={entry.items} /> : null}
      {/* Для выплат (cash_out) по заказу правильное действие — встречная
          операция, а не отмена всего заказа: панель отмены тут не место. */}
      {entry.orderId !== null && entry.type !== "cash_out" ? <OrderCancelPanel entry={entry} /> : null}
      {entry.type === "cash_in" || entry.type === "cash_out" ? <ReverseOpPanel entry={entry} /> : null}
      {entry.type === "sale" ? <SaleStornoPanel entry={entry} /> : null}
    </>
  )
}

function renderLink(entry: CashLedgerEntry) {
  if (entry.orderId) {
    const label = `Заказ ${orderNumberLabel({ id: entry.orderId ?? 0, number: entry.orderNumber })}`
    return (
      <span>
        {label}
        {entry.customerName ? <span className="text-muted-foreground"> · {entry.customerName}</span> : null}
      </span>
    )
  }
  if (entry.saleId) {
    return (
      <span>
        {`Продажа #${entry.saleId}`}
        {entry.customerName ? <span className="text-muted-foreground"> · {entry.customerName}</span> : null}
      </span>
    )
  }
  if (entry.customerName) {
    return <span>{entry.customerName}</span>
  }
  return <span className="text-muted-foreground">—</span>
}

function formatDateTime(value: string) {
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}

// Отмена/возврат заказа прямо из истории кассы. Переиспользует cancelOrderAction:
// возврат проводится по текущей открытой смене, для оплат прошлых смен — с пометкой
// «за смену #N». Требует открытую смену (иначе экшен вернёт ошибку — покажем тостом).
function OrderCancelPanel({ entry }: { entry: CashLedgerEntry }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  const cancelled = entry.orderStatus === "Отменен" || entry.orderStatus === "canceled"
  const orderLabel = `Заказ ${orderNumberLabel({ id: entry.orderId ?? 0, number: entry.orderNumber })}`
  const willRefund = entry.orderPaid !== null && entry.orderPaid > 0
  const refundAmount = formatMoney(entry.orderPaid ?? 0)
  // Заказ уже передан курьеру с выплатой: возврат клиенту её не сторнирует — предупреждаем.
  const courierPayout =
    entry.orderStatus === "Передан курьеру" && (entry.orderCourierPayout ?? 0) > 0
      ? (entry.orderCourierPayout ?? 0)
      : 0

  function handleConfirm() {
    if (entry.orderId === null) {
      return
    }
    const orderId = entry.orderId
    setOpen(false)
    startTransition(async () => {
      const result = await cancelOrderAction(orderId)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {orderLabel}
        {entry.orderStatus ? ` · ${entry.orderStatus}` : ""}
      </span>
      {cancelled ? (
        <Badge variant="outline">Заказ отменён</Badge>
      ) : (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={pending} />}>
            {pending ? "Отмена…" : willRefund ? `Отменить и вернуть ${refundAmount}` : "Отменить заказ"}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Отменить заказ?</AlertDialogTitle>
              <AlertDialogDescription>
                {orderLabel} будет отменён{willRefund ? `, возврат ${refundAmount} тем же способом оплаты` : ""}. Бронь и
                склад откатятся, если букет ещё не собран. Возврат пройдёт по текущей открытой смене (для оплат прошлых
                смен — с пометкой «за смену #N»).
                {courierPayout > 0
                  ? ` Внимание: выплата курьеру ${formatMoney(courierPayout)} не сторнируется автоматически — при необходимости отмените её отдельно в строке выплаты.`
                  : ""}{" "}
                Действие необратимо.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Назад</AlertDialogCancel>
              <AlertDialogAction render={<Button variant="destructive" />} onClick={handleConfirm}>
                Отменить заказ
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

// Отмена служебной операции (внесение/изъятие) из истории кассы — встречной операцией
// в текущей смене. Повторно отменить нельзя; сама операция отмены тоже не отменяется.
function ReverseOpPanel({ entry }: { entry: CashLedgerEntry }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  const label = cashTransactionTypeLabel(entry.type)

  function handleConfirm() {
    setOpen(false)
    const formData = new FormData()
    formData.set("id", String(entry.id))
    startTransition(async () => {
      const result = await reverseCashTransactionAction(formData)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {label} · {formatMoney(entry.amount)}
      </span>
      {entry.isReversal ? (
        <Badge variant="outline">Операция отмены</Badge>
      ) : entry.reversed ? (
        <Badge variant="outline">Отменено</Badge>
      ) : (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={pending} />}>
            {pending ? "Отмена…" : "Отменить операцию"}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Отменить операцию?</AlertDialogTitle>
              <AlertDialogDescription>
                {label} на {formatMoney(entry.amount)} будет отменена встречной операцией в текущей открытой смене (для
                операций прошлых смен — с пометкой «за смену #N»). Действие необратимо.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Назад</AlertDialogCancel>
              <AlertDialogAction render={<Button variant="destructive" />} onClick={handleConfirm}>
                Отменить операцию
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

// Сторно быстрой продажи из истории кассы: возврат денег тем же способом + возврат товара
// на склад + вычет из выручки. Повторное сторно заблокировано (кнопка скрывается).
function SaleStornoPanel({ entry }: { entry: CashLedgerEntry }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const amount = formatMoney(entry.amount)

  function handleConfirm() {
    setOpen(false)
    const formData = new FormData()
    formData.set("id", String(entry.id))
    startTransition(async () => {
      const result = await reverseCashTransactionAction(formData)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {entry.saleId ? `Продажа #${entry.saleId}` : "Продажа"} · {amount}
      </span>
      {entry.reversed ? (
        <Badge variant="outline">Сторнировано</Badge>
      ) : (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={pending} />}>
            {pending ? "Сторно…" : `Сторнировать и вернуть ${amount}`}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Сторнировать продажу?</AlertDialogTitle>
              <AlertDialogDescription>
                Продажа {entry.saleId ? `#${entry.saleId}` : ""} будет отменена целиком: возврат каждой оплаты тем же
                способом (при смешанной оплате — обеих частей), выручка уменьшится, товар вернётся на склад. Возврат
                пройдёт по текущей открытой смене (для продаж прошлых смен — с пометкой «за смену #N»). Действие
                необратимо.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Назад</AlertDialogCancel>
              <AlertDialogAction render={<Button variant="destructive" />} onClick={handleConfirm}>
                Сторнировать
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
