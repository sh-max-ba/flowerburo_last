"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ExternalLinkIcon,
  AtSignIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
} from "lucide-react"
import { toast } from "sonner"
import { updateCustomerAction } from "@/app/actions"
import type { Customer, Deal } from "@/lib/crm"
import type { Order, Sale } from "@/lib/db"
import { getPaymentMethodLabel, sourceLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
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

type ActionResult = Awaited<ReturnType<typeof updateCustomerAction>>

const HISTORY_CAP = 5

// Mirrors activeDealOrderStatuses in @/lib/db/types (kept local to avoid pulling the
// server-only db module — which imports node:path — into this client bundle).
const ACTIVE_ORDER_STATUSES = ["Новый", "В работе", "Готов", "Передан курьеру", "new", "in_progress", "ready"]

const dealForms: [string, string, string] = ["сделка", "сделки", "сделок"]
const orderForms: [string, string, string] = ["заказ", "заказа", "заказов"]
const saleForms: [string, string, string] = ["продажа", "продажи", "продаж"]

export function CustomerDetailPage({
  customer,
  deals,
  orders,
  sales,
}: {
  customer: Customer
  deals: Deal[]
  orders: Order[]
  sales: Sale[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)

  const telHref = telLink(customer.phone)
  const igHref = instagramLink(customer.instagram)

  // The Wazzup chat lives on a deal (the app opens chats per deal). Link to the most
  // recent deal that has a chat / phone so "Открыть чат" lands on a usable conversation.
  const chatDeal = useMemo(() => {
    const withChat = deals.filter((deal) => deal.wazzupChatId)
    return withChat[0] ?? deals[0] ?? null
  }, [deals])

  const stats = useMemo(() => {
    const dealPaid = deals.reduce((sum, deal) => sum + (deal.paid || 0), 0)
    const salesPaid = sales.reduce((sum, sale) => sum + (sale.total || 0), 0)
    const totalPaid = dealPaid + salesPaid

    // Only genuinely live deals owe a balance (won = closed/paid, lost/cancelled = no money due).
    const activeDeals = deals.filter((deal) => deal.status === "open")
    const dealOutstanding = activeDeals.reduce(
      (sum, deal) => sum + Math.max(0, (deal.total || 0) - (deal.paid || 0)),
      0
    )
    const orderOutstanding = orders
      .filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status))
      .reduce((sum, order) => sum + Math.max(0, (order.total || 0) - (order.paid || 0)), 0)
    const outstanding = dealOutstanding + orderOutstanding

    const lastActivity = [
      ...deals.map((deal) => deal.createdAt),
      ...orders.map((order) => order.createdAt),
      ...sales.map((sale) => sale.createdAt),
    ]
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((time) => !Number.isNaN(time))
      .sort((a, b) => b - a)[0]

    return { totalPaid, outstanding, lastActivity }
  }, [deals, orders, sales])

  const sortedDeals = useMemo(() => sortByCreated(deals), [deals])
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
      <Card className="rounded-2xl border-zinc-200 bg-white">
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
              label="Сделок / Заказов"
              value={`${deals.length} / ${orders.length}`}
              hint={`${sales.length} ${pluralWord(sales.length, saleForms)}`}
            />
            <StatTile
              label="Последняя активность"
              value={stats.lastActivity ? dateTime(new Date(stats.lastActivity).toISOString()) : "—"}
            />
          </div>

          {/* Contact actions */}
          <div className="flex flex-wrap gap-2">
            {chatDeal ? (
              <Link
                href={`/deals/${chatDeal.id}`}
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

          <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
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
        <Card className="rounded-2xl border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle className="font-semibold text-zinc-950">История</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="deals">
              <TabsList variant="line" className="mb-4">
                <TabsTrigger value="deals">Сделки {deals.length}</TabsTrigger>
                <TabsTrigger value="orders">Заказы {orders.length}</TabsTrigger>
                <TabsTrigger value="sales">Продажи {sales.length}</TabsTrigger>
              </TabsList>

              <TabsContent value="deals">
                <DealsTable deals={sortedDeals} />
              </TabsContent>
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
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
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

function DealsTable({ deals }: { deals: Deal[] }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? deals : deals.slice(0, HISTORY_CAP)

  if (!deals.length) {
    return (
      <Empty className="min-h-40">
        <EmptyHeader>
          <EmptyTitle>Сделок пока нет</EmptyTitle>
          <EmptyDescription>Данные появятся после первой сделки клиента.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Номер</TableHead>
            <TableHead>Название</TableHead>
            <TableHead>Этап</TableHead>
            <TableHead className="text-right">Итог</TableHead>
            <TableHead className="text-right">Оплачено</TableHead>
            <TableHead className="text-right">Остаток</TableHead>
            <TableHead>Создана</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((deal) => (
            <TableRow key={deal.id}>
              <TableCell className="font-medium">{deal.number}</TableCell>
              <TableCell>{deal.title || deal.customerName}</TableCell>
              <TableCell>
                <Badge variant="outline">{deal.stageName || "—"}</Badge>
              </TableCell>
              <TableCell className="text-right font-semibold">{formatMoney(deal.total)}</TableCell>
              <TableCell className="text-right">{formatMoney(deal.paid)}</TableCell>
              <TableCell className="text-right font-semibold">
                {formatMoney(Math.max(0, deal.total - deal.paid))}
              </TableCell>
              <TableCell>{dateTime(deal.createdAt)}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline" render={<Link href={`/deals/${deal.id}`} />}>
                  <ExternalLinkIcon data-icon="inline-start" />
                  Открыть
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ShowAllToggle
        showAll={showAll}
        total={deals.length}
        cap={HISTORY_CAP}
        onToggle={() => setShowAll((value) => !value)}
        forms={dealForms}
      />
    </div>
  )
}

function OrdersTable({ orders }: { orders: Order[] }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? orders : orders.slice(0, HISTORY_CAP)

  if (!orders.length) {
    return (
      <Empty className="min-h-40">
        <EmptyHeader>
          <EmptyTitle>Связанных заказов нет</EmptyTitle>
          <EmptyDescription>Данные появятся после первого заказа клиента.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Номер</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead className="text-right">Оплачено</TableHead>
            <TableHead className="text-right">Остаток</TableHead>
            <TableHead>К сроку</TableHead>
            <TableHead>Связь</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="font-medium">{order.number}</TableCell>
              <TableCell>
                <Badge variant={order.status === "Отменен" ? "destructive" : "outline"}>{order.status}</Badge>
              </TableCell>
              <TableCell className="text-right font-semibold">{formatMoney(order.total)}</TableCell>
              <TableCell className="text-right">{formatMoney(order.paid)}</TableCell>
              <TableCell className="text-right font-semibold">
                {formatMoney(Math.max(0, order.total - order.paid))}
              </TableCell>
              <TableCell>{dateTime(order.dueAt)}</TableCell>
              <TableCell>
                {order.dealId ? (
                  <Button size="sm" variant="outline" render={<Link href={`/deals/${order.dealId}`} />}>
                    Сделка #{order.dealId}
                  </Button>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ShowAllToggle
        showAll={showAll}
        total={orders.length}
        cap={HISTORY_CAP}
        onToggle={() => setShowAll((value) => !value)}
        forms={orderForms}
      />
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
          <EmptyTitle>Продаж пока нет</EmptyTitle>
          <EmptyDescription>Данные появятся после продажи на кассе.</EmptyDescription>
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
            <TableRow key={sale.id}>
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
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
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
    const aTime = new Date(a.createdAt).getTime()
    const bTime = new Date(b.createdAt).getTime()
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
  })
}

function pluralWord(count: number, forms: [string, string, string]) {
  return pluralize(count, forms).replace(/^\d+\s/, "")
}
