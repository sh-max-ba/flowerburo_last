import Link from "next/link"
import {
  AlarmClockIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ClockIcon,
  CreditCardIcon,
  ReceiptTextIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"
import type { OwnerDashboardData, OwnerDashboardRange } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { formatInstant } from "@/lib/datetime"
import { getPaymentMethodLabel } from "@/lib/labels"
import { Money, StatCard } from "./stat-card"
import { RevenueChart } from "./revenue-chart"
import { DonutChart } from "./donut-chart"
import { ManagersTable } from "./managers-table"
import { DateRangePicker } from "./date-range-picker"

type DashboardPageProps = {
  data: OwnerDashboardData
}

// Время открытия смены (opened_at — UTC из БД, показываем в поясе магазина).
function formatOpenedAt(value: string | null) {
  return formatInstant(value)
}

export function DashboardPage({ data }: DashboardPageProps) {
  const { range, shift, period, stock, work, managers, revenueSeries, revenueWindow, paymentBreakdown } =
    data

  return (
    <div className="flex flex-col gap-5">
      {/* Селектор периода вместо статичного заголовка. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold text-zinc-900">Сводка по магазину</h1>
        <DateRangePicker range={range} />
      </div>

      {/* Адаптив: <md — стопкой; md (планшет) — 2 колонки: hero и широкие блоки
          (графики, таблицы) на всю ширину, а компактные Смена/Склад — по
          половине; lg+ — единая 12-колоночная сетка с выравниванием рядов.
          Операционка по заказам вынесена в таблицу внизу страницы. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
        {/* Ряд 1: 5 + 3 + 4 = 12. Приоритет: деньги → смена → склад. */}
        <RevenueHeroCard period={period} range={range} className="md:col-span-2 lg:col-span-5" />
        <ShiftCard shift={shift} className="md:col-span-1 lg:col-span-3" />
        <StockCard stock={stock} className="md:col-span-1 lg:col-span-4" />

        {/* Ряд 2: 8 + 4 = 12 (на планшете — каждый на всю ширину) */}
        <RevenueCard
          series={revenueSeries}
          window={revenueWindow}
          className="md:col-span-2 lg:col-span-8"
        />
        <PaymentBreakdownCard data={paymentBreakdown} className="md:col-span-2 lg:col-span-4" />

        {/* Ряд 3 */}
        {managers.length > 0 ? (
          <StatCard
            title="Показатели менеджеров"
            icon={UsersIcon}
            className="md:col-span-2 lg:col-span-12"
          >
            <ManagersTable managers={managers} />
          </StatCard>
        ) : null}

        {/* Ряд 4: список заказов на всю ширину — вместо компактной карточки «Заказы». */}
        <OrdersTableCard work={work} className="md:col-span-2 lg:col-span-12" />
      </div>
    </div>
  )
}

// (a) ВЫРУЧКА — карта-герой ---------------------------------------------------
// Чистая главная метрика: крупное число выручки за период + счётчики снизу.
function RevenueHeroCard({
  period,
  range,
  className,
}: {
  period: OwnerDashboardData["period"]
  range: OwnerDashboardRange
  className?: string
}) {
  const hasActivity = period.salesCount > 0 || period.ordersCount > 0
  return (
    <StatCard title={`Выручка ${periodLabel(range)}`} icon={ReceiptTextIcon} href="/cash" className={className}>
      <div className="flex flex-1 flex-col justify-center gap-2">
        <Money
          value={period.salesTotal}
          className="text-6xl leading-none font-light tracking-tight text-brand"
        />
        <div className="text-sm text-muted-foreground">
          {hasActivity
            ? `${period.salesCount} ${plural(period.salesCount, SALES)} · ${period.ordersCount} ${plural(period.ordersCount, ORDERS)}`
            : "Продаж за период пока нет"}
        </div>
      </div>
    </StatCard>
  )
}

// (b) СКЛАД — мини-таблица проблемных позиций --------------------------------
function StockCard({
  stock,
  className,
}: {
  stock: OwnerDashboardData["stock"]
  className?: string
}) {
  const calm = stock.negativeStockCount === 0 && stock.lowStockCount === 0
  const hidden = Math.max(0, stock.negativeStockCount + stock.lowStockCount - stock.items.length)

  return (
    <StatCard title="Склад" icon={WalletIcon} className={className}>
      {calm ? (
        <CalmRow text="Остатки в норме" />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-2 pb-2 font-medium">Позиция</th>
                <th className="px-2 pb-2 text-right font-medium">Остаток</th>
                <th className="px-2 pb-2 text-right font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {stock.items.map((item, index) => (
                <tr key={index} className="border-t border-zinc-100 transition-colors hover:bg-zinc-50/70">
                  <td className="px-2 py-2">
                    <span className="block max-w-[160px] truncate text-zinc-700">{item.name}</span>
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right font-medium tabular-nums",
                      item.status === "negative" ? "text-red-600" : "text-amber-600"
                    )}
                  >
                    {item.available}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <StockStatusPill status={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {hidden > 0 ? (
          <span className="text-xs text-muted-foreground">
            ещё {hidden} {plural(hidden, POSITIONS)}
          </span>
        ) : (
          <span />
        )}
        <FooterLink href="/stock" label="Открыть склад" />
      </div>
    </StatCard>
  )
}

// Пилюля статуса позиции склада — в тон проблемным метрикам (красный/янтарный).
function StockStatusPill({ status }: { status: "negative" | "low" }) {
  if (status === "negative") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        <TrendingDownIcon className="size-3 shrink-0" />
        В минусе
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
      <TriangleAlertIcon className="size-3 shrink-0" />
      Заканчивается
    </span>
  )
}

// (c) ЗАКАЗЫ — таблица активных заказов внизу страницы -----------------------
// Тот же набор заказов, что стоял за счётчиками карточки «Заказы». Счётчики
// (новые сделки / готовы / просрочены) сохранены как компактные ссылки в шапке.
function OrdersTableCard({
  work,
  className,
}: {
  work: OwnerDashboardData["work"]
  className?: string
}) {
  const orders = work.orders
  const hidden = Math.max(0, work.activeOrdersCount - orders.length)

  return (
    <StatCard
      title="Заказы"
      icon={AlarmClockIcon}
      headerRight={<OrdersCounters work={work} />}
      className={className}
    >
      {orders.length === 0 ? (
        <CalmRow text="Всё под контролем" />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-2 pb-2 font-medium">Номер</th>
                <th className="px-2 pb-2 font-medium">Клиент</th>
                <th className="px-2 pb-2 font-medium">Срок</th>
                <th className="px-2 pb-2 font-medium">Статус</th>
                <th className="px-2 pb-2 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {hidden > 0 ? (
          <span className="text-xs text-muted-foreground">
            Показаны {orders.length} из {work.activeOrdersCount}
          </span>
        ) : (
          <span />
        )}
        <FooterLink href="/orders" label="Все заказы" />
      </div>
    </StatCard>
  )
}

// Строка активного заказа: номер, клиент, срок (просрочка — красным), статус, сумма.
function OrderRow({ order }: { order: OwnerDashboardData["work"]["orders"][number] }) {
  const due = formatDue(order.dueAt)

  return (
    <tr className="border-t border-zinc-100 transition-colors hover:bg-zinc-50/70">
      <td className="px-2 py-2.5 font-medium tabular-nums whitespace-nowrap text-zinc-900">
        {order.number || `#${order.id}`}
      </td>
      <td className="px-2 py-2.5">
        <span className="block max-w-[260px] truncate text-zinc-700">
          {order.customer || "Клиент не указан"}
        </span>
      </td>
      <td
        className={cn(
          "px-2 py-2.5 tabular-nums whitespace-nowrap",
          due.overdue ? "font-medium text-red-600" : "text-zinc-600"
        )}
      >
        {due.overdue ? (
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3.5 shrink-0" />
            {due.text}
          </span>
        ) : (
          due.text
        )}
      </td>
      <td className="px-2 py-2.5">
        <OrderStatusPill status={order.status} />
      </td>
      <td className="px-2 py-2.5 text-right font-medium tabular-nums whitespace-nowrap text-zinc-900">
        {formatMoney(order.total)}
      </td>
    </tr>
  )
}

// Компактные счётчики-ссылки в шапке карточки заказов (что горит прямо сейчас).
function OrdersCounters({ work }: { work: OwnerDashboardData["work"] }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <CounterChip href="/deals" label="Новые сделки" value={work.incomingDealsCount} />
      <CounterChip href="/ready-orders" label="Готовы" value={work.readyOrdersCount} tone="success" />
      <CounterChip href="/orders" label="Просрочены" value={work.overdueOrdersCount} tone="danger" />
    </div>
  )
}

function CounterChip({
  href,
  label,
  value,
  tone = "default",
}: {
  href: string
  label: string
  value: number
  tone?: "default" | "success" | "danger"
}) {
  const active = value > 0
  const valueColor = !active
    ? "text-zinc-400"
    : tone === "danger"
      ? "text-red-600"
      : tone === "success"
        ? "text-emerald-600"
        : "text-zinc-900"

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-zinc-50"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums font-semibold", valueColor)}>{value}</span>
    </Link>
  )
}

// Цвет точки статуса заказа — спокойная палитра в тон бейджам на /orders.
const ORDER_STATUS_DOT: Record<string, string> = {
  "Новый": "bg-zinc-400",
  "В работе": "bg-blue-500",
  "Готов": "bg-emerald-500",
  "Передан курьеру": "bg-amber-500",
  "Выдан": "bg-zinc-300",
  "Отменен": "bg-red-500",
}

function OrderStatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-zinc-700">
      <span className={cn("size-2 shrink-0 rounded-full", ORDER_STATUS_DOT[status] ?? "bg-zinc-400")} />
      {status}
    </span>
  )
}

// (d) СМЕНА (вместо «Долги клиентов») — детали текущей смены ------------------
function ShiftCard({
  shift,
  className,
}: {
  shift: OwnerDashboardData["shift"]
  className?: string
}) {
  return (
    <StatCard title="Смена" icon={ClockIcon} href="/shifts" hideArrow className={className}>
      {shift.isOpen ? (
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-700">
              <CheckCircle2Icon className="size-4 text-emerald-600" />
              Открыта
            </span>
            <span className="rounded-md border border-zinc-200/70 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
              {shift.type === "night" ? "Ночная" : "Дневная"}
            </span>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Касса ожидается</div>
            <div className="text-xl font-normal tabular-nums tracking-tight text-zinc-900">
              {formatMoney(shift.expectedCash)}
            </div>
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {shift.cashierName ? <span className="truncate">Кассир · {shift.cashierName}</span> : null}
            {formatOpenedAt(shift.openedAt) ? (
              <span className="tabular-nums">Открыта · {formatOpenedAt(shift.openedAt)}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700">
            <AlertTriangleIcon className="size-4 shrink-0" />
            Смена закрыта
          </span>
          <span className="text-xs text-muted-foreground">
            Откройте смену, чтобы принимать оплату.
          </span>
        </div>
      )}
      <CardCta label="Смены" />
    </StatCard>
  )
}

// График выручки по дням + сумма и количество за окно графика.
function RevenueCard({
  series,
  window,
  className,
}: {
  series: OwnerDashboardData["revenueSeries"]
  window: OwnerDashboardData["revenueWindow"]
  className?: string
}) {
  return (
    <StatCard
      title={`Выручка за ${window.days} ${plural(window.days, DAYS)}`}
      icon={TrendingUpIcon}
      className={className}
    >
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <Money value={window.total} className="text-3xl font-normal tracking-tight text-zinc-900" />
          <div className="mt-1 text-xs text-muted-foreground">
            {window.salesCount} {plural(window.salesCount, SALES)} · {window.ordersCount}{" "}
            {plural(window.ordersCount, ORDERS)}
          </div>
        </div>
        <RevenueChart series={series} className="mt-auto" />
      </div>
    </StatCard>
  )
}

// Donut «Разбивка по оплатам» — доля выручки по методам оплаты.
function PaymentBreakdownCard({
  data,
  className,
}: {
  data: OwnerDashboardData["paymentBreakdown"]
  className?: string
}) {
  const segments = data
    .filter((row) => row.total > 0)
    .map((row, index) => ({
      label: getPaymentMethodLabel(row.method),
      value: row.total,
      count: row.count,
      color: paymentColor(row.method, index),
    }))
  const total = segments.reduce((sum, s) => sum + s.value, 0)

  return (
    <StatCard
      title="Разбивка по оплатам"
      icon={CreditCardIcon}
      fill={total > 0}
      className={cn(className, total === 0 && "self-start")}
    >
      {total === 0 ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <CreditCardIcon className="size-4 shrink-0 text-zinc-300" />
          Продаж за период нет
        </div>
      ) : (
        <div className="flex flex-1 items-center gap-5">
          <DonutChart segments={segments} centerValue={compactSum(total)} centerLabel="сом" />
          <ul className="flex min-w-0 flex-1 flex-col gap-2.5 text-sm">
            {segments.map((segment) => (
              <li key={segment.label} className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: segment.color }}
                />
                <span className="truncate text-zinc-600">{segment.label}</span>
                <span className="ml-auto shrink-0 tabular-nums font-medium text-zinc-900">
                  {formatMoney(segment.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </StatCard>
  )
}

// --- Мелкие части ------------------------------------------------------------

// Спокойное позитивное состояние: тонкая приглушённая строка с галочкой.
function CalmRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
      <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600/80" />
      <span>{text}</span>
    </div>
  )
}

// Нижний указатель «Открыть … →». Не отдельная ссылка (вся карточка кликабельна).
function CardCta({ label }: { label: string }) {
  return (
    <span className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors group-hover/stat:text-brand-strong">
      {label}
      <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover/stat:translate-x-0.5" />
    </span>
  )
}

// Явная нижняя ссылка для карточек с собственными таблицами (карточка не кликабельна).
function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group/link inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-brand-strong"
    >
      {label}
      <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover/link:translate-x-0.5" />
    </Link>
  )
}

// --- Хелперы -----------------------------------------------------------------

function periodLabel(range: OwnerDashboardRange): string {
  switch (range.preset) {
    case "today":
      return "за сегодня"
    case "7d":
      return "за 7 дней"
    case "30d":
      return "за 30 дней"
    case "month":
      return "за месяц"
    default:
      return "за период"
  }
}

// Срок заказа: дата-время + флаг просрочки (для подсветки в таблице).
function formatDue(value: string | null): { text: string; overdue: boolean } {
  if (!value) {
    return { text: "Без срока", overdue: false }
  }

  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"))
  if (Number.isNaN(date.getTime())) {
    return { text: "—", overdue: false }
  }

  return {
    text: new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
    overdue: date.getTime() < Date.now(),
  }
}

// Русские склонения по числу.
const SALES: [string, string, string] = ["продажа", "продажи", "продаж"]
const ORDERS: [string, string, string] = ["заказ", "заказа", "заказов"]
const DAYS: [string, string, string] = ["день", "дня", "дней"]
const POSITIONS: [string, string, string] = ["позиция", "позиции", "позиций"]

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// Компактная сумма для центра donut (967 440 → «967К», 1 200 000 → «1,2 млн»).
function compactSum(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} млн`
  if (abs >= 1_000) return `${Math.round(value / 1_000)}К`
  return String(Math.round(value))
}

// Спокойная сине-серая палитра методов оплаты (без светофора).
const PAYMENT_COLORS: Record<string, string> = {
  cash: "#2563eb",
  card: "#3b82f6",
  transfer: "#60a5fa",
  terminal: "#93c5fd",
  mbank: "#0ea5e9",
  optima: "#38bdf8",
  elsom: "#94a3b8",
  bakai: "#475569",
}

const PAYMENT_FALLBACK = ["#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#0ea5e9", "#38bdf8", "#94a3b8"]

function paymentColor(method: string, index: number): string {
  return PAYMENT_COLORS[method] ?? PAYMENT_FALLBACK[index % PAYMENT_FALLBACK.length]
}
