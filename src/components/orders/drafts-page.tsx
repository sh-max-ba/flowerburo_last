"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"
import { deleteDraftOrderAction, finalizeOrderDraftAction } from "@/app/actions"
import type { BouquetTemplate, DraftOrderView, Order, Product } from "@/lib/db"
import { getPaymentMethodLabel } from "@/lib/labels"
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
import { OrdersActivityRefresh, OrderStatusBadge } from "@/components/orders/order-shared"
import { OrderEditSheet } from "@/components/orders/order-edit-sheet"

type Result = Awaited<ReturnType<typeof finalizeOrderDraftAction>>

// Страница черновиков заказов (/orders/drafts, owner/manager). Черновик — несогласованный заказ:
// без резерва склада и без кассовых проводок. Предоплата в черновике — НАМЕРЕНИЕ (сумма + способ):
// деньги проводятся в кассу только при отправке в работу, в текущую на тот момент смену.
export function DraftsPage({
  drafts,
  products,
  bouquets,
  hasOpenShift,
}: {
  drafts: DraftOrderView[]
  products: Product[]
  bouquets: BouquetTemplate[]
  hasOpenShift: boolean
}) {
  const router = useRouter()
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [, startTransition] = useTransition()

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
      <Card className="rounded-2xl border bg-white">
        <CardContent>
          {!drafts.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Черновиков нет</EmptyTitle>
                <EmptyDescription>
                  Черновик можно сохранить на кассе в окне «Создать заказ» кнопкой «Сохранить черновик».
                  Предоплата и способ оплаты, указанные в черновике, проводятся в кассу при отправке в работу.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {drafts.map((draft) => (
                <DraftOrderCard
                  key={draft.id}
                  draft={draft}
                  pendingAction={pendingOrderId === draft.id}
                  hasOpenShift={hasOpenShift}
                  onFinalize={(id, priceMode) => run(id, () => finalizeOrderDraftAction(id, priceMode))}
                  onDelete={(id) => run(id, () => deleteDraftOrderAction(id))}
                  onEdit={setEditingOrder}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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

function DraftOrderCard({
  draft,
  pendingAction,
  hasOpenShift,
  onFinalize,
  onDelete,
  onEdit,
}: {
  draft: DraftOrderView
  pendingAction: boolean
  hasOpenShift: boolean
  onFinalize: (id: number, priceMode: "keep" | "current") => void
  onDelete: (id: number) => void
  onEdit: (order: Order) => void
}) {
  const itemsCount = draft.items.length
  const hasPriceChanges = draft.priceChanges.length > 0
  const hasPrepaid = draft.prepaid > 0
  // Предоплата проводится в кассу при отправке в работу — для этого нужна открытая смена.
  const prepaidNeedsShift = hasPrepaid && !hasOpenShift
  const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{draft.number || `#${draft.id}`}</span>
            <OrderStatusBadge status="Черновик" />
          </div>
          <p className="text-sm text-muted-foreground">{draft.customer || "Без имени"}</p>
        </div>
        <div className="text-right text-sm">
          <div className="font-medium tabular-nums">{money(draft.total)}</div>
          <div className="text-muted-foreground">{itemsCount ? `${itemsCount} поз.` : "без позиций"}</div>
        </div>
      </div>

      {hasPrepaid && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
            Предоплата: {money(draft.prepaid)} · {getPaymentMethodLabel(draft.draftPrepaidMethod || "cash")}
          </Badge>
          <span className="text-xs text-muted-foreground">не проведена — уйдёт в кассу при отправке в работу</span>
        </div>
      )}

      {hasPriceChanges && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Цены некоторых позиций изменились с момента сохранения</AlertTitle>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {hasPriceChanges ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button size="sm" className="flex-1" disabled={pendingAction || !itemsCount || prepaidNeedsShift} />}
            >
              Отправить в работу
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Цены изменились</AlertDialogTitle>
                <AlertDialogDescription>С момента сохранения изменились цены позиций:</AlertDialogDescription>
              </AlertDialogHeader>
              <ul className="space-y-1 text-sm">
                {draft.priceChanges.map((change) => (
                  <li key={change.name} className="flex justify-between gap-2">
                    <span className="truncate">{change.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {money(change.oldPrice)} → {money(change.newPrice)}
                    </span>
                  </li>
                ))}
              </ul>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={() => onFinalize(draft.id, "keep")}>
                  Оставить цены черновика
                </AlertDialogAction>
                <AlertDialogAction onClick={() => onFinalize(draft.id, "current")}>
                  Обновить по текущим
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            size="sm"
            className="flex-1"
            disabled={pendingAction || !itemsCount || prepaidNeedsShift}
            onClick={() => onFinalize(draft.id, "keep")}
          >
            Отправить в работу
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={pendingAction} onClick={() => onEdit(draft)}>
          <PencilIcon data-icon="inline-start" />
          Изменить
        </Button>
        <AlertDialog>
          <AlertDialogTrigger render={<Button size="sm" variant="ghost" disabled={pendingAction} />}>
            Удалить
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить черновик?</AlertDialogTitle>
              <AlertDialogDescription>
                Черновик {draft.number || `#${draft.id}`} будет удалён без возможности восстановления.
                {hasPrepaid
                  ? " Записанная предоплата в кассу не проводилась — возвращать деньги через кассу не нужно."
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(draft.id)}>Удалить</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {!itemsCount && (
        <p className="text-xs text-muted-foreground">Добавьте позиции, чтобы отправить заказ в работу.</p>
      )}
      {prepaidNeedsShift && itemsCount > 0 && (
        <p className="text-xs text-amber-700">
          В черновике есть предоплата — чтобы провести её в кассу и отправить заказ в работу, откройте смену.
        </p>
      )}
    </div>
  )
}
