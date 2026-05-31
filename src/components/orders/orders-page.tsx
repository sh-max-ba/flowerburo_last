"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon } from "lucide-react"
import { toast } from "sonner"
import { cancelOrderAction, markOrderReadyAction, startOrderWorkAction } from "@/app/actions"
import type { Order } from "@/lib/db"
import { deliveryTypeLabel } from "@/lib/labels"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  OrderBadge,
  OrderCalendarView,
  OrderComposition,
  OrdersActivityRefresh,
  OrderToolbar,
  type OrderSortMode,
  type OrderViewMode,
  addDays,
  dateTime,
  sortWorkOrders,
  startOfLocalDay,
} from "@/components/orders/order-shared"

type Result = Awaited<ReturnType<typeof startOrderWorkAction>>

export function OrdersPage({ orders: allOrders }: { orders: Order[] }) {
  const router = useRouter()
  const [sortMode, setSortMode] = useState<OrderSortMode>("default")
  const [viewMode, setViewMode] = useState<OrderViewMode>("list")
  const [weekStart, setWeekStart] = useState(() => startOfLocalDay(new Date()))
  const [isPending, startTransition] = useTransition()

  const orders = sortWorkOrders(
    allOrders.filter((order) => ["Новый", "В работе", "Готов"].includes(order.status)),
    sortMode
  )

  function run(action: () => Promise<Result>) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        for (const message of result.messages ?? [result.message]) {
          toast.success(message)
        }
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <>
      <OrdersActivityRefresh />
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <OrderToolbar
            sortMode={sortMode}
            viewMode={viewMode}
            onSortModeChange={setSortMode}
            onViewModeChange={setViewMode}
          />
        </div>
        <Card className="rounded-2xl border bg-white">
          <CardContent>
            {!orders.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Заказов для флористов нет</EmptyTitle>
                  <EmptyDescription>Новые заказы появятся после создания на кассе.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : viewMode === "calendar" ? (
              <OrderCalendarView
                orders={orders}
                weekStart={weekStart}
                showMoney={false}
                onToday={() => setWeekStart(startOfLocalDay(new Date()))}
                onPreviousWeek={() => setWeekStart((current) => addDays(current, -7))}
                onNextWeek={() => setWeekStart((current) => addDays(current, 7))}
                onOpenOrder={() => setViewMode("list")}
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {orders.map((order) => (
                  <WorkOrderCard
                    key={order.id}
                    order={order}
                    pending={isPending}
                    onStart={(target) => run(() => startOrderWorkAction(target.id))}
                    onReady={(target) => run(() => markOrderReadyAction(target.id))}
                    onCancel={(target) => run(() => cancelOrderAction(target.id))}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function WorkOrderCard({
  order,
  pending,
  onStart,
  onReady,
  onCancel,
}: {
  order: Order
  pending: boolean
  onStart: (order: Order) => void
  onReady: (order: Order) => void
  onCancel: (order: Order) => void
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">{order.number || `#${order.id}`}</div>
          <div className="text-2xl font-semibold">{order.dueAt ? dateTime(order.dueAt) : "Без срока"}</div>
        </div>
        <OrderBadge status={order.status} />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <div className="font-medium">{order.customer}</div>
        <div>{deliveryTypeLabel(order.deliveryType)}</div>
        {order.recipientPhone && <div>Получатель: {order.recipientPhone}</div>}
        {order.address && <div>{order.address}</div>}
        {order.note && <div className="text-muted-foreground">{order.note}</div>}
      </div>
      <OrderComposition items={order.items} compact />
      {(order.status === "Готов" || order.status === "Передан курьеру") && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Букет уже собран, склад автоматически не восстанавливается</AlertTitle>
        </Alert>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {order.status === "Новый" && (
          <Button size="sm" onClick={() => onStart(order)} disabled={pending}>
            В работу
          </Button>
        )}
        {["Новый", "В работе"].includes(order.status) && (
          <Button size="sm" variant="default" onClick={() => onReady(order)} disabled={pending}>
            Букет готов
          </Button>
        )}
        {["Новый", "В работе", "Готов"].includes(order.status) && (
          <Button size="sm" variant="outline" onClick={() => onCancel(order)} disabled={pending}>
            Отменить
          </Button>
        )}
      </div>
    </div>
  )
}
