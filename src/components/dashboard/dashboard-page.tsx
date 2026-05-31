import type React from "react"
import Link from "next/link"
import {
  AlarmClockIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircle2Icon,
  ClockIcon,
  CoinsIcon,
  MessageSquareTextIcon,
  PackageCheckIcon,
  ReceiptTextIcon,
  TriangleAlertIcon,
  WalletIcon,
} from "lucide-react"
import type { OwnerDashboardData } from "@/lib/db"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type DashboardPageProps = {
  data: OwnerDashboardData
}

function formatOpenedAt(value: string | null) {
  if (!value) {
    return ""
  }

  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"))
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function DashboardPage({ data }: DashboardPageProps) {
  const { shift, today, stock, work, debts } = data

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-zinc-600">
        Краткий обзор на утро: смена, склад, что горит по заказам и долги клиентов.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ShiftCard shift={shift} today={today} />
        <StockCard stock={stock} />
        <WorkCard work={work} />
        <DebtsCard debts={debts} />
      </div>
    </div>
  )
}

// (a) СМЕНА И ВЫРУЧКА ЗА СЕГОДНЯ ----------------------------------------------
function ShiftCard({
  shift,
  today,
}: {
  shift: OwnerDashboardData["shift"]
  today: OwnerDashboardData["today"]
}) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          <ReceiptTextIcon className="size-4" />
          Смена и выручка за сегодня
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="text-xs text-zinc-500">Выручка за сегодня</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-zinc-950">
              {formatMoney(today.salesTotal)}
            </span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {today.salesCount > 0
              ? `Продаж за день: ${today.salesCount}`
              : "Продаж за день пока нет"}
          </div>
        </div>

        {shift.isOpen ? (
          <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
                <ClockIcon className="size-3.5" />
                Смена открыта
              </span>
              <Badge variant="secondary">{shift.type === "night" ? "Ночная" : "Дневная"}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-zinc-500">Касса (ожидается)</dt>
              <dd className="text-right font-medium tabular-nums text-zinc-950">
                {formatMoney(shift.expectedCash)}
              </dd>
              <dt className="text-zinc-500">Открыто с</dt>
              <dd className="text-right tabular-nums text-zinc-700">
                {formatMoney(shift.openingCash)}
              </dd>
              {shift.cashierName ? (
                <>
                  <dt className="text-zinc-500">Кассир</dt>
                  <dd className="truncate text-right text-zinc-700">{shift.cashierName}</dd>
                </>
              ) : null}
              {formatOpenedAt(shift.openedAt) ? (
                <>
                  <dt className="text-zinc-500">Открыта</dt>
                  <dd className="text-right text-zinc-700">{formatOpenedAt(shift.openedAt)}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span>Смена закрыта — откройте смену, чтобы принимать оплату.</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// (b) СКЛАД — ТРЕБУЕТ ДОЗАКАЗА ------------------------------------------------
function StockCard({ stock }: { stock: OwnerDashboardData["stock"] }) {
  const calm = stock.lowStockCount === 0 && stock.negativeStockCount === 0

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          <WalletIcon className="size-4" />
          Склад — требует дозаказа
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {calm ? (
          <CalmState text="Остатки в норме" />
        ) : (
          <div className="flex flex-col gap-3">
            <StatRow
              icon={<TriangleAlertIcon className="size-4 text-destructive" />}
              label="В минусе"
              value={stock.negativeStockCount}
              tone={stock.negativeStockCount > 0 ? "destructive" : "muted"}
            />
            <StatRow
              icon={<AlertTriangleIcon className="size-4 text-amber-600" />}
              label="Заканчиваются (≤ 3)"
              value={stock.lowStockCount}
              tone={stock.lowStockCount > 0 ? "amber" : "muted"}
            />
          </div>
        )}
        <CardLink href="/stock" label="Открыть склад" />
      </CardContent>
    </Card>
  )
}

// (c) СДЕЛКИ И ЗАКАЗЫ — ЧТО ГОРИТ ---------------------------------------------
function WorkCard({ work }: { work: OwnerDashboardData["work"] }) {
  const calm =
    work.incomingDealsCount === 0 && work.readyOrdersCount === 0 && work.overdueOrdersCount === 0

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          <AlarmClockIcon className="size-4" />
          Сделки и заказы — что горит
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {calm ? <CalmState text="Всё под контролем" /> : null}

        <Link
          href="/deals"
          className="group/row flex items-center justify-between rounded-xl border border-zinc-200 p-3 transition-colors hover:bg-zinc-50"
        >
          <span className="flex items-center gap-2 text-sm text-zinc-600">
            <MessageSquareTextIcon className="size-4 text-zinc-500" />
            Новые сделки
          </span>
          <span className="flex items-center gap-2">
            <span className="text-xl font-semibold tabular-nums text-zinc-950">
              {work.incomingDealsCount}
            </span>
            {work.incomingDealsCount > 0 ? <Badge>новые</Badge> : null}
          </span>
        </Link>

        <Link
          href="/ready-orders"
          className="group/row flex items-center justify-between rounded-xl border border-zinc-200 p-3 transition-colors hover:bg-zinc-50"
        >
          <span className="flex items-center gap-2 text-sm text-zinc-600">
            <PackageCheckIcon className="size-4 text-zinc-500" />
            Готовы к выдаче
          </span>
          <span className="flex items-center gap-2">
            <span className="text-xl font-semibold tabular-nums text-zinc-950">
              {work.readyOrdersCount}
            </span>
            {work.readyOrdersCount > 0 ? <Badge variant="secondary">ждут</Badge> : null}
          </span>
        </Link>

        <Link
          href="/orders"
          className="group/row flex items-center justify-between rounded-xl border border-zinc-200 p-3 transition-colors hover:bg-zinc-50"
        >
          <span className="flex items-center gap-2 text-sm text-zinc-600">
            <ClockIcon className="size-4 text-zinc-500" />
            Просрочены
          </span>
          <span className="flex items-center gap-2">
            <span
              className={
                work.overdueOrdersCount > 0
                  ? "text-xl font-semibold tabular-nums text-destructive"
                  : "text-xl font-semibold tabular-nums text-zinc-950"
              }
            >
              {work.overdueOrdersCount}
            </span>
            {work.overdueOrdersCount > 0 ? <Badge variant="destructive">срок прошёл</Badge> : null}
          </span>
        </Link>
      </CardContent>
    </Card>
  )
}

// (d) ДОЛГИ КЛИЕНТОВ ----------------------------------------------------------
function DebtsCard({ debts }: { debts: OwnerDashboardData["debts"] }) {
  const noDebts = debts.totalOutstanding <= 0 && debts.topDebtors.length === 0

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          <CoinsIcon className="size-4" />
          Долги клиентов
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {noDebts ? (
          <CalmState text="Долгов нет" />
        ) : (
          <>
            <div>
              <div className="text-xs text-zinc-500">Всего к доплате</div>
              <div className="flex items-baseline gap-2">
                <BanknoteIcon className="size-5 text-amber-600" />
                <span className="text-3xl font-semibold tabular-nums text-zinc-950">
                  {formatMoney(debts.totalOutstanding)}
                </span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                По {debts.debtorOrdersCount}{" "}
                {pluralOrders(debts.debtorOrdersCount)} с долгом
              </div>
            </div>

            <ul className="flex flex-col gap-1.5">
              {debts.topDebtors.map((debtor, index) => {
                const href = debtor.customerId ? `/clients/${debtor.customerId}` : "/clients"
                return (
                  <li key={`${debtor.customerId ?? "no-id"}-${index}`}>
                    <Link
                      href={href}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-zinc-50"
                    >
                      <span className="min-w-0 truncate text-zinc-700">{debtor.customerName}</span>
                      <span className="shrink-0 font-medium tabular-nums text-zinc-950">
                        {formatMoney(debtor.amount)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <CardLink href="/clients" label="Все клиенты" />
      </CardContent>
    </Card>
  )
}

// --- Мелкие части ------------------------------------------------------------
function StatRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone: "destructive" | "amber" | "muted"
}) {
  const valueClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "amber"
        ? "text-amber-600"
        : "text-zinc-950"

  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-200 p-3">
      <span className="flex items-center gap-2 text-sm text-zinc-600">
        {icon}
        {label}
      </span>
      <span className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  )
}

function CalmState({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
      <CheckCircle2Icon className="size-4 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function CardLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-950"
    >
      {label}
      <ArrowRightIcon className="size-4" />
    </Link>
  )
}

// «по 1 заказу» / «по N заказам» — дательный падеж после числа.
function pluralOrders(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  return mod10 === 1 && mod100 !== 11 ? "заказу" : "заказам"
}
