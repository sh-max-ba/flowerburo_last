"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, BanknoteIcon, EyeIcon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { closeShiftAction } from "@/app/actions"
import type { DashboardData, ShiftDetails } from "@/lib/db"
import { cashTransactionTypeLabel, getPaymentMethodLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
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
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h1 className="text-2xl font-semibold">Смены</h1>
          </div>
          <Link className={buttonVariants({ variant: "outline" })} href="/">
            <ArrowLeftIcon data-icon="inline-start" />
            В backoffice
          </Link>
        </div>

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
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">Смена #{shift.id}</h1>
              <ShiftStatusBadge status={shift.status} />
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>Ответственный: {detail.cashier}</span>
              <span>Открыта: {dateTime(shift.openedAt)}</span>
              {shift.closedAt && <span>Закрыта: {dateTime(shift.closedAt)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "outline" })} href="/shifts">
              <ArrowLeftIcon data-icon="inline-start" />
              Назад к сменам
            </Link>
            {shift.status === "open" && <ShiftCloseDialog detail={detail} />}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ShiftStat title="Наличные" value={formatMoney(revenueByMethod.cash)} />
          <ShiftStat title="Карта" value={formatMoney(revenueByMethod.card)} />
          <ShiftStat title="Mbank" value={formatMoney(revenueByMethod.mbank)} />
          <ShiftStat title="Optima" value={formatMoney(revenueByMethod.optima)} />
          <ShiftStat title="ЭлСом" value={formatMoney(revenueByMethod.elsom)} />
          <ShiftStat title="Перевод" value={formatMoney(revenueByMethod.transfer)} />
          <ShiftStat title="Внесения" value={formatMoney(detail.summary.cashIn)} />
          <ShiftStat title="Изъятия" value={formatMoney(detail.breakdown.cashOutOther)} />
          <ShiftStat title="Ожидается в кассе" value={formatMoney(shift.expectedCash)} emphasis />
          <ShiftStat title="Фактическая наличка" value={shift.closingCash === null ? "-" : formatMoney(shift.closingCash)} />
          <ShiftStat title="Разница" value={difference === null ? "-" : formatMoney(difference)} />
          <ShiftStat title="Выручка всего" value={formatMoney(detail.summary.revenueTotal)} />
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

        <DataTableCard
          title="Продажи смены"
          description="Быстрые продажи, проведенные в смене"
          emptyTitle="Продаж за эту смену нет"
          headers={["Время", "Sale ID", "Сумма", "Способ оплаты", "Позиций", "Комментарий"]}
          rows={detail.sales.map((sale) => [
            dateTime(sale.createdAt),
            `#${sale.id}`,
            formatMoney(sale.total),
            getPaymentMethodLabel(sale.paymentMethod),
            sale.itemsCount,
            sale.note || "-",
          ])}
        />

        <DataTableCard
          title="Заказы / оплаты"
          description="Операции смены, связанные с заказами"
          emptyTitle="Операций по заказам в смене пока нет"
          headers={["Заказ", "Клиент", "Тип оплаты", "Сумма", "Комментарий"]}
          rows={detail.relatedOrders.map((order) => [
            order.number || `#${order.orderId}`,
            order.customer || "-",
            cashTransactionTypeLabel(order.type),
            formatMoney(order.amount),
            order.comment || "-",
          ])}
        />
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
        <ShiftStat title="Выручка всего" value={formatMoney(detail.summary.revenueTotal)} />
        <ShiftStat title="Ответственный" value={detail.cashier} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Наличные" value={formatMoney(revenueByMethod.cash)} />
        <Metric label="Карта" value={formatMoney(revenueByMethod.card)} />
        <Metric label="Mbank" value={formatMoney(revenueByMethod.mbank)} />
        <Metric label="Optima" value={formatMoney(revenueByMethod.optima)} />
        <Metric label="ЭлСом" value={formatMoney(revenueByMethod.elsom)} />
        <Metric label="Перевод" value={formatMoney(revenueByMethod.transfer)} />
        <Metric label="Предоплаты" value={formatMoney(getPrepayments(detail))} />
        <Metric label="Доплаты по заказам" value={formatMoney(getOrderPayments(detail))} />
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

function DataTableCard({
  title,
  description,
  emptyTitle,
  headers,
  rows,
}: {
  title: string
  description: string
  emptyTitle: string
  headers: string[]
  rows: React.ReactNode[][]
}) {
  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!rows.length ? (
          <CompactEmpty title={emptyTitle} />
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((header) => (
                    <TableHead key={header}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <TableCell key={cellIndex}>{cell}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
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
    cash: detail.summary.cashSales + detail.summary.cashPrepayments + detail.summary.cashOrderPayments,
    card: detail.breakdown.cardSales + detail.breakdown.cardPrepayments + detail.breakdown.cardOrderPayments,
    mbank:
      detail.breakdown.mbankSales +
      detail.breakdown.mbankPrepayments +
      detail.breakdown.mbankOrderPayments,
    optima:
      detail.breakdown.optimaSales +
      detail.breakdown.optimaPrepayments +
      detail.breakdown.optimaOrderPayments,
    elsom:
      detail.breakdown.elsomSales +
      detail.breakdown.elsomPrepayments +
      detail.breakdown.elsomOrderPayments,
    transfer:
      detail.breakdown.transferSales +
      detail.breakdown.transferPrepayments +
      detail.breakdown.transferOrderPayments,
  }
}

function getPrepayments(detail: ShiftDetails) {
  return (
    detail.summary.cashPrepayments +
    detail.breakdown.cardPrepayments +
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
    detail.breakdown.mbankOrderPayments +
    detail.breakdown.optimaOrderPayments +
    detail.breakdown.elsomOrderPayments +
    detail.breakdown.transferOrderPayments
  )
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
