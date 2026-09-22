"use client"

import { Fragment, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDownIcon, Loader2Icon, RotateCcwIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { updatePaymentMethodAction } from "@/app/actions"
import type { PaymentMethod, SalePaymentMethod, ShiftDetails } from "@/lib/db"
import { cashTransactionTypeLabel, getPaymentMethodLabel, paymentMethodOptions } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { formatInstant } from "@/lib/datetime"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
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
  // 'mixed' — только у строки продажи со смешанной оплатой (показ текстом, без правки).
  paymentMethod: SalePaymentMethod
  outflow: boolean
  refund: boolean
  // Сторнированная продажа: бейдж «сторнировано», способ оплаты только текстом (selectа нет).
  reversed?: boolean
  customer: string
  operator: string
  comment: string
  items: CompositionItem[] | null
  editTarget: { target: "sale" | "transaction"; id: number } | null
  kind: TimelineKind
}

// Категория строки для фильтра «Операция» (обобщение над typeLabel).
type TimelineKind = "sale" | "order_payment" | "refund" | "cash_in" | "cash_out"

const KIND_CHIPS: Array<{ value: TimelineKind | "all"; label: string }> = [
  { value: "all", label: "Все" },
  { value: "sale", label: "Продажи" },
  { value: "order_payment", label: "Оплаты заказов" },
  { value: "refund", label: "Возвраты" },
  { value: "cash_in", label: "Внесения" },
  { value: "cash_out", label: "Изъятия" },
]

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

  // Фильтры ленты: поиск (номер/клиент/оператор/состав), тип операции, способ оплаты, оператор.
  const [query, setQuery] = useState("")
  const [kindFilter, setKindFilter] = useState<TimelineKind | "all">("all")
  const [methodFilter, setMethodFilter] = useState<string>("all")
  const [operatorFilter, setOperatorFilter] = useState<string>("all")

  // Способы оплаты и операторы — только реально встречающиеся в этой смене.
  const methods = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) set.add(row.paymentMethod)
    return paymentMethodOptions
      .map((option) => option.value as string)
      .concat("mixed")
      .filter((value) => set.has(value))
  }, [rows])
  const operators = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) {
      if (row.operator) set.add(row.operator)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"))
  }, [rows])

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1)
    return counts
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (kindFilter !== "all" && row.kind !== kindFilter) return false
      if (methodFilter !== "all" && row.paymentMethod !== methodFilter) return false
      if (operatorFilter !== "all" && row.operator !== operatorFilter) return false
      if (!q) return true
      const itemNames = row.items?.map((item) => item.name).join(" ") ?? ""
      return `${row.reference} ${row.customer} ${row.operator} ${row.typeLabel} ${row.comment} ${itemNames}`
        .toLowerCase()
        .includes(q)
    })
  }, [rows, query, kindFilter, methodFilter, operatorFilter])

  const hasFilters =
    query.trim() !== "" || kindFilter !== "all" || methodFilter !== "all" || operatorFilter !== "all"

  const totals = useMemo(
    () =>
      filteredRows.reduce(
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
    [filteredRows]
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

  function resetFilters() {
    setQuery("")
    setKindFilter("all")
    setMethodFilter("all")
    setOperatorFilter("all")
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по номеру, клиенту, комментарию или составу"
            className="h-9 w-full pl-9"
          />
        </div>
        <Select
          items={[
            { label: "Все способы оплаты", value: "all" },
            ...methods.map((value) => ({ label: getPaymentMethodLabel(value), value })),
          ]}
          value={methodFilter}
          onValueChange={(next) => setMethodFilter(next ?? "all")}
        >
          <SelectTrigger className="h-9 w-full min-w-44 lg:w-52">
            <SelectValue placeholder="Все способы оплаты">
              {methodFilter === "all" ? "Все способы оплаты" : getPaymentMethodLabel(methodFilter)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              <SelectItem value="all">Все способы оплаты</SelectItem>
              {methods.map((value) => (
                <SelectItem key={value} value={value}>
                  {getPaymentMethodLabel(value)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {operators.length > 1 && (
          <Select
            items={[
              { label: "Все операторы", value: "all" },
              ...operators.map((name) => ({ label: name, value: name })),
            ]}
            value={operatorFilter}
            onValueChange={(next) => setOperatorFilter(next ?? "all")}
          >
            <SelectTrigger className="h-9 w-full min-w-40 lg:w-48">
              <SelectValue placeholder="Все операторы">
                {operatorFilter === "all" ? "Все операторы" : operatorFilter}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                <SelectItem value="all">Все операторы</SelectItem>
                {operators.map((name) => (
                  <SelectItem key={name} value={name}>
                    <span className="max-w-48 truncate">{name}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <button
          type="button"
          disabled={!hasFilters}
          onClick={resetFilters}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcwIcon className="size-4" />
          Сброс
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {KIND_CHIPS.map((chip) => {
          const count = chip.value === "all" ? rows.length : (kindCounts.get(chip.value) ?? 0)
          const active = kindFilter === chip.value
          const disabled = chip.value !== "all" && count === 0
          return (
            <button
              key={chip.value}
              type="button"
              disabled={disabled}
              onClick={() => setKindFilter(chip.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition-colors",
                active
                  ? "bg-zinc-950 text-white"
                  : "bg-muted/60 text-foreground hover:bg-muted",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {chip.label}
              <span className={cn("text-xs tabular-nums", active ? "text-white/70" : "text-muted-foreground")}>
                {count}
              </span>
            </button>
          )
        })}
        {hasFilters && (
          <span className="ml-auto text-xs text-muted-foreground">
            Показано {filteredRows.length} из {rows.length}
          </span>
        )}
      </div>

      {filteredRows.length === 0 ? (
        <Empty className="min-h-24 py-4">
          <EmptyHeader>
            <EmptyTitle>Ничего не найдено</EmptyTitle>
            <EmptyDescription>По выбранным фильтрам операций нет — измените поиск или сбросьте фильтры.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
    <div className="min-w-0 max-w-full overflow-x-auto">
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
          {filteredRows.map((row) => {
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
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={row.refund ? "destructive" : "outline"}>{row.typeLabel}</Badge>
                      {row.reversed && (
                        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                          сторнировано
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  {/* Ссылка на заказ/продажу + комментарий второй строкой (если есть):
                      отдельная колонка не влезает на ноутбуке, а для изъятий/внесений
                      комментарий — фактически единственное описание операции. */}
                  <TableCell>
                    <div className="max-w-44 min-w-36 lg:max-w-56">
                      <div className="truncate">{row.reference}</div>
                      {row.comment && (
                        <div className="truncate text-xs text-muted-foreground" title={row.comment}>
                          {row.comment}
                        </div>
                      )}
                    </div>
                  </TableCell>
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
                        // editTarget не ставится для mixed-строк — здесь всегда конкретный способ.
                        method={row.paymentMethod as PaymentMethod}
                        editable={editable}
                      />
                    ) : (
                      <span className="whitespace-nowrap">{getPaymentMethodLabel(row.paymentMethod)}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-40 truncate" title={row.customer || undefined}>
                    {row.customer || "-"}
                  </TableCell>
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
              {hasFilters ? "Итого по фильтру" : "Итого за смену"}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              <span className="whitespace-nowrap">+{formatMoney(totals.inflow)}</span>
              {totals.outflow >= 0.01 && (
                <span className="block whitespace-nowrap text-red-600">−{formatMoney(totals.outflow)}</span>
              )}
            </TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
      )}
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
      operator: sale.userName ?? "",
      comment: sale.note,
      items: sale.items,
      // У сторнированной продажи способ оплаты заморожен: возврат повторил исходный метод,
      // правка разбалансирует пару «приход+возврат» (сервер такую правку тоже отклоняет).
      // У смешанной оплаты частей две — единого способа нет, правка тоже заморожена.
      editTarget: reversed || sale.paymentMethod === "mixed" ? null : { target: "sale", id: sale.id },
      kind: "sale",
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
      operator: order.userName ?? "",
      comment: order.comment,
      items: order.items,
      editTarget: isPayment ? { target: "transaction", id: order.transactionId } : null,
      kind: refund ? "refund" : order.type === "cash_out" ? "cash_out" : "order_payment",
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
      operator: tx.userName ?? "",
      comment: tx.comment,
      items: null,
      editTarget: null,
      kind: "refund",
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
      operator: tx.userName ?? "",
      comment: tx.comment,
      items: null,
      editTarget: null,
      kind: tx.type === "cash_in" ? "cash_in" : "cash_out",
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
