"use client"

import { Fragment, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ClockIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  MinusCircleIcon,
  PercentIcon,
  PlusCircleIcon,
  PlusIcon,
  ReceiptTextIcon,
  UserPlusIcon,
  WalletIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  cashInAction,
  cashOutAction,
  createCashCustomerAction,
  createOrderAction,
  createOrderDraftAction,
  createSaleAction,
  updatePaymentMethodAction,
} from "@/app/actions"
import type {
  CustomerOption,
  DashboardData,
  PaymentMethod,
  Product,
  BouquetTemplate,
} from "@/lib/db"
import { cashTransactionTypeLabel, deliveryTypeLabel, discountTypeLabel, getPaymentMethodLabel, paymentMethodOptions, sourceLabel, sourceOptions } from "@/lib/labels"
import { calculateCommercialTotals, normalizeDiscountType, type DiscountType } from "@/lib/pricing"
import { cn, formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ProductCombobox } from "@/components/products/product-combobox"
import { CustomerCombobox } from "@/components/customers/customer-combobox"
import {
  addProductToLineItems,
  addBouquetToLineItems,
  getProductLineItemsForTotals,
  ProductLineItems,
  type ProductLineItem,
  validateProductLineItems,
} from "@/components/products/product-line-items"
import {
  Info,
  dateTime,
  OrdersActivityRefresh,
} from "@/components/orders/order-shared"
import { LineComposition, type CompositionItem } from "@/components/cash/line-composition"

type Result = Awaited<ReturnType<typeof createSaleAction>>
type CustomerCreateResult = Awaited<ReturnType<typeof createCashCustomerAction>>
type CashOperation = "cashIn" | "cashOut"

// Номера в Кыргызстане начинаются с +996 — поля номера предзаполняем этим префиксом.
const PHONE_PREFIX = "+996 "

// Если в поле остался только префикс (номер не вводили) — отправляем пустую строку,
// чтобы не сохранять «+996» как телефон/получателя.
function phoneForSubmit(value: string) {
  const trimmed = value.trim()
  return trimmed === PHONE_PREFIX.trim() ? "" : trimmed
}

// Касса (продажа) — единый экран walk-in без табов. Оформление заказа с доставкой
// вынесено в модалку («Создать заказ»), показатели смены и кассовые операции —
// в боковую панель «Касса за смену» (кнопка в верхней зоне). Открытие/закрытие смены
// живут в CrmShell (shiftContext + ShiftSheet).
export function CashPage({ data }: { data: DashboardData }) {
  const router = useRouter()
  const [cashOperation, setCashOperation] = useState<CashOperation | null>(null)
  const [orderOpen, setOrderOpen] = useState(false)
  const [shiftDetailsOpen, setShiftDetailsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  // Единая корзина: walk-in продажа и оформление заказа работают с одним составом —
  // «Создать заказ» наследует уже набранные позиции.
  const [items, setItems] = useState<ProductLineItem[]>([])

  const openShift = data.stats.openShift
  const activeShiftDetail = openShift
    ? data.shiftDetails.find((detail) => detail.shift.id === openShift.id) ?? null
    : data.shiftDetails[0] ?? null

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

  function submitForm(
    event: React.FormEvent<HTMLFormElement>,
    action: (formData: FormData) => Promise<Result>,
    after?: () => void
  ) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    run(() => action(formData), after)
  }

  return (
    <>
      <OrdersActivityRefresh />
      <div className="flex flex-col gap-4">
        {!openShift && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <AlertTriangleIcon />
            <AlertTitle>Откройте смену для кассовых операций</AlertTitle>
            <AlertDescription>
              Продажа, предоплата, доплата и выдача денег курьеру доступны только при открытой смене.
            </AlertDescription>
          </Alert>
        )}

        {/* Верхняя зона: заголовок + «Касса за смену» (панель смены). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-lg font-semibold text-zinc-900">Продажа</h1>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShiftDetailsOpen(true)}
          >
            <WalletIcon data-icon="inline-start" />
            Касса за смену
          </Button>
        </div>

        <QuickSaleForm
          products={data.products}
          bouquets={data.bouquetTemplates}
          customers={data.customers}
          pending={isPending}
          disabled={!openShift}
          items={items}
          setItems={setItems}
          onCreateOrder={() => setOrderOpen(true)}
          onSubmit={(event, after) => submitForm(event, createSaleAction, after)}
        />
      </div>

      <OrderDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        products={data.products}
        bouquets={data.bouquetTemplates}
        customers={data.customers}
        pending={isPending}
        shiftOpen={Boolean(openShift)}
        items={items}
        setItems={setItems}
        onSubmit={(event, after) => {
          const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null
          const action = submitter?.getAttribute("data-intent") === "draft" ? createOrderDraftAction : createOrderAction
          submitForm(event, action, () => {
            after?.()
            setOrderOpen(false)
          })
        }}
      />

      <ShiftDetailsSheet
        open={shiftDetailsOpen}
        onOpenChange={setShiftDetailsOpen}
        detail={activeShiftDetail}
        openShift={openShift}
        pending={isPending}
        onCashOperation={(operation) => {
          setShiftDetailsOpen(false)
          setCashOperation(operation)
        }}
      />

      <CashOperationDialog
        operation={cashOperation}
        pending={isPending}
        onOpenChange={(open) => !open && setCashOperation(null)}
        onSubmit={(event, operation) => {
          submitForm(event, operation === "cashIn" ? cashInAction : cashOutAction, () => setCashOperation(null))
        }}
      />
    </>
  )
}

function upsertCustomerOption(customers: CustomerOption[], customer: CustomerOption) {
  const next = [customer, ...customers.filter((item) => item.id !== customer.id)]
  return next.sort((left, right) => left.name.localeCompare(right.name, "ru"))
}

function CustomerCreateDialog({
  open,
  pending,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (customer: CustomerOption) => void
}) {
  const [isCreating, startTransition] = useTransition()
  const disabled = pending || isCreating

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    startTransition(async () => {
      const result: CustomerCreateResult = await createCashCustomerAction(formData)
      if (result.ok) {
        toast.success(result.message)
        onCreated(result.data)
        form.reset()
        onOpenChange(false)
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Новый клиент</DialogTitle>
            <DialogDescription>Клиент будет сразу выбран в текущей продаже или заказе.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="cash-customer-name">Имя</FieldLabel>
              <Input id="cash-customer-name" name="name" disabled={disabled} required />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="cash-customer-phone">Телефон</FieldLabel>
                <Input id="cash-customer-phone" name="phone" inputMode="tel" defaultValue={PHONE_PREFIX} disabled={disabled} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cash-customer-instagram">Instagram</FieldLabel>
                <Input id="cash-customer-instagram" name="instagram" disabled={disabled} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="cash-customer-source">Источник</FieldLabel>
                <Select name="source" defaultValue="manual">
                  <SelectTrigger id="cash-customer-source" className="w-full" disabled={disabled}>
                    <SelectValue placeholder="Источник">{(value) => sourceLabel(String(value ?? "manual"))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      {sourceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="cash-customer-discount">Скидка клиента, %</FieldLabel>
                <Input
                  id="cash-customer-discount"
                  name="defaultDiscountPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue="0"
                  disabled={disabled}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="cash-customer-comment">Комментарий</FieldLabel>
              <Textarea id="cash-customer-comment" name="comment" disabled={disabled} rows={3} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={disabled}>
              Создать клиента
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Маленькая «таблетка» для опциональных секций продажи (Клиент/Скидка/Комментарий).
function AddChip({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof PercentIcon
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-full text-zinc-600"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon data-icon="inline-start" />
      {label}
    </Button>
  )
}

function QuickSaleForm({
  products,
  bouquets,
  customers,
  pending,
  disabled,
  items,
  setItems,
  onCreateOrder,
  onSubmit,
}: {
  products: Product[]
  bouquets: BouquetTemplate[]
  customers: CustomerOption[]
  pending: boolean
  disabled: boolean
  items: ProductLineItem[]
  setItems: React.Dispatch<React.SetStateAction<ProductLineItem[]>>
  onCreateOrder: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [createdCustomers, setCreatedCustomers] = useState<CustomerOption[]>([])
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [saleDiscountType, setSaleDiscountType] = useState<DiscountType>("none")
  const [saleDiscountValue, setSaleDiscountValue] = useState(0)
  const [saleDiscountTouched, setSaleDiscountTouched] = useState(false)
  const [saleDiscountOpen, setSaleDiscountOpen] = useState(false)
  const [receivedInput, setReceivedInput] = useState("")
  const [note, setNote] = useState("")
  const [noteOpen, setNoteOpen] = useState(false)
  // Клиент/скидка/комментарий для walk-in опциональны — секции свёрнуты, пока их не раскрыли
  // или пока в них нет данных.
  const saleDiscountActive = saleDiscountType !== "none"
  const showSaleDiscount = saleDiscountOpen || saleDiscountActive
  const showCustomer = customerOpen || selectedCustomerId !== null
  const showNote = noteOpen || note.trim() !== ""
  const availableCustomers = useMemo(
    () => createdCustomers.reduce((current, customer) => upsertCustomerOption(current, customer), customers),
    [createdCustomers, customers]
  )
  const selectedCustomer = selectedCustomerId === null
    ? null
    : availableCustomers.find((customer) => customer.id === selectedCustomerId) ?? null
  const saleTotals = calculateCommercialTotals(getProductLineItemsForTotals(items), saleDiscountType, saleDiscountValue)
  const saleTotal = saleTotals.total
  const hasAnyDiscount = saleTotals.itemsDiscountTotal > 0 || saleTotals.dealDiscountAmount > 0
  const productByCode = useMemo(() => new Map(products.map((product) => [product.code, product])), [products])
  // Сводная нехватка по корзине: сравниваем суммарную потребность по каждому коду с остатком.
  const cartShortageCount = useMemo(() => {
    const requiredByCode = new Map<string, number>()
    for (const item of items) {
      const qty = Number.isFinite(item.qty) ? item.qty : 0
      requiredByCode.set(item.productCode, (requiredByCode.get(item.productCode) ?? 0) + qty)
    }
    let count = 0
    for (const [code, requiredQty] of requiredByCode) {
      const product = productByCode.get(code)
      if (product && requiredQty > product.stock) {
        count += 1
      }
    }
    return count
  }, [items, productByCode])
  // «Получено / Сдача» — клиентский расчёт сдачи для наличных, ничего не сохраняем.
  const isCash = paymentMethod === "cash"
  const received = Number(receivedInput.replace(",", "."))
  const hasReceived = receivedInput.trim() !== "" && Number.isFinite(received)
  const changeDue = hasReceived ? Math.max(0, Math.round((received - saleTotal) * 100) / 100) : 0
  const shortfall = hasReceived ? Math.round((saleTotal - received) * 100) / 100 : 0
  const cashShort = isCash && hasReceived && shortfall > 0
  const cartEmpty = items.length === 0
  const completeDisabledReason = disabled
    ? "Смена закрыта"
    : cartEmpty
      ? "Добавьте позиции"
      : !paymentMethod
        ? "Выберите способ оплаты"
        : cashShort
          ? `Не хватает ${formatMoney(shortfall)}`
          : null
  const completeDisabled = pending || Boolean(completeDisabledReason)

  function addProduct(product: Product) {
    setItems((current) => addProductToLineItems(current, product))
  }

  function addBouquet(bouquet: BouquetTemplate) {
    setItems((current) => addBouquetToLineItems(current, bouquet))
  }

  function resetForm() {
    setItems([])
    setSelectedCustomerId(null)
    setCustomerOpen(false)
    setSaleDiscountType("none")
    setSaleDiscountValue(0)
    setSaleDiscountTouched(false)
    setSaleDiscountOpen(false)
    setReceivedInput("")
    setNote("")
    setNoteOpen(false)
  }

  function clearSaleDiscount() {
    setSaleDiscountTouched(true)
    setSaleDiscountType("none")
    setSaleDiscountValue(0)
    setSaleDiscountOpen(false)
  }

  function applySaleCustomer(customer: CustomerOption | null) {
    setSelectedCustomerId(customer?.id ?? null)
    if (!saleDiscountTouched) {
      if (customer && customer.defaultDiscountPercent > 0) {
        setSaleDiscountType("percent")
        setSaleDiscountValue(customer.defaultDiscountPercent)
      } else {
        setSaleDiscountType("none")
        setSaleDiscountValue(0)
      }
    }
  }

  function handleCustomerCreated(customer: CustomerOption) {
    setCreatedCustomers((current) => upsertCustomerOption(current, customer))
    setCustomerOpen(true)
    applySaleCustomer(customer)
  }

  function handleSaleDiscountTypeChange(value: string) {
    const nextType = normalizeDiscountType(value)
    setSaleDiscountTouched(true)
    setSaleDiscountType(nextType)
    if (nextType === "none") {
      setSaleDiscountValue(0)
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const validationError = validateProductLineItems(items)
    if (validationError) {
      event.preventDefault()
      toast.error(validationError)
      return
    }

    if (cashShort) {
      event.preventDefault()
      toast.error(`Полученная сумма меньше итога. Не хватает ${formatMoney(shortfall)}.`)
      return
    }

    onSubmit(event, resetForm)
  }

  return (
    <>
      <CustomerCreateDialog
        open={customerDialogOpen}
        pending={pending || disabled}
        onOpenChange={setCustomerDialogOpen}
        onCreated={handleCustomerCreated}
      />
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* Левая колонка: крупный поиск (автофокус) + компактная корзина. */}
          <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
            <ProductCombobox
              products={products}
              bouquets={bouquets}
              includeBouquets
              portalDropdown
              autoFocus
              inputClassName="h-12 rounded-xl text-base"
              placeholder="Найти товар — название, код или артикул"
              disabled={pending}
              onSelect={addProduct}
              onSelectBouquet={addBouquet}
            />
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-700">Корзина</span>
                {items.length > 0 && (
                  <span className="text-xs text-zinc-500">{items.length} поз.</span>
                )}
              </div>
              <ProductLineItems
                products={products}
                items={items}
                disabled={pending}
                emptyTitle="Корзина пуста"
                onItemsChange={setItems}
              />
            </div>
          </div>

          {/* Правая колонка: панель оплаты. На виду — способ оплаты, получено, сдача, итог. */}
          <div className="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white shadow-sm xl:sticky xl:top-20 xl:self-start">
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <input type="hidden" name="customerId" value={selectedCustomer?.id ?? ""} />
              <input type="hidden" name="saleDiscountType" value={saleDiscountType} />
              <input type="hidden" name="saleDiscountValue" value={saleDiscountValue} />
              <input type="hidden" name="paymentMethod" value={paymentMethod} />

              <Field>
                <FieldLabel htmlFor="salePaymentMethod">Способ оплаты</FieldLabel>
                <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value ?? "cash")}>
                  <SelectTrigger id="salePaymentMethod" className="w-full" disabled={disabled || pending}>
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

              {isCash && (
                <Field>
                  <FieldLabel htmlFor="sale-received">Получено от клиента</FieldLabel>
                  <Input
                    id="sale-received"
                    inputMode="decimal"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    value={receivedInput}
                    disabled={disabled || pending}
                    className="h-12 text-right text-lg tabular-nums"
                    onChange={(event) => setReceivedInput(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  {!hasReceived && (
                    <FieldDescription>Введите полученную сумму, чтобы рассчитать сдачу.</FieldDescription>
                  )}
                </Field>
              )}

              {/* Клиент — опционален для walk-in: свёрнут, пока не выбран. */}
              {showCustomer && (
                <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel className="m-0">Клиент</FieldLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-zinc-500"
                      disabled={disabled || pending}
                      onClick={() => {
                        applySaleCustomer(null)
                        setCustomerOpen(false)
                      }}
                    >
                      <XIcon data-icon="inline-start" />
                      Убрать
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <CustomerCombobox
                      customers={availableCustomers}
                      value={selectedCustomerId}
                      disabled={disabled || pending}
                      onChange={applySaleCustomer}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={disabled || pending}
                      onClick={() => setCustomerDialogOpen(true)}
                    >
                      Новый
                    </Button>
                  </div>
                  {selectedCustomer?.defaultDiscountPercent ? (
                    <Badge className="w-fit bg-emerald-100 text-emerald-900">
                      Скидка клиента {selectedCustomer.defaultDiscountPercent}%
                    </Badge>
                  ) : selectedCustomer ? (
                    <Badge variant="outline" className="w-fit">Без персональной скидки</Badge>
                  ) : null}
                  {selectedCustomer && (
                    <div className="text-xs text-zinc-500">
                      {selectedCustomer.phone || "Телефон не указан"}
                    </div>
                  )}
                </div>
              )}

              {/* Скидка на чек — редка, свёрнута по умолчанию. */}
              {showSaleDiscount && (
                <FieldSet className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLegend className="m-0">Скидка на чек</FieldLegend>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-zinc-500"
                      disabled={disabled || pending}
                      onClick={clearSaleDiscount}
                    >
                      <XIcon data-icon="inline-start" />
                      Убрать
                    </Button>
                  </div>
                  <div className="flex items-end gap-2">
                    <Field>
                      <FieldLabel htmlFor="saleDiscountType">Тип</FieldLabel>
                      <Select value={saleDiscountType} onValueChange={(value) => handleSaleDiscountTypeChange(value ?? "none")}>
                        <SelectTrigger id="saleDiscountType" className="w-32" disabled={disabled || pending}>
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
                      <FieldLabel htmlFor="saleDiscountValue">Значение</FieldLabel>
                      <Input
                        id="saleDiscountValue"
                        type="number"
                        step="1"
                        min="0"
                        value={saleDiscountValue}
                        disabled={disabled || pending}
                        readOnly={saleDiscountType === "none"}
                        className="w-24 text-right tabular-nums"
                        onChange={(event) => {
                          setSaleDiscountTouched(true)
                          setSaleDiscountValue(Number(event.target.value) || 0)
                        }}
                      />
                    </Field>
                  </div>
                </FieldSet>
              )}

              {/* Комментарий — необязателен, свёрнут по умолчанию. */}
              {showNote && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="sale-note" className="m-0 text-xs font-normal text-zinc-500">
                      Комментарий
                    </FieldLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-zinc-500"
                      disabled={disabled || pending}
                      onClick={() => {
                        setNote("")
                        setNoteOpen(false)
                      }}
                    >
                      <XIcon data-icon="inline-start" />
                      Убрать
                    </Button>
                  </div>
                  <Textarea
                    id="sale-note"
                    name="note"
                    rows={2}
                    className="text-sm"
                    value={note}
                    disabled={disabled || pending}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
              )}

              {cartShortageCount > 0 && (
                <Alert variant="destructive">
                  <AlertTriangleIcon />
                  <AlertTitle>Не хватает остатков</AlertTitle>
                  <AlertDescription>
                    {cartShortageCount === 1
                      ? "По одной позиции склад уйдёт в минус. Проверьте корзину."
                      : `По ${cartShortageCount} позициям склад уйдёт в минус. Проверьте корзину.`}
                  </AlertDescription>
                </Alert>
              )}

              {/* Разбивка показывается только когда есть скидка — иначе не загромождаем. */}
              {hasAnyDiscount && (
                <div className="grid gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  <Info label="Товары до скидки" value={formatMoney(saleTotals.itemsTotalBeforeDiscount)} />
                  {saleTotals.itemsDiscountTotal > 0 && (
                    <Info label="Скидка по позициям" value={`− ${formatMoney(saleTotals.itemsDiscountTotal)}`} />
                  )}
                  {saleTotals.dealDiscountAmount > 0 && (
                    <Info label="Скидка на чек" value={`− ${formatMoney(saleTotals.dealDiscountAmount)}`} />
                  )}
                </div>
              )}

              {/* Добавить опциональные секции. */}
              {(!showCustomer || !showSaleDiscount || !showNote) && (
                <div className="flex flex-wrap gap-2">
                  {!showCustomer && (
                    <AddChip
                      icon={UserPlusIcon}
                      label="Клиент"
                      disabled={disabled || pending}
                      onClick={() => setCustomerOpen(true)}
                    />
                  )}
                  {!showSaleDiscount && (
                    <AddChip
                      icon={PercentIcon}
                      label="Скидка"
                      disabled={disabled || pending}
                      onClick={() => {
                        setSaleDiscountOpen(true)
                        if (saleDiscountType === "none") {
                          handleSaleDiscountTypeChange("percent")
                        }
                      }}
                    />
                  )}
                  {!showNote && (
                    <AddChip
                      icon={MessageSquarePlusIcon}
                      label="Комментарий"
                      disabled={disabled || pending}
                      onClick={() => setNoteOpen(true)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Закреплённый итог + сдача + главное действие. */}
            <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-b-xl border-t border-zinc-200 bg-white/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:px-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Итого к оплате</div>
                  <div className="text-2xl font-semibold leading-tight tabular-nums text-zinc-950">{formatMoney(saleTotal)}</div>
                </div>
                {isCash && hasReceived && (
                  cashShort ? (
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-1 text-xs font-medium text-destructive">
                        <AlertTriangleIcon className="size-3.5" />
                        Не хватает
                      </div>
                      <div className="text-2xl font-semibold leading-tight tabular-nums text-destructive">{formatMoney(shortfall)}</div>
                    </div>
                  ) : (
                    <div className="text-right">
                      <div className="text-xs text-zinc-500">Сдача</div>
                      <div className="text-2xl font-bold leading-tight tabular-nums text-zinc-950">{formatMoney(changeDue)}</div>
                    </div>
                  )
                )}
              </div>
              {isCash && hasReceived && cashShort && (
                <div className="text-xs text-destructive/80">
                  Полученной суммы недостаточно — продажу нельзя провести.
                </div>
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span tabIndex={completeDisabled ? 0 : -1} className="block w-full" />
                    }
                  >
                    <Button
                      className="h-11 w-full border-brand bg-brand text-white shadow-sm hover:border-brand-strong hover:bg-brand-strong"
                      type="submit"
                      disabled={completeDisabled}
                    >
                      {pending ? (
                        <>
                          <Loader2Icon data-icon="inline-start" className="animate-spin" />
                          Проведение…
                        </>
                      ) : (
                        <>
                          <ReceiptTextIcon data-icon="inline-start" />
                          Провести продажу
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  {completeDisabledReason && !pending && (
                    <TooltipContent>{completeDisabledReason}</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
              {/* Оформление заказа с доставкой — наследует текущую корзину. */}
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full border-brand bg-brand-subtle/40 text-brand-strong hover:border-brand-strong hover:bg-brand-subtle hover:text-brand-strong"
                disabled={pending}
                onClick={onCreateOrder}
              >
                <PlusIcon data-icon="inline-start" />
                Создать заказ
              </Button>
            </div>
          </div>
        </div>
      </form>
    </>
  )
}

// Шаг модалки заказа — нумерованный заголовок задаёт логичный порядок сверху вниз.
function OrderStep({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-brand-subtle text-[11px] font-semibold text-brand-strong">
          {index}
        </span>
        <h3 className="font-heading text-sm font-semibold text-zinc-900">{title}</h3>
      </div>
      {children}
    </section>
  )
}

// Chip-кнопка «Сегодня/Завтра» — подсвечивается синим, когда выбранная дата совпадает.
function DateChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-brand bg-brand-subtle text-brand-strong"
          : "border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:bg-zinc-100"
      )}
    >
      {label}
    </button>
  )
}

function OrderDialog({
  open,
  onOpenChange,
  products,
  bouquets,
  customers,
  pending,
  shiftOpen,
  items,
  setItems,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: Product[]
  bouquets: BouquetTemplate[]
  customers: CustomerOption[]
  pending: boolean
  shiftOpen: boolean
  items: ProductLineItem[]
  setItems: React.Dispatch<React.SetStateAction<ProductLineItem[]>>
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-6xl">
        <DialogHeader className="shrink-0 border-b border-zinc-200 px-5 py-4">
          <DialogTitle>Новый заказ</DialogTitle>
          <DialogDescription>Оформление заказа с самовывозом или доставкой. Состав наследуется из корзины продажи.</DialogDescription>
        </DialogHeader>
        <NewOrderForm
          products={products}
          bouquets={bouquets}
          customers={customers}
          pending={pending}
          shiftOpen={shiftOpen}
          items={items}
          setItems={setItems}
          onSubmit={onSubmit}
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
  shiftOpen,
  items,
  setItems,
  onSubmit,
}: {
  products: Product[]
  bouquets: BouquetTemplate[]
  customers: CustomerOption[]
  pending: boolean
  shiftOpen: boolean
  items: ProductLineItem[]
  setItems: React.Dispatch<React.SetStateAction<ProductLineItem[]>>
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  const [deliveryType, setDeliveryType] = useState("pickup")
  const [deliveryPrice, setDeliveryPrice] = useState(0)
  const [courierPayout, setCourierPayout] = useState(0)
  const [prepaid, setPrepaid] = useState(0)
  const [customer, setCustomer] = useState("")
  const [phone, setPhone] = useState(PHONE_PREFIX)
  const [recipientPhone, setRecipientPhone] = useState(PHONE_PREFIX)
  const [createdCustomers, setCreatedCustomers] = useState<CustomerOption[]>([])
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>("none")
  const [orderDiscountValue, setOrderDiscountValue] = useState(0)
  const [orderDiscountTouched, setOrderDiscountTouched] = useState(false)
  const [orderDiscountOpen, setOrderDiscountOpen] = useState(false)
  const [dueDate, setDueDate] = useState("")
  const [dueTime, setDueTime] = useState("")
  const [address, setAddress] = useState("")
  const [note, setNote] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("cash")

  const availableCustomers = useMemo(
    () => createdCustomers.reduce((current, customerOption) => upsertCustomerOption(current, customerOption), customers),
    [createdCustomers, customers]
  )
  const selectedCustomer = selectedCustomerId === null
    ? null
    : availableCustomers.find((current) => current.id === selectedCustomerId) ?? null
  const isDelivery = deliveryType === "delivery"
  const effectiveDeliveryPrice = isDelivery ? deliveryPrice : 0
  const orderTotals = calculateCommercialTotals(getProductLineItemsForTotals(items), orderDiscountType, orderDiscountValue)
  const itemsTotal = orderTotals.total
  const total = itemsTotal + effectiveDeliveryPrice
  const balance = total - prepaid
  const fullyPaid = items.length > 0 && balance <= 0
  const needsShift = prepaid > 0 && !shiftOpen
  const prepaidTooHigh = prepaid > total
  const dueAt = dueDate && dueTime ? `${dueDate}T${dueTime}` : ""
  const orderDisabledReason = items.length === 0
    ? "Добавьте позиции"
    : needsShift
      ? "Откройте смену для предоплаты"
      : prepaidTooHigh
        ? "Предоплата выше итога"
        : null
  const orderDisabled = pending || Boolean(orderDisabledReason)
  const orderDiscountActive = orderDiscountType !== "none"
  const showOrderDiscount = orderDiscountOpen || orderDiscountActive
  const todayValue = dateInputValue(new Date())
  const tomorrowValue = dateInputValue(addLocalDays(new Date(), 1))

  function addProduct(product: Product) {
    setItems((current) => addProductToLineItems(current, product))
  }

  function addBouquet(bouquet: BouquetTemplate) {
    setItems((current) => addBouquetToLineItems(current, bouquet))
  }

  function resetForm() {
    setItems([])
    setSelectedCustomerId(null)
    setCustomer("")
    setPhone(PHONE_PREFIX)
    setRecipientPhone(PHONE_PREFIX)
    setOrderDiscountType("none")
    setOrderDiscountValue(0)
    setOrderDiscountTouched(false)
    setOrderDiscountOpen(false)
    setDueDate("")
    setDueTime("")
    setDeliveryType("pickup")
    setAddress("")
    setNote("")
    setDeliveryPrice(0)
    setCourierPayout(0)
    setPrepaid(0)
    setPaymentMethod("cash")
  }

  function handleDeliveryTypeChange(value: string) {
    const next = value ?? "pickup"
    setDeliveryType(next)
    // Самовывоз обнуляет доставку/курьера/адрес, чтобы они не попали в итог и заказ.
    if (next !== "delivery") {
      setDeliveryPrice(0)
      setCourierPayout(0)
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
        setOrderDiscountValue(nextCustomer.defaultDiscountPercent)
      } else {
        setOrderDiscountType("none")
        setOrderDiscountValue(0)
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
      setOrderDiscountValue(0)
    }
  }

  function clearOrderDiscount() {
    setOrderDiscountTouched(true)
    setOrderDiscountType("none")
    setOrderDiscountValue(0)
    setOrderDiscountOpen(false)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Черновик (data-intent="draft"): минимум — имя клиента; позиции/смена/предоплата необязательны,
    // полная валидация — при отправке в работу. Пропускаем строгие проверки и отдаём наверх.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    if (submitter?.getAttribute("data-intent") === "draft") {
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
      toast.error("Суммы не могут быть отрицательными.")
      return
    }

    if (needsShift) {
      event.preventDefault()
      toast.error("Откройте смену для предоплаты.")
      return
    }

    if (prepaidTooHigh) {
      event.preventDefault()
      toast.error("Предоплата не может быть больше итога заказа.")
      return
    }

    onSubmit(event, resetForm)
  }

  function setDueDay(offsetDays: number) {
    setDueDate(dateInputValue(addLocalDays(new Date(), offsetDays)))
    if (!dueTime) {
      setDueTime("18:00")
    }
  }

  return (
    <>
      <CustomerCreateDialog
        open={customerDialogOpen}
        pending={pending}
        onOpenChange={setCustomerDialogOpen}
        onCreated={handleCustomerCreated}
      />
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        {/* Прокручиваемое тело модалки: Клиент → Получение → Состав → Оплата. */}
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
          <input type="hidden" name="customerId" value={selectedCustomer?.id ?? ""} />
          <input type="hidden" name="orderDiscountType" value={orderDiscountType} />
          <input type="hidden" name="orderDiscountValue" value={orderDiscountValue} />
          <input type="hidden" name="deliveryType" value={deliveryType} />
          <input type="hidden" name="paymentMethod" value={paymentMethod} />
          <input type="hidden" name="dueAt" value={dueAt} />

          <OrderStep index={1} title="Клиент">
            <FieldGroup>
              <Field>
                <FieldLabel>Выбор клиента</FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <CustomerCombobox
                    customers={availableCustomers}
                    value={selectedCustomerId}
                    disabled={pending}
                    onChange={applyOrderCustomer}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setCustomerDialogOpen(true)}
                  >
                    Новый клиент
                  </Button>
                </div>
                {selectedCustomer?.defaultDiscountPercent ? (
                  <Badge className="w-fit bg-emerald-100 text-emerald-900">
                    Скидка клиента {selectedCustomer.defaultDiscountPercent}%
                  </Badge>
                ) : selectedCustomer ? (
                  <Badge variant="outline" className="w-fit">Без персональной скидки</Badge>
                ) : (
                  <FieldDescription>Можно выбрать клиента или заполнить контакты вручную.</FieldDescription>
                )}
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="customer">Имя клиента</FieldLabel>
                  <Input
                    id="customer"
                    name="customer"
                    value={customer}
                    onChange={(event) => setCustomer(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="phone">Телефон</FieldLabel>
                  <Input id="phone" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
                  <input type="hidden" name="phone" value={phoneForSubmit(phone)} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="recipientPhone">Номер получателя</FieldLabel>
                <Input
                  id="recipientPhone"
                  inputMode="tel"
                  placeholder="Например, +996 700 123 456"
                  value={recipientPhone}
                  onChange={(event) => setRecipientPhone(event.target.value)}
                />
                <input type="hidden" name="recipientPhone" value={phoneForSubmit(recipientPhone)} />
              </Field>
            </FieldGroup>
          </OrderStep>

          <OrderStep index={2} title="Получение">
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Дата и время</FieldLabel>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <div className="relative">
                      <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="dueDate"
                        type="date"
                        className="pl-9 tabular-nums"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                      />
                    </div>
                    <div className="relative">
                      <ClockIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="dueTime"
                        type="time"
                        step="900"
                        className="pl-9 tabular-nums"
                        value={dueTime}
                        onChange={(event) => setDueTime(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <DateChip label="Сегодня" active={dueDate === todayValue} onClick={() => setDueDay(0)} />
                    <DateChip label="Завтра" active={dueDate === tomorrowValue} onClick={() => setDueDay(1)} />
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="deliveryType">Способ получения</FieldLabel>
                  <Select value={deliveryType} onValueChange={(value) => handleDeliveryTypeChange(value ?? "pickup")}>
                    <SelectTrigger id="deliveryType" className="w-full" disabled={pending}>
                      <SelectValue placeholder="Получение">{(value) => deliveryTypeLabel(String(value ?? "pickup"))}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="pickup">Самовывоз</SelectItem>
                      <SelectItem value="delivery">Доставка</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {isDelivery && (
                <Field>
                  <FieldLabel htmlFor="address">Адрес доставки</FieldLabel>
                  <Input
                    id="address"
                    name="address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="order-note">Комментарий</FieldLabel>
                <Textarea id="order-note" name="note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>
            </FieldGroup>
          </OrderStep>

          <OrderStep index={3} title="Состав заказа">
            <div className="flex min-w-0 flex-col gap-3">
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
          </OrderStep>

          <OrderStep index={4} title="Оплата и итог">
            <FieldGroup>
              {isDelivery && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="deliveryPrice">Платит клиент за доставку</FieldLabel>
                    <Input
                      id="deliveryPrice"
                      name="deliveryPrice"
                      type="number"
                      step="1"
                      min="0"
                      className="tabular-nums"
                      value={deliveryPrice}
                      onChange={(event) => setDeliveryPrice(Number(event.target.value) || 0)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="courierPayout">Выдать курьеру из кассы</FieldLabel>
                    <Input
                      id="courierPayout"
                      name="courierPayout"
                      type="number"
                      step="1"
                      min="0"
                      className="tabular-nums"
                      value={courierPayout}
                      onChange={(event) => setCourierPayout(Number(event.target.value) || 0)}
                    />
                    <FieldDescription>Выплата курьеру не входит в итог — это отдельная кассовая операция.</FieldDescription>
                  </Field>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="prepaid">Предоплата</FieldLabel>
                  <Input
                    id="prepaid"
                    name="prepaid"
                    type="number"
                    step="1"
                    min="0"
                    className="tabular-nums"
                    value={prepaid}
                    onChange={(event) => setPrepaid(Number(event.target.value) || 0)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="orderPaymentMethod">Способ оплаты</FieldLabel>
                  <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value ?? "cash")}>
                    <SelectTrigger id="orderPaymentMethod" className="w-full" disabled={pending}>
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
                <p className="text-xs text-muted-foreground">
                  «Провести заказ» — предоплата сразу уходит в кассу текущей смены. «Сохранить черновик» —
                  сумма и способ запоминаются, в кассу попадут при отправке черновика в работу.
                </p>
              )}

              {showOrderDiscount ? (
                <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Скидка на чек</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-zinc-500"
                      disabled={pending}
                      onClick={clearOrderDiscount}
                    >
                      <XIcon data-icon="inline-start" />
                      Убрать
                    </Button>
                  </div>
                  <div className="flex items-end gap-2">
                    <Field>
                      <FieldLabel htmlFor="orderDiscountType">Тип</FieldLabel>
                      <Select value={orderDiscountType} onValueChange={(value) => handleOrderDiscountTypeChange(value ?? "none")}>
                        <SelectTrigger id="orderDiscountType" className="w-32" disabled={pending}>
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
                      <FieldLabel htmlFor="orderDiscountValue">Значение</FieldLabel>
                      <Input
                        id="orderDiscountValue"
                        type="number"
                        step="1"
                        min="0"
                        value={orderDiscountValue}
                        disabled={pending}
                        readOnly={orderDiscountType === "none"}
                        className="w-24 text-right tabular-nums"
                        onChange={(event) => {
                          setOrderDiscountTouched(true)
                          setOrderDiscountValue(Number(event.target.value) || 0)
                        }}
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit rounded-full text-zinc-600"
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

              {needsShift && (
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>Откройте смену для кассовых операций</AlertTitle>
                  <AlertDescription>Предоплату можно принять только при открытой смене.</AlertDescription>
                </Alert>
              )}
              {prepaidTooHigh && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                  <AlertTriangleIcon />
                  <AlertTitle>Предоплата выше итога</AlertTitle>
                  <AlertDescription>Уменьшите предоплату до суммы заказа после скидок.</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
                <Info label="До скидки" value={formatMoney(orderTotals.itemsTotalBeforeDiscount)} />
                {orderTotals.itemsDiscountTotal > 0 && (
                  <Info label="Скидка по позициям" value={`− ${formatMoney(orderTotals.itemsDiscountTotal)}`} />
                )}
                {orderTotals.dealDiscountAmount > 0 && (
                  <Info label="Скидка на чек" value={`− ${formatMoney(orderTotals.dealDiscountAmount)}`} />
                )}
                {effectiveDeliveryPrice > 0 && <Info label="Доставка" value={formatMoney(effectiveDeliveryPrice)} />}
                {prepaid > 0 && <Info label="Предоплата" value={`− ${formatMoney(prepaid)}`} />}
              </div>
            </FieldGroup>
          </OrderStep>
        </div>

        {/* Закреплённый футер модалки: итог + остаток к доплате + главное действие. */}
        <div className="shrink-0 border-t border-zinc-200 bg-white px-5 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-500">Итого после скидок</div>
                <div className="text-2xl font-semibold leading-tight tabular-nums text-zinc-950">{formatMoney(total)}</div>
              </div>
              <div className="text-right">
                {fullyPaid ? (
                  <div className="flex items-center gap-1.5 text-emerald-600">
                    <CheckCircle2Icon className="size-4" />
                    <span className="text-sm font-semibold">Оплачено полностью</span>
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-zinc-500">Остаток к доплате</div>
                    <div className="text-2xl font-semibold leading-tight tabular-nums text-zinc-950">{formatMoney(Math.max(0, balance))}</div>
                  </>
                )}
              </div>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={<span tabIndex={orderDisabled ? 0 : -1} className="block w-full" />}
                >
                  <Button
                    className="h-11 w-full border-brand bg-brand text-white shadow-sm hover:border-brand-strong hover:bg-brand-strong"
                    type="submit"
                    data-intent="create"
                    disabled={orderDisabled}
                  >
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
                {orderDisabledReason && !pending && (
                  <TooltipContent>{orderDisabledReason}</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            {/* Черновик: недоформленный заказ (минимум — имя клиента), без резерва склада. Доступен
                даже без позиций/смены, поэтому НЕ гейтится orderDisabled. */}
            <Button
              type="submit"
              data-intent="draft"
              variant="outline"
              className="h-10 w-full"
              disabled={pending}
            >
              Сохранить черновик
            </Button>
          </div>
        </div>
      </form>
    </>
  )
}

// Боковая панель «Касса за смену»: показатели смены, последние продажи и кассовые
// операции (внесение/изъятие). Перенесена с главного экрана, чтобы продажа была чистой.
function ShiftDetailsSheet({
  open,
  onOpenChange,
  detail,
  openShift,
  pending,
  onCashOperation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: DashboardData["shiftDetails"][number] | null
  openShift: DashboardData["stats"]["openShift"]
  pending: boolean
  onCashOperation: (operation: CashOperation) => void
}) {
  const summary = detail ? getShiftCashSummary(detail) : null
  const sales = detail?.sales ?? []
  const orderPayments = detail?.relatedOrders ?? []
  // Способ оплаты правим только в текущей открытой смене (у закрытой касса уже зафиксирована).
  const canEditPayments = Boolean(openShift)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-zinc-200">
          <SheetTitle>Касса за смену</SheetTitle>
          <SheetDescription>
            {openShift
              ? `Текущая смена #${openShift.id}`
              : detail
                ? `Последняя смена #${detail.shift.id}`
                : "Откройте смену"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={!openShift || pending}
              onClick={() => onCashOperation("cashIn")}
            >
              <PlusCircleIcon data-icon="inline-start" />
              Внесение наличных
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={!openShift || pending}
              onClick={() => onCashOperation("cashOut")}
            >
              <MinusCircleIcon data-icon="inline-start" />
              Изъятие наличных
            </Button>
          </div>
          {!openShift && (
            <div className="text-xs text-muted-foreground">
              Кассовые операции доступны только при открытой смене.
            </div>
          )}

          {summary ? (
            <div className="grid grid-cols-2 gap-2">
              <CashMetric label="Выручка до скидок" value={formatMoney(summary.revenueBeforeDiscount)} />
              <CashMetric label="Скидки" value={formatMoney(summary.discountTotal)} />
              <CashMetric label="Выручка после скидок" value={formatMoney(summary.revenueTotal)} />
              <CashMetric label="Ожидается в кассе" value={formatMoney(summary.expectedCash)} />
              {summary.deferredPrepayments > 0 && (
                <CashMetric label="Предоплаты по будущим заказам" value={formatMoney(summary.deferredPrepayments)} />
              )}
              {summary.draftPrepaidTotal > 0 && (
                <CashMetric
                  label="Предоплаты в черновиках (не проведены)"
                  value={formatMoney(summary.draftPrepaidTotal)}
                />
              )}
              <CashMetric label="Наличные" value={formatMoney(summary.cash)} />
              <CashMetric label="Карта" value={formatMoney(summary.card)} />
              <CashMetric label="Терминал" value={formatMoney(summary.terminal)} />
              <CashMetric label="Mbank" value={formatMoney(summary.mbank)} />
              <CashMetric label="Optima" value={formatMoney(summary.optima)} />
              <CashMetric label="ЭлСом" value={formatMoney(summary.elsom)} />
              <CashMetric label="Бакай" value={formatMoney(summary.bakai)} />
              <CashMetric label="Перевод" value={formatMoney(summary.transfer)} />
              <CashMetric label="Внесения" value={formatMoney(summary.cashIn)} />
              <CashMetric label="Изъятия" value={formatMoney(summary.cashOutOther)} />
              {summary.courierPayouts > 0 && (
                <CashMetric label="Выплаты курьеру" value={formatMoney(summary.courierPayouts)} />
              )}
            </div>
          ) : (
            <Empty className="min-h-28 py-4">
              <EmptyHeader>
                <EmptyTitle>Откройте смену</EmptyTitle>
                <EmptyDescription>После открытия здесь появятся кассовые показатели.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Хронология кассы</span>
              {(sales.length > 0 || orderPayments.length > 0) && (
                <span className="text-xs text-muted-foreground">
                  {canEditPayments ? "Строка — состав, способ оплаты можно менять" : "Нажмите на строку — состав"}
                </span>
              )}
            </div>
            <ShiftCashTimeline detail={detail} editable={canEditPayments} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Ячейка способа оплаты с возможностью правки прямо в истории кассы. Меняет метод
// проведённой продажи/платежа через updatePaymentMethodAction (только текущая смена).
// Селект не должен раскрывать/сворачивать строку — гасим всплытие клика.
function PaymentMethodCell({
  target,
  id,
  method,
  editable,
}: {
  target: "sale" | "transaction"
  id: number
  method: PaymentMethod
  editable: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (!editable) {
    return <span className="whitespace-nowrap">{getPaymentMethodLabel(method)}</span>
  }

  function handleChange(next: string | null) {
    const value = next ?? ""
    if (!value || value === method || pending) {
      return
    }
    const formData = new FormData()
    formData.set("target", target)
    formData.set("id", String(id))
    formData.set("paymentMethod", value)
    startTransition(async () => {
      const result = await updatePaymentMethodAction(formData)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
      <Select value={method} onValueChange={handleChange}>
        <SelectTrigger
          className="h-8 w-[124px] text-xs"
          disabled={pending}
          onClick={(event) => event.stopPropagation()}
        >
          {pending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <SelectValue>{(value) => getPaymentMethodLabel(String(value ?? method))}</SelectValue>
          )}
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
    </span>
  )
}

// История оплат по заказам в смене: одна строка на платёж (предоплата/доплата/оплата
// сделки), раскрывается составом заказа. Способ оплаты можно поправить inline.
// Минимальный набор полей строки единой ленты кассы за смену.
type TimelineRow = {
  key: string
  createdAt: string
  typeLabel: string
  reference: string
  amount: number
  paymentMethod: PaymentMethod
  outflow: boolean
  refund: boolean
  // Сторнированная продажа: бейдж «сторнировано», способ оплаты только текстом (selectа нет).
  reversed?: boolean
  customer: string
  items: CompositionItem[] | null
  editTarget: { target: "sale" | "transaction"; id: number } | null
}

// Единая хронология кассы за смену: продажи, оплаты по заказам, возвраты и ручные
// внесения/изъятия в одной ленте по времени. Возвраты и изъятия показаны со знаком
// «минус» (возврат — ещё и красным бейджем). Строки продаж/заказов раскрываются
// составом; способ оплаты правится там, где это допустимо (продажа и приход по заказу),
// у возвратов/изъятий метод показан текстом.
function ShiftCashTimeline({
  detail,
  editable,
}: {
  detail: DashboardData["shiftDetails"][number] | null
  editable: boolean
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const rows = useMemo(() => buildTimelineRows(detail), [detail])

  if (!rows.length) {
    return (
      <Empty className="min-h-24 py-4">
        <EmptyHeader>
          <EmptyTitle>Операций пока нет</EmptyTitle>
          <EmptyDescription>
            Здесь появятся продажи, оплаты по заказам, возвраты и внесения/изъятия смены — строку с составом можно раскрыть.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-zinc-200">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead>Операция</TableHead>
            <TableHead>Заказ / продажа</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead>Оплата</TableHead>
            <TableHead>Клиент</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expandable = row.items !== null
            const isOpen = openKey === row.key

            return (
              <Fragment key={row.key}>
                <TableRow
                  className={cn(expandable && "cursor-pointer")}
                  onClick={expandable ? () => setOpenKey(isOpen ? null : row.key) : undefined}
                >
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {expandable ? (
                        <ChevronDownIcon
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isOpen && "rotate-180"
                          )}
                        />
                      ) : (
                        <span className="inline-block size-4 shrink-0" />
                      )}
                      <span className="whitespace-nowrap">{dateTime(row.createdAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={row.refund ? "destructive" : "outline"}>{row.typeLabel}</Badge>
                    {row.reversed && (
                      <Badge variant="outline" className="ml-1 border-red-200 bg-red-50 text-red-700">
                        сторнировано
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{row.reference}</TableCell>
                  <TableCell
                    className={cn(
                      "whitespace-nowrap text-right font-medium tabular-nums",
                      row.outflow && "text-red-600"
                    )}
                  >
                    {row.outflow ? "−" : "+"}
                    {formatMoney(row.amount)}
                  </TableCell>
                  <TableCell>
                    {row.editTarget ? (
                      <PaymentMethodCell
                        target={row.editTarget.target}
                        id={row.editTarget.id}
                        method={row.paymentMethod}
                        editable={editable}
                      />
                    ) : (
                      <span className="whitespace-nowrap">{getPaymentMethodLabel(row.paymentMethod)}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-32 truncate">{row.customer || "-"}</TableCell>
                </TableRow>
                {expandable && isOpen && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30 p-0">
                      <LineComposition items={row.items ?? []} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// Сборка строк единой ленты: продажи (detail.sales), оплаты/возвраты по заказам
// (detail.relatedOrders — order_id != null, любой тип) и ручные внесения/изъятия
// (cash_transactions без привязки к заказу/продаже). Сортировка по времени, новые сверху.
function buildTimelineRows(detail: DashboardData["shiftDetails"][number] | null): TimelineRow[] {
  if (!detail) {
    return []
  }

  const rows: TimelineRow[] = []

  for (const sale of detail.sales) {
    const reversed = Boolean(sale.reversedAt)
    rows.push({
      key: `sale-${sale.id}`,
      createdAt: sale.createdAt,
      typeLabel: "Продажа",
      reference: `Продажа #${sale.id}`,
      amount: sale.total,
      paymentMethod: sale.paymentMethod,
      outflow: false,
      refund: false,
      reversed,
      customer: sale.customerName,
      items: sale.items,
      // У сторнированной продажи способ оплаты заморожен: возврат повторил исходный метод,
      // правка разбалансирует пару «приход+возврат» (сервер такую правку тоже отклоняет).
      editTarget: reversed ? null : { target: "sale", id: sale.id },
    })
  }

  for (const order of detail.relatedOrders) {
    const refund = order.type === "cash_refund"
    const outflow = refund || order.type === "cash_out"
    const isPayment =
      order.type === "prepayment" || order.type === "order_payment" || order.type === "deal_payment"
    rows.push({
      key: `order-${order.transactionId}`,
      createdAt: order.createdAt,
      typeLabel: cashTransactionTypeLabel(order.type),
      reference: order.number || `Заказ #${order.orderId}`,
      amount: order.amount,
      paymentMethod: order.paymentMethod,
      outflow,
      refund,
      customer: order.customer,
      items: order.items,
      editTarget: isPayment ? { target: "transaction", id: order.transactionId } : null,
    })
  }

  // Возвраты по сторно продаж (sale_id != null, к заказу не привязаны) — раньше эти
  // проводки не попадали ни в одну ветку ленты, и минус по кассе выглядел «ниоткуда».
  for (const tx of detail.cashTransactions) {
    if (tx.type !== "cash_refund" || tx.saleId === null || tx.orderId !== null) {
      continue
    }
    rows.push({
      key: `sale-refund-${tx.id}`,
      createdAt: tx.createdAt,
      typeLabel: cashTransactionTypeLabel(tx.type),
      reference: `Продажа #${tx.saleId}`,
      amount: tx.amount,
      paymentMethod: tx.paymentMethod,
      outflow: true,
      refund: true,
      customer: "",
      items: null,
      editTarget: null,
    })
  }

  for (const tx of detail.cashTransactions) {
    if (tx.orderId !== null || tx.saleId !== null) {
      continue
    }
    if (tx.type !== "cash_in" && tx.type !== "cash_out") {
      continue
    }
    rows.push({
      key: `cash-${tx.id}`,
      createdAt: tx.createdAt,
      typeLabel: cashTransactionTypeLabel(tx.type),
      reference: "—",
      amount: tx.amount,
      paymentMethod: tx.paymentMethod,
      outflow: tx.type === "cash_out",
      refund: false,
      customer: "",
      items: null,
      editTarget: null,
    })
  }

  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

function CashMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold tabular-nums text-zinc-950">{value}</div>
    </div>
  )
}

function CashOperationDialog({
  operation,
  pending,
  onOpenChange,
  onSubmit,
}: {
  operation: CashOperation | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, operation: CashOperation) => void
}) {
  const isCashOut = operation === "cashOut"
  const title = isCashOut ? "Изъятие наличных" : "Внесение наличных"
  const formRef = useRef<HTMLFormElement>(null)
  const [amountInput, setAmountInput] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const parsedAmount = Number(amountInput.replace(",", "."))
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!operation) {
      event.preventDefault()
      return
    }

    const amount = Number(new FormData(event.currentTarget).get("amount"))
    if (!Number.isFinite(amount) || amount <= 0) {
      event.preventDefault()
      toast.error("Сумма должна быть больше нуля.")
      return
    }

    onSubmit(event, operation)
  }

  // Изъятие — необратимая денежная операция: перед посылкой money-out
  // показываем AlertDialog с форматированной суммой. Внесение проводится сразу.
  function handlePrimaryClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (!isCashOut) {
      return
    }
    event.preventDefault()
    if (!amountValid) {
      toast.error("Сумма должна быть больше нуля.")
      return
    }
    setConfirmOpen(true)
  }

  function confirmCashOut() {
    setConfirmOpen(false)
    formRef.current?.requestSubmit()
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setConfirmOpen(false)
      setAmountInput("")
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={Boolean(operation)} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Операция пройдет по текущей открытой смене.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cash-operation-amount">Сумма</FieldLabel>
              <Input
                id="cash-operation-amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                className="tabular-nums"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cash-operation-comment">Комментарий</FieldLabel>
              <Textarea id="cash-operation-comment" name="comment" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="submit"
              variant={isCashOut ? "destructive" : "default"}
              disabled={pending}
              onClick={handlePrimaryClick}
            >
              {isCashOut ? (
                <>
                  <MinusCircleIcon data-icon="inline-start" />
                  Изъять
                </>
              ) : (
                <>
                  <PlusCircleIcon data-icon="inline-start" />
                  Внести
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Изъять наличные из кассы?</AlertDialogTitle>
            <AlertDialogDescription>
              Из кассы будет изъято{" "}
              <span className="font-semibold text-foreground">{formatMoney(amountValid ? parsedAmount : 0)}</span>.
              Операция необратима и сразу уменьшит остаток текущей смены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Отмена</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={confirmCashOut}>
              Изъять {formatMoney(amountValid ? parsedAmount : 0)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

function getShiftCashSummary(detail: DashboardData["shiftDetails"][number]) {
  const revenueTypes = new Set(["sale", "prepayment", "order_payment", "deal_payment"])
  const byMethod: Record<PaymentMethod, number> = {
    cash: 0,
    card: 0,
    terminal: 0,
    mbank: 0,
    optima: 0,
    elsom: 0,
    bakai: 0,
    transfer: 0,
  }

  // Выручка по способам — net возвратов: cash_refund отменённого заказа проводится тем же
  // методом, что и приход (refundOrderPayments), поэтому вычитаем его из того же способа,
  // иначе по безналу (mbank/card/перевод/…) выручка завышается на сумму возврата.
  for (const transaction of detail.cashTransactions) {
    if (revenueTypes.has(transaction.type)) {
      byMethod[transaction.paymentMethod] += transaction.amount
    }
  }
  // Возвраты — net по смене ИСХОДНОГО прихода (breakdown.*Refund атрибутирован по
  // source_shift_id), чтобы кросс-сменный возврат не занижал выручку текущей смены.
  // Совпадает с getRevenueByMethod в shift-pages.tsx.
  byMethod.cash -= detail.breakdown.cashRefund
  byMethod.card -= detail.breakdown.cardRefund
  byMethod.terminal -= detail.breakdown.terminalRefund
  byMethod.mbank -= detail.breakdown.mbankRefund
  byMethod.optima -= detail.breakdown.optimaRefund
  byMethod.elsom -= detail.breakdown.elsomRefund
  byMethod.bakai -= detail.breakdown.bakaiRefund
  byMethod.transfer -= detail.breakdown.transferRefund

  return {
    ...byMethod,
    revenueBeforeDiscount: detail.summary.revenueBeforeDiscount,
    discountTotal: detail.summary.discountTotal,
    revenueTotal: detail.summary.revenueTotal,
    expectedCash: detail.summary.expectedCash,
    deferredPrepayments: detail.summary.deferredPrepayments,
    draftPrepaidTotal: detail.summary.draftPrepaidTotal,
    cashIn: detail.summary.cashIn,
    cashOutOther: detail.breakdown.cashOutOther,
    courierPayouts: detail.breakdown.courierPayouts,
  }
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
