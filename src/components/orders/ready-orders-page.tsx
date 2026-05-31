"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon } from "lucide-react"
import { toast } from "sonner"
import {
  closeDeliveredOrderAction,
  completePickupOrderAction,
  handOrderToCourierAction,
} from "@/app/actions"
import type { DashboardData, Order } from "@/lib/db"
import { deliveryTypeLabel, paymentMethodOptions } from "@/lib/labels"
import { formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Info,
  OrderCalendarView,
  OrderComposition,
  OrdersActivityRefresh,
  OrderToolbar,
  ReadyStatusBadge,
  type OrderSortMode,
  type OrderViewMode,
  addDays,
  dateTime,
  sortReadyOrders,
  startOfLocalDay,
} from "@/components/orders/order-shared"

type OpenShift = DashboardData["stats"]["openShift"]
type Result = Awaited<ReturnType<typeof completePickupOrderAction>>

export function ReadyOrdersPage({ orders: allOrders, openShift }: { orders: Order[]; openShift: OpenShift }) {
  const router = useRouter()
  const [sortMode, setSortMode] = useState<OrderSortMode>("default")
  const [viewMode, setViewMode] = useState<OrderViewMode>("list")
  const [weekStart, setWeekStart] = useState(() => startOfLocalDay(new Date()))
  const [handoverOrder, setHandoverOrder] = useState<Order | null>(null)
  const [isPending, startTransition] = useTransition()

  const orders = sortReadyOrders(
    allOrders.filter((order) => ["Готов", "Передан курьеру"].includes(order.status)),
    sortMode
  )
  const actionCount = orders.filter((order) => order.status === "Готов").length

  function run(action: () => Promise<Result>, after?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        for (const message of result.messages ?? [result.message]) {
          toast.success(message)
        }
        after?.()
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <>
      <OrdersActivityRefresh />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Badge className="w-fit bg-amber-100 text-amber-900 hover:bg-amber-100">
            {actionCount} ожидают действия
          </Badge>
          <OrderToolbar
            sortMode={sortMode}
            viewMode={viewMode}
            onSortModeChange={setSortMode}
            onViewModeChange={setViewMode}
          />
        </div>

        {!orders.length ? (
          <Empty className="min-h-36 rounded-2xl border bg-white py-6">
            <EmptyHeader>
              <EmptyTitle>Готовых заказов пока нет</EmptyTitle>
              <EmptyDescription>Заказы появятся здесь после отметки “Букет готов”.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : viewMode === "calendar" ? (
          <OrderCalendarView
            orders={orders}
            weekStart={weekStart}
            showMoney
            onToday={() => setWeekStart(startOfLocalDay(new Date()))}
            onPreviousWeek={() => setWeekStart((current) => addDays(current, -7))}
            onNextWeek={() => setWeekStart((current) => addDays(current, 7))}
            onOpenOrder={() => setViewMode("list")}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {orders.map((order) => (
              <ReadyOrderCard
                key={order.id}
                order={order}
                shiftOpen={Boolean(openShift)}
                pending={isPending}
                onPickup={(target, event) => {
                  event.preventDefault()
                  const formData = new FormData(event.currentTarget)
                  run(() => completePickupOrderAction(target.id, formData))
                }}
                onHandover={setHandoverOrder}
                onCloseDelivery={(target) => run(() => closeDeliveredOrderAction(target.id))}
              />
            ))}
          </div>
        )}
      </div>

      <CourierSheet
        order={handoverOrder}
        openShift={openShift}
        pending={isPending}
        onOpenChange={(open) => !open && setHandoverOrder(null)}
        onSubmit={(event, order) => {
          event.preventDefault()
          const formData = new FormData(event.currentTarget)
          run(() => handOrderToCourierAction(order.id, formData), () => setHandoverOrder(null))
        }}
      />
    </>
  )
}

function ReadyOrderCard({
  order,
  shiftOpen,
  pending,
  onPickup,
  onHandover,
  onCloseDelivery,
}: {
  order: Order
  shiftOpen: boolean
  pending: boolean
  onPickup: (order: Order, event: React.FormEvent<HTMLFormElement>) => void
  onHandover: (order: Order) => void
  onCloseDelivery: (order: Order) => void
}) {
  const balance = order.total - order.paid
  const needsPayment = balance > 0

  return (
    <Card className="min-w-0 rounded-2xl border bg-white">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{order.number || `#${order.id}`}</CardTitle>
            <CardDescription className="truncate">{order.customer || "Клиент не указан"}</CardDescription>
          </div>
          <ReadyStatusBadge status={order.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {balance <= 0 ? (
            <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Сумма закрыта</Badge>
          ) : (
            <Badge
              className={
                balance > order.total / 2
                  ? "bg-red-100 text-red-900 hover:bg-red-100"
                  : "bg-amber-100 text-amber-900 hover:bg-amber-100"
              }
            >
              Остаток {formatMoney(balance)}
            </Badge>
          )}
          {order.deliveryPayoutPaid ? (
            <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Курьер оплачен</Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Курьер не оплачен</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid gap-3 text-sm">
          <Info label="Телефон" value={order.phone || "не указан"} />
          {order.recipientPhone && <Info label="Номер получателя" value={order.recipientPhone} />}
          <Info label="Тип" value={deliveryTypeLabel(order.deliveryType)} />
          {order.deliveryType === "delivery" && <Info label="Адрес" value={order.address || "не указан"} />}
          <div className="grid grid-cols-2 gap-3">
            <Info label="К сроку" value={order.dueAt ? dateTime(order.dueAt) : "-"} />
            <Info label="Готов" value={order.readyAt ? dateTime(order.readyAt) : "-"} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border bg-muted/30 p-3 text-sm md:grid-cols-3">
          <Info label="До скидки" value={formatMoney(order.totalBeforeDiscount)} />
          <Info
            label="Скидка"
            value={formatMoney(order.itemsDiscountTotal + order.orderDiscountAmount)}
          />
          <Info label="Итого" value={formatMoney(order.total)} />
          <Info label="Оплачено" value={formatMoney(order.paid)} />
          <Info label="Остаток" value={formatMoney(balance)} />
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-2xl border bg-muted/30 p-3 text-sm">
          <Info label="Доставка" value={formatMoney(order.deliveryPrice)} />
          <Info label="Курьеру" value={formatMoney(order.courierPayout)} />
          <Info label="Выплата" value={order.deliveryPayoutPaid ? "выдана" : "не выдана"} />
        </div>

        <OrderComposition items={order.items} />

        <div className="mt-auto flex flex-col gap-2 border-t pt-3">
          {order.deliveryType === "pickup" && order.status === "Готов" && (
            <form onSubmit={(event) => onPickup(order, event)} className="flex flex-col gap-2">
              {needsPayment && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`pickupAmount-${order.id}`}>Доплата</FieldLabel>
                    <Input
                      id={`pickupAmount-${order.id}`}
                      name="paymentAmount"
                      type="number"
                      step="0.01"
                      defaultValue={balance}
                      disabled={!shiftOpen}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`pickupMethod-${order.id}`}>Оплата</FieldLabel>
                    <select
                      id={`pickupMethod-${order.id}`}
                      name="paymentMethod"
                      className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                      defaultValue="cash"
                      disabled={!shiftOpen}
                    >
                      {paymentMethodOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              <Button type="submit" disabled={pending || (needsPayment && !shiftOpen)}>
                Выдать клиенту
              </Button>
            </form>
          )}
          {order.deliveryType === "delivery" && order.status === "Готов" && (
            <Button onClick={() => onHandover(order)} disabled={pending}>
              Передать курьеру
            </Button>
          )}
          {order.status === "Передан курьеру" && (
            <Button onClick={() => onCloseDelivery(order)} disabled={pending}>
              Доставлен / Закрыть
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function CourierSheet({
  order,
  openShift,
  pending,
  onOpenChange,
  onSubmit,
}: {
  order: Order | null
  openShift: OpenShift
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, order: Order) => void
}) {
  const balance = order ? order.total - order.paid : 0
  const needsCashOperation = balance > 0 || Boolean(order && order.courierPayout > 0 && !order.deliveryPayoutPaid)

  return (
    <Sheet open={Boolean(order)} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Передача курьеру</SheetTitle>
          <SheetDescription>Доплата и выдача курьеру проходят через открытую смену.</SheetDescription>
        </SheetHeader>
        {order && (
          <form onSubmit={(event) => onSubmit(event, order)} className="flex flex-1 flex-col">
            <div className="px-4">
              <FieldGroup>
                {needsCashOperation && !openShift && (
                  <Alert>
                    <AlertTriangleIcon />
                    <AlertTitle>Откройте смену для кассовых операций</AlertTitle>
                    <AlertDescription>Нужна открытая смена для доплаты или выдачи курьеру.</AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
                  <Info label="До скидки" value={formatMoney(order.totalBeforeDiscount)} />
                  <Info
                    label="Скидка"
                    value={formatMoney(order.itemsDiscountTotal + order.orderDiscountAmount)}
                  />
                  <Info label="Итого" value={formatMoney(order.total)} />
                  <Info label="Оплачено" value={formatMoney(order.paid)} />
                  <Info label="Остаток" value={formatMoney(balance)} />
                  <Info label="Доставка" value={formatMoney(order.deliveryPrice)} />
                  <Info label="Курьеру" value={formatMoney(order.courierPayout)} />
                  <Info label="Оплата" value={balance <= 0 ? "Сумма закрыта" : `Остаток: ${formatMoney(balance)}`} />
                </div>
                {balance > 0 && (
                  <FieldSet>
                    <FieldLegend>Принять доплату</FieldLegend>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="paymentAmount">Сумма</FieldLabel>
                        <Input id="paymentAmount" name="paymentAmount" type="number" step="0.01" defaultValue={balance} />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="paymentMethod">Способ оплаты</FieldLabel>
                        <select
                          id="paymentMethod"
                          name="paymentMethod"
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                          defaultValue="cash"
                        >
                          {paymentMethodOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  </FieldSet>
                )}
                <FieldSet>
                  <FieldLegend>Курьер</FieldLegend>
                  <Field>
                    <FieldLabel htmlFor="courierName">Имя курьера</FieldLabel>
                    <Input id="courierName" name="courierName" defaultValue={order.courierName} />
                  </Field>
                  {order.deliveryPayoutPaid ? (
                    <Badge variant="outline">Курьер оплачен</Badge>
                  ) : order.courierPayout > 0 ? (
                    <Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="payCourier" />
                        Выдать курьеру из кассы: {formatMoney(order.courierPayout)}
                      </label>
                    </Field>
                  ) : (
                    <FieldDescription>Выплата курьеру не указана.</FieldDescription>
                  )}
                </FieldSet>
              </FieldGroup>
            </div>
            <SheetFooter>
              <Button type="submit" disabled={pending || (needsCashOperation && !openShift)}>
                Передать курьеру
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
