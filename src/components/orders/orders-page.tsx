"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"
import { cancelOrderAction, markOrderReadyAction, startOrderWorkAction } from "@/app/actions"
import type { BouquetTemplate, Order, OrderStatus, Product } from "@/lib/db"
import { deliveryTypeLabel } from "@/lib/labels"
import { Alert, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  OrderComposition,
  OrderDealLink,
  OrdersActivityRefresh,
  OrderSourceBadge,
  OrderStatusBadge,
  OrderToolbar,
  OrderUrgencyBadge,
  OrderCalendarView,
  Spinner,
  orderUrgency,
  type OrderSortMode,
  type OrderViewMode,
  addDays,
  dateTimeLong,
  sortWorkOrders,
  startOfLocalDay,
} from "@/components/orders/order-shared"
import { OrderEditSheet } from "@/components/orders/order-edit-sheet"
import { cn } from "@/lib/utils"

type Result = Awaited<ReturnType<typeof startOrderWorkAction>>

type WorkStatusFilter = "all" | "Новый" | "В работе" | "Готов"

const workStatusFilters: Array<{ value: WorkStatusFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "Новый", label: "Новые" },
  { value: "В работе", label: "В работе" },
  { value: "Готов", label: "Готовые" },
]

const workQueueStatuses: OrderStatus[] = ["Новый", "В работе", "Готов"]

// Крупная тач-зона для действий на планшете: высота 48px, растягиваются и переносятся,
// между кнопками достаточный отступ (gap-3 на контейнере), чтобы не промахиваться пальцем.
const touchButtonClass = "h-12 min-w-32 flex-1 px-5 text-base"

export function OrdersPage({
  orders: allOrders,
  products,
  bouquets,
  hasOpenShift,
}: {
  orders: Order[]
  products: Product[]
  bouquets: BouquetTemplate[]
  // Когда смена не открыта, в пустом состоянии показываем подсказку перейти к сменам.
  hasOpenShift?: boolean
}) {
  const router = useRouter()
  const [sortMode, setSortMode] = useState<OrderSortMode>("default")
  const [viewMode, setViewMode] = useState<OrderViewMode>("list")
  const [statusFilter, setStatusFilter] = useState<WorkStatusFilter>("all")
  const [weekStart, setWeekStart] = useState(() => startOfLocalDay(new Date()))
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [, startTransition] = useTransition()

  const queueOrders = useMemo(
    () => allOrders.filter((order) => workQueueStatuses.includes(order.status)),
    [allOrders]
  )

  const counts = useMemo(() => {
    const result: Record<WorkStatusFilter, number> = { all: queueOrders.length, "Новый": 0, "В работе": 0, "Готов": 0 }
    for (const order of queueOrders) {
      if (order.status === "Новый" || order.status === "В работе" || order.status === "Готов") {
        result[order.status] += 1
      }
    }
    return result
  }, [queueOrders])

  const orders = useMemo(() => {
    const filtered = statusFilter === "all" ? queueOrders : queueOrders.filter((order) => order.status === statusFilter)
    return sortWorkOrders(filtered, sortMode)
  }, [queueOrders, statusFilter, sortMode])

  function run(orderId: number, action: () => Promise<Result>) {
    setPendingOrderId(orderId)
    startTransition(async () => {
      try {
        const result = await action()
        if (result.ok) {
          for (const message of result.messages ?? [result.message]) {
            toast.success(message)
          }
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter((value ?? "all") as WorkStatusFilter)}>
            <TabsList>
              {workStatusFilters.map((filter) => (
                <TabsTrigger key={filter.value} value={filter.value}>
                  {filter.label}
                  <span className="ml-1.5 text-muted-foreground">{counts[filter.value]}</span>
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
        <Card className="rounded-2xl border bg-white">
          <CardContent>
            {!orders.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {statusFilter === "all"
                      ? "Заказов для флористов нет"
                      : "По этому фильтру заказов нет"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {statusFilter !== "all"
                      ? "Сбросьте фильтр, чтобы увидеть все заказы в работе."
                      : hasOpenShift === false
                        ? "Новые заказы появятся после создания на кассе. Сейчас смена не открыта — откройте её, чтобы работать с кассой."
                        : "Новые заказы появятся после создания на кассе."}
                  </EmptyDescription>
                </EmptyHeader>
                {statusFilter !== "all" ? (
                  <Button variant="outline" size="sm" onClick={() => setStatusFilter("all")}>
                    Показать все
                  </Button>
                ) : (
                  hasOpenShift === false && (
                    <Button variant="outline" size="sm" render={<Link href="/shifts" />}>
                      Перейти к сменам
                    </Button>
                  )
                )}
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
                    pendingAction={pendingOrderId === order.id}
                    onStart={(target) => run(target.id, () => startOrderWorkAction(target.id))}
                    onReady={(target) => run(target.id, () => markOrderReadyAction(target.id))}
                    onCancel={(target) => run(target.id, () => cancelOrderAction(target.id))}
                    onEdit={setEditingOrder}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {editingOrder && (
        <OrderEditSheet
          key={editingOrder.id}
          order={editingOrder}
          products={products}
          bouquets={bouquets}
          open={Boolean(editingOrder)}
          onOpenChange={(open) => {
            if (!open) {
              setEditingOrder(null)
            }
          }}
        />
      )}
    </>
  )
}

function WorkOrderCard({
  order,
  pendingAction,
  onStart,
  onReady,
  onCancel,
  onEdit,
}: {
  order: Order
  pendingAction: boolean
  onStart: (order: Order) => void
  onReady: (order: Order) => void
  onCancel: (order: Order) => void
  onEdit: (order: Order) => void
}) {
  const urgency = orderUrgency(order)
  // Иерархия действий по статусу: главное действие — primary, остальные — вторичны.
  const readyIsPrimary = order.status === "В работе"

  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border bg-white p-4", urgency.cardClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{order.number || `#${order.id}`}</div>
          <div className="text-2xl font-semibold">{order.dueAt ? dateTimeLong(order.dueAt) : "Без срока"}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <OrderStatusBadge status={order.status} />
          <OrderUrgencyBadge order={order} />
          {order.isModified && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
              Изменён
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1 text-base">
        <div className="text-lg font-semibold">{order.customer}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span>{deliveryTypeLabel(order.deliveryType)}</span>
          <OrderSourceBadge source={order.source} />
        </div>
        {order.recipientPhone && <div>Получатель: {order.recipientPhone}</div>}
        {order.address && <div>{order.address}</div>}
        {order.note && <div className="text-muted-foreground">{order.note}</div>}
        <OrderDealLink dealId={order.dealId} className="mt-0.5" />
      </div>
      <OrderComposition items={order.items} size="lg" />
      {(order.status === "Готов" || order.status === "Передан курьеру") && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Букет уже собран, склад автоматически не восстанавливается</AlertTitle>
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        {order.status === "Новый" && (
          <Button size="lg" className={touchButtonClass} onClick={() => onStart(order)} disabled={pendingAction}>
            {pendingAction && <Spinner className="size-4" />}
            В работу
          </Button>
        )}
        {(order.status === "Новый" || order.status === "В работе") && (
          <ReadyConfirmButton
            order={order}
            primary={readyIsPrimary}
            pending={pendingAction}
            onConfirm={() => onReady(order)}
          />
        )}
        {(order.status === "Новый" || order.status === "В работе") && (
          <Button
            size="lg"
            variant="outline"
            className={touchButtonClass}
            onClick={() => onEdit(order)}
            disabled={pendingAction}
          >
            <PencilIcon data-icon="inline-start" />
            Изменить
          </Button>
        )}
        {workQueueStatuses.includes(order.status) && (
          <CancelConfirmButton order={order} pending={pendingAction} onConfirm={() => onCancel(order)} />
        )}
      </div>
    </div>
  )
}

// P0: «Букет готов» необратимо списывает склад — требуем подтверждение.
function ReadyConfirmButton({
  order,
  primary,
  pending,
  onConfirm,
}: {
  order: Order
  primary: boolean
  pending: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            size="lg"
            variant={primary ? "default" : "outline"}
            className={touchButtonClass}
            disabled={pending}
          />
        }
      >
        {pending && <Spinner className="size-4" />}
        Букет готов
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Отметить букет готовым?</AlertDialogTitle>
          <AlertDialogDescription>
            Заказ {order.number || `#${order.id}`} перейдёт в статус «Готов», а склад спишется автоматически.
            Отменить списание потом нельзя.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Назад</AlertDialogCancel>
          <AlertDialogAction
            render={<Button />}
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            Букет готов
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// P0: «Отменить» — деструктивное действие (откат брони/склада), требуем подтверждение.
function CancelConfirmButton({
  order,
  pending,
  onConfirm,
}: {
  order: Order
  pending: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button size="lg" variant="destructive" className={touchButtonClass} disabled={pending} />}
      >
        Отменить
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Отменить заказ?</AlertDialogTitle>
          <AlertDialogDescription>
            Заказ {order.number || `#${order.id}`} будет отменён, бронь и списание со склада откатятся.
            Действие необратимо.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Назад</AlertDialogCancel>
          <AlertDialogAction
            render={<Button variant="destructive" />}
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            Отменить заказ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
