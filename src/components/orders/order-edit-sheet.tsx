"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CalendarIcon, ClockIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { updateOrderAction, updateOrderDraftAction } from "@/app/actions"
import type { BouquetTemplate, Order, OrderItem, Product } from "@/lib/db"
import { deliveryTypeLabel, getPaymentMethodLabel, paymentMethodOptions } from "@/lib/labels"
import { calculateCommercialTotals } from "@/lib/pricing"
import { formatMoney } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
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
import { Textarea } from "@/components/ui/textarea"
import { ProductCombobox } from "@/components/products/product-combobox"
import {
  ProductLineItems,
  addBouquetToLineItems,
  addProductToLineItems,
  getProductLineItemsForTotals,
  validateProductLineItems,
  type ProductLineItem,
} from "@/components/products/product-line-items"

// Состав заказа -> строки редактора. Сохраняем bouquetGroupId/цены, чтобы букеты остались
// сгруппированными и считались как при создании.
function orderItemsToLineItems(items: OrderItem[]): ProductLineItem[] {
  return items.map((item) => ({
    lineId: item.bouquetGroupId
      ? `${item.bouquetGroupId}:${item.productCode}:${item.id}`
      : `item-${item.id}`,
    productCode: item.productCode,
    code: item.productCode,
    name: item.name,
    imagePath: item.imagePath,
    qty: item.qty,
    price: item.price,
    bouquetId: item.bouquetId ?? null,
    bouquetName: item.bouquetName,
    bouquetGroupId: item.bouquetGroupId || undefined,
    discountType: item.discountType,
    discountValue: item.discountValue,
  }))
}

function splitDueAt(dueAt: string): { date: string; time: string } {
  if (!dueAt) {
    return { date: "", time: "" }
  }
  const [date = "", time = ""] = dueAt.split("T")
  return { date, time: time.slice(0, 5) }
}

export function OrderEditSheet({
  order,
  products,
  bouquets,
  open,
  onOpenChange,
}: {
  order: Order
  products: Product[]
  bouquets: BouquetTemplate[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const initialDue = splitDueAt(order.dueAt)
  const [items, setItems] = useState<ProductLineItem[]>(() => orderItemsToLineItems(order.items))
  const [dueDate, setDueDate] = useState(initialDue.date)
  const [dueTime, setDueTime] = useState(initialDue.time)
  const [deliveryType, setDeliveryType] = useState<"pickup" | "delivery">(
    order.deliveryType === "delivery" ? "delivery" : "pickup"
  )
  const [address, setAddress] = useState(order.address ?? "")
  const [recipientPhone, setRecipientPhone] = useState(order.recipientPhone ?? "")
  const [note, setNote] = useState(order.note ?? "")
  const [deliveryPrice, setDeliveryPrice] = useState(order.deliveryPrice ?? 0)
  const [courierPayout, setCourierPayout] = useState(order.courierPayout ?? 0)
  // Предоплата-намерение черновика: сумма и способ хранятся в черновике, в кассу проводятся
  // только при отправке в работу. У обычного заказа этот блок не показывается.
  const [prepaid, setPrepaid] = useState(order.prepaid ?? 0)
  const [prepaidMethod, setPrepaidMethod] = useState(order.draftPrepaidMethod || "cash")

  const isDelivery = deliveryType === "delivery"
  // Итог считаем со скидкой на чек, сохранённой у заказа (на столе её не меняем).
  const totals = calculateCommercialTotals(
    getProductLineItemsForTotals(items),
    order.orderDiscountType,
    order.orderDiscountValue
  )
  const total = totals.total + (isDelivery ? deliveryPrice : 0)
  const dueAt = dueDate ? `${dueDate}T${dueTime || "00:00"}` : ""
  const paidExceeds = order.paid - total > 0.009

  function addProduct(product: Product) {
    setItems((current) => addProductToLineItems(current, product))
  }

  function addBouquet(bouquet: BouquetTemplate) {
    setItems((current) => addBouquetToLineItems(current, bouquet))
  }

  const isDraft = order.status === "Черновик"

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Черновик: состав необязателен (валидация — при отправке в работу). Прочие проверки тоже мягче.
    if (!isDraft) {
      const validationError = validateProductLineItems(items)
      if (validationError) {
        toast.error(validationError)
        return
      }
      if (deliveryPrice < 0 || courierPayout < 0) {
        toast.error("Суммы не могут быть отрицательными.")
        return
      }
      if (paidExceeds) {
        toast.error("Сумма заказа не может быть меньше уже принятой оплаты.")
        return
      }
    }

    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await (isDraft ? updateOrderDraftAction(formData) : updateOrderAction(formData))
      if (result.ok) {
        toast.success(result.message)
        onOpenChange(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
        <SheetHeader className="border-b border-zinc-200">
          <SheetTitle>Редактировать заказ {order.number || `#${order.id}`}</SheetTitle>
          <SheetDescription>
            Состав, срок и доставку можно менять, пока заказ не собран. Склад спишется по новому составу при отметке «Букет готов».
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="dueAt" value={dueAt} />
            <input type="hidden" name="deliveryType" value={deliveryType} />

            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Дата и время</FieldLabel>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <div className="relative">
                      <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="date"
                        className="pl-9 tabular-nums"
                        value={dueDate}
                        disabled={pending}
                        onChange={(event) => setDueDate(event.target.value)}
                      />
                    </div>
                    <div className="relative">
                      <ClockIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="time"
                        step="900"
                        className="pl-9 tabular-nums"
                        value={dueTime}
                        disabled={pending}
                        onChange={(event) => setDueTime(event.target.value)}
                      />
                    </div>
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="order-edit-delivery">Способ получения</FieldLabel>
                  <Select
                    value={deliveryType}
                    onValueChange={(value) => setDeliveryType(value === "delivery" ? "delivery" : "pickup")}
                  >
                    <SelectTrigger id="order-edit-delivery" className="w-full" disabled={pending}>
                      <SelectValue>{(value) => deliveryTypeLabel(String(value ?? "pickup"))}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="pickup">Самовывоз</SelectItem>
                      <SelectItem value="delivery">Доставка</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {isDelivery ? (
                <Field>
                  <FieldLabel htmlFor="order-edit-address">Адрес доставки</FieldLabel>
                  <Input
                    id="order-edit-address"
                    name="address"
                    value={address}
                    disabled={pending}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </Field>
              ) : (
                <input type="hidden" name="address" value="" />
              )}

              <Field>
                <FieldLabel htmlFor="order-edit-recipient">Номер получателя</FieldLabel>
                <Input
                  id="order-edit-recipient"
                  name="recipientPhone"
                  inputMode="tel"
                  value={recipientPhone}
                  disabled={pending}
                  onChange={(event) => setRecipientPhone(event.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="order-edit-note">Комментарий</FieldLabel>
                <Textarea
                  id="order-edit-note"
                  name="comment"
                  rows={2}
                  value={note}
                  disabled={pending}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>

              {isDelivery ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="order-edit-delivery-price">Платит клиент за доставку</FieldLabel>
                    <Input
                      id="order-edit-delivery-price"
                      name="deliveryPrice"
                      type="number"
                      step="1"
                      min="0"
                      className="tabular-nums"
                      value={deliveryPrice}
                      disabled={pending}
                      onChange={(event) => setDeliveryPrice(Number(event.target.value) || 0)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="order-edit-courier">Выдать курьеру из кассы</FieldLabel>
                    <Input
                      id="order-edit-courier"
                      name="courierPayout"
                      type="number"
                      step="1"
                      min="0"
                      className="tabular-nums"
                      value={courierPayout}
                      disabled={pending}
                      onChange={(event) => setCourierPayout(Number(event.target.value) || 0)}
                    />
                    <FieldDescription>Выплата курьеру не входит в итог — это отдельная кассовая операция.</FieldDescription>
                  </Field>
                </div>
              ) : (
                <>
                  <input type="hidden" name="deliveryPrice" value="0" />
                  <input type="hidden" name="courierPayout" value="0" />
                </>
              )}

              {isDraft && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="order-edit-prepaid">Предоплата</FieldLabel>
                    <Input
                      id="order-edit-prepaid"
                      name="prepaid"
                      type="number"
                      step="1"
                      min="0"
                      className="tabular-nums"
                      value={prepaid}
                      disabled={pending}
                      onChange={(event) => setPrepaid(Math.max(0, Number(event.target.value) || 0))}
                    />
                    <FieldDescription>
                      Не проведена — уйдёт в кассу при отправке в работу.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="order-edit-prepaid-method">Способ предоплаты</FieldLabel>
                    <input type="hidden" name="paymentMethod" value={prepaidMethod} />
                    <Select value={prepaidMethod} onValueChange={(value) => setPrepaidMethod(value ?? "cash")}>
                      <SelectTrigger id="order-edit-prepaid-method" className="w-full" disabled={pending || prepaid <= 0}>
                        <SelectValue>{(value) => getPaymentMethodLabel(String(value ?? "cash"))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {paymentMethodOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}

              <div className="flex min-w-0 flex-col gap-2">
                <FieldLabel>Состав заказа</FieldLabel>
                <ProductCombobox
                  products={products}
                  bouquets={bouquets}
                  includeBouquets
                  portalDropdown
                  disabled={pending}
                  onSelect={addProduct}
                  onSelectBouquet={addBouquet}
                />
                <ProductLineItems
                  products={products}
                  items={items}
                  disabled={pending}
                  emptyTitle="Добавьте товары через поиск"
                  onItemsChange={setItems}
                />
              </div>
            </FieldGroup>
          </div>

          <SheetFooter className="border-t border-zinc-200">
            {paidExceeds && (
              <div className="text-sm text-destructive">
                Итог ({formatMoney(total)}) меньше уже принятой оплаты ({formatMoney(order.paid)}). Увеличьте состав или уменьшите скидку.
              </div>
            )}
            <div className="flex w-full items-center justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Итого</div>
                <div className="text-xl font-semibold tabular-nums">{formatMoney(total)}</div>
              </div>
              <Button type="submit" disabled={pending || paidExceeds}>
                {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Сохранить
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
