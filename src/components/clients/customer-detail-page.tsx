"use client"

import type React from "react"
import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ExternalLinkIcon } from "lucide-react"
import { toast } from "sonner"
import { updateCustomerAction } from "@/app/actions"
import type { Customer, Deal } from "@/lib/crm"
import type { Order, Sale } from "@/lib/db"
import { getPaymentMethodLabel } from "@/lib/labels"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CustomerFields, sourceLabel } from "@/components/clients/customers-page"

type ActionResult = Awaited<ReturnType<typeof updateCustomerAction>>

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

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result: ActionResult = await updateCustomerAction(formData)
      if (result.ok) {
        toast.success(result.message)
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
              <CardTitle className="truncate font-semibold text-zinc-950">Карточка клиента</CardTitle>
              <CardDescription className="text-zinc-500">{customer.phone || "Телефон не указан"}</CardDescription>
            </div>
            <Badge className="bg-emerald-100 text-emerald-900">Скидка {customer.defaultDiscountPercent}%</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
            <InfoLine label="Источник" value={sourceLabel(customer.source)} />
            <InfoLine label="Комментарий" value={customer.comment || "Нет комментария"} />
          </div>
          <form onSubmit={submit}>
            <input type="hidden" name="customerId" value={customer.id} />
            <CustomerFields customer={customer} />
            <Button type="submit" disabled={pending} className="bg-zinc-950 text-white hover:bg-zinc-800">
              Сохранить
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-col gap-5">
        <Card className="rounded-2xl border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle className="font-semibold text-zinc-950">Сделки</CardTitle>
            <CardDescription className="text-zinc-500">{deals.length} найдено</CardDescription>
          </CardHeader>
          <CardContent>
            {deals.length ? (
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
                  {deals.map((deal) => (
                    <TableRow key={deal.id}>
                      <TableCell className="font-medium">{deal.number}</TableCell>
                      <TableCell>{deal.title || deal.customerName}</TableCell>
                      <TableCell>
                        <Badge className="bg-slate-100 text-slate-900">{deal.stageName || "-"}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatMoney(deal.total)}</TableCell>
                      <TableCell className="text-right">{formatMoney(deal.paid)}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoney(Math.max(0, deal.total - deal.paid))}
                      </TableCell>
                      <TableCell>{dateOnly(deal.createdAt)}</TableCell>
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
            ) : (
              <Empty className="min-h-40">
                <EmptyHeader>
                  <EmptyTitle>Сделок пока нет</EmptyTitle>
                  <EmptyDescription>Данные появятся после первой сделки клиента.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle className="font-semibold text-zinc-950">Заказы</CardTitle>
            <CardDescription className="text-zinc-500">{orders.length} найдено</CardDescription>
          </CardHeader>
          <CardContent>
            {orders.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Номер</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead className="text-right">Оплачено</TableHead>
                    <TableHead>К сроку</TableHead>
                    <TableHead>Связь</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.number}</TableCell>
                      <TableCell>
                        <Badge variant={order.status === "Отменен" ? "destructive" : "outline"}>{order.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatMoney(order.total)}</TableCell>
                      <TableCell className="text-right">{formatMoney(order.paid)}</TableCell>
                      <TableCell>{dateOnly(order.dueAt)}</TableCell>
                      <TableCell>
                        {order.dealId ? (
                          <Button size="sm" variant="outline" render={<Link href={`/deals/${order.dealId}`} />}>
                            Сделка #{order.dealId}
                          </Button>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty className="min-h-40">
                <EmptyHeader>
                  <EmptyTitle>Связанных заказов нет</EmptyTitle>
                  <EmptyDescription>Данные появятся после первого заказа клиента.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle className="font-semibold text-zinc-950">Продажи</CardTitle>
            <CardDescription className="text-zinc-500">{sales.length} найдено</CardDescription>
          </CardHeader>
          <CardContent>
            {sales.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Способ оплаты</TableHead>
                    <TableHead>Дата</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-medium">#{sale.id}</TableCell>
                      <TableCell className="text-right font-semibold">{formatMoney(sale.total)}</TableCell>
                      <TableCell>{getPaymentMethodLabel(sale.paymentMethod)}</TableCell>
                      <TableCell>{dateOnly(sale.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty className="min-h-40">
                <EmptyHeader>
                  <EmptyTitle>Продаж пока нет</EmptyTitle>
                  <EmptyDescription>Данные появятся после продажи на кассе.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>
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

function dateOnly(value: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
