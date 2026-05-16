"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, BanknoteIcon, ChevronDownIcon, EyeIcon } from "lucide-react"
import { Fragment, useState, useTransition } from "react"
import { toast } from "sonner"
import { closeShiftAction } from "@/app/actions"
import type { DashboardData, ShiftDetails } from "@/lib/db"
import { cashTransactionTypeLabel, getPaymentMethodLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

export function ShiftsPage({ data }: { data: DashboardData }) {
  const router = useRouter()
  const shiftDetailsById = new Map(data.shiftDetails.map((detail) => [detail.shift.id, detail]))

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-5 md:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
        <PageHeader
          title="Смены"
          description="Открытие, закрытие и сверка кассовых смен"
          actions={
            <Link className={buttonVariants({ variant: "outline" })} href="/">
              <ArrowLeftIcon data-icon="inline-start" />
              В backoffice
            </Link>
          }
        />

        <Card className="rounded-2xl border bg-white">
          <CardHeader>
            <CardTitle>Таблица смен</CardTitle>
            <CardDescription>Откройте смену, чтобы увидеть формулу, операции, продажи и оплаты заказов</CardDescription>
          </CardHeader>
          <CardContent>
            {!data.shifts.length ? (
              <CompactEmpty title="Смен пока нет" />
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>№</TableHead>
                      <TableHead>Ответственный</TableHead>
                      <TableHead>Открыта</TableHead>
                      <TableHead>Закрыта</TableHead>
                      <TableHead>Начальная наличка</TableHead>
                      <TableHead>Ожидается</TableHead>
                      <TableHead>Факт</TableHead>
                      <TableHead>Разница</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Действие</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.shifts.map((shift) => {
                      const detail = shiftDetailsById.get(shift.id)
                      const difference = shift.closingCash === null ? null : shift.closingCash - shift.expectedCash

                      return (
                        <TableRow
                          key={shift.id}
                          className="cursor-pointer"
                          onClick={() => router.push(`/shifts/${shift.id}`)}
                        >
                          <TableCell className="font-medium">#{shift.id}</TableCell>
                          <TableCell>{detail?.cashier ?? (shift.cashierName || "-")}</TableCell>
                          <TableCell>{dateTime(shift.openedAt)}</TableCell>
                          <TableCell>{shift.closedAt ? dateTime(shift.closedAt) : "активна"}</TableCell>
                          <TableCell>{formatMoney(shift.openingCash)}</TableCell>
                          <TableCell className="font-medium">{formatMoney(shift.expectedCash)}</TableCell>
                          <TableCell>{shift.closingCash === null ? "-" : formatMoney(shift.closingCash)}</TableCell>
                          <TableCell>
                            {difference === null ? (
                              "-"
                            ) : (
                              <DifferenceBadge difference={difference} />
                            )}
                          </TableCell>
                          <TableCell>
                            <ShiftStatusBadge status={shift.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Link
                              className={buttonVariants({ variant: "outline", size: "sm" })}
                              href={`/shifts/${shift.id}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <EyeIcon data-icon="inline-start" />
                              Открыть
                            </Link>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export function ShiftDetailPage({ detail }: { detail: ShiftDetails }) {
  const shift = detail.shift
  const difference = shift.closingCash === null ? null : shift.closingCash - shift.expectedCash
  const revenueByMethod = getRevenueByMethod(detail)

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-5 md:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
        <PageHeader
          title={`Смена #${shift.id}`}
          description={
            <>
              Ответственный: {detail.cashier} · Открыта: {dateTime(shift.openedAt)}
              {shift.closedAt ? ` · Закрыта: ${dateTime(shift.closedAt)}` : ""}
            </>
          }
          actions={
            <>
              <ShiftStatusBadge status={shift.status} />
              <Link className={buttonVariants({ variant: "outline" })} href="/shifts">
                <ArrowLeftIcon data-icon="inline-start" />
                Назад к сменам
              </Link>
              {shift.status === "open" && <ShiftCloseDialog detail={detail} />}
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ShiftStat title="Выручка до скидок" value={formatMoney(detail.summary.revenueBeforeDiscount)} />
          <ShiftStat title="Скидки" value={formatMoney(detail.summary.discountTotal)} />
          <ShiftStat title="Выручка после скидок" value={formatMoney(detail.summary.revenueTotal)} />
          <ShiftStat title="Наличные" value={formatMoney(revenueByMethod.cash)} />
          <ShiftStat title="Карта" value={formatMoney(revenueByMethod.card)} />
          <ShiftStat title="Терминал" value={formatMoney(revenueByMethod.terminal)} />
          <ShiftStat title="Mbank" value={formatMoney(revenueByMethod.mbank)} />
          <ShiftStat title="Optima" value={formatMoney(revenueByMethod.optima)} />
          <ShiftStat title="ЭлСом" value={formatMoney(revenueByMethod.elsom)} />
          <ShiftStat title="Перевод" value={formatMoney(revenueByMethod.transfer)} />
          <ShiftStat title="Внесения" value={formatMoney(detail.summary.cashIn)} />
          <ShiftStat title="Изъятия" value={formatMoney(detail.breakdown.cashOutOther)} />
          <ShiftStat title="Ожидается в кассе" value={formatMoney(shift.expectedCash)} emphasis />
          <ShiftStat title="Фактическая наличка" value={shift.closingCash === null ? "-" : formatMoney(shift.closingCash)} />
          <ShiftStat title="Разница" value={difference === null ? "-" : formatMoney(difference)} />
        </div>

        <FormulaCard detail={detail} />

        <Card className="rounded-2xl border bg-white">
          <CardHeader>
            <CardTitle>Денежные операции</CardTitle>
            <CardDescription>Операции cash_transactions по этой смене</CardDescription>
          </CardHeader>
          <CardContent>
            {!detail.cashTransactions.length ? (
              <CompactEmpty title="Операций в смене пока нет" />
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Время</TableHead>
                      <TableHead>Провёл</TableHead>
                      <TableHead>Операция</TableHead>
                      <TableHead>Способ оплаты</TableHead>
                      <TableHead>Сумма</TableHead>
                      <TableHead>Связь</TableHead>
                      <TableHead>Комментарий</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.cashTransactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell>{dateTime(transaction.createdAt)}</TableCell>
                        <TableCell>{operationUser(transaction.userName)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <span>{cashTransactionTypeLabel(transaction.type)}</span>
                            <CashEffectBadge type={transaction.type} method={transaction.paymentMethod} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{getPaymentMethodLabel(transaction.paymentMethod)}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">{formatMoney(transaction.amount)}</TableCell>
                        <TableCell>
                          {transaction.orderId
                            ? `Заказ #${transaction.orderId}`
                            : transaction.saleId
                              ? `Продажа #${transaction.saleId}`
                              : transaction.dealId
                                ? `Сделка #${transaction.dealId}`
                                : "-"}
                        </TableCell>
                        <TableCell className="max-w-72 truncate">{transaction.comment || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <ShiftSalesCard sales={detail.sales} />

        <ShiftOrderPaymentsCard orders={detail.relatedOrders} />
      </div>
    </main>
  )
}

export function ShiftCloseDialog({ detail }: { detail: ShiftDetails }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [actualCash, setActualCash] = useState(detail.shift.expectedCash)
  const [isPending, startTransition] = useTransition()
  const difference = actualCash - detail.shift.expectedCash

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await closeShiftAction(formData)
      if (result.ok) {
        toast.success(result.message)
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <BanknoteIcon data-icon="inline-start" />
        Закрыть смену
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Закрыть смену #{detail.shift.id}</DialogTitle>
            <DialogDescription>Проверьте сводку и внесите фактическую наличку в кассе.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <input type="hidden" name="shiftId" value={detail.shift.id} />
            <ShiftCloseSummary detail={detail} />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="closingCash">Фактическая наличка в кассе</FieldLabel>
                <Input
                  id="closingCash"
                  name="closingCash"
                  type="number"
                  step="0.01"
                  value={Number.isFinite(actualCash) ? actualCash : ""}
                  onChange={(event) => setActualCash(Number(event.target.value) || 0)}
                  required
                />
              </Field>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Разница = факт - ожидается</div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="text-xl font-semibold">{formatMoney(difference)}</div>
                  <DifferenceBadge difference={difference} />
                </div>
              </div>
              <Field>
                <FieldLabel htmlFor="shift-note">Комментарий</FieldLabel>
                <Textarea id="shift-note" name="note" />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                Закрыть смену
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ShiftCloseSummary({ detail }: { detail: ShiftDetails }) {
  const revenueByMethod = getRevenueByMethod(detail)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ShiftStat title="Ожидается в кассе" value={formatMoney(detail.summary.expectedCash)} emphasis />
        <ShiftStat title="Выручка до скидок" value={formatMoney(detail.summary.revenueBeforeDiscount)} />
        <ShiftStat title="Скидки" value={formatMoney(detail.summary.discountTotal)} />
        <ShiftStat title="Выручка после скидок" value={formatMoney(detail.summary.revenueTotal)} />
        <ShiftStat title="Ответственный" value={detail.cashier} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Наличные" value={formatMoney(revenueByMethod.cash)} />
        <Metric label="Карта" value={formatMoney(revenueByMethod.card)} />
        <Metric label="Терминал" value={formatMoney(revenueByMethod.terminal)} />
        <Metric label="Mbank" value={formatMoney(revenueByMethod.mbank)} />
        <Metric label="Optima" value={formatMoney(revenueByMethod.optima)} />
        <Metric label="ЭлСом" value={formatMoney(revenueByMethod.elsom)} />
        <Metric label="Перевод" value={formatMoney(revenueByMethod.transfer)} />
        <Metric label="Предоплаты" value={formatMoney(getPrepayments(detail))} />
        <Metric label="Доплаты по заказам" value={formatMoney(getOrderPayments(detail))} />
        <Metric label="Оплаты по сделкам" value={formatMoney(getDealPayments(detail))} />
        <Metric label="Внесения" value={formatMoney(detail.summary.cashIn)} />
        <Metric label="Изъятия" value={formatMoney(detail.breakdown.cashOutOther)} />
        <Metric label="Выплаты курьеру" value={formatMoney(detail.breakdown.courierPayouts)} />
      </div>
      <FormulaCard detail={detail} compact />
    </div>
  )
}

function FormulaCard({ detail, compact }: { detail: ShiftDetails; compact?: boolean }) {
  const rows = getFormulaRows(detail)

  return (
    <Card className={cn("rounded-2xl border bg-white", compact && "rounded-xl")}>
      <CardHeader>
        <CardTitle>Формула кассы</CardTitle>
        <CardDescription>Безналичные оплаты входят в выручку, но не увеличивают expected cash</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="w-10 text-muted-foreground">{row.sign}</TableCell>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(row.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">=</TableCell>
                <TableCell className="font-semibold">Ожидается в кассе</TableCell>
                <TableCell className="text-right font-semibold">{formatMoney(detail.summary.expectedCash)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function ShiftSalesCard({ sales }: { sales: ShiftDetails["sales"] }) {
  const [openId, setOpenId] = useState<number | null>(null)

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardTitle>Продажи смены</CardTitle>
        <CardDescription>Быстрые продажи, проведенные в смене</CardDescription>
      </CardHeader>
      <CardContent>
        {!sales.length ? (
          <CompactEmpty title="Продаж за эту смену нет" />
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <Table>
              <TableHeader>
                  <TableRow>
                    <TableHead>Время</TableHead>
                    <TableHead>Провел</TableHead>
                    <TableHead>Sale ID</TableHead>
                    <TableHead>До скидки</TableHead>
                    <TableHead>Скидка</TableHead>
                    <TableHead>Итого</TableHead>
                    <TableHead>Способ оплаты</TableHead>
                    <TableHead>Позиций</TableHead>
                    <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => {
                  const isOpen = openId === sale.id

                  return (
                    <Fragment key={sale.id}>
                      <TableRow
                        key={`sale-${sale.id}`}
                        className="cursor-pointer"
                        onClick={() => setOpenId(isOpen ? null : sale.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ChevronDownIcon
                              className={cn("size-4 transition-transform", isOpen && "rotate-180")}
                            />
                            {dateTime(sale.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell>{operationUser(sale.userName)}</TableCell>
                        <TableCell className="font-medium">#{sale.id}</TableCell>
                        <TableCell>{formatMoney(sale.totalBeforeDiscount)}</TableCell>
                        <TableCell>{formatMoney(sale.discountTotal)}</TableCell>
                        <TableCell className="font-medium">{formatMoney(sale.total)}</TableCell>
                        <TableCell>{getPaymentMethodLabel(sale.paymentMethod)}</TableCell>
                        <TableCell>{sale.itemsCount}</TableCell>
                        <TableCell className="max-w-72 truncate">{sale.note || "-"}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={`sale-${sale.id}-items`}>
                          <TableCell colSpan={9} className="bg-muted/30 p-0">
                            <ShiftItemsTable items={sale.items} emptyTitle="В продаже нет позиций" />
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
      </CardContent>
    </Card>
  )
}

function ShiftOrderPaymentsCard({ orders }: { orders: ShiftDetails["relatedOrders"] }) {
  const [openId, setOpenId] = useState<number | null>(null)

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardTitle>Заказы / оплаты</CardTitle>
        <CardDescription>Операции смены, связанные с заказами</CardDescription>
      </CardHeader>
      <CardContent>
        {!orders.length ? (
          <CompactEmpty title="Операций по заказам в смене пока нет" />
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Заказ</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Провел</TableHead>
                  <TableHead>Тип оплаты</TableHead>
                  <TableHead>До скидки</TableHead>
                  <TableHead>Скидка</TableHead>
                  <TableHead>Итого заказа</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const isOpen = openId === order.transactionId

                  return (
                    <Fragment key={order.transactionId}>
                      <TableRow
                        key={`order-payment-${order.transactionId}`}
                        className="cursor-pointer"
                        onClick={() => setOpenId(isOpen ? null : order.transactionId)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ChevronDownIcon
                              className={cn("size-4 transition-transform", isOpen && "rotate-180")}
                            />
                            <span className="font-medium">{order.number || `#${order.orderId}`}</span>
                          </div>
                        </TableCell>
                        <TableCell>{order.customer || "-"}</TableCell>
                        <TableCell>{operationUser(order.userName)}</TableCell>
                        <TableCell>{cashTransactionTypeLabel(order.type)}</TableCell>
                        <TableCell>{formatMoney(order.totalBeforeDiscount)}</TableCell>
                        <TableCell>{formatMoney(order.discountTotal)}</TableCell>
                        <TableCell>{formatMoney(order.total)}</TableCell>
                        <TableCell className="font-medium">{formatMoney(order.amount)}</TableCell>
                        <TableCell className="max-w-72 truncate">{order.comment || "-"}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={`order-payment-${order.transactionId}-items`}>
                          <TableCell colSpan={9} className="bg-muted/30 p-0">
                            <ShiftItemsTable items={order.items} emptyTitle="В заказе нет позиций" />
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
      </CardContent>
    </Card>
  )
}

function ShiftItemsTable({
  items,
  emptyTitle,
}: {
  items: Array<{
    id: number
    name: string
    productCode: string
    qty: number
    price: number
    discountAmount?: number
    totalBeforeDiscount?: number
    total: number
  }>
  emptyTitle: string
}) {
  if (!items.length) {
    return <div className="px-6 py-4 text-sm text-muted-foreground">{emptyTitle}</div>
  }

  return (
    <div className="px-6 py-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Позиция</TableHead>
            <TableHead>Код</TableHead>
            <TableHead>Кол-во</TableHead>
            <TableHead>Цена</TableHead>
            <TableHead>До скидки</TableHead>
            <TableHead>Скидка</TableHead>
            <TableHead>Итого</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>{item.productCode || "-"}</TableCell>
              <TableCell>{formatNumber(item.qty)}</TableCell>
              <TableCell>{formatMoney(item.price)}</TableCell>
              <TableCell>{formatMoney(item.totalBeforeDiscount ?? item.total)}</TableCell>
              <TableCell>{formatMoney(item.discountAmount ?? 0)}</TableCell>
              <TableCell className="font-medium">{formatMoney(item.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ShiftStat({ title, value, emphasis }: { title: string; value: string; emphasis?: boolean }) {
  return (
    <Card className={cn("rounded-2xl border bg-white", emphasis && "border-primary bg-primary/5")}>
      <CardHeader>
        <CardDescription className="text-xs">{title}</CardDescription>
        <CardTitle className="text-2xl font-semibold">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  )
}

function ShiftStatusBadge({ status }: { status: "open" | "closed" }) {
  return (
    <Badge variant={status === "open" ? "secondary" : "outline"}>
      {status === "open" ? "Открыта" : "Закрыта"}
    </Badge>
  )
}

function DifferenceBadge({ difference }: { difference: number }) {
  return (
    <Badge variant={Math.abs(difference) < 0.01 ? "secondary" : "destructive"}>
      {Math.abs(difference) < 0.01 ? "совпало" : formatMoney(difference)}
    </Badge>
  )
}

function CashEffectBadge({ type, method }: { type: string; method: string }) {
  if (method !== "cash") {
    return <Badge variant="outline">Без налички</Badge>
  }

  if (type === "cash_out" || type === "cash_refund") {
    return <Badge variant="destructive">Из кассы</Badge>
  }

  return <Badge variant="secondary">В кассу</Badge>
}

function CompactEmpty({ title }: { title: string }) {
  return (
    <Empty className="min-h-36 py-5">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>Данные появятся после операций в смене.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function getFormulaRows(detail: ShiftDetails) {
  return [
    { label: "Начальная наличка", sign: "+", amount: detail.summary.openingCash },
    { label: "Наличные продажи", sign: "+", amount: detail.summary.cashSales },
    { label: "Наличные предоплаты", sign: "+", amount: detail.summary.cashPrepayments },
    { label: "Наличные доплаты", sign: "+", amount: detail.summary.cashOrderPayments },
    { label: "Наличные оплаты сделок", sign: "+", amount: detail.summary.cashDealPayments },
    { label: "Внесения", sign: "+", amount: detail.summary.cashIn },
    { label: "Изъятия", sign: "-", amount: detail.breakdown.cashOutOther },
    { label: "Выплаты курьеру", sign: "-", amount: detail.breakdown.courierPayouts },
    ...(detail.summary.cashRefund > 0
      ? [{ label: "Возвраты наличными", sign: "-", amount: detail.summary.cashRefund }]
      : []),
  ]
}

function getRevenueByMethod(detail: ShiftDetails) {
  return {
    cash:
      detail.summary.cashSales +
      detail.summary.cashPrepayments +
      detail.summary.cashOrderPayments +
      detail.summary.cashDealPayments,
    card:
      detail.breakdown.cardSales +
      detail.breakdown.cardPrepayments +
      detail.breakdown.cardOrderPayments +
      detail.breakdown.cardDealPayments,
    terminal:
      detail.breakdown.terminalSales +
      detail.breakdown.terminalPrepayments +
      detail.breakdown.terminalOrderPayments +
      detail.breakdown.terminalDealPayments,
    mbank:
      detail.breakdown.mbankSales +
      detail.breakdown.mbankPrepayments +
      detail.breakdown.mbankOrderPayments +
      detail.breakdown.mbankDealPayments,
    optima:
      detail.breakdown.optimaSales +
      detail.breakdown.optimaPrepayments +
      detail.breakdown.optimaOrderPayments +
      detail.breakdown.optimaDealPayments,
    elsom:
      detail.breakdown.elsomSales +
      detail.breakdown.elsomPrepayments +
      detail.breakdown.elsomOrderPayments +
      detail.breakdown.elsomDealPayments,
    transfer:
      detail.breakdown.transferSales +
      detail.breakdown.transferPrepayments +
      detail.breakdown.transferOrderPayments +
      detail.breakdown.transferDealPayments,
  }
}

function getPrepayments(detail: ShiftDetails) {
  return (
    detail.summary.cashPrepayments +
    detail.breakdown.cardPrepayments +
    detail.breakdown.terminalPrepayments +
    detail.breakdown.mbankPrepayments +
    detail.breakdown.optimaPrepayments +
    detail.breakdown.elsomPrepayments +
    detail.breakdown.transferPrepayments
  )
}

function getOrderPayments(detail: ShiftDetails) {
  return (
    detail.summary.cashOrderPayments +
    detail.breakdown.cardOrderPayments +
    detail.breakdown.terminalOrderPayments +
    detail.breakdown.mbankOrderPayments +
    detail.breakdown.optimaOrderPayments +
    detail.breakdown.elsomOrderPayments +
    detail.breakdown.transferOrderPayments
  )
}

function getDealPayments(detail: ShiftDetails) {
  return (
    detail.summary.cashDealPayments +
    detail.breakdown.cardDealPayments +
    detail.breakdown.terminalDealPayments +
    detail.breakdown.mbankDealPayments +
    detail.breakdown.optimaDealPayments +
    detail.breakdown.elsomDealPayments +
    detail.breakdown.transferDealPayments
  )
}

function operationUser(name: string | null | undefined) {
  return name?.trim() || "не зафиксирован"
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function dateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
