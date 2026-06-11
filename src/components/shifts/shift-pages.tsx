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
  InfoIcon,
  MessageSquareIcon,
  SunIcon,
} from "lucide-react"
import { useState } from "react"
import type { DashboardData, ShiftDetails } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { formatInstant } from "@/lib/datetime"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ShiftCashTimeline } from "@/components/cash/shift-cash-timeline"

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
                  <TableHead className="text-right">Начальная наличка</TableHead>
                  <TableHead className="text-right">Ожидается</TableHead>
                  <TableHead className="text-right">Факт</TableHead>
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
                      <TableCell className="text-right tabular-nums">{formatMoney(shift.openingCash)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatMoney(shift.expectedCash)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {shift.closingCash === null ? "-" : formatMoney(shift.closingCash)}
                      </TableCell>
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
  const note = shift.note?.trim()

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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FormulaCard detail={detail} />
          <RevenueCard detail={detail} />
        </div>

        <MethodBreakdownCard detail={detail} />

        <Card className="rounded-2xl border bg-white">
          <CardHeader>
            <CardTitle>Хронология смены</CardTitle>
            <CardDescription>
              Все операции одной лентой: продажи, оплаты по заказам, возвраты, внесения и изъятия. Строки с составом раскрываются по клику
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ShiftCashTimeline detail={detail} editable={false} />
          </CardContent>
        </Card>

        {detail.operatorSummaries.length > 0 && (
          <OperatorSummaryCard operators={detail.operatorSummaries} />
        )}
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

// Сводка в диалоге закрытия: только главное и только ненулевое. Поле «Фактическая наличка»
// идёт ПЕРЕД этой сводкой (см. ShiftSheet) — менеджер сначала вводит факт, потом сверяет детали.
export function ShiftCloseSummary({ detail }: { detail: ShiftDetails }) {
  const [showFormula, setShowFormula] = useState(false)
  const revenueByMethod = getRevenueByMethod(detail)
  const explainers = getRevenueExplainers(detail)
  const tiles = [
    { label: "Наличные", value: revenueByMethod.cash },
    { label: "Карта", value: revenueByMethod.card },
    { label: "Терминал", value: revenueByMethod.terminal },
    { label: "Mbank", value: revenueByMethod.mbank },
    { label: "Optima", value: revenueByMethod.optima },
    { label: "ЭлСом", value: revenueByMethod.elsom },
    { label: "Бакай", value: revenueByMethod.bakai },
    { label: "Перевод", value: revenueByMethod.transfer },
    { label: "Предоплаты", value: getPrepayments(detail) },
    { label: "Доплаты по заказам", value: getOrderPayments(detail) },
    { label: "Оплаты по сделкам", value: getDealPayments(detail) },
    { label: "Внесения", value: detail.summary.cashIn },
    { label: "Изъятия", value: detail.breakdown.cashOutOther },
    { label: "Выплаты курьеру", value: detail.breakdown.courierPayouts },
    { label: "Возвраты наличными", value: detail.summary.cashRefund },
    { label: "Возвраты безналичными", value: getNonCashRefunds(detail) },
  ].filter((tile) => Math.abs(tile.value) >= 0.01)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ShiftStat title="Ожидается в кассе" value={formatMoney(detail.summary.expectedCash)} emphasis />
        <ShiftStat title="Выручка после скидок" value={formatMoney(detail.summary.revenueTotal)} />
        <ShiftStat title="Скидки" value={formatMoney(detail.summary.discountTotal)} />
      </div>
      {explainers.length > 0 && (
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          {explainers.map((line) => (
            <div key={line} className="flex items-start gap-1.5">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Metric key={tile.label} label={tile.label} value={formatMoney(tile.value)} />
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        onClick={() => setShowFormula((value) => !value)}
      >
        <ChevronDownIcon
          data-icon="inline-start"
          className={cn("transition-transform", showFormula && "rotate-180")}
        />
        Формула кассы
      </Button>
      {showFormula && <FormulaCard detail={detail} compact />}
    </div>
  )
}

function FormulaCard({ detail, compact }: { detail: ShiftDetails; compact?: boolean }) {
  // Нулевые строки прячем (кроме начальной налички — она всегда часть формулы).
  const rows = getFormulaRows(detail).filter(
    (row) => row.label === "Начальная наличка" || Math.abs(row.amount) >= 0.01
  )

  return (
    <Card className={cn("rounded-2xl border bg-white", compact && "rounded-xl")}>
      <CardHeader>
        <CardTitle>Наличные в кассе</CardTitle>
        <CardDescription>
          Физический ящик: только наличные по факту получения. Безнал входит в выручку, но не в ожидаемую наличку
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="text-muted-foreground">{row.label}</TableCell>
                  <TableCell
                    className={cn("text-right font-medium tabular-nums", row.sign === "-" && "text-red-600")}
                  >
                    {row.sign === "-" ? "−" : "+"}
                    {formatMoney(row.amount)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">= Ожидается в кассе</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(detail.summary.expectedCash)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// Правая колонка «двух миров»: коммерческая выручка смены + пояснения, почему она может
// не совпадать ни с наличкой в ящике, ни с разбивкой по способам (кросс-сменные предоплаты).
function RevenueCard({ detail }: { detail: ShiftDetails }) {
  const summary = detail.summary
  const explainers = getRevenueExplainers(detail)

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardTitle>Выручка смены</CardTitle>
        <CardDescription>Признаётся в смене выдачи заказа; быстрые продажи — сразу</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Выручка до скидок</span>
            <span className="font-medium tabular-nums">{formatMoney(summary.revenueBeforeDiscount)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Скидки</span>
            <span className={cn("font-medium tabular-nums", summary.discountTotal >= 0.01 && "text-red-600")}>
              −{formatMoney(summary.discountTotal)}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-3">
            <span className="font-medium">Выручка после скидок</span>
            <span className="text-2xl font-semibold tabular-nums">{formatMoney(summary.revenueTotal)}</span>
          </div>
        </div>
        {explainers.length > 0 && (
          <div className="mt-4 grid gap-1.5 border-t pt-3 text-xs text-muted-foreground">
            {explainers.map((line) => (
              <div key={line} className="flex items-start gap-1.5">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{line}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Строки-объяснители разрыва «выручка ≠ наличные в кассе / разбивка по способам».
function getRevenueExplainers(detail: ShiftDetails) {
  const summary = detail.summary
  const lines: string[] = []
  if (summary.revenueReceivedInOtherShifts >= 0.01) {
    lines.push(
      `+${formatMoney(summary.revenueReceivedInOtherShifts)} — получены в прошлые смены, признаны выручкой в этой (заказы, выданные сейчас)`
    )
  }
  if (summary.deferredPrepayments >= 0.01) {
    lines.push(
      `−${formatMoney(summary.deferredPrepayments)} — получены в эту смену за незавершённые заказы (станут выручкой при выдаче)`
    )
  }
  // Черновики — глобальная справка «на сейчас», к закрытой смене отношения не имеет.
  if (detail.shift.status === "open" && summary.draftPrepaidTotal >= 0.01) {
    lines.push(`${formatMoney(summary.draftPrepaidTotal)} — предоплаты в черновиках, в кассу не проведены`)
  }
  return lines
}

const METHOD_LABELS: Array<{ key: keyof ReturnType<typeof getRevenueByMethod>; label: string }> = [
  { key: "cash", label: "Наличные" },
  { key: "card", label: "Карта" },
  { key: "terminal", label: "Терминал" },
  { key: "mbank", label: "Mbank" },
  { key: "optima", label: "Optima" },
  { key: "elsom", label: "ЭлСом" },
  { key: "bakai", label: "Бакай" },
  { key: "transfer", label: "Перевод" },
]

// Только способы оплаты (получено в смену, минус возвраты) с подытогом нал/безнал.
// Движения наличных (внесения/изъятия/курьер) показаны в «Наличных в кассе», не здесь.
function MethodBreakdownCard({ detail }: { detail: ShiftDetails }) {
  const revenueByMethod = getRevenueByMethod(detail)
  const entries = METHOD_LABELS.map(({ key, label }) => ({ label, value: revenueByMethod[key] })).filter(
    (entry) => Math.abs(entry.value) >= 0.01
  )

  if (!entries.length) {
    return null
  }

  const max = Math.max(...entries.map((entry) => Math.abs(entry.value)))
  const cashTotal = revenueByMethod.cash
  const nonCashTotal = METHOD_LABELS.filter((method) => method.key !== "cash").reduce(
    (sum, method) => sum + revenueByMethod[method.key],
    0
  )

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardTitle>Выручка по способам</CardTitle>
        <CardDescription>
          Получено в смену, за вычетом возвратов. Может не совпадать с признанной выручкой из-за кросс-сменных предоплат — см. пояснения в «Выручке смены»
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2.5">
          {entries.map((entry) => (
            <div key={entry.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <span className="text-sm text-muted-foreground">{entry.label}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${max > 0 ? Math.max(4, Math.round((Math.abs(entry.value) / max) * 100)) : 0}%`,
                  }}
                />
              </div>
              <span className="text-sm font-medium tabular-nums">{formatMoney(entry.value)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          Наличные {formatMoney(cashTotal)} · Безнал {formatMoney(nonCashTotal)} · Всего{" "}
          {formatMoney(cashTotal + nonCashTotal)}
        </div>
      </CardContent>
    </Card>
  )
}

function OperatorSummaryCard({ operators }: { operators: ShiftDetails["operatorSummaries"] }) {
  const totals = operators.reduce(
    (acc, operator) => ({
      salesCount: acc.salesCount + operator.salesCount,
      salesTotal: acc.salesTotal + operator.salesTotal,
      orderPaymentsTotal: acc.orderPaymentsTotal + operator.orderPaymentsTotal,
      cashInTotal: acc.cashInTotal + operator.cashInTotal,
      cashOutTotal: acc.cashOutTotal + operator.cashOutTotal,
      courierPayoutTotal: acc.courierPayoutTotal + operator.courierPayoutTotal,
      refundTotal: acc.refundTotal + operator.refundTotal,
    }),
    {
      salesCount: 0,
      salesTotal: 0,
      orderPaymentsTotal: 0,
      cashInTotal: 0,
      cashOutTotal: 0,
      courierPayoutTotal: 0,
      refundTotal: 0,
    }
  )

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardTitle>Итоги по операторам</CardTitle>
        <CardDescription>Кто сколько провёл за смену (атрибуция по операциям)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Оператор</TableHead>
                <TableHead className="text-right">Продажи (шт)</TableHead>
                <TableHead className="text-right">Продажи (сумма)</TableHead>
                <TableHead className="text-right">Оплаты заказов</TableHead>
                <TableHead className="text-right">Внесения</TableHead>
                <TableHead className="text-right">Изъятия</TableHead>
                <TableHead className="text-right">Курьерам</TableHead>
                <TableHead className="text-right">Возвраты</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((operator) => (
                <TableRow key={operator.userId ?? "null"}>
                  <TableCell className="font-medium">{operationUser(operator.userName)}</TableCell>
                  <TableCell className="text-right tabular-nums">{operator.salesCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(operator.salesTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(operator.orderPaymentsTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(operator.cashInTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(operator.cashOutTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(operator.courierPayoutTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(operator.refundTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Итого</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{totals.salesCount}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(totals.salesTotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(totals.orderPaymentsTotal)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(totals.cashInTotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(totals.cashOutTotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(totals.courierPayoutTotal)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(totals.refundTotal)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
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

// Выручка по способам — net возвратов. Возврат отменённого заказа проводится тем же
// способом, что и приход (refundOrderPayments), поэтому вычитаем его из того же метода,
// иначе по безналу (mbank/card/перевод/…) выручка завышается на сумму возврата.
function getRevenueByMethod(detail: ShiftDetails) {
  return {
    cash:
      detail.summary.cashSales +
      detail.summary.cashPrepayments +
      detail.summary.cashOrderPayments +
      detail.summary.cashDealPayments -
      detail.breakdown.cashRefund,
    card:
      detail.breakdown.cardSales +
      detail.breakdown.cardPrepayments +
      detail.breakdown.cardOrderPayments +
      detail.breakdown.cardDealPayments -
      detail.breakdown.cardRefund,
    terminal:
      detail.breakdown.terminalSales +
      detail.breakdown.terminalPrepayments +
      detail.breakdown.terminalOrderPayments +
      detail.breakdown.terminalDealPayments -
      detail.breakdown.terminalRefund,
    mbank:
      detail.breakdown.mbankSales +
      detail.breakdown.mbankPrepayments +
      detail.breakdown.mbankOrderPayments +
      detail.breakdown.mbankDealPayments -
      detail.breakdown.mbankRefund,
    optima:
      detail.breakdown.optimaSales +
      detail.breakdown.optimaPrepayments +
      detail.breakdown.optimaOrderPayments +
      detail.breakdown.optimaDealPayments -
      detail.breakdown.optimaRefund,
    elsom:
      detail.breakdown.elsomSales +
      detail.breakdown.elsomPrepayments +
      detail.breakdown.elsomOrderPayments +
      detail.breakdown.elsomDealPayments -
      detail.breakdown.elsomRefund,
    bakai:
      detail.breakdown.bakaiSales +
      detail.breakdown.bakaiPrepayments +
      detail.breakdown.bakaiOrderPayments +
      detail.breakdown.bakaiDealPayments -
      detail.breakdown.bakaiRefund,
    transfer:
      detail.breakdown.transferSales +
      detail.breakdown.transferPrepayments +
      detail.breakdown.transferOrderPayments +
      detail.breakdown.transferDealPayments -
      detail.breakdown.transferRefund,
  }
}

// Сумма безналичных возвратов (для строки «Возвраты безналичными» в разбивке по способам).
// Наличные возвраты показываются отдельно в «Формуле кассы» (getFormulaRows).
function getNonCashRefunds(detail: ShiftDetails) {
  return (
    detail.breakdown.cardRefund +
    detail.breakdown.terminalRefund +
    detail.breakdown.mbankRefund +
    detail.breakdown.optimaRefund +
    detail.breakdown.elsomRefund +
    detail.breakdown.bakaiRefund +
    detail.breakdown.transferRefund
  )
}

function getPrepayments(detail: ShiftDetails) {
  return (
    detail.summary.cashPrepayments +
    detail.breakdown.cardPrepayments +
    detail.breakdown.terminalPrepayments +
    detail.breakdown.mbankPrepayments +
    detail.breakdown.optimaPrepayments +
    detail.breakdown.elsomPrepayments +
    detail.breakdown.bakaiPrepayments +
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
    detail.breakdown.bakaiOrderPayments +
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
    detail.breakdown.bakaiDealPayments +
    detail.breakdown.transferDealPayments
  )
}

function operationUser(name: string | null | undefined) {
  return name?.trim() || "не зафиксирован"
}

// Метки смены (opened_at/closed_at/created_at — UTC из БД, показываем в поясе магазина).
function dateTime(value: string) {
  return formatInstant(value)
}
