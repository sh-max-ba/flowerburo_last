"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  AlertTriangleIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  MessageSquareIcon,
  SunIcon,
} from "lucide-react"
import { Fragment, useState } from "react"
import type { DashboardData, ShiftDetails } from "@/lib/db"
import { cashTransactionTypeLabel, getPaymentMethodLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function ShiftsPage({ data }: { data: DashboardData }) {
  const router = useRouter()
  const shiftDetailsById = new Map(data.shiftDetails.map((detail) => [detail.shift.id, detail]))

  return (
    <Card className="rounded-2xl border bg-white">
      <CardContent>
        {!data.shifts.length ? (
          <CompactEmpty title="Смен пока нет" />
        ) : (
          <TooltipProvider>
          <div className="min-w-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>№</TableHead>
                  <TableHead>Тип</TableHead>
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
                      className="cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => router.push(`/shifts/${shift.id}`)}
                    >
                      <TableCell className="font-medium">#{shift.id}</TableCell>
                      <TableCell>
                        <ShiftTypeBadge type={shift.type} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span>{detail?.cashier ?? (shift.cashierName || "-")}</span>
                          {shift.note?.trim() ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span
                                    className="inline-flex text-muted-foreground"
                                    aria-label="Комментарий к смене"
                                    onClick={(event) => event.stopPropagation()}
                                  />
                                }
                              >
                                <MessageSquareIcon className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs whitespace-pre-wrap">
                                {shift.note}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{dateTime(shift.openedAt)}</TableCell>
                      <TableCell>{shift.closedAt ? dateTime(shift.closedAt) : "активна"}</TableCell>
                      <TableCell>{formatMoney(shift.openingCash)}</TableCell>
                      <TableCell className="font-medium">{formatMoney(shift.expectedCash)}</TableCell>
                      <TableCell>{shift.closingCash === null ? "-" : formatMoney(shift.closingCash)}</TableCell>
                      <TableCell>
                        {difference === null ? "-" : <DifferenceBadge difference={difference} />}
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
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  )
}

export function ShiftDetailPage({ detail }: { detail: ShiftDetails }) {
  const shift = detail.shift
  const difference = shift.closingCash === null ? null : shift.closingCash - shift.expectedCash
  const revenueByMethod = getRevenueByMethod(detail)

  const note = shift.note?.trim()
  const methodMetrics = [
    { label: "Наличные", value: revenueByMethod.cash },
    { label: "Карта", value: revenueByMethod.card },
    { label: "Терминал", value: revenueByMethod.terminal },
    { label: "Mbank", value: revenueByMethod.mbank },
    { label: "Optima", value: revenueByMethod.optima },
    { label: "ЭлСом", value: revenueByMethod.elsom },
    { label: "Перевод", value: revenueByMethod.transfer },
    { label: "Внесения", value: detail.summary.cashIn },
    { label: "Изъятия", value: detail.breakdown.cashOutOther },
    { label: "Выплаты курьеру", value: detail.breakdown.courierPayouts },
  ].filter((metric) => Math.abs(metric.value) >= 0.01)

  return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">Смена #{shift.id}</span>
            <ShiftTypeBadge type={shift.type} />
            <ShiftStatusBadge status={shift.status} />
            <span className="text-sm text-muted-foreground">{detail.cashier}</span>
            <span className="text-sm text-muted-foreground">
              {dateTime(shift.openedAt)} → {shift.closedAt ? dateTime(shift.closedAt) : "активна"}
            </span>
          </div>
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/shifts">
            <ArrowLeftIcon data-icon="inline-start" />
            Назад к сменам
          </Link>
        </div>

        <ReconciliationPanel
          expectedCash={shift.expectedCash}
          closingCash={shift.closingCash}
          difference={difference}
        />

        {note ? (
          <Alert>
            <MessageSquareIcon />
            <AlertTitle>Комментарий к смене</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap text-foreground">{note}</AlertDescription>
          </Alert>
        ) : null}

        <FormulaCard detail={detail} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ShiftStat title="Выручка до скидок" value={formatMoney(detail.summary.revenueBeforeDiscount)} />
          <ShiftStat title="Скидки" value={formatMoney(detail.summary.discountTotal)} />
          <ShiftStat title="Выручка после скидок" value={formatMoney(detail.summary.revenueTotal)} />
        </div>

        {methodMetrics.length ? (
          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <CardTitle>Разбивка по способам оплаты</CardTitle>
              <CardDescription>Показаны только ненулевые способы и движения наличных</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {methodMetrics.map((metric) => (
                  <Metric key={metric.label} label={metric.label} value={formatMoney(metric.value)} />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="rounded-2xl border bg-white">
          <CardHeader>
            <CardTitle>Денежные операции</CardTitle>
            <CardDescription>Продажи, оплаты, внесения и изъятия по этой смене</CardDescription>
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
  )
}

function ReconciliationPanel({
  expectedCash,
  closingCash,
  difference,
}: {
  expectedCash: number
  closingCash: number | null
  difference: number | null
}) {
  const counted = closingCash !== null

  return (
    <Card className="overflow-hidden rounded-2xl border bg-white">
      <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-5">
          <div className="text-xs text-muted-foreground">Ожидается в кассе</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(expectedCash)}</div>
        </div>
        <div className="p-5">
          <div className="text-xs text-muted-foreground">Фактическая наличка</div>
          {counted ? (
            <div className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(closingCash)}</div>
          ) : (
            <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <AlertTriangleIcon className="size-4" />
              Ещё не пересчитана
            </div>
          )}
        </div>
        <div className={cn("p-5", counted && difference !== null && Math.abs(difference) >= 0.01 && difference < 0 && "bg-destructive/5")}>
          <div className="text-xs text-muted-foreground">Разница</div>
          {counted && difference !== null ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  Math.abs(difference) < 0.01
                    ? "text-foreground"
                    : difference < 0
                      ? "text-destructive"
                      : "text-amber-700"
                )}
              >
                {Math.abs(difference) < 0.01 ? formatMoney(0) : formatMoney(difference)}
              </span>
              <DifferenceBadge difference={difference} />
            </div>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">Появится после закрытия смены</div>
          )}
        </div>
      </div>
    </Card>
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
                    <TableHead>Провёл</TableHead>
                    <TableHead>№ продажи</TableHead>
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

type ShiftItemRow = {
  id: number
  name: string
  productCode: string
  qty: number
  price: number
  bouquetName?: string
  bouquetGroupId?: string
  discountAmount?: number
  totalBeforeDiscount?: number
  total: number
}

function ShiftItemsTable({
  items,
  emptyTitle,
}: {
  items: ShiftItemRow[]
  emptyTitle: string
}) {
  const groups = groupShiftItems(items)

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
          {groups.map((group) => {
            if (group.type === "bouquet") {
              const totalBeforeDiscount = group.items.reduce(
                (sum, item) => sum + (item.totalBeforeDiscount ?? item.total),
                0
              )
              const discountAmount = group.items.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0)
              const total = group.items.reduce((sum, item) => sum + item.total, 0)
              const price = group.items.reduce((sum, item) => sum + item.price, 0)

              return (
                <TableRow key={group.key}>
                  <TableCell colSpan={2}>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <Badge variant="secondary">Букет</Badge>
                        <span>{group.bouquetName || "Букет"}</span>
                      </div>
                      <div className="grid gap-1 text-xs text-muted-foreground">
                        {group.items.map((item) => (
                          <div key={item.id} className="flex justify-between gap-3">
                            <span>{item.name}</span>
                            <span>{formatNumber(item.qty)} шт</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>-</TableCell>
                  <TableCell>{formatMoney(price)}</TableCell>
                  <TableCell>{formatMoney(totalBeforeDiscount)}</TableCell>
                  <TableCell>{formatMoney(discountAmount)}</TableCell>
                  <TableCell className="font-medium">{formatMoney(total)}</TableCell>
                </TableRow>
              )
            }

            const item = group.item
            return (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>{item.productCode || "-"}</TableCell>
                <TableCell>{formatNumber(item.qty)}</TableCell>
                <TableCell>{formatMoney(item.price)}</TableCell>
                <TableCell>{formatMoney(item.totalBeforeDiscount ?? item.total)}</TableCell>
                <TableCell>{formatMoney(item.discountAmount ?? 0)}</TableCell>
                <TableCell className="font-medium">{formatMoney(item.total)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function groupShiftItems(items: ShiftItemRow[]) {
  const groups: Array<
    | { type: "single"; key: string; item: ShiftItemRow }
    | { type: "bouquet"; key: string; bouquetName: string; items: ShiftItemRow[] }
  > = []
  const bouquetGroups = new Map<string, Extract<(typeof groups)[number], { type: "bouquet" }>>()

  for (const item of items) {
    if (!item.bouquetGroupId) {
      groups.push({ type: "single", key: `item-${item.id}`, item })
      continue
    }

    let group = bouquetGroups.get(item.bouquetGroupId)
    if (!group) {
      group = {
        type: "bouquet",
        key: item.bouquetGroupId,
        bouquetName: item.bouquetName ?? "",
        items: [],
      }
      bouquetGroups.set(item.bouquetGroupId, group)
      groups.push(group)
    }
    group.items.push(item)
  }

  return groups
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

function ShiftTypeBadge({ type }: { type: "day" | "night" }) {
  return (
    <Badge variant="outline">
      {type === "night" ? (
        <CalendarClockIcon data-icon="inline-start" />
      ) : (
        <SunIcon data-icon="inline-start" />
      )}
      {type === "night" ? "Ночная" : "Дневная"}
    </Badge>
  )
}

// Расхождение крупнее этого порога подсвечивается значком предупреждения.
const DIFFERENCE_WARNING_THRESHOLD = 100

function DifferenceBadge({
  difference,
  className,
}: {
  difference: number
  className?: string
}) {
  const matched = Math.abs(difference) < 0.01

  if (matched) {
    return (
      <Badge variant="secondary" className={className}>
        <CheckIcon data-icon="inline-start" />
        Совпало
      </Badge>
    )
  }

  const isShortage = difference < 0
  const magnitude = Math.abs(difference)
  const isLarge = magnitude >= DIFFERENCE_WARNING_THRESHOLD

  if (isShortage) {
    return (
      <Badge variant="destructive" className={className}>
        {isLarge ? <AlertTriangleIcon data-icon="inline-start" /> : <ArrowDownIcon data-icon="inline-start" />}
        Недостача <span className="font-semibold">{formatMoney(magnitude)}</span>
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className={cn("border-amber-300 text-amber-700", className)}>
      <ArrowUpIcon data-icon="inline-start" />
      Излишек <span className="font-semibold">{formatMoney(magnitude)}</span>
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
