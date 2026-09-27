"use client"

import type React from "react"
import { useState } from "react"
import { ImageIcon, MapPinIcon, MessageCircleIcon, PencilIcon, PhoneIcon, ReceiptTextIcon, StoreIcon, TruckIcon, UserRoundIcon } from "lucide-react"
import type { Order, OrderImage } from "@/lib/db"
import { getSafeOrderImagePath } from "@/lib/order-images"
import { sourceLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { OrderImageLightbox } from "@/components/orders/order-images"
import { FloristMark } from "@/components/florist-mark"
import { OrderComposition, OrderStatusBadge, OrderUrgencyBadge, dateTime, dateTimeLong } from "@/components/orders/order-shared"

// Карточка заказа для просмотра: фото и чеки (галерея с лайтбоксом), кто/когда/куда, состав,
// комментарий, деньги. «Изменить» — если передан onEdit и заказ ещё редактируется.

const editableStatuses = new Set<Order["status"]>(["Новый", "В работе", "Черновик"])

export function OrderDetailsDialog({
  order,
  onOpenChange,
  onEdit,
  chatHref,
  showMoney = true,
}: {
  order: Order | null
  onOpenChange: (open: boolean) => void
  onEdit?: (order: Order) => void
  // Ссылка «Открыть чат» (если заказ пришёл из мессенджера).
  chatHref?: string | null
  showMoney?: boolean
}) {
  return (
    <Dialog open={Boolean(order)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-3xl">
        {order ? <OrderDetailsBody order={order} onEdit={onEdit} chatHref={chatHref} showMoney={showMoney} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function OrderDetailsBody({
  order,
  onEdit,
  chatHref,
  showMoney,
}: {
  order: Order
  onEdit?: (order: Order) => void
  chatHref?: string | null
  showMoney: boolean
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const photos = order.images.filter((image) => image.kind !== "receipt")
  const receipts = order.images.filter((image) => image.kind === "receipt")
  const balance = order.total - order.paid
  const canEdit = Boolean(onEdit) && editableStatuses.has(order.status)

  return (
    <>
      <DialogHeader className="shrink-0 px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2 pr-8">
          <div className="min-w-0">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>{order.number || `#${order.id}`}</span>
              <OrderStatusBadge status={order.status} />
              <OrderUrgencyBadge order={order} />
            </DialogTitle>
            <DialogDescription className="mt-1">
              {order.dueAt ? `Срок: ${dateTimeLong(order.dueAt)}` : "Без срока"} · создан {dateTime(order.createdAt)}
              {order.source ? ` · ${sourceLabel(order.source)}` : ""}
            </DialogDescription>
            {order.createdByRole === "florist" || order.completedByRole === "florist" ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <FloristMark role={order.createdByRole} name={order.createdByName} action="Оформил" />
                <FloristMark
                  role={order.completedByRole}
                  name={order.completedByName}
                  action={order.status === "Передан курьеру" ? "Передал курьеру" : "Выдал"}
                />
              </div>
            ) : null}
          </div>
          {canEdit && onEdit ? (
            <Button type="button" size="sm" variant="ghost" className="bg-muted/60" onClick={() => onEdit(order)}>
              <PencilIcon data-icon="inline-start" />
              Изменить
            </Button>
          ) : null}
        </div>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {order.images.length ? (
          <Gallery images={order.images} onOpen={setLightboxIndex} />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <InfoBlock icon={UserRoundIcon} title="Клиент">
            <div className="text-base font-semibold">{order.customer || "Не указан"}</div>
            {order.phone ? (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <PhoneIcon className="size-3.5" />
                {order.phone}
              </div>
            ) : null}
            {order.recipientPhone ? <div className="text-sm text-muted-foreground">Получатель: {order.recipientPhone}</div> : null}
            {chatHref ? (
              <a href={chatHref} className="mt-1 inline-flex items-center gap-1 text-sm text-brand-strong hover:underline">
                <MessageCircleIcon className="size-3.5" />
                Открыть чат
              </a>
            ) : null}
          </InfoBlock>
          <InfoBlock icon={order.deliveryType === "delivery" ? TruckIcon : StoreIcon} title={order.deliveryType === "delivery" ? "Доставка" : "Самовывоз"}>
            {order.deliveryType === "delivery" ? (
              <div className="flex items-start gap-1 text-sm">
                <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>{order.address || "Адрес не указан"}</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Клиент заберёт в магазине</div>
            )}
            {order.courierName ? <div className="text-sm text-muted-foreground">Курьер: {order.courierName}</div> : null}
            {order.deliveryPrice > 0 ? <div className="text-sm text-muted-foreground">Доставка: {formatMoney(order.deliveryPrice)}</div> : null}
          </InfoBlock>
        </div>

        {order.note ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <div className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase">Комментарий</div>
            <div className="mt-0.5 whitespace-pre-wrap">{order.note}</div>
          </div>
        ) : null}

        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Состав · {order.items.length}</h3>
          {order.items.length ? <OrderComposition items={order.items} size="lg" /> : <p className="text-sm text-muted-foreground">Позиции не добавлены.</p>}
        </section>

        {showMoney ? (
          <section className="grid grid-cols-3 gap-2">
            <Money label="Итого" value={formatMoney(order.total)} />
            <Money label="Оплачено" value={formatMoney(order.paid)} hint={order.pendingPrepaid > 0.009 ? "предоплата в кассу при выдаче" : ""} />
            <Money label={balance > 0.009 ? "Остаток" : "Долг"} value={balance > 0.009 ? formatMoney(balance) : "нет"} tone={balance > 0.009 ? "warn" : "ok"} />
          </section>
        ) : null}

        {receipts.length ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ReceiptTextIcon className="size-3.5" />
            {receipts.length === 1 ? "Прикреплён чек об оплате" : `Прикреплено чеков: ${receipts.length}`}
            {photos.length ? ` · фото: ${photos.length}` : ""}
          </p>
        ) : null}
      </div>

      <OrderImageLightbox images={order.images} index={lightboxIndex} onIndexChange={setLightboxIndex} />
    </>
  )
}

// Галерея: первое фото крупно, остальные — миниатюрами; чек помечен.
function Gallery({ images, onOpen }: { images: OrderImage[]; onOpen: (index: number) => void }) {
  const [hero, ...rest] = images
  return (
    <div className="flex flex-col gap-2">
      <GalleryImage image={hero} index={0} onOpen={onOpen} className="h-64 w-full sm:h-80" />
      {rest.length ? (
        <div className="flex flex-wrap gap-2">
          {rest.map((image, offset) => (
            <GalleryImage key={image.id} image={image} index={offset + 1} onOpen={onOpen} className="size-20" />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function GalleryImage({ image, index, onOpen, className }: { image: OrderImage; index: number; onOpen: (index: number) => void; className?: string }) {
  const src = getSafeOrderImagePath(image.thumbPath || image.imagePath)
  const full = getSafeOrderImagePath(image.imagePath)
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      className={cn("group relative overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/35", className)}
      aria-label={image.kind === "receipt" ? "Открыть чек" : "Открыть фото"}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={index === 0 ? full || src : src} alt={image.originalName || "Фото заказа"} className="size-full object-cover transition-transform group-hover:scale-[1.02]" loading="lazy" />
      ) : (
        <ImageIcon className="m-auto size-6 text-muted-foreground" />
      )}
      {image.kind === "receipt" ? (
        <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] font-medium shadow-xs">
          <ReceiptTextIcon className="size-3" />
          Чек
        </span>
      ) : null}
    </button>
  )
}

function InfoBlock({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" />
        {title}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function Money({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "ok" }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-base font-semibold tabular-nums", tone === "warn" && "text-amber-700", tone === "ok" && "text-emerald-700")}>{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

// Маленькая пометка «есть фото/чек» для строк и карточек.
export function OrderPhotoMark({ images, className }: { images: OrderImage[]; className?: string }) {
  if (!images.length) {
    return null
  }
  const receipts = images.filter((image) => image.kind === "receipt").length
  const photos = images.length - receipts
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)} title={`Фото: ${photos}, чеков: ${receipts}`}>
      {photos ? (
        <span className="inline-flex items-center gap-0.5">
          <ImageIcon className="size-3.5" />
          {photos}
        </span>
      ) : null}
      {receipts ? (
        <span className="inline-flex items-center gap-0.5">
          <ReceiptTextIcon className="size-3.5" />
          {receipts}
        </span>
      ) : null}
    </span>
  )
}
