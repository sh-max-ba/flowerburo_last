"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CheckIcon, ExternalLinkIcon, HistoryIcon, Loader2Icon, PencilIcon, PlusIcon, ReceiptTextIcon, SendIcon, UserRoundPlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { createCustomerFromChatAction, sendOrderToChatAction, updateCustomerFieldAction } from "@/app/actions"
import type { Customer, CustomerChange, CustomerEditableField, CustomerStats } from "@/lib/crm"
import type { BouquetTemplate, ChatSummary, Order, OrderImage, Product } from "@/lib/db"
import { deliveryTypeLabel, sourceLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { OrderDetailsDialog, OrderPhotoMark } from "@/components/orders/order-details-dialog"
import { OrderEditSheet } from "@/components/orders/order-edit-sheet"
import { OrderStatusBadge, dateTimeLong } from "@/components/orders/order-shared"
import { FloristMark } from "@/components/florist-mark"
import { getSafeOrderImagePath } from "@/lib/order-images"
import { formatOrderForChat } from "@/lib/order-message"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ChatAvatar, channelMeta, formatDateTime, formatPhone } from "./chat-shared"

// Правая панель диалога: «Контакт» — карточка клиента с инлайн-правкой (имя, телефон, скидка,
// комментарий), сводкой по заказам и историей изменений; «Заказы» — заказы клиента и создание
// нового (клиент подставляется автоматически). Данные грузятся по /api/chats/[id]/context.

export type ChatPanelKind = "contact" | "orders"

type ContextData = {
  chat: ChatSummary
  customer: Customer | null
  stats: CustomerStats | null
  changes: CustomerChange[]
  orders: Order[]
}

const fieldLabels: Record<CustomerEditableField, string> = {
  name: "Имя",
  phone: "Телефон",
  defaultDiscountPercent: "Скидка",
  comment: "Комментарий",
  instagram: "Instagram",
}

export function ChatContextPanel({
  chat,
  kind,
  products,
  bouquets,
  reloadKey,
  pendingImages,
  onRemovePendingImage,
  onClose,
  onCreateOrder,
  onCustomerChanged,
}: {
  chat: ChatSummary
  kind: ChatPanelKind
  products: Product[]
  bouquets: BouquetTemplate[]
  // Растёт после создания заказа/правок — панель перезагружает контекст.
  reloadKey: number
  // Фото/чеки из чата, отложенные к следующему заказу (живут на экране, пока заказ не создан).
  pendingImages: OrderImage[]
  onRemovePendingImage: (imageId: number) => void
  onClose: () => void
  onCreateOrder: (customer: { id: number; name: string; phone: string; defaultDiscountPercent: number }) => void
  onCustomerChanged: () => void
}) {
  const [data, setData] = useState<ContextData | null>(null)
  const [error, setError] = useState("")
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null)
  // Предпросмотр «состав в чат» перед отправкой.
  const [sharingOrder, setSharingOrder] = useState<Order | null>(null)
  const [sharing, setSharing] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetch(`/api/chats/${chat.id}/context`, { cache: "no-store", signal })
        .then((response) => response.json() as Promise<({ status: "ok" } & ContextData) | { status: string; message?: string }>)
        .then((payload) => {
          if (payload.status !== "ok") {
            setError(("message" in payload && payload.message) || "Не удалось загрузить данные.")
            return
          }
          setData(payload as ContextData)
          setError("")
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setError("Не удалось загрузить данные.")
          }
        }),
    [chat.id]
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, reloadKey])

  async function ensureCustomer(): Promise<ContextData["customer"] | null> {
    if (data?.customer) {
      return data.customer
    }
    setCreatingCustomer(true)
    try {
      const result = await createCustomerFromChatAction(chat.id)
      if (!result.ok) {
        toast.error(result.message)
        return null
      }
      await load()
      onCustomerChanged()
      const response = await fetch(`/api/chats/${chat.id}/context`, { cache: "no-store" })
      const payload = (await response.json()) as { status: string; customer?: Customer | null }
      return payload.customer ?? null
    } finally {
      setCreatingCustomer(false)
    }
  }

  async function shareOrder() {
    if (!sharingOrder) {
      return
    }
    setSharing(true)
    try {
      const result = await sendOrderToChatAction(chat.id, sharingOrder.id)
      if (result.ok) {
        toast.success(result.message)
        setSharingOrder(null)
        onCustomerChanged()
      } else {
        toast.error(result.message)
      }
    } finally {
      setSharing(false)
    }
  }

  async function saveField(field: CustomerEditableField, value: string) {
    if (!data?.customer) {
      return false
    }
    const result = await updateCustomerFieldAction(data.customer.id, field, value)
    if (!result.ok) {
      toast.error(result.message)
      return false
    }
    if (result.data.changed) {
      toast.success(`${fieldLabels[field]}: сохранено`)
      await load()
      onCustomerChanged()
    }
    return true
  }

  const header = (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
      <div className="text-sm font-semibold">{kind === "contact" ? "Контакт" : "Заказы"}</div>
      <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={onClose} aria-label="Закрыть панель">
        <XIcon />
      </Button>
    </div>
  )

  if (error) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="px-3 text-sm text-muted-foreground">{error}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-col gap-3 px-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  const { customer, stats, changes, orders } = data
  const channel = channelMeta(data.chat.chatType)

  if (kind === "orders") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
          <Button
            type="button"
            className="h-11 w-full"
            disabled={creatingCustomer}
            onClick={async () => {
              const target = await ensureCustomer()
              if (target) {
                onCreateOrder({ id: target.id, name: target.name, phone: target.phone, defaultDiscountPercent: target.defaultDiscountPercent })
              }
            }}
          >
            {creatingCustomer ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PlusIcon data-icon="inline-start" />}
            Создать заказ
          </Button>
          {pendingImages.length ? (
            <div className="rounded-lg bg-brand-subtle p-2.5">
              <div className="mb-1.5 text-xs font-medium text-brand-strong">К новому заказу · {pendingImages.length}</div>
              <div className="flex flex-wrap gap-1.5">
                {pendingImages.map((image) => (
                  <div key={image.id} className="relative size-16 overflow-hidden rounded-md bg-background">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={getSafeOrderImagePath(image.thumbPath || image.imagePath)} alt="" className="size-full object-cover" />
                    {image.kind === "receipt" ? (
                      <span className="absolute bottom-1 left-1 rounded-sm bg-background/90 px-1 text-[10px] font-medium">
                        <ReceiptTextIcon className="inline size-3" /> чек
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onRemovePendingImage(image.id)}
                      className="absolute top-0.5 right-0.5 rounded-sm bg-background/90 p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label="Убрать"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Попадут в заказ или черновик при создании.</p>
            </div>
          ) : null}
          {!customer ? (
            <p className="text-sm text-muted-foreground">Клиент ещё не привязан — при создании заказа он появится автоматически.</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">У клиента пока нет заказов.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {orders.map((order) => (
                <li key={order.id}>
                  <OrderRow order={order} onOpen={() => setViewingOrder(order)} onShare={() => setSharingOrder(order)} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <OrderDetailsDialog
          order={viewingOrder}
          onOpenChange={(open) => !open && setViewingOrder(null)}
          onEdit={(order) => {
            setViewingOrder(null)
            setEditingOrder(order)
          }}
        />
        <Dialog open={Boolean(sharingOrder)} onOpenChange={(open) => !open && !sharing && setSharingOrder(null)}>
          <DialogContent className="rounded-xl sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Отправить состав в чат</DialogTitle>
              <DialogDescription>Так сообщение увидит клиент — жирный и курсив мессенджер покажет как разметку.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-y-auto rounded-lg bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap">
              {sharingOrder ? renderChatMarkup(formatOrderForChat(sharingOrder)) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSharingOrder(null)} disabled={sharing}>
                Отмена
              </Button>
              <Button type="button" onClick={() => void shareOrder()} disabled={sharing}>
                {sharing ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SendIcon data-icon="inline-start" />}
                Отправить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {editingOrder ? (
          <OrderEditSheet
            key={editingOrder.id}
            order={editingOrder}
            products={products}
            bouquets={bouquets}
            open={Boolean(editingOrder)}
            onOpenChange={(open) => {
              if (!open) {
                setEditingOrder(null)
                void load()
              }
            }}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-3">
        <div className="flex items-center gap-3">
          <ChatAvatar chatId={data.chat.id} name={data.chat.name} hasAvatar={data.chat.hasAvatar} chatType={data.chat.chatType} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              <span className={channel.className}>{channel.label}</span>
              {data.chat.username ? ` · @${data.chat.username}` : ""}
              {customer?.source && customer.source !== data.chat.chatType ? ` · ${sourceLabel(customer.source)}` : ""}
            </div>
            {customer ? (
              <Link href={`/clients/${customer.id}`} className="mt-1 inline-flex items-center gap-1 text-xs text-brand-strong hover:underline">
                <ExternalLinkIcon className="size-3" />
                Карточка клиента
              </Link>
            ) : null}
          </div>
        </div>

        {!customer ? (
          <div className="rounded-lg bg-muted/40 p-3 text-sm">
            <div className="font-medium">Клиент не привязан</div>
            <p className="mt-1 text-muted-foreground">Создайте карточку — имя и телефон возьмутся из чата.</p>
            <Button type="button" size="sm" className="mt-3" disabled={creatingCustomer} onClick={() => void ensureCustomer()}>
              {creatingCustomer ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <UserRoundPlusIcon data-icon="inline-start" />}
              Создать клиента
            </Button>
          </div>
        ) : (
          <>
            <dl className="flex flex-col gap-1">
              <InlineField label="Имя" value={customer.name} onSave={(value) => saveField("name", value)} required />
              <InlineField
                label="Телефон"
                value={customer.phone}
                display={customer.phone ? formatPhone(customer.phone) : ""}
                inputMode="tel"
                placeholder="996555123456"
                onSave={(value) => saveField("phone", value)}
              />
              <InlineField
                label="Скидка"
                value={customer.defaultDiscountPercent ? String(customer.defaultDiscountPercent) : ""}
                display={customer.defaultDiscountPercent ? `${customer.defaultDiscountPercent}%` : ""}
                inputMode="decimal"
                placeholder="нет"
                suffix="%"
                onSave={(value) => saveField("defaultDiscountPercent", value || "0")}
              />
              <InlineField label="Instagram" value={customer.instagram} placeholder="аккаунт" onSave={(value) => saveField("instagram", value)} />
              <InlineField label="Комментарий" value={customer.comment} multiline placeholder="Предпочтения, поводы, адрес…" onSave={(value) => saveField("comment", value)} />
            </dl>

            {stats ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Заказов" value={String(stats.ordersCount)} hint={stats.ordersTotal ? formatMoney(stats.ordersTotal) : ""} />
                <Stat label="Покупок на кассе" value={String(stats.salesCount)} hint={stats.salesTotal ? formatMoney(stats.salesTotal) : ""} />
                <Stat label="В работе" value={String(stats.activeOrdersCount)} hint={stats.cancelledOrdersCount ? `отменено ${stats.cancelledOrdersCount}` : ""} />
                <Stat label="Последний заказ" value={stats.lastOrderAt ? formatDateTime(stats.lastOrderAt) : "—"} hint={stats.firstContactAt ? `клиент с ${formatDateTime(stats.firstContactAt)}` : ""} />
              </div>
            ) : null}

            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <HistoryIcon className="size-3.5" />
                История изменений
              </h3>
              {changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Правок пока не было.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {changes.map((change) => (
                    <li key={change.id} className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>
                          {change.userName || "Система"} · {formatDateTime(change.createdAt)}
                        </span>
                        <FloristMark role={change.userRole} name={change.userName} action="Изменил" compact />
                      </div>
                      <div className="mt-0.5">
                        <span className="text-muted-foreground">{fieldLabels[change.field] ?? change.field}: </span>
                        <span className="line-through decoration-muted-foreground/60">{change.oldValue || "пусто"}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium">{change.newValue || "пусто"}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      {hint ? <div className="truncate text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

// Инлайн-поле: значение с карандашом; клик — ввод; Enter/✓ — сохранить, Esc/✕ — отмена.
function InlineField({
  label,
  value,
  display,
  placeholder,
  inputMode,
  suffix,
  multiline = false,
  required = false,
  onSave,
}: {
  label: string
  value: string
  display?: string
  placeholder?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  suffix?: string
  multiline?: boolean
  required?: boolean
  onSave: (value: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select?.()
    }
  }, [editing])

  function start() {
    setDraft(value)
    setEditing(true)
  }

  async function commit() {
    const next = draft.trim()
    if (required && !next) {
      toast.error(`${label}: поле не может быть пустым.`)
      return
    }
    if (next === value.trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    const ok = await onSave(next)
    setSaving(false)
    if (ok) {
      setEditing(false)
    }
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !(multiline && event.shiftKey)) {
      event.preventDefault()
      void commit()
    }
    if (event.key === "Escape") {
      event.preventDefault()
      cancel()
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className="mt-1 flex items-end gap-1">
          {multiline ? (
            <Textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={draft}
              rows={3}
              placeholder={placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={saving}
              className="min-h-16 flex-1 resize-none bg-background text-base sm:text-sm"
            />
          ) : (
            <div className="flex h-10 flex-1 items-center rounded-lg bg-background px-2 focus-within:ring-3 focus-within:ring-ring/15">
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={draft}
                inputMode={inputMode}
                placeholder={placeholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={saving}
                className="h-full min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
                aria-label={label}
              />
              {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
            </div>
          )}
          <Button type="button" size="icon" variant="ghost" className="text-muted-foreground" onClick={cancel} disabled={saving} aria-label="Отменить">
            <XIcon />
          </Button>
          <Button type="button" size="icon" onClick={() => void commit()} disabled={saving} aria-label="Сохранить">
            {saving ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
          </Button>
        </dd>
      </div>
    )
  }

  const shown = display ?? value
  return (
    <button
      type="button"
      onClick={start}
      className="group/field flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
      title={`Изменить: ${label.toLowerCase()}`}
    >
      <span className="min-w-0">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className={cn("text-sm whitespace-pre-wrap break-words", !shown && "text-muted-foreground italic")}>{shown || placeholder || "—"}</dd>
      </span>
      <PencilIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/field:opacity-100 pointer-coarse:opacity-60" aria-hidden />
    </button>
  )
}

function OrderRow({ order, onOpen, onShare }: { order: Order; onOpen: () => void; onShare: () => void }) {
  const balance = order.total - order.paid
  return (
    <div className="flex items-start gap-1 rounded-lg bg-muted/40 pr-1 transition-colors hover:bg-muted/70">
    <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2 text-left">
      <span className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {order.number || `#${order.id}`}
            <span className="font-normal text-muted-foreground"> · {order.dueAt ? dateTimeLong(order.dueAt) : "без срока"}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{deliveryTypeLabel(order.deliveryType)}</span>
            {order.items.length ? <span>· {order.items.length} поз.</span> : null}
            {balance > 0.009 && order.status !== "Отменен" ? <span>· остаток {formatMoney(balance)}</span> : null}
            <OrderPhotoMark images={order.images} />
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-semibold tabular-nums">{formatMoney(order.total)}</span>
          <OrderStatusBadge status={order.status} />
        </span>
      </span>
      {/* Метки флориста — отдельной строкой во всю ширину и с переносом: панель узкая. */}
      {order.createdByRole === "florist" || order.completedByRole === "florist" ? (
        <span className="flex flex-wrap gap-1">
          <FloristMark role={order.createdByRole} name={order.createdByName} action="Оформил" wrap />
          <FloristMark
            role={order.completedByRole}
            name={order.completedByName}
            action={order.status === "Передан курьеру" ? "Передал курьеру" : "Выдал"}
            wrap
          />
        </span>
      ) : null}
    </button>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="mt-1 shrink-0 text-muted-foreground"
      onClick={onShare}
      aria-label="Отправить состав в чат"
      title="Отправить состав в чат"
    >
      <SendIcon />
    </Button>
    </div>
  )
}

// Предпросмотр разметки мессенджера: *жирный* и _курсив_ — как их покажет WhatsApp.
function renderChatMarkup(text: string): React.ReactNode {
  return text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, index) => {
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return <strong key={index}>{part.slice(1, -1)}</strong>
    }
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    return <span key={index}>{part}</span>
  })
}
