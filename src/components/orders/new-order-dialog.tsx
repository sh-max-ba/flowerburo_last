"use client"

import type React from "react"
import { useCallback, useMemo, useState } from "react"
import { ru } from "date-fns/locale"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronRightIcon,
  Loader2Icon,
  PercentIcon,
  ReceiptTextIcon,
  StoreIcon,
  TruckIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { BouquetTemplate, CustomerOption, OrderImage, Product } from "@/lib/db"
import { discountTypeLabel, getPaymentMethodLabel, paymentMethodOptions } from "@/lib/labels"
import { calculateCommercialTotals, normalizeDiscountType, type DiscountType } from "@/lib/pricing"
import { cn, formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { SplitPaymentFields, type SplitPaymentState } from "@/components/cash/split-payment-fields"
import { CustomerCombobox } from "@/components/customers/customer-combobox"
import { CustomerCreateDialog, PHONE_PREFIX, phoneForSubmit, upsertCustomerOption } from "@/components/customers/customer-create-dialog"
import { ProductCombobox } from "@/components/products/product-combobox"
import {
  addBouquetToLineItems,
  addProductToLineItems,
  getProductLineItemsForTotals,
  ProductLineItems,
  validateProductLineItems,
  type ProductLineItem,
} from "@/components/products/product-line-items"
import { OrderImagesField } from "@/components/orders/order-images"
import { Info } from "@/components/orders/order-shared"
import { TimeDial } from "@/components/orders/time-dial"

// Окно «Новый заказ»: две колонки — слева состав (поиск товара, позиции, сводка по суммам),
// справа поля этапами «Клиент → Получение → Оплата». Все этапы смонтированы всегда (переключение
// только прячет панели), поэтому набранное не теряется и уходит одним FormData. На узком экране
// колонки складываются: состав, затем этапы. Переиспользуется кассой и чатами (initialCustomer /
// initialSource / initialImages — клиент, источник и фото из диалога).

export type OrderStepKey = "customer" | "delivery" | "payment"

const steps: Array<{ key: OrderStepKey; index: number; title: string }> = [
  { key: "customer", index: 1, title: "Клиент" },
  { key: "delivery", index: 2, title: "Получение" },
  { key: "payment", index: 3, title: "Оплата" },
]

// Календарь срока: без «чужих» дней соседних месяцев, выбранный день — бренд, сегодня — точкой
// (как в аналитике).
const CALENDAR_CLASS =
  "w-full p-0 [--cell-size:2.5rem] [&_button[data-selected-single=true]]:bg-primary [&_button[data-selected-single=true]]:text-primary-foreground"
const CALENDAR_CLASSNAMES = {
  months: "relative flex w-full flex-col",
  month: "flex w-full flex-col gap-3",
  month_grid: "w-full",
  today:
    "rounded-(--cell-radius) [&:not([data-selected=true])_button]:font-semibold [&:not([data-selected=true])_button]:text-brand-strong [&_button]:after:absolute [&_button]:after:bottom-1 [&_button]:after:left-1/2 [&_button]:after:size-1 [&_button]:after:-translate-x-1/2 [&_button]:after:rounded-full [&_button]:after:bg-current",
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0")
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function parseDateInput(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return undefined
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

const dueLabelFormatter = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" })

// «1 500», «1500,50» → число; пусто/мусор → 0.
function parseMoneyInput(value: string) {
  const parsed = Number(value.replace(/\s+/g, "").replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

// Денежное поле: текст с цифровой клавиатурой; хранит строку, поэтому «0» не прилипает и
// стирается как обычный символ. В форму уходит как есть — сервер парсит число.
function MoneyInput({
  id,
  name,
  value,
  onChange,
  disabled,
  readOnly,
  className,
}: {
  id: string
  name?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  readOnly?: boolean
  className?: string
}) {
  return (
    <>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        className={cn("tabular-nums", className)}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.,\s]/g, ""))}
        onFocus={(event) => event.target.select()}
      />
      {/* В форму уходит нормализованное число (пробелы и запятая сервером не парсятся). */}
      {name ? <input type="hidden" name={name} value={parseMoneyInput(value)} /> : null}
    </>
  )
}

export function OrderDialog({
  open,
  onOpenChange,
  products,
  bouquets,
  customers,
  pending,
  items,
  setItems,
  onSubmit,
  initialCustomer,
  initialSource,
  initialImages,
  description,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: Product[]
  bouquets: BouquetTemplate[]
  customers: CustomerOption[]
  pending: boolean
  items: ProductLineItem[]
  setItems: React.Dispatch<React.SetStateAction<ProductLineItem[]>>
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
  initialCustomer?: CustomerOption | null
  initialSource?: string
  initialImages?: OrderImage[]
  description?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(94vh,64rem)] max-h-[94vh] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-3xl lg:max-w-6xl xl:max-w-7xl">
        <DialogHeader className="shrink-0 px-5 pt-4 pb-3">
          <DialogTitle>Новый заказ</DialogTitle>
          <DialogDescription className="max-sm:sr-only">{description ?? "Слева — состав, справа — клиент, получение и оплата."}</DialogDescription>
        </DialogHeader>
        <NewOrderForm
          products={products}
          bouquets={bouquets}
          customers={customers}
          pending={pending}
          items={items}
          setItems={setItems}
          onSubmit={onSubmit}
          initialCustomer={initialCustomer}
          initialSource={initialSource}
          initialImages={initialImages}
        />
      </DialogContent>
    </Dialog>
  )
}

function NewOrderForm({
  products,
  bouquets,
  customers,
  pending,
  items,
  setItems,
  onSubmit,
  initialCustomer,
  initialSource,
  initialImages,
}: {
  products: Product[]
  bouquets: BouquetTemplate[]
  customers: CustomerOption[]
  pending: boolean
  items: ProductLineItem[]
  setItems: React.Dispatch<React.SetStateAction<ProductLineItem[]>>
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
  initialCustomer?: CustomerOption | null
  initialSource?: string
  initialImages?: OrderImage[]
}) {
  const [step, setStep] = useState<OrderStepKey>("customer")
  const [deliveryType, setDeliveryType] = useState("pickup")
  // Суммы держим строками: с числовым состоянием «0» в поле не стирался при вводе.
  const [deliveryPriceInput, setDeliveryPriceInput] = useState("")
  const [courierPayoutInput, setCourierPayoutInput] = useState("")
  const [prepaidInput, setPrepaidInput] = useState("")
  const deliveryPrice = parseMoneyInput(deliveryPriceInput)
  const courierPayout = parseMoneyInput(courierPayoutInput)
  const prepaid = parseMoneyInput(prepaidInput)
  const [customer, setCustomer] = useState(initialCustomer?.name ?? "")
  const [phone, setPhone] = useState(initialCustomer?.phone || PHONE_PREFIX)
  const [recipientPhone, setRecipientPhone] = useState(PHONE_PREFIX)
  // Клиент из чата может отсутствовать в общем списке (список грузится один раз) — добавляем.
  const [createdCustomers, setCreatedCustomers] = useState<CustomerOption[]>(initialCustomer ? [initialCustomer] : [])
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(initialCustomer?.id ?? null)
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>(
    initialCustomer && initialCustomer.defaultDiscountPercent > 0 ? "percent" : "none"
  )
  const [orderDiscountInput, setOrderDiscountInput] = useState(
    initialCustomer && initialCustomer.defaultDiscountPercent > 0 ? String(initialCustomer.defaultDiscountPercent) : ""
  )
  const orderDiscountValue = parseMoneyInput(orderDiscountInput)
  const [orderDiscountTouched, setOrderDiscountTouched] = useState(false)
  const [orderDiscountOpen, setOrderDiscountOpen] = useState(false)
  const [dueDate, setDueDate] = useState("")
  const [dueTime, setDueTime] = useState("")
  const [address, setAddress] = useState("")
  const [note, setNote] = useState("")
  // Фото/чеки: загружаются сразу при выборе (или приходят из чата), в заказ уходят id.
  const [images, setImages] = useState<OrderImage[]>(initialImages ?? [])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [prepaidSplit, setPrepaidSplit] = useState<SplitPaymentState>({ enabled: false, valid: true })
  const handlePrepaidSplitChange = useCallback((state: SplitPaymentState) => {
    setPrepaidSplit((current) =>
      current.enabled === state.enabled && current.valid === state.valid ? current : state
    )
  }, [])

  const availableCustomers = useMemo(
    () => createdCustomers.reduce((current, customerOption) => upsertCustomerOption(current, customerOption), customers),
    [createdCustomers, customers]
  )
  const selectedCustomer =
    selectedCustomerId === null ? null : availableCustomers.find((current) => current.id === selectedCustomerId) ?? null
  const isDelivery = deliveryType === "delivery"
  const effectiveDeliveryPrice = isDelivery ? deliveryPrice : 0
  const orderTotals = calculateCommercialTotals(getProductLineItemsForTotals(items), orderDiscountType, orderDiscountValue)
  const itemsTotal = orderTotals.total
  const total = itemsTotal + effectiveDeliveryPrice
  const balance = total - prepaid
  const fullyPaid = items.length > 0 && balance <= 0
  const prepaidTooHigh = prepaid > total
  const dueAt = dueDate && dueTime ? `${dueDate}T${dueTime}` : ""
  const orderDisabledReason =
    items.length === 0
      ? "Добавьте позиции"
      : !customer.trim()
        ? "Укажите имя клиента"
        : prepaidTooHigh
          ? "Предоплата выше итога"
          : prepaidSplit.enabled && !prepaidSplit.valid
            ? "Заполните части смешанной предоплаты"
            : null
  const orderDisabled = pending || Boolean(orderDisabledReason)
  const orderDiscountActive = orderDiscountType !== "none"
  const showOrderDiscount = orderDiscountOpen || orderDiscountActive
  const todayValue = dateInputValue(new Date())
  const tomorrowValue = dateInputValue(addLocalDays(new Date(), 1))
  const afterTomorrowValue = dateInputValue(addLocalDays(new Date(), 2))
  const dueDateObject = parseDateInput(dueDate)

  // Готовность этапов для галочек в переключателе.
  const stepDone: Record<OrderStepKey, boolean> = {
    customer: Boolean(customer.trim()),
    delivery: Boolean(dueAt) && (!isDelivery || Boolean(address.trim())),
    payment: prepaid > 0 || fullyPaid,
  }

  function resetForm() {
    setItems([])
    setStep("customer")
    setSelectedCustomerId(null)
    setCustomer("")
    setPhone(PHONE_PREFIX)
    setRecipientPhone(PHONE_PREFIX)
    setOrderDiscountType("none")
    setOrderDiscountInput("")
    setOrderDiscountTouched(false)
    setOrderDiscountOpen(false)
    setDueDate("")
    setDueTime("")
    setDeliveryType("pickup")
    setAddress("")
    setNote("")
    setImages([])
    setDeliveryPriceInput("")
    setCourierPayoutInput("")
    setPrepaidInput("")
    setPaymentMethod("cash")
  }

  function handleDeliveryTypeChange(value: string) {
    const next = value ?? "pickup"
    setDeliveryType(next)
    // Самовывоз обнуляет доставку/курьера/адрес, чтобы они не попали в итог и заказ.
    if (next !== "delivery") {
      setDeliveryPriceInput("")
      setCourierPayoutInput("")
      setAddress("")
    }
  }

  function applyOrderCustomer(nextCustomer: CustomerOption | null) {
    setSelectedCustomerId(nextCustomer?.id ?? null)
    setCustomer(nextCustomer?.name ?? "")
    setPhone(nextCustomer?.phone || PHONE_PREFIX)
    if (!orderDiscountTouched) {
      if (nextCustomer && nextCustomer.defaultDiscountPercent > 0) {
        setOrderDiscountType("percent")
        setOrderDiscountInput(String(nextCustomer.defaultDiscountPercent))
      } else {
        setOrderDiscountType("none")
        setOrderDiscountInput("")
      }
    }
  }

  function handleCustomerCreated(nextCustomer: CustomerOption) {
    setCreatedCustomers((current) => upsertCustomerOption(current, nextCustomer))
    applyOrderCustomer(nextCustomer)
  }

  function handleOrderDiscountTypeChange(value: string) {
    const nextType = normalizeDiscountType(value)
    setOrderDiscountTouched(true)
    setOrderDiscountType(nextType)
    if (nextType === "none") {
      setOrderDiscountInput("")
    }
  }

  function clearOrderDiscount() {
    setOrderDiscountTouched(true)
    setOrderDiscountType("none")
    setOrderDiscountInput("")
    setOrderDiscountOpen(false)
  }

  function selectDueDate(value: string) {
    setDueDate(value)
    // Время по умолчанию, чтобы дата без времени не «висела» невалидной.
    if (value && !dueTime) {
      setDueTime("18:00")
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const isDraft = submitter?.getAttribute("data-intent") === "draft"

    // Имя клиента обязательно и для заказа, и для черновика; поле может быть на скрытом этапе —
    // переключаемся на него вместо немой браузерной валидации.
    if (!customer.trim()) {
      event.preventDefault()
      setStep("customer")
      toast.error("Укажите имя клиента.")
      return
    }

    // Черновик: минимум — имя клиента; позиции/смена/предоплата необязательны, полная валидация —
    // при отправке в работу. Пропускаем строгие проверки и отдаём наверх.
    if (isDraft) {
      onSubmit(event, resetForm)
      return
    }

    const validationError = validateProductLineItems(items)
    if (validationError) {
      event.preventDefault()
      toast.error(validationError)
      return
    }
    if (prepaid < 0 || deliveryPrice < 0 || courierPayout < 0) {
      event.preventDefault()
      setStep("payment")
      toast.error("Суммы не могут быть отрицательными.")
      return
    }
    if (prepaidTooHigh) {
      event.preventDefault()
      setStep("payment")
      toast.error("Предоплата не может быть больше итога заказа.")
      return
    }

    onSubmit(event, resetForm)
  }

  const stepIndex = steps.findIndex((entry) => entry.key === step)
  const nextStep = steps[stepIndex + 1]

  return (
    <>
      <CustomerCreateDialog
        open={customerDialogOpen}
        pending={pending}
        onOpenChange={setCustomerDialogOpen}
        onCreated={handleCustomerCreated}
      />
      <form onSubmit={handleSubmit} className="@container/order flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="customerId" value={selectedCustomer?.id ?? ""} />
        <input type="hidden" name="orderDiscountType" value={orderDiscountType} />
        <input type="hidden" name="orderDiscountValue" value={orderDiscountValue} />
        <input type="hidden" name="deliveryType" value={deliveryType} />
        <input type="hidden" name="paymentMethod" value={paymentMethod} />
        <input type="hidden" name="dueAt" value={dueAt} />
        <input type="hidden" name="customer" value={customer} />
        <input type="hidden" name="phone" value={phoneForSubmit(phone)} />
        <input type="hidden" name="recipientPhone" value={phoneForSubmit(recipientPhone)} />
        {initialSource ? <input type="hidden" name="source" value={initialSource} /> : null}

        <div className="grid min-h-0 flex-1 content-start overflow-y-auto lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)] lg:content-stretch lg:overflow-hidden">
          {/* Левая колонка — состав. Одной колонкой (ниже lg) секции высотой по содержимому —
              min-h-0 там схлопывал строки сетки, и блоки наезжали друг на друга. */}
          <section className="flex flex-col gap-3 bg-muted/30 px-4 py-4 sm:px-5 lg:min-h-0 lg:overflow-y-auto" aria-label="Состав заказа">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-heading text-sm font-semibold">Состав</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                {items.length ? `${items.length} поз. · ${formatMoney(itemsTotal)}` : "пока пусто"}
              </span>
            </div>
            <ProductCombobox
              products={products}
              bouquets={bouquets}
              includeBouquets
              portalDropdown
              disabled={pending}
              placeholder="Найти товар или букет"
              onSelect={(product) => setItems((current) => addProductToLineItems(current, product))}
              onSelectBouquet={(bouquet) => setItems((current) => addBouquetToLineItems(current, bouquet))}
            />
            <ProductLineItems
              products={products}
              items={items}
              disabled={pending}
              emptyTitle="Добавьте товары через поиск"
              onItemsChange={setItems}
            />
            {items.length ? (
              <div className="grid gap-1.5 rounded-lg bg-background p-3 text-sm shadow-xs">
                <Info label="До скидки" value={formatMoney(orderTotals.itemsTotalBeforeDiscount)} />
                {orderTotals.itemsDiscountTotal > 0 && (
                  <Info label="Скидка по позициям" value={`− ${formatMoney(orderTotals.itemsDiscountTotal)}`} />
                )}
                {orderTotals.dealDiscountAmount > 0 && <Info label="Скидка на чек" value={`− ${formatMoney(orderTotals.dealDiscountAmount)}`} />}
                {effectiveDeliveryPrice > 0 && <Info label="Доставка" value={formatMoney(effectiveDeliveryPrice)} />}
                {prepaid > 0 && <Info label="Предоплата (в кассу при выдаче)" value={`− ${formatMoney(prepaid)}`} />}
              </div>
            ) : null}
          </section>

          {/* Правая колонка — этапы */}
          <section className="flex flex-col lg:min-h-0 lg:overflow-hidden" aria-label="Данные заказа">
            <div className="shrink-0 px-4 pt-4 sm:px-5">
              <StepSwitch value={step} done={stepDone} onChange={setStep} />
            </div>
            <div className="flex flex-1 flex-col gap-5 px-4 py-4 sm:px-5 lg:min-h-0 lg:overflow-y-auto">
              {/* 1. Клиент */}
              <div className={cn("flex flex-col gap-4", step !== "customer" && "hidden")}>
                <FieldGroup>
                  <Field>
                    <FieldLabel>Выбор клиента</FieldLabel>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <CustomerCombobox customers={availableCustomers} value={selectedCustomerId} disabled={pending} onChange={applyOrderCustomer} />
                      <Button type="button" variant="outline" disabled={pending} onClick={() => setCustomerDialogOpen(true)}>
                        Новый клиент
                      </Button>
                    </div>
                    {selectedCustomer?.defaultDiscountPercent ? (
                      <Badge variant="success" className="w-fit">Скидка клиента {selectedCustomer.defaultDiscountPercent}%</Badge>
                    ) : selectedCustomer ? (
                      <Badge variant="outline" className="w-fit">Без персональной скидки</Badge>
                    ) : (
                      <FieldDescription>Можно выбрать клиента или заполнить контакты вручную.</FieldDescription>
                    )}
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="order-customer">Имя клиента</FieldLabel>
                      <Input id="order-customer" value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Как обращаться" />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="order-phone">Телефон</FieldLabel>
                      <Input id="order-phone" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="order-recipient-phone">Номер получателя</FieldLabel>
                    <Input
                      id="order-recipient-phone"
                      inputMode="tel"
                      placeholder="Если букет получает другой человек"
                      value={recipientPhone}
                      onChange={(event) => setRecipientPhone(event.target.value)}
                    />
                  </Field>
                </FieldGroup>
              </div>

              {/* 2. Получение */}
              <div className={cn("flex flex-col gap-5", step !== "delivery" && "hidden")}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <FieldLabel>Когда</FieldLabel>
                    <span className={cn("text-sm font-medium", !dueDateObject && "text-muted-foreground")}>
                      {dueDateObject ? `${dueLabelFormatter.format(dueDateObject)}${dueTime ? `, ${dueTime}` : ""}` : "дата не выбрана"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <DateChip label="Сегодня" active={dueDate === todayValue} onClick={() => selectDueDate(todayValue)} />
                    <DateChip label="Завтра" active={dueDate === tomorrowValue} onClick={() => selectDueDate(tomorrowValue)} />
                    <DateChip label="Послезавтра" active={dueDate === afterTomorrowValue} onClick={() => selectDueDate(afterTomorrowValue)} />
                    {dueDate ? <DateChip label="Без срока" active={false} onClick={() => { setDueDate(""); setDueTime("") }} /> : null}
                  </div>
                  <div className="grid gap-4 @lg/order:grid-cols-[auto_minmax(0,1fr)]">
                    <div className="rounded-lg bg-muted/40 p-2">
                      <Calendar
                        mode="single"
                        selected={dueDateObject}
                        onSelect={(date) => selectDueDate(date ? dateInputValue(date) : "")}
                        defaultMonth={dueDateObject ?? new Date()}
                        showOutsideDays={false}
                        locale={ru}
                        className={CALENDAR_CLASS}
                        classNames={CALENDAR_CLASSNAMES}
                      />
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <TimeDial value={dueTime} onChange={setDueTime} disabled={pending} />
                    </div>
                  </div>
                </div>

                <Field>
                  <FieldLabel>Способ получения</FieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    <ChoiceCard icon={StoreIcon} label="Самовывоз" hint="Клиент заберёт в магазине" active={!isDelivery} onClick={() => handleDeliveryTypeChange("pickup")} disabled={pending} />
                    <ChoiceCard icon={TruckIcon} label="Доставка" hint="Курьер отвезёт по адресу" active={isDelivery} onClick={() => handleDeliveryTypeChange("delivery")} disabled={pending} />
                  </div>
                </Field>
                {isDelivery && (
                  <Field>
                    <FieldLabel htmlFor="order-address">Адрес доставки</FieldLabel>
                    <Input id="order-address" name="address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Улица, дом, подъезд, ориентир" />
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="order-note">Комментарий</FieldLabel>
                  <Textarea id="order-note" name="note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Пожелания к букету, открытка, звонок за час…" />
                </Field>
                <OrderImagesField images={images} onChange={setImages} disabled={pending} label="Фото и чеки" />
              </div>

              {/* 3. Оплата */}
              <div className={cn("flex flex-col gap-4", step !== "payment" && "hidden")}>
                <FieldGroup>
                  {isDelivery && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="order-delivery-price">Платит клиент за доставку</FieldLabel>
                        <MoneyInput id="order-delivery-price" name="deliveryPrice" value={deliveryPriceInput} onChange={setDeliveryPriceInput} />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="order-courier-payout">Выдать курьеру из кассы</FieldLabel>
                        <MoneyInput id="order-courier-payout" name="courierPayout" value={courierPayoutInput} onChange={setCourierPayoutInput} />
                        <FieldDescription>Выплата курьеру не входит в итог — это отдельная кассовая операция.</FieldDescription>
                      </Field>
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="order-prepaid">Предоплата</FieldLabel>
                      <MoneyInput id="order-prepaid" name="prepaid" value={prepaidInput} onChange={setPrepaidInput} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="order-payment-method">Способ оплаты</FieldLabel>
                      <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value ?? "cash")}>
                        <SelectTrigger id="order-payment-method" className="w-full" disabled={pending}>
                          <SelectValue placeholder="Способ оплаты">{(value) => getPaymentMethodLabel(String(value ?? "cash"))}</SelectValue>
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
                  {prepaid > 0 && (
                    <SplitPaymentFields total={prepaid} primaryMethod={paymentMethod} disabled={pending} idPrefix="order-split" onStateChange={handlePrepaidSplitChange} />
                  )}
                  {prepaid > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Предоплата попадёт в кассу в день выдачи заказа, а не сегодня. Смена для этого не нужна.
                    </p>
                  )}

                  {showOrderDiscount ? (
                    <div className="grid gap-3 rounded-lg bg-muted/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">Скидка на чек</div>
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" disabled={pending} onClick={clearOrderDiscount}>
                          <XIcon data-icon="inline-start" />
                          Убрать
                        </Button>
                      </div>
                      <div className="flex items-end gap-2">
                        <Field>
                          <FieldLabel htmlFor="order-discount-type">Тип</FieldLabel>
                          <Select value={orderDiscountType} onValueChange={(value) => handleOrderDiscountTypeChange(value ?? "none")}>
                            <SelectTrigger id="order-discount-type" className="w-32" disabled={pending}>
                              <SelectValue>{(value) => discountTypeLabel(String(value ?? "none"))}</SelectValue>
                            </SelectTrigger>
                            <SelectContent align="start">
                              <SelectItem value="none">Без скидки</SelectItem>
                              <SelectItem value="percent">%</SelectItem>
                              <SelectItem value="amount">Сумма</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="order-discount-value">Значение</FieldLabel>
                          <MoneyInput
                            id="order-discount-value"
                            value={orderDiscountInput}
                            disabled={pending}
                            readOnly={orderDiscountType === "none"}
                            className="w-24 text-right"
                            onChange={(next) => {
                              setOrderDiscountTouched(true)
                              setOrderDiscountInput(next)
                            }}
                          />
                        </Field>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-fit bg-muted/60 text-muted-foreground"
                      disabled={pending}
                      onClick={() => {
                        setOrderDiscountOpen(true)
                        if (orderDiscountType === "none") {
                          handleOrderDiscountTypeChange("percent")
                        }
                      }}
                    >
                      <PercentIcon data-icon="inline-start" />
                      Скидка на чек
                    </Button>
                  )}

                  {prepaidTooHigh && (
                    <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                      <AlertTriangleIcon />
                      <AlertTitle>Предоплата выше итога</AlertTitle>
                      <AlertDescription>Уменьшите предоплату до суммы заказа после скидок.</AlertDescription>
                    </Alert>
                  )}
                </FieldGroup>
              </div>

              {nextStep ? (
                <div className="mt-auto flex justify-end pt-1">
                  <Button type="button" variant="ghost" className="bg-muted/60" onClick={() => setStep(nextStep.key)}>
                    Далее: {nextStep.title}
                    <ChevronRightIcon data-icon="inline-end" />
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {/* Футер: итог + остаток + главное действие. */}
        <div className="shrink-0 border-t border-border/40 bg-background px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 @3xl/order:flex-row @3xl/order:items-center @3xl/order:justify-between">
            <div className="flex items-end gap-6">
              <div>
                <div className="text-xs text-muted-foreground">Итого после скидок</div>
                <div className="text-xl font-semibold leading-tight tabular-nums sm:text-2xl">{formatMoney(total)}</div>
              </div>
              <div>
                {fullyPaid ? (
                  <div className="flex items-center gap-1.5 text-emerald-600">
                    <CheckCircle2Icon className="size-4" />
                    <span className="text-sm font-semibold">Оплачено полностью</span>
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground">Остаток к доплате</div>
                    <div className="text-xl font-semibold leading-tight tabular-nums sm:text-2xl">{formatMoney(Math.max(0, balance))}</div>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex sm:flex-row sm:items-center">
              {/* Черновик: недоформленный заказ (минимум — имя клиента), без резерва склада. Доступен
                  даже без позиций/смены, поэтому НЕ гейтится orderDisabled. */}
              <Button type="submit" data-intent="draft" variant="ghost" className="h-11 bg-muted/60 sm:min-w-44" disabled={pending || prepaidSplit.enabled}>
                <ReceiptTextIcon data-icon="inline-start" />
                <span className="sm:hidden">Черновик</span>
                <span className="max-sm:hidden">Сохранить черновик</span>
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span tabIndex={orderDisabled ? 0 : -1} className="block" />}>
                    <Button className="h-11 w-full border-brand bg-brand text-white shadow-sm hover:border-brand-strong hover:bg-brand-strong sm:min-w-52" type="submit" data-intent="create" disabled={orderDisabled}>
                      {pending ? (
                        <>
                          <Loader2Icon data-icon="inline-start" className="animate-spin" />
                          Проведение…
                        </>
                      ) : (
                        "Провести заказ"
                      )}
                    </Button>
                  </TooltipTrigger>
                  {orderDisabledReason && !pending && <TooltipContent>{orderDisabledReason}</TooltipContent>}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          {/* На тач-экране подсказки по наведению нет — причину показываем текстом. */}
          {orderDisabledReason && !pending ? (
            <p className="mt-2 text-xs text-muted-foreground sm:hidden">{orderDisabledReason}</p>
          ) : null}
          {prepaidSplit.enabled && (
            <p className="mt-2 text-xs text-muted-foreground">
              Черновик хранит один способ предоплаты — уберите смешанную оплату или проведите заказ сразу.
            </p>
          )}
        </div>
      </form>
    </>
  )
}

// Переключатель этапов: номер, название, галочка у заполненного. Клик — просто показать этап.
function StepSwitch({
  value,
  done,
  onChange,
}: {
  value: OrderStepKey
  done: Record<OrderStepKey, boolean>
  onChange: (value: OrderStepKey) => void
}) {
  return (
    <div role="tablist" aria-label="Этапы заказа" className="flex h-11 w-full items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {steps.map((entry) => {
        const active = entry.key === value
        const complete = done[entry.key]
        return (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(entry.key)}
            className={cn(
              "flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
              active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                complete ? "bg-emerald-500 text-white" : active ? "bg-brand-subtle text-brand-strong" : "bg-background/70 text-muted-foreground"
              )}
            >
              {complete ? <CheckIcon className="size-3" /> : entry.index}
            </span>
            <span className="truncate">{entry.title}</span>
          </button>
        )
      })}
    </div>
  )
}

// Чип даты «Сегодня/Завтра/Послезавтра».
function DateChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 rounded-md px-2.5 text-sm font-medium transition-colors pointer-coarse:h-9",
        active ? "bg-brand text-brand-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}

// Карточка-выбор (самовывоз / доставка) с иконкой и подсказкой.
function ChoiceCard({
  icon: Icon,
  label,
  hint,
  active,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-start gap-3 rounded-lg p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
        active ? "bg-brand-subtle ring-1 ring-brand/40" : "bg-muted/40 hover:bg-muted/70"
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", active ? "bg-brand text-brand-foreground" : "bg-background text-muted-foreground")}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}
