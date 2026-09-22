"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"
import { deleteDraftOrderAction, finalizeOrderDraftAction } from "@/app/actions"
import type { BouquetTemplate, DraftOrderView, Order, Product } from "@/lib/db"
import { getPaymentMethodLabel } from "@/lib/labels"
import { formatMoney } from "@/lib/utils"
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
import { ScreenBody } from "@/components/screen-body"
import { ScreenHeader } from "@/components/screen-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { OrderImageStrip } from "@/components/orders/order-images"
import { OrdersActivityRefresh, OrderStatusBadge } from "@/components/orders/order-shared"
import { OrderEditSheet } from "@/components/orders/order-edit-sheet"

type Result = Awaited<ReturnType<typeof finalizeOrderDraftAction>>

// Страница черновиков заказов (/orders/drafts) — доступна всем ролям, включая флориста, и все
// могут править черновик, отправлять его в работу и удалять. Черновик — несогласованный заказ:
// без резерва склада и без кассовых проводок. Предоплата в черновике — НАМЕРЕНИЕ (сумма + способ):
// при отправке в работу она становится отложенной предоплатой заказа и проводится в кассу при
// выдаче заказа — в смену выдачи (открытая смена для отправки в работу не нужна).
export function DraftsPage({
  drafts,
  products,
  bouquets,
}: {
  drafts: DraftOrderView[]
  products: Product[]
  bouquets: BouquetTemplate[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [, startTransition] = useTransition()

  const normalizedSearch = search.trim().toLowerCase()
  const visibleDrafts = useMemo(
    () =>
      normalizedSearch
        ? drafts.filter((draft) =>
            [draft.number, String(draft.id), draft.customer, draft.phone, draft.recipientPhone, draft.address, draft.note, ...draft.items.map((item) => item.name)]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(normalizedSearch)
          )
        : drafts,
    [drafts, normalizedSearch]
  )

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
      <ScreenHeader
        title="Черновики"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Поиск по черновикам: номер, клиент, телефон, состав",
          inputProps: { "aria-label": "Поиск черновиков" },
        }}
      />
      <ScreenBody surface={!visibleDrafts.length}>
        {!visibleDrafts.length ? (
          <Empty className="min-h-56">
            <EmptyHeader>
              <EmptyTitle>{normalizedSearch ? "Ничего не найдено" : "Черновиков нет"}</EmptyTitle>
              <EmptyDescription>
                {normalizedSearch
                  ? "Измените запрос или очистите поиск."
                  : "Черновик можно сохранить на кассе в окне «Создать заказ» кнопкой «Сохранить черновик». Предоплата из черновика попадёт в кассу в день выдачи заказа."}
              </EmptyDescription>
            </EmptyHeader>
            {normalizedSearch ? (
              <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                Очистить поиск
              </Button>
            ) : null}
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))] gap-3 pb-2">
            {visibleDrafts.map((draft) => (
              <DraftOrderCard
                key={draft.id}
                draft={draft}
                pendingAction={pendingOrderId === draft.id}
                onFinalize={(id, priceMode) => run(id, () => finalizeOrderDraftAction(id, priceMode))}
                onDelete={(id) => run(id, () => deleteDraftOrderAction(id))}
                onEdit={setEditingOrder}
              />
            ))}
          </div>
        )}
      </ScreenBody>

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
  onFinalize,
  onDelete,
  onEdit,
}: {
  draft: DraftOrderView
  pendingAction: boolean
  onFinalize: (id: number, priceMode: "keep" | "current") => void
  onDelete: (id: number) => void
  onEdit: (order: Order) => void
}) {
  const itemsCount = draft.items.length
  const hasPriceChanges = draft.priceChanges.length > 0
  const hasPrepaid = draft.prepaid > 0
  const money = (value: number) => formatMoney(value)

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-background p-4 shadow-xs">
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
          <Badge variant="warning">
            Предоплата {money(draft.prepaid)} · {getPaymentMethodLabel(draft.draftPrepaidMethod || "cash")}
          </Badge>
          <span className="text-xs text-muted-foreground">попадёт в кассу при выдаче заказа</span>
        </div>
      )}

      {hasPriceChanges && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Цены некоторых позиций изменились с момента сохранения</AlertTitle>
        </Alert>
      )}

      <OrderImageStrip images={draft.images} size="sm" />

      <div className="flex flex-wrap gap-2">
        {hasPriceChanges ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button size="sm" className="flex-1" disabled={pendingAction || !itemsCount} />}
            >
              Отправить в работу
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Цены изменились</AlertDialogTitle>
                <AlertDialogDescription>
                  С момента сохранения цены некоторых позиций изменились. Выберите, какие зафиксировать в заказе.
                </AlertDialogDescription>
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
              <p className="text-xs text-muted-foreground">
                «Оставить цены черновика» — как было при создании. «Обновить по текущим» — по актуальному прайсу.
              </p>
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
            disabled={pendingAction || !itemsCount}
            onClick={() => onFinalize(draft.id, "keep")}
          >
            Отправить в работу
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pendingAction} onClick={() => onEdit(draft)}>
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
                  ? ` Предоплата ${money(draft.prepaid)} в кассу не попадала — просто верните её клиенту.`
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
    </div>
  )
}
