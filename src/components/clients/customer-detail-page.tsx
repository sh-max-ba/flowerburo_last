"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AtSignIcon, MessageCircleIcon, PencilIcon, PhoneIcon } from "lucide-react"
import { toast } from "sonner"
import { updateCustomerAction } from "@/app/actions"
import type { Customer } from "@/lib/crm"
import type { CustomerDate } from "@/lib/customer-dates"
import type { Order, Sale } from "@/lib/db"
import { getPaymentMethodLabel, sourceLabel } from "@/lib/labels"
import { orderNumberLabel, orderTitle } from "@/lib/order-labels"
import type { CustomerRecipient } from "@/lib/recipients"
import { cn, formatMoney } from "@/lib/utils"
import { FloristMark } from "@/components/florist-mark"
import { CustomerDatesSection } from "@/components/customers/customer-dates"
import { CustomerRecipientsSection } from "@/components/customers/customer-recipients"
import { OrderDetailsDialog } from "@/components/orders/order-details-dialog"
import { OrderStatusBadge } from "@/components/orders/order-shared"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CustomerFields,
  dateTime,
  instagramLink,
  pluralize,
  telLink,
} from "@/components/clients/customers-page"
import { formatDeadline, parseDbInstant } from "@/lib/datetime"

type ActionResult = Awaited<ReturnType<typeof updateCustomerAction>>

const HISTORY_CAP = 5

// Активные заказы (остаток к оплате ещё ждём). Черновик и отменённый — не долг.
const ACTIVE_ORDER_STATUSES = ["Новый", "В работе", "Готов", "Передан курьеру", "new", "in_progress", "ready"]
const NOT_COUNTED_STATUSES = ["Отменен", "Черновик"]

const orderForms: [string, string, string] = ["заказ", "заказа", "заказов"]
const saleForms: [string, string, string] = ["продажа", "продажи", "продаж"]

// Карточка клиента: слева — контакты, важные даты и получатели; справа — история заказов и
// покупок на кассе. Сделки (старый канбан) здесь не показываем: работа идёт в «Чатах» и заказах.
export function CustomerDetailPage({
  customer,
  orders,
  sales,
  dates,
  recipients,
  hasChat = false,
}: {
  customer: Customer
  orders: Order[]
  sales: Sale[]
  // Дни рождения, годовщины — ближайшая первой.
  dates: CustomerDate[]
  // Кому клиент дарит цветы — недавние первыми.
  recipients: CustomerRecipient[]
  // У клиента уже есть диалог в «Чатах» (без телефона ссылку «Открыть чат» показываем только тогда).
  hasChat?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)

  const telHref = telLink(customer.phone)
  const igHref = instagramLink(customer.instagram)

  // Переписка — в «Чатах»: /chats?customer= открывает диалог клиента, а если его ещё нет и есть
  // телефон — заводит WhatsApp-диалог.
  const chatHref = hasChat || customer.phone ? `/chats?customer=${customer.id}` : null

  const stats = useMemo(() => {
    // Оплачено: принятые оплаты заказов (без отменённых и черновиков) + продажи на кассе (без сторно).
    const countedOrders = orders.filter((order) => !NOT_COUNTED_STATUSES.includes(order.status))
    const ordersPaid = countedOrders.reduce((sum, order) => sum + (order.paid || 0), 0)
    const liveSales = sales.filter((sale) => !sale.reversedAt)
    const salesPaid = liveSales.reduce((sum, sale) => sum + (sale.total || 0), 0)

    const outstanding = orders
      .filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status))
      .reduce((sum, order) => sum + Math.max(0, (order.total || 0) - (order.paid || 0)), 0)

    const lastActivity = [...orders.map((order) => order.createdAt), ...sales.map((sale) => sale.createdAt)]
      .filter(Boolean)
      // Метки из БД — UTC без зоны: new Date(value) разобрал бы их в поясе сервера/устройства,
      // и время съезжало на 6 часов (а сервер и планшет рисовали разное).
      .map((value) => parseDbInstant(value)?.getTime() ?? Number.NaN)
      .filter((time) => !Number.isNaN(time))
      .sort((a, b) => b - a)[0]

    return {
      totalPaid: ordersPaid + salesPaid,
      outstanding,
      ordersCount: countedOrders.length,
      salesCount: liveSales.length,
      lastActivity,
    }
  }, [orders, sales])

  const sortedOrders = useMemo(() => sortByCreated(orders), [orders])
  const sortedSales = useMemo(() => sortByCreated(sales), [sales])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result: ActionResult = await updateCustomerAction(formData)
      if (result.ok) {
        toast.success(result.message)
        setEditOpen(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Card className="rounded-2xl">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate font-semibold text-zinc-950">{customer.name}</CardTitle>
              {telHref ? (
                <a
                  href={telHref}
                  className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-950 hover:underline"
                >
                  <PhoneIcon className="size-3.5" />
                  {customer.phone}
                </a>
              ) : (
                <p className="mt-0.5 text-sm text-zinc-500">Телефон не указан</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {customer.defaultDiscountPercent > 0 ? (
                <Badge variant="secondary">Скидка {customer.defaultDiscountPercent}%</Badge>
              ) : null}
              <Badge variant="outline">{sourceLabel(customer.source)}</Badge>
              <FloristMark role={customer.createdByRole} name={customer.createdByName} action="Добавил" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Stat strip — the manager's two core questions, above the fold. */}
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Всего оплачено" value={formatMoney(stats.totalPaid)} />
            <StatTile
              label="Открытый остаток"
              value={formatMoney(stats.outstanding)}
              emphasis={stats.outstanding > 0}
            />
            <StatTile
              label="Заказов / Продаж"
              value={`${stats.ordersCount} / ${stats.salesCount}`}
              hint={recipients.length ? `получателей: ${recipients.length}` : undefined}
            />
            <StatTile
              label="Последняя активность"
              value={stats.lastActivity ? dateTime(new Date(stats.lastActivity).toISOString()) : "—"}
            />
          </div>

          {/* Contact actions */}
          <div className="flex flex-wrap gap-2">
            {chatHref ? (
              <Link
                href={chatHref}
                className={cn(buttonVariants({ variant: "default", size: "sm" }))}
              >
                <MessageCircleIcon data-icon="inline-start" />
                Открыть чат
              </Link>
            ) : null}
            {telHref ? (
              <a href={telHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                <PhoneIcon data-icon="inline-start" />
                Позвонить
              </a>
            ) : null}
            {igHref ? (
              <a
                href={igHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <AtSignIcon data-icon="inline-start" />
                Instagram
              </a>
            ) : null}
          </div>

          <CustomerDatesSection
            customerId={customer.id}
            dates={dates}
            recipients={recipients}
            onChanged={() => router.refresh()}
          />

          <CustomerRecipientsSection customerId={customer.id} recipients={recipients} onChanged={() => router.refresh()} />

          <div className="grid gap-3 rounded-xl bg-muted/30 p-3 text-sm">
            {customer.instagram ? (
              <InfoLine label="Instagram" value={customer.instagram} />
            ) : null}
            <InfoLine label="Комментарий" value={customer.comment || "Нет комментария"} />
          </div>

          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <PencilIcon data-icon="inline-start" />
            Изменить
          </Button>
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-col gap-5">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-semibold text-zinc-950">История</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="orders">
              <TabsList variant="line" className="mb-4">
                <TabsTrigger value="orders">Заказы {orders.length}</TabsTrigger>
                <TabsTrigger value="sales">Покупки на кассе {sales.length}</TabsTrigger>
              </TabsList>

              <TabsContent value="orders">
                <OrdersTable orders={sortedOrders} />
              </TabsContent>
              <TabsContent value="sales">
                <SalesTable sales={sortedSales} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Изменить клиента</DialogTitle>
            </DialogHeader>
            <input type="hidden" name="customerId" value={customer.id} />
            <CustomerFields customer={customer} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={pending}>
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Заказы клиента: «№583 · Нежность», получатель, срок и деньги. Нажатие — карточка заказа.
function OrdersTable({ orders }: { orders: Order[] }) {
  const [showAll, setShowAll] = useState(false)
  const [opened, setOpened] = useState<Order | null>(null)
  const rows = showAll ? orders : orders.slice(0, HISTORY_CAP)

  if (!orders.length) {
    return (
      <Empty className="min-h-40">
        <EmptyHeader>
          <EmptyTitle>Заказов пока нет</EmptyTitle>
          <EmptyDescription>Заказы появятся здесь после первого заказа из чата или на кассе.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Заказ</TableHead>
            <TableHead>К сроку</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((order) => {
            const balance = Math.max(0, order.total - order.paid)
            const counted = !NOT_COUNTED_STATUSES.includes(order.status)
            return (
              <TableRow key={order.id} className="cursor-pointer" onClick={() => setOpened(order)}>
                <TableCell className="max-w-64">
                  <div className="truncate font-medium">
                    {orderNumberLabel(order)} · {orderTitle(order)}
                  </div>
                  {order.recipientName || order.recipientPhone ? (
                    <div className="truncate text-xs text-muted-foreground">
                      Получатель: {[order.recipientName, order.recipientPhone].filter(Boolean).join(", ")}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{order.dueAt ? formatDeadline(order.dueAt) : "—"}</TableCell>
                <TableCell>
                  <OrderStatusBadge status={order.status} />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  <div className="font-semibold">{formatMoney(order.total)}</div>
                  {counted && balance > 0.009 ? (
                    <div className="text-xs font-medium text-destructive">остаток {formatMoney(balance)}</div>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <ShowAllToggle
        showAll={showAll}
        total={orders.length}
        cap={HISTORY_CAP}
        onToggle={() => setShowAll((value) => !value)}
        forms={orderForms}
      />
      <OrderDetailsDialog order={opened} onOpenChange={(open) => !open && setOpened(null)} />
    </div>
  )
}

function SalesTable({ sales }: { sales: Sale[] }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? sales : sales.slice(0, HISTORY_CAP)

  if (!sales.length) {
    return (
      <Empty className="min-h-40">
        <EmptyHeader>
          <EmptyTitle>Покупок на кассе пока нет</EmptyTitle>
          <EmptyDescription>Данные появятся после продажи на кассе с выбранным клиентом.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead className="text-right">До скидки</TableHead>
            <TableHead className="text-right">Скидка</TableHead>
            <TableHead className="text-right">Итог</TableHead>
            <TableHead>Способ оплаты</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((sale) => (
            <TableRow key={sale.id} className={cn(sale.reversedAt && "text-muted-foreground line-through")}>
              <TableCell>{dateTime(sale.createdAt)}</TableCell>
              <TableCell className="text-right">{formatMoney(sale.totalBeforeDiscount)}</TableCell>
              <TableCell className="text-right">{formatMoney(sale.discountTotal)}</TableCell>
              <TableCell className="text-right font-semibold">{formatMoney(sale.total)}</TableCell>
              <TableCell>{getPaymentMethodLabel(sale.paymentMethod)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ShowAllToggle
        showAll={showAll}
        total={sales.length}
        cap={HISTORY_CAP}
        onToggle={() => setShowAll((value) => !value)}
        forms={saleForms}
      />
    </div>
  )
}

function ShowAllToggle({
  showAll,
  total,
  cap,
  onToggle,
  forms,
}: {
  showAll: boolean
  total: number
  cap: number
  onToggle: () => void
  forms: [string, string, string]
}) {
  if (total <= cap) {
    return null
  }
  return (
    <div className="mt-3 flex justify-center">
      <Button variant="ghost" size="sm" onClick={onToggle}>
        {showAll ? "Свернуть" : `Показать все ${pluralize(total, forms)}`}
      </Button>
    </div>
  )
}

function StatTile({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string
  value: string
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold text-zinc-950", emphasis && "text-destructive")}>
        {value}
      </div>
      {hint ? <div className="text-xs text-zinc-500">{hint}</div> : null}
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium text-zinc-950">{value}</div>
    </div>
  )
}

function sortByCreated<T extends { createdAt: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const aTime = parseDbInstant(a.createdAt)?.getTime() ?? 0
    const bTime = parseDbInstant(b.createdAt)?.getTime() ?? 0
    return bTime - aTime
  })
}
