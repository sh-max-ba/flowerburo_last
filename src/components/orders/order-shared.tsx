"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ClockIcon,
  ExternalLinkIcon,
  HourglassIcon,
  ListIcon,
  Loader2Icon,
  PackageCheckIcon,
  TruckIcon,
} from "lucide-react"
import type { Order, OrderItem, OrderStatus } from "@/lib/db"
import { deliveryTypeLabel, sourceLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { formatDeadline, formatInstant } from "@/lib/datetime"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProductThumbnail } from "@/components/products/product-thumbnail"

export type OrderSortMode = "default" | "due" | "new"
export type OrderViewMode = "list" | "calendar"

export const orderRealtimeRefreshMs = 5000
export const noDueDateKey = "__no_due_at__"

export const orderSortOptions: Array<{ label: string; value: OrderSortMode }> = [
  { label: "По умолчанию", value: "default" },
  { label: "Сначала ближайшие", value: "due" },
  { label: "Сначала новые", value: "new" },
]

// PERF-2: общий 5-сек поллер активности заказов. Опрашивает /api/orders/activity,
// вызывает router.refresh() только при изменении ревизии. Используется как клиентский
// остров на страницах /orders и /ready-orders (вместо монолитного useEffect).
export function OrdersActivityRefresh() {
  const router = useRouter()

  useEffect(() => {
    let lastRevision: string | null = null
    let active = true

    async function checkForUpdates() {
      if (document.visibilityState !== "visible") {
        return
      }

      try {
        const response = await fetch("/api/orders/activity", { cache: "no-store" })
        if (!response.ok) {
          return
        }
        const payload = (await response.json()) as { revision?: string }
        const revision = String(payload.revision ?? "")
        if (lastRevision === null) {
          lastRevision = revision
          return
        }
        if (revision !== lastRevision) {
          lastRevision = revision
          if (active) {
            router.refresh()
          }
        }
      } catch {
        // Polling should never break the UI.
      }
    }

    const interval = window.setInterval(checkForUpdates, orderRealtimeRefreshMs)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [router])

  return null
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0")
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

function dateKey(date: Date) {
  return dateInputValue(startOfLocalDay(date))
}

function dateKeyFromValue(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return noDueDateKey
  }

  return dateKey(date)
}

// Время срока заказа (due_at — наивное локальное время, без сдвига пояса).
function timeValue(value: string) {
  return formatDeadline(value, { date: false }) || "-"
}

function dayLabel(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date)
}

function weekRangeLabel(startDate: Date) {
  const endDate = addDays(startDate, 6)
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
  })
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`
}

function timestamp(value: string | null | undefined) {
  if (!value) {
    return Number.POSITIVE_INFINITY
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime()
}

function newestTimestamp(value: string | null | undefined) {
  const parsed = timestamp(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function compareDueAt(left: Order, right: Order) {
  const leftDue = timestamp(left.dueAt)
  const rightDue = timestamp(right.dueAt)
  const dueCompare = leftDue === rightDue ? 0 : leftDue - rightDue
  if (dueCompare !== 0) {
    return dueCompare
  }

  return newestTimestamp(right.createdAt) - newestTimestamp(left.createdAt)
}

function compareCreatedAtDesc(left: Order, right: Order) {
  return newestTimestamp(right.createdAt) - newestTimestamp(left.createdAt)
}

function workOrderStatusRank(status: OrderStatus) {
  const ranks: Partial<Record<OrderStatus, number>> = {
    "Новый": 0,
    "В работе": 1,
    "Готов": 2,
  }

  return ranks[status] ?? 99
}

function readyOrderStatusRank(status: OrderStatus) {
  const ranks: Partial<Record<OrderStatus, number>> = {
    "Готов": 0,
    "Передан курьеру": 1,
  }

  return ranks[status] ?? 99
}

export function sortWorkOrders(orders: Order[], sortMode: OrderSortMode) {
  return [...orders].sort((left, right) => {
    if (sortMode === "new") {
      return compareCreatedAtDesc(left, right)
    }

    if (sortMode === "due") {
      return compareDueAt(left, right)
    }

    const statusCompare = workOrderStatusRank(left.status) - workOrderStatusRank(right.status)
    if (statusCompare !== 0) {
      return statusCompare
    }

    return compareDueAt(left, right)
  })
}

export function sortReadyOrders(orders: Order[], sortMode: OrderSortMode) {
  return [...orders].sort((left, right) => {
    if (sortMode === "new") {
      return newestTimestamp(right.readyAt ?? right.createdAt) - newestTimestamp(left.readyAt ?? left.createdAt)
    }

    if (sortMode === "due") {
      const dueCompare = compareDueAt(left, right)
      if (dueCompare !== 0) {
        return dueCompare
      }

      return newestTimestamp(right.readyAt ?? right.createdAt) - newestTimestamp(left.readyAt ?? left.createdAt)
    }

    const statusCompare = readyOrderStatusRank(left.status) - readyOrderStatusRank(right.status)
    if (statusCompare !== 0) {
      return statusCompare
    }

    const leftDue = timestamp(left.dueAt)
    const rightDue = timestamp(right.dueAt)
    const dueCompare = leftDue === rightDue ? 0 : leftDue - rightDue
    if (dueCompare !== 0) {
      return dueCompare
    }

    return newestTimestamp(right.readyAt ?? right.createdAt) - newestTimestamp(left.readyAt ?? left.createdAt)
  })
}

export function OrderToolbar({
  sortMode,
  viewMode,
  onSortModeChange,
  onViewModeChange,
}: {
  sortMode: OrderSortMode
  viewMode: OrderViewMode
  onSortModeChange: (value: OrderSortMode) => void
  onViewModeChange: (value: OrderViewMode) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Сортировка</span>
        <Select
          value={sortMode}
          onValueChange={(value) => onSortModeChange((value ?? "default") as OrderSortMode)}
        >
          <SelectTrigger size="sm" className="min-w-44">
            <SelectValue placeholder="Сортировка">
              {(value) => orderSortOptions.find((option) => option.value === value)?.label ?? "По умолчанию"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {orderSortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <Tabs
        value={viewMode}
        onValueChange={(value) => onViewModeChange((value ?? "list") as OrderViewMode)}
      >
        <TabsList>
          <TabsTrigger value="list">
            <ListIcon data-icon="inline-start" />
            Список
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarDaysIcon data-icon="inline-start" />
            Календарь
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}

export function OrderCalendarView({
  orders,
  weekStart,
  showMoney,
  onToday,
  onPreviousWeek,
  onNextWeek,
  onOpenOrder,
}: {
  orders: Order[]
  weekStart: Date
  showMoney: boolean
  onToday: () => void
  onPreviousWeek: () => void
  onNextWeek: () => void
  onOpenOrder: (order: Order) => void
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const dayKeys = new Set(days.map(dateKey))
  const ordersByDate = new Map<string, Order[]>()
  const ordersWithoutDate: Order[] = []

  for (const order of orders) {
    const key = order.dueAt ? dateKeyFromValue(order.dueAt) : noDueDateKey
    if (key === noDueDateKey) {
      ordersWithoutDate.push(order)
      continue
    }

    if (!dayKeys.has(key)) {
      continue
    }

    ordersByDate.set(key, [...(ordersByDate.get(key) ?? []), order])
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium">Неделя</div>
          <div className="text-sm text-muted-foreground">{weekRangeLabel(weekStart)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onToday}>
            Сегодня
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onPreviousWeek}
            aria-label="Предыдущая неделя"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Пред. неделя
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onNextWeek}
            aria-label="Следующая неделя"
          >
            След. неделя
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-7">
        {days.map((day) => {
          const key = dateKey(day)
          const dayOrders = ordersByDate.get(key) ?? []

          return (
            <div key={key} className="flex min-h-40 flex-col gap-2 rounded-lg border bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium capitalize">{dayLabel(day)}</div>
                <Badge variant="outline">{dayOrders.length}</Badge>
              </div>
              {dayOrders.length ? (
                <div className="flex flex-col gap-2">
                  {dayOrders.map((order) => (
                    <OrderCalendarCard
                      key={order.id}
                      order={order}
                      showMoney={showMoney}
                      onOpenOrder={onOpenOrder}
                    />
                  ))}
                </div>
              ) : (
                <Empty className="min-h-24 rounded-lg border py-3">
                  <EmptyHeader>
                    <EmptyTitle className="text-sm">На этот день заказов нет</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          )
        })}
      </div>

      {ordersWithoutDate.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Без даты</div>
            <Badge variant="outline">{ordersWithoutDate.length}</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {ordersWithoutDate.map((order) => (
              <OrderCalendarCard
                key={order.id}
                order={order}
                showMoney={showMoney}
                onOpenOrder={onOpenOrder}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OrderCalendarCard({
  order,
  showMoney,
  onOpenOrder,
}: {
  order: Order
  showMoney: boolean
  onOpenOrder: (order: Order) => void
}) {
  const balance = order.total - order.paid

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border bg-white p-3 text-xs", orderUrgencyClass(order))}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{order.number || `#${order.id}`}</div>
          <div className="text-muted-foreground">{order.dueAt ? timeValue(order.dueAt) : "Без срока"}</div>
        </div>
        {order.status === "Готов" || order.status === "Передан курьеру" ? (
          <ReadyStatusBadge status={order.status} />
        ) : (
          <OrderBadge status={order.status} />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium">{order.customer || "Клиент не указан"}</div>
        {order.recipientPhone && (
          <div className="truncate text-muted-foreground">Получатель: {order.recipientPhone}</div>
        )}
        <div className="truncate text-muted-foreground">{deliveryTypeLabel(order.deliveryType)}</div>
      </div>
      {showMoney && (
        <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-2">
          <Info label="Сумма" value={formatMoney(order.total)} />
          <Info label="Остаток" value={formatMoney(balance)} />
        </div>
      )}
      <Button type="button" size="sm" variant="outline" className="mt-auto" onClick={() => onOpenOrder(order)}>
        К списку
      </Button>
    </div>
  )
}

export type OrderUrgencyLevel = "overdue" | "today" | "soon" | "future" | "none"

export type OrderUrgency = {
  level: OrderUrgencyLevel
  /** Russian label, e.g. «Просрочено», «Сегодня», «Через 3 ч». Empty for no-date. */
  label: string
  /** Card border/background classes that make overdue visually dominate the gray theme. */
  cardClass: string
}

// P0: единый источник срочности по сроку заказа. Используется и в списочном виде
// (карточки стола заказов), и в календаре. Просрочка визуально доминирует.
export function orderUrgency(order: Order, now: Date = new Date()): OrderUrgency {
  if (!order.dueAt) {
    return { level: "none", label: "", cardClass: "" }
  }

  const dueAt = new Date(order.dueAt)
  if (Number.isNaN(dueAt.getTime())) {
    return { level: "none", label: "", cardClass: "" }
  }

  const diffMs = dueAt.getTime() - now.getTime()

  if (diffMs < 0) {
    return {
      level: "overdue",
      label: "Просрочено",
      cardClass: "border-destructive bg-destructive/5 ring-1 ring-destructive/40",
    }
  }

  if (dateKey(dueAt) === dateKey(now)) {
    const hoursLeft = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)))
    return {
      level: "today",
      label: hoursLeft <= 6 ? `Через ${hoursLeft} ч` : "Сегодня",
      cardClass: "border-amber-300 bg-amber-50",
    }
  }

  return { level: "future", label: "", cardClass: "" }
}

function orderUrgencyClass(order: Order) {
  return orderUrgency(order).cardClass
}

// P0: текстовая+иконочная метка срочности. Цвет в монохроме читается плохо,
// поэтому каждый уровень несёт иконку и русскую подпись.
export function OrderUrgencyBadge({ order, className }: { order: Order; className?: string }) {
  const urgency = orderUrgency(order)

  if (urgency.level === "overdue") {
    return (
      <Badge variant="destructive" className={cn("gap-1", className)}>
        <AlertTriangleIcon data-icon="inline-start" />
        {urgency.label}
      </Badge>
    )
  }

  if (urgency.level === "today") {
    return (
      <Badge className={cn("gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100", className)}>
        <ClockIcon data-icon="inline-start" />
        {urgency.label}
      </Badge>
    )
  }

  return null
}

// size="lg" — планшетный вид Стола заказов: крупнее текст позиций и количества,
// больше отступы и миниатюры, имена переносятся (флорист читает состав с расстояния).
// size="sm" — компактный список (карточки готовых заказов).
export function OrderComposition({ items, size = "sm" }: { items: OrderItem[]; size?: "sm" | "lg" }) {
  const groups = groupOrderItems(items)
  const lg = size === "lg"
  const thumbSize = lg ? "sm" : "xs"

  if (!groups.length) {
    return (
      <div className={cn("rounded-lg bg-muted p-3 text-muted-foreground", lg ? "text-base" : "text-sm")}>
        Состав не указан
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col rounded-lg bg-muted", lg ? "gap-2 p-4 text-base" : "gap-1 p-3 text-sm")}>
      {groups.map((group) => {
        if (group.type === "bouquet") {
          return (
            <div
              key={group.key}
              className={cn("flex flex-col rounded-md bg-background/70", lg ? "gap-2 p-3" : "gap-1 p-2")}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={cn("min-w-0", lg ? "font-semibold" : "font-medium")}>
                  Букет &ldquo;{group.bouquetName || "Без названия"}&rdquo;
                </span>
                <span className="shrink-0 text-muted-foreground">{formatMoney(group.total)}</span>
              </div>
              <div className={cn("grid pl-2", lg ? "gap-2" : "gap-1")}>
                {group.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 text-muted-foreground">
                    <span className="flex min-w-0 items-center gap-2">
                      <ProductThumbnail name={item.name} imagePath={item.imagePath} size={thumbSize} />
                      <span className={lg ? "min-w-0" : "truncate"}>{item.name}</span>
                    </span>
                    <span className={cn("shrink-0 tabular-nums", lg && "font-semibold text-foreground")}>
                      {number(item.qty)} шт
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        }

        const item = group.item
        return (
          <div key={group.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <ProductThumbnail name={item.name} imagePath={item.imagePath} size={thumbSize} />
              <span className={lg ? "min-w-0" : "truncate"}>{item.name}</span>
            </span>
            <span className={cn("shrink-0 tabular-nums", lg && "font-semibold")}>{number(item.qty)} шт</span>
          </div>
        )
      })}
    </div>
  )
}

function groupOrderItems(items: OrderItem[]) {
  const groups: Array<
    | { type: "single"; key: string; item: OrderItem }
    | { type: "bouquet"; key: string; bouquetName: string; total: number; items: OrderItem[] }
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
        bouquetName: item.bouquetName,
        total: 0,
        items: [],
      }
      bouquetGroups.set(item.bouquetGroupId, group)
      groups.push(group)
    }
    group.items.push(item)
    group.total += item.total
  }

  return groups
}

// P1: единый бейдж статуса заказа для /orders и /ready-orders. Каждый статус
// несёт иконку, поэтому читается и без опоры на цвет (тема в основном монохромна).
export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  switch (status) {
    case "Новый":
      return (
        <Badge variant="outline" className={cn("gap-1", className)}>
          <HourglassIcon data-icon="inline-start" />
          Новый
        </Badge>
      )
    case "В работе":
      return (
        <Badge variant="secondary" className={cn("gap-1", className)}>
          <ClockIcon data-icon="inline-start" />
          В работе
        </Badge>
      )
    case "Готов":
      return (
        <Badge className={cn("gap-1 bg-emerald-100 text-emerald-900 hover:bg-emerald-100", className)}>
          <PackageCheckIcon data-icon="inline-start" />
          Готов
        </Badge>
      )
    case "Передан курьеру":
      return (
        <Badge className={cn("gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100", className)}>
          <TruckIcon data-icon="inline-start" />
          Передан курьеру
        </Badge>
      )
    case "Выдан":
      return (
        <Badge variant="secondary" className={cn("gap-1", className)}>
          <CheckCircle2Icon data-icon="inline-start" />
          Выдан
        </Badge>
      )
    case "Отменен":
      return (
        <Badge variant="destructive" className={cn("gap-1", className)}>
          <AlertTriangleIcon data-icon="inline-start" />
          Отменен
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className={className}>
          {status}
        </Badge>
      )
  }
}

// Сохраняем имена-обёртки для обратной совместимости — оба теперь дают
// идентичный вид для одинакового статуса на обоих экранах.
export function OrderBadge({ status }: { status: OrderStatus }) {
  return <OrderStatusBadge status={status} />
}

export function ReadyStatusBadge({ status }: { status: OrderStatus }) {
  return <OrderStatusBadge status={status} />
}

// P1: бейдж источника заказа (WhatsApp/Сайт/Телефон…) — помогает понять контекст.
// «deal» не выводим: это не реальный канал (заказ создан из сделки), а происхождение
// уже передаёт ссылка «Открыть сделку».
export function OrderSourceBadge({ source, className }: { source: string; className?: string }) {
  if (!source || source === "deal") {
    return null
  }

  return (
    <Badge variant="outline" className={className}>
      {sourceLabel(source)}
    </Badge>
  )
}

// P1: ненавязчивая ссылка на сделку-источник, чтобы быстро уточнить детали.
export function OrderDealLink({ dealId, className }: { dealId: number | null; className?: string }) {
  if (!dealId) {
    return null
  }

  return (
    <Link
      href={`/deals/${dealId}`}
      className={cn(
        "inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline",
        className
      )}
    >
      <ExternalLinkIcon className="size-3.5" />
      Открыть сделку
    </Link>
  )
}

// P2: маленький спиннер для точечной обратной связи на конкретной нажатой кнопке.
export function Spinner({ className }: { className?: string }) {
  return <Loader2Icon className={cn("animate-spin", className)} aria-hidden />
}

export function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-semibold text-zinc-950">{value}</div>
    </div>
  )
}

export function number(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

// Метка времени операции (created_at и т.п. — UTC из БД, показываем в поясе магазина).
export function dateTime(value: string) {
  return formatInstant(value)
}

// Человекочитаемый срок для планшета: «12 мая, 12:00» (день + месяц словом + время).
// Дату и время собираем раздельно, чтобы гарантировать разделитель «, » (ICU для ru
// иначе может выдать «12 мая в 12:00»).
export function dateTimeLong(value: string) {
  return formatDeadline(value, { longMonth: true })
}
