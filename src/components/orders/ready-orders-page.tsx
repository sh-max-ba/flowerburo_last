"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, ChevronDownIcon } from "lucide-react"
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Info,
  OrderCalendarView,
  OrderComposition,
  OrderDealLink,
  OrdersActivityRefresh,
  OrderSourceBadge,
  OrderStatusBadge,
  OrderToolbar,
  Spinner,
  type OrderSortMode,
  type OrderViewMode,
  addDays,
  dateTime,
  sortReadyOrders,
  startOfLocalDay,
} from "@/components/orders/order-shared"

type OpenShift = DashboardData["stats"]["openShift"]
type Result = Awaited<ReturnType<typeof completePickupOrderAction>>

type ReadyStatusFilter = "pending" | "Передан курьеру" | "all"

export function ReadyOrdersPage({ orders: allOrders, openShift }: { orders: Order[]; openShift: OpenShift }) {
  const router = useRouter()
  const [sortMode, setSortMode] = useState<OrderSortMode>("default")
  const [viewMode, setViewMode] = useState<OrderViewMode>("list")
  const [statusFilter, setStatusFilter] = useState<ReadyStatusFilter>("pending")
  const [weekStart, setWeekStart] = useState(() => startOfLocalDay(new Date()))
  const [handoverOrder, setHandoverOrder] = useState<Order | null>(null)
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  const baseOrders = useMemo(
    () => allOrders.filter((order) => ["Готов", "Передан курьеру"].includes(order.status)),
    [allOrders]
  )

  const counts = useMemo(() => {
    let pending = 0
    let courier = 0
    for (const order of baseOrders) {
      if (order.status === "Готов") {
        pending += 1
      } else if (order.status === "Передан курьеру") {
        courier += 1
      }
    }
    return { pending, courier, all: baseOrders.length }
  }, [baseOrders])

  const filters: Array<{ value: ReadyStatusFilter; label: string; count: number }> = [
    { value: "pending", label: "Ожидают действия", count: counts.pending },
    { value: "Передан курьеру", label: "Передан курьеру", count: counts.courier },
    { value: "all", label: "Все", count: counts.all },
  ]

  const orders = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? baseOrders
        : statusFilter === "pending"
          ? baseOrders.filter((order) => order.status === "Готов")
          : baseOrders.filter((order) => order.status === "Передан курьеру")
    return sortReadyOrders(filtered, sortMode)
  }, [baseOrders, statusFilter, sortMode])

  function run(orderId: number, action: () => Promise<Result>, after?: () => void) {
    setPendingOrderId(orderId)
    startTransition(async () => {
      try {
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
      } finally {
        setPendingOrderId(null)
      }
    })
  }

  return (
    <>
      <OrdersActivityRefresh />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            value={statusFilter}
            onValueChange={(value) => setStatusFilter((value ?? "pending") as ReadyStatusFilter)}
          >
            <TabsList>
              {filters.map((filter) => (
                <TabsTrigger key={filter.value} value={filter.value}>
                  {filter.label}
                  <span className="ml-1.5 text-muted-foreground">{filter.count}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
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
              <EmptyTitle>
                {statusFilter === "pending" ? "Нет заказов, ожидающих действия" : "Готовых заказов пока нет"}
              </EmptyTitle>
              <EmptyDescription>
                {statusFilter === "pending"
                  ? "Здесь появятся заказы со статусом «Готов» — для выдачи или передачи курьеру."
                  : "Заказы появятся здесь после отметки «Букет готов»."}
              </EmptyDescription>
            </EmptyHeader>
            {statusFilter !== "all" && counts.all > 0 && (
              <Button variant="outline" size="sm" onClick={() => setStatusFilter("all")}>
                Показать все
              </Button>
            )}
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
                pendingAction={pendingOrderId === order.id}
                onPickup={(target, event) => {
                  event.preventDefault()
                  const formData = new FormData(event.currentTarget)
                  run(target.id, () => completePickupOrderAction(target.id, formData))
                }}
                onHandover={setHandoverOrder}
                onCloseDelivery={(target) => run(target.id, () => closeDeliveredOrderAction(target.id))}
              />
            ))}
          </div>
        )}
      </div>

      <CourierSheet
        order={handoverOrder}
        openShift={openShift}
        pending={handoverOrder ? pendingOrderId === handoverOrder.id : false}
        onOpenChange={(open) => !open && setHandoverOrder(null)}
        onSubmit={(event, order) => {
          event.preventDefault()
          const formData = new FormData(event.currentTarget)
          run(order.id, () => handOrderToCourierAction(order.id, formData), () => setHandoverOrder(null))
        }}
      />
    </>
  )
}

function ReadyOrderCard({
  order,
  shiftOpen,
  pendingAction,
  onPickup,
  onHandover,
  onCloseDelivery,
}: {
  order: Order
  shiftOpen: boolean
  pendingAction: boolean
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
            <CardTitle className="truncate text-base">{order.customer || "Клиент не указан"}</CardTitle>
            <CardDescription className="truncate">{order.number || `#${order.id}`}</CardDescription>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OrderSourceBadge source={order.source} />
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
          {order.deliveryType === "delivery" &&
            (order.deliveryPayoutPaid ? (
              <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Курьер оплачен</Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Курьер не оплачен</Badge>
            ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {/* Суть момента выдачи: тип/адрес, телефон, срок, остаток крупно. */}
        <div className="grid gap-2 text-sm">
          <Info label="Тип" value={deliveryTypeLabel(order.deliveryType)} />
          {order.deliveryType === "delivery" && <Info label="Адрес" value={order.address || "не указан"} />}
          <div className="grid grid-cols-2 gap-3">
            <Info label="Телефон" value={order.phone || "не указан"} />
            {order.recipientPhone ? (
              <Info label="Номер получателя" value={order.recipientPhone} />
            ) : (
              <Info label="К сроку" value={order.dueAt ? dateTime(order.dueAt) : "-"} />
            )}
          </div>
        </div>

        {needsPayment ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs text-amber-900/70">К доплате</div>
            <div className="text-2xl font-semibold text-amber-900">{formatMoney(balance)}</div>
          </div>
        ) : (
          <div className="rounded-2xl border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">К доплате</div>
            <div className="text-lg font-semibold text-emerald-700">Оплачено полностью</div>
          </div>
        )}

        {/* Полная финансовая разбивка убрана под раскрытие — деталь сделки, не момента выдачи. */}
        <details className="group rounded-2xl border bg-muted/30 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer items-center justify-between gap-2 p-3 text-sm font-medium text-muted-foreground select-none">
            Финансы и доставка
            <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-2 px-3 pb-3">
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <Info label="До скидки" value={formatMoney(order.totalBeforeDiscount)} />
              <Info label="Скидка" value={formatMoney(order.itemsDiscountTotal + order.orderDiscountAmount)} />
              <Info label="Итого" value={formatMoney(order.total)} />
              <Info label="Оплачено" value={formatMoney(order.paid)} />
              <Info label="Остаток" value={formatMoney(balance)} />
            </div>
            {order.deliveryType === "delivery" && (
              <div className="grid grid-cols-3 gap-2 border-t pt-2 text-sm">
                <Info label="Доставка" value={formatMoney(order.deliveryPrice)} />
                <Info label="Курьеру" value={formatMoney(order.courierPayout)} />
                <Info label="Выплата" value={order.deliveryPayoutPaid ? "выдана" : "не выдана"} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 border-t pt-2 text-sm">
              <Info label="К сроку" value={order.dueAt ? dateTime(order.dueAt) : "-"} />
              <Info label="Готов" value={order.readyAt ? dateTime(order.readyAt) : "-"} />
            </div>
          </div>
        </details>

        <OrderComposition items={order.items} compact />

        <OrderDealLink dealId={order.dealId} />

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
                      min="0"
                      max={balance}
                      step="0.01"
                      defaultValue={balance}
                      disabled={!shiftOpen}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`pickupMethod-${order.id}`}>Оплата</FieldLabel>
                    <Select name="paymentMethod" defaultValue="cash" disabled={!shiftOpen}>
                      <SelectTrigger id={`pickupMethod-${order.id}`} className="w-full" disabled={!shiftOpen}>
                        <SelectValue placeholder="Способ оплаты" />
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
                  </Field>
                </div>
              )}
              <Button type="submit" disabled={pendingAction || (needsPayment && !shiftOpen)}>
                {pendingAction && <Spinner className="size-4" />}
                Выдать клиенту
              </Button>
            </form>
          )}
          {order.deliveryType === "delivery" && order.status === "Готов" && (
            <Button onClick={() => onHandover(order)} disabled={pendingAction}>
              {pendingAction && <Spinner className="size-4" />}
              Передать курьеру
            </Button>
          )}
          {order.status === "Передан курьеру" && (
            <Button onClick={() => onCloseDelivery(order)} disabled={pendingAction}>
              {pendingAction && <Spinner className="size-4" />}
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
                        <Input
                          id="paymentAmount"
                          name="paymentAmount"
                          type="number"
                          min="0"
                          max={balance}
                          step="0.01"
                          defaultValue={balance}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="courierPaymentMethod">Способ оплаты</FieldLabel>
                        <Select name="paymentMethod" defaultValue="cash">
                          <SelectTrigger id="courierPaymentMethod" className="w-full">
                            <SelectValue placeholder="Способ оплаты" />
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
                {pending && <Spinner className="size-4" />}
                Передать курьеру
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
