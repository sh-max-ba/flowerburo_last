"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  MinusCircleIcon,
  PercentIcon,
  PlusCircleIcon,
  PlusIcon,
  ReceiptTextIcon,
  Trash2Icon,
  TruckIcon,
  UserPlusIcon,
  WalletIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useUrlFlagDialog } from "@/hooks/use-url-flag"
import {
  cashInAction,
  cashOutAction,
  createCashCustomerAction,
  createOrderAction,
  createOrderDraftAction,
  createSaleAction,
} from "@/app/actions"
import type {
  CustomerOption,
  DashboardData,
  OrderImage,
  PaymentMethod,
  Product,
  BouquetTemplate,
} from "@/lib/db"
import { deliveryTypeLabel, discountTypeLabel, getPaymentMethodLabel, paymentMethodOptions, sourceLabel, sourceOptions } from "@/lib/labels"
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
import { ScreenBody } from "@/components/screen-body"
import { HeaderAction, ScreenHeader } from "@/components/screen-header"
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
  OrdersActivityRefresh,
} from "@/components/orders/order-shared"
import { OrderImagesField } from "@/components/orders/order-images"
import { RefundSearchSheet } from "@/components/orders/order-refund"
import { ShiftCashTimeline } from "@/components/cash/shift-cash-timeline"
import { ShiftReceiptsList } from "@/components/cash/shift-receipts-list"
import { SplitPaymentFields, type SplitPaymentState } from "@/components/cash/split-payment-fields"

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

// Ключ localStorage для корзины продажи — чтобы набранный состав не терялся при переходе на другой
// раздел или перезагрузке (F5). Один на браузер; очищается, когда корзина пуста (после продажи).
const CART_STORAGE_KEY = "fb-cash-cart"

// Касса (продажа) — единый экран walk-in без табов. Оформление заказа с доставкой
// вынесено в модалку («Создать заказ»), показатели смены и кассовые операции —
// в боковую панель «Касса за смену» (кнопка в верхней зоне). Открытие/закрытие смены
// живут в CrmShell (shiftContext + ShiftSheet).
export function CashPage({ data, canRefund = false }: { data: DashboardData; canRefund?: boolean }) {
  const router = useRouter()
  const [cashOperation, setCashOperation] = useState<CashOperation | null>(null)
  // Окно заказа открывается кнопкой на кассе и ссылкой /cash?order=new («+ Новый заказ»
  // со стола заказов и «+» на строке меню).
  const [orderOpen, setOrderOpen] = useUrlFlagDialog("order", "new")
  const [shiftDetailsOpen, setShiftDetailsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  // Единая корзина: walk-in продажа и оформление заказа работают с одним составом —
  // «Создать заказ» наследует уже набранные позиции.
  const [items, setItems] = useState<ProductLineItem[]>([])

  // Корзина переживает переход между разделами и F5: восстанавливаем состав при возврате на кассу…
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY)
      if (!raw) return
      const stored = JSON.parse(raw) as ProductLineItem[]
      if (Array.isArray(stored) && stored.length) {
        // Регидрация из внешнего хранилища после монтирования (в инициализаторе useState нельзя —
        // рассинхрон гидрации SSR↔клиент).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(stored)
      }
    } catch {
      // повреждённое хранилище игнорируем
    }
    // восстановление одноразовое, только при монтировании
  }, [])

  // …и зеркалим любое изменение состава. Пустая корзина (после продажи resetForm) — ключ самоочищается.
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      if (items.length) {
        window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
      } else {
        window.localStorage.removeItem(CART_STORAGE_KEY)
      }
    } catch {
      // недоступность/переполнение localStorage игнорируем
    }
  }, [items])

  const openShift = data.stats.openShift
  const activeShiftDetail = openShift
    ? data.shiftDetails.find((detail) => detail.shift.id === openShift.id) ?? null
    : data.shiftDetails[0] ?? null

  function run(action: () => Promise<Result>, after?: () => void, successLink?: { label: string; href: string }) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        const messages = result.messages ?? [result.message]
        messages.forEach((message, index) => {
          const withLink = successLink && index === messages.length - 1
          toast.success(
            message,
            withLink
              ? { action: { label: successLink.label, onClick: () => router.push(successLink.href) } }
              : undefined
          )
        })
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
    after?: () => void,
    successLink?: { label: string; href: string }
  ) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    run(() => action(formData), after, successLink)
  }

  return (
    <>
      <OrdersActivityRefresh />
      {/* Поле шапки — поиск товара (автофокус: позиции набивают руками); справа — возврат и
          «Касса за смену». Главное действие экрана — «Провести продажу» в панели оплаты. */}
      <ScreenHeader
        title="Касса"
        searchSlot={
          <ProductCombobox
            products={data.products}
            bouquets={data.bouquetTemplates}
            includeBouquets
            portalDropdown
            autoFocus
            bare
            className="h-full flex-1"
            inputClassName="text-base"
            placeholder="Найти товар — название, код или артикул"
            disabled={isPending}
            onSelect={(product) => setItems((current) => addProductToLineItems(current, product))}
            onSelectBouquet={(bouquet) => setItems((current) => addBouquetToLineItems(current, bouquet))}
          />
        }
        actions={
          <>
            {canRefund && <RefundSearchSheet hasOpenShift={Boolean(openShift)} trigger="header" />}
            <HeaderAction icon={WalletIcon} label="Касса за смену" onClick={() => setShiftDetailsOpen(true)} />
          </>
        }
        tabs={null}
      />

      {!openShift && (
        <Alert className="shrink-0 border-0 bg-amber-50 text-amber-950 shadow-xs">
          <AlertTriangleIcon />
          <AlertTitle>Откройте смену для кассовых операций</AlertTitle>
          <AlertDescription>
            Продажа, доплата, выдача заказов и выдача денег курьеру доступны только при открытой смене.
            Заказ оформить можно и сейчас — предоплата попадёт в кассу в день выдачи.
          </AlertDescription>
        </Alert>
      )}

      <ScreenBody surface={false} scroll="none">
        <QuickSaleForm
          products={data.products}
          customers={data.customers}
          pending={isPending}
          disabled={!openShift}
          items={items}
          setItems={setItems}
          onCreateOrder={() => setOrderOpen(true)}
          onSubmit={(event, after) => submitForm(event, createSaleAction, after)}
        />
      </ScreenBody>

      <OrderDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        products={data.products}
        bouquets={data.bouquetTemplates}
        customers={data.customers}
        pending={isPending}
        items={items}
        setItems={setItems}
        onSubmit={(event, after) => {
          const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null
          const isDraft = submitter?.getAttribute("data-intent") === "draft"
          const action = isDraft ? createOrderDraftAction : createOrderAction
          submitForm(
            event,
            action,
            () => {
              after?.()
              setOrderOpen(false)
            },
            // После сохранения черновик «пропадал» — даём ссылку прямо в тосте.
            isDraft ? { label: "Открыть черновики", href: "/orders/drafts" } : undefined
          )
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
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => onOpenChange(false)}>
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

// «Очистить» — сбрасывает набранную продажу и ничего не трогает на складе: состав живёт только
// в состоянии формы (и в localStorage), списание происходит лишь при проведении продажи.
// Чистим через resetForm, а не setItems([]): иначе на пустой корзине остаются включённая
// смешанная оплата с её скрытыми полями и «Получено», и они прилипнут к следующей продаже.
// Подтверждение обязательно: на планшете кнопку легко задеть пальцем.
function ClearCartButton({
  count,
  disabled,
  onClear,
}: {
  count: number
  disabled?: boolean
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)

  if (count === 0) {
    return null
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-zinc-500"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon data-icon="inline-start" />
        Очистить
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить корзину?</AlertDialogTitle>
            <AlertDialogDescription>
              {count === 1
                ? "Позиция будет убрана из списка"
                : `Все позиции (${count}) будут убраны из списка`}
              , а поля продажи (клиент, скидка, оплата, комментарий) — сброшены. Со склада ничего
              не спишется: это только текущий набор на кассе.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onClear()
                setOpen(false)
              }}
            >
              Очистить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function QuickSaleForm({
  products,
  customers,
  pending,
  disabled,
  items,
  setItems,
  onCreateOrder,
  onSubmit,
}: {
  products: Product[]
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
  // Смешанная оплата: состояние дочернего блока (валидность гейтит submit), epoch ремоунтит
  // блок при сбросе формы после проведения.
  const [splitState, setSplitState] = useState<SplitPaymentState>({ enabled: false, valid: true })
  const [saleFormEpoch, setSaleFormEpoch] = useState(0)
  // Стабильный колбэк: bail при том же значении (иначе эффект ребёнка зациклит рендер).
  // При включении сплита очищаем «Получено» — сдача в смешанной оплате не считается.
  const handleSplitStateChange = useCallback((state: SplitPaymentState) => {
    setSplitState((current) =>
      current.enabled === state.enabled && current.valid === state.valid ? current : state
    )
    if (state.enabled) {
      setReceivedInput("")
    }
  }, [])
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
  // При смешанной оплате суммы вводятся точно по частям — расчёт сдачи не участвует.
  const cashShort = isCash && !splitState.enabled && hasReceived && shortfall > 0
  const cartEmpty = items.length === 0
  // Причина видна не только тултипом (на тач-экране наведения нет), но и текстом под кнопкой —
  // поэтому формулировки сразу подсказывают действие.
  const completeDisabledReason = disabled
    ? "Смена закрыта — откройте смену, чтобы проводить продажи"
    : cartEmpty
      ? "Добавьте позиции в корзину"
      : !paymentMethod
        ? "Выберите способ оплаты"
        : splitState.enabled && !splitState.valid
          ? "Заполните части смешанной оплаты"
          : cashShort
            ? `Полученная сумма меньше итога — не хватает ${formatMoney(shortfall)}`
            : null
  const completeDisabled = pending || Boolean(completeDisabledReason)


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
    setSplitState({ enabled: false, valid: true })
    setSaleFormEpoch((value) => value + 1)
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
      <form onSubmit={handleSubmit} className="@container/cash flex min-h-0 flex-1 flex-col">
        {/* На всю высоту: корзина слева скроллится сама, панель оплаты — 360px справа. В узкой
            рабочей области (< @4xl) колонки складываются, скроллится вся область. */}
        <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-3 overflow-y-auto overscroll-contain @4xl/cash:auto-rows-[minmax(0,1fr)] @4xl/cash:grid-cols-[minmax(0,1fr)_360px] @4xl/cash:overflow-hidden">
          {/* Левая колонка: корзина. */}
          <div className="flex min-h-0 min-w-0 flex-col rounded-2xl bg-background shadow-xs @4xl/cash:overflow-y-auto">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">Корзина</span>
                <div className="flex items-center gap-2">
                  {items.length > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">{items.length} поз.</span>
                  )}
                  <ClearCartButton
                    count={items.length}
                    disabled={pending}
                    onClear={resetForm}
                  />
                </div>
              </div>
              <ProductLineItems
                products={products}
                items={items}
                disabled={pending}
                emptyTitle="Корзина пуста"
                maxHeightPx={null}
                onItemsChange={setItems}
              />
            </div>
          </div>

          {/* Правая колонка: панель оплаты. На виду — способ оплаты, получено, сдача, итог. */}
          <div className="flex min-h-0 min-w-0 flex-col rounded-2xl bg-background shadow-xs @4xl/cash:overflow-y-auto">
            <div className="flex flex-col gap-4 p-4">
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

              <SplitPaymentFields
                key={saleFormEpoch}
                total={saleTotal}
                primaryMethod={paymentMethod}
                disabled={disabled || pending}
                idPrefix="sale-split"
                onStateChange={handleSplitStateChange}
              />

              {isCash && !splitState.enabled && (
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
                <div className="flex flex-col gap-2 rounded-xl bg-muted/30 p-3">
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
                <FieldSet className="rounded-xl bg-muted/30 p-3">
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

              {/* Информационное предупреждение, НЕ блокировка: продажа в минус разрешена.
                  Янтарный, не красный — красный читался как «продавать нельзя». */}
              {cartShortageCount > 0 && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900 *:data-[slot=alert-description]:text-amber-900/80">
                  <AlertTriangleIcon />
                  <AlertTitle>Остаток уйдёт в минус</AlertTitle>
                  <AlertDescription>
                    {cartShortageCount === 1
                      ? "По одной позиции не хватает остатка на складе. Продажа всё равно пройдёт — остаток станет отрицательным."
                      : `По ${cartShortageCount} позициям не хватает остатка на складе. Продажа всё равно пройдёт — остатки станут отрицательными.`}
                  </AlertDescription>
                </Alert>
              )}

              {/* Разбивка показывается только когда есть скидка — иначе не загромождаем. */}
              {hasAnyDiscount && (
                <div className="grid gap-1.5 rounded-xl bg-muted/30 p-3 text-sm">
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
            <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-3 rounded-b-2xl border-t border-border/40 bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
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
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span tabIndex={completeDisabled ? 0 : -1} className="block w-full" />
                    }
                  >
                    <Button
                      className="h-11 w-full bg-brand text-white shadow-sm hover:bg-brand-strong"
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
              {/* Причина блокировки текстом — тултип на тач-экране кассы недоступен. */}
              {completeDisabledReason && !pending && (
                <div
                  className={cn(
                    "text-center text-xs",
                    cashShort ? "font-medium text-destructive" : "text-muted-foreground"
                  )}
                >
                  {completeDisabledReason}
                </div>
              )}
              {/* Оформление заказа с доставкой — наследует текущую корзину. */}
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full bg-brand-subtle/60 text-brand-strong hover:bg-brand-subtle hover:text-brand-strong"
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
          : "text-muted-foreground hover:bg-muted"
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
  items: ProductLineItem[]
  setItems: React.Dispatch<React.SetStateAction<ProductLineItem[]>>
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-6xl">
        <DialogHeader className="shrink-0 border-b border-border/40 px-5 py-4">
          <DialogTitle>Новый заказ</DialogTitle>
          <DialogDescription>Оформление заказа с самовывозом или доставкой. Состав наследуется из корзины продажи.</DialogDescription>
        </DialogHeader>
        <NewOrderForm
          products={products}
          bouquets={bouquets}
          customers={customers}
          pending={pending}
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
  items,
  setItems,
  onSubmit,
}: {
  products: Product[]
  bouquets: BouquetTemplate[]
  customers: CustomerOption[]
  pending: boolean
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
  // Фото-референсы: загружаются сразу при выборе, в заказ уходят id (скрытое поле orderImageIds).
  const [images, setImages] = useState<OrderImage[]>([])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  // Смешанная предоплата: блок размонтируется при prepaid=0 (сброс состояния «бесплатный»).
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
  // Предоплата — отложенная (в кассу проводится при выдаче), поэтому открытая смена для
  // создания заказа не нужна.
  const prepaidTooHigh = prepaid > total
  const dueAt = dueDate && dueTime ? `${dueDate}T${dueTime}` : ""
  const orderDisabledReason = items.length === 0
    ? "Добавьте позиции"
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
    setImages([])
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
              <OrderImagesField images={images} onChange={setImages} disabled={pending} />
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
                <SplitPaymentFields
                  total={prepaid}
                  primaryMethod={paymentMethod}
                  disabled={pending}
                  idPrefix="order-split"
                  onStateChange={handlePrepaidSplitChange}
                />
              )}
              {prepaid > 0 && (
                <p className="text-xs text-muted-foreground">
                  Предоплата попадёт в кассу в день выдачи заказа, а не сегодня. Смена для этого не нужна.
                </p>
              )}

              {showOrderDiscount ? (
                <div className="grid gap-3 rounded-xl bg-muted/30 p-3">
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

              {prepaidTooHigh && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                  <AlertTriangleIcon />
                  <AlertTitle>Предоплата выше итога</AlertTitle>
                  <AlertDescription>Уменьшите предоплату до суммы заказа после скидок.</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-1.5 rounded-xl bg-muted/30 p-3 text-sm">
                <Info label="До скидки" value={formatMoney(orderTotals.itemsTotalBeforeDiscount)} />
                {orderTotals.itemsDiscountTotal > 0 && (
                  <Info label="Скидка по позициям" value={`− ${formatMoney(orderTotals.itemsDiscountTotal)}`} />
                )}
                {orderTotals.dealDiscountAmount > 0 && (
                  <Info label="Скидка на чек" value={`− ${formatMoney(orderTotals.dealDiscountAmount)}`} />
                )}
                {effectiveDeliveryPrice > 0 && <Info label="Доставка" value={formatMoney(effectiveDeliveryPrice)} />}
                {prepaid > 0 && <Info label="Предоплата (в кассу при выдаче)" value={`− ${formatMoney(prepaid)}`} />}
              </div>
            </FieldGroup>
          </OrderStep>
        </div>

        {/* Закреплённый футер модалки: итог + остаток к доплате + главное действие. */}
        <div className="shrink-0 border-t border-border/40 bg-background px-5 py-4">
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
                даже без позиций/смены, поэтому НЕ гейтится orderDisabled. Черновик хранит ОДИН
                способ предоплаты-намерения — со смешанной оплатой недоступен (сервер тоже гардит). */}
            <Button
              type="submit"
              data-intent="draft"
              variant="outline"
              className="h-10 w-full"
              disabled={pending || prepaidSplit.enabled}
            >
              Сохранить черновик
            </Button>
            {prepaidSplit.enabled && (
              <p className="text-center text-xs text-muted-foreground">
                Черновик хранит один способ предоплаты — уберите смешанную оплату или проведите заказ сразу.
              </p>
            )}
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
        <SheetHeader className="border-b border-border/40">
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
            <div className="flex flex-col gap-5">
              {/* Hero: выручка за смену — главное число, крупно. */}
              <div>
                <div className="text-xs text-muted-foreground">Выручка за смену</div>
                <div className="text-3xl font-semibold tabular-nums text-zinc-950">
                  {formatMoney(summary.revenueTotal)}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span>до скидок {formatMoney(summary.revenueBeforeDiscount)}</span>
                  {summary.discountTotal > 0 && <span>скидки −{formatMoney(summary.discountTotal)}</span>}
                </div>
              </div>

              {/* Ожидается в кассе — ключевое число для сверки на закрытии. */}
              <div className="flex items-baseline justify-between rounded-xl bg-muted/30 px-4 py-3">
                <span className="text-sm text-muted-foreground">Ожидается в кассе</span>
                <span className="text-xl font-semibold tabular-nums text-zinc-950">
                  {formatMoney(summary.expectedCash)}
                </span>
              </div>

              {/* Справочно: деньги, не входящие в выручку/кассу этой смены. */}
              {(summary.deferredPrepayments > 0 ||
                summary.revenueReceivedInOtherShifts > 0 ||
                (Boolean(openShift) && (summary.draftPrepaidTotal > 0 || summary.pendingPrepaidTotal > 0))) && (
                <div className="flex flex-col gap-1 rounded-lg bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
                  {summary.deferredPrepayments > 0 && (
                    <ShiftNote label="Предоплаты по будущим заказам" value={formatMoney(summary.deferredPrepayments)} />
                  )}
                  {summary.revenueReceivedInOtherShifts > 0 && (
                    <ShiftNote
                      label="Из выручки получено в другие смены"
                      value={formatMoney(summary.revenueReceivedInOtherShifts)}
                    />
                  )}
                  {Boolean(openShift) && summary.pendingPrepaidTotal > 0 && (
                    <ShiftNote
                      label="Предоплаты по невыданным заказам — попадут в кассу при выдаче"
                      value={formatMoney(summary.pendingPrepaidTotal)}
                    />
                  )}
                  {Boolean(openShift) && summary.draftPrepaidTotal > 0 && (
                    <ShiftNote
                      label="Предоплаты в черновиках (не проведены)"
                      value={formatMoney(summary.draftPrepaidTotal)}
                    />
                  )}
                </div>
              )}

              {/* Поступления по способам — только ненулевые (net возвратов). */}
              {(() => {
                const methods = (
                  [
                    { key: "cash", value: summary.cash },
                    { key: "card", value: summary.card },
                    { key: "terminal", value: summary.terminal },
                    { key: "mbank", value: summary.mbank },
                    { key: "optima", value: summary.optima },
                    { key: "elsom", value: summary.elsom },
                    { key: "bakai", value: summary.bakai },
                    { key: "transfer", value: summary.transfer },
                  ] as Array<{ key: PaymentMethod; value: number }>
                ).filter((m) => Math.abs(m.value) >= 0.01)
                if (!methods.length) return null
                return (
                  <div>
                    <ShiftSectionHeader>Поступления по способам</ShiftSectionHeader>
                    <div className="flex flex-col">
                      {methods.map((m) => (
                        <ShiftStatRow key={m.key} label={getPaymentMethodLabel(m.key)} value={formatMoney(m.value)} />
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Доставка за смену — по заказам, выданным/переданным курьеру в эту смену. */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                  <TruckIcon className="size-4 text-muted-foreground" />
                  <span>Доставка за смену</span>
                </div>
                {summary.deliveryPaidCount + summary.deliveryFreeCount + summary.deliveryPickupCount === 0 ? (
                  <div className="text-xs text-muted-foreground">Выдач и доставок в эту смену не было.</div>
                ) : (
                  <div className="flex flex-col">
                    <ShiftStatRow
                      label={`Платная · ${summary.deliveryPaidCount} ${pluralOrders(summary.deliveryPaidCount)}`}
                      value={formatMoney(summary.deliveryPaidTotal)}
                      tone={summary.deliveryPaidTotal > 0 ? "in" : undefined}
                    />
                    <ShiftStatRow
                      label="Бесплатная"
                      value={`${summary.deliveryFreeCount} ${pluralOrders(summary.deliveryFreeCount)}`}
                      muted
                    />
                    <ShiftStatRow
                      label="Самовывоз"
                      value={`${summary.deliveryPickupCount} ${pluralOrders(summary.deliveryPickupCount)}`}
                      muted
                    />
                    {summary.courierPayouts > 0 && (
                      <ShiftStatRow label="Выплаты курьеру" value={`−${formatMoney(summary.courierPayouts)}`} tone="out" />
                    )}
                  </div>
                )}
              </div>

              {/* Наличные операции — если были. */}
              {(summary.cashIn > 0 || summary.cashOutOther > 0) && (
                <div>
                  <ShiftSectionHeader>Наличные операции</ShiftSectionHeader>
                  <div className="flex flex-col">
                    {summary.cashIn > 0 && (
                      <ShiftStatRow label="Внесения" value={`+${formatMoney(summary.cashIn)}`} tone="in" />
                    )}
                    {summary.cashOutOther > 0 && (
                      <ShiftStatRow label="Изъятия" value={`−${formatMoney(summary.cashOutOther)}`} tone="out" />
                    )}
                  </div>
                </div>
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

          {/* Чеки за смену — что продали и какие оплаты по заказам прошли. */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-zinc-900">
              <ReceiptTextIcon className="size-4 text-muted-foreground" />
              <span>Чеки за смену</span>
            </div>
            <ShiftReceiptsList detail={detail} />
          </div>

          {/* Все операции — полная лента (включая возвраты и ручные внесения/изъятия). */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-900">Все операции</span>
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


function ShiftSectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-sm font-medium text-zinc-900">{children}</div>
}

// Строка «метка — значение» в секциях панели смены. tone красит сумму (приход/расход),
// muted — для справочных счётчиков (кол-во заказов и т.п.).
function ShiftStatRow({
  label,
  value,
  tone,
  muted,
}: {
  label: string
  value: string
  tone?: "in" | "out"
  muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "shrink-0 font-medium tabular-nums",
          tone === "in" && "text-emerald-600",
          tone === "out" && "text-red-600",
          muted && "font-normal text-muted-foreground"
        )}
      >
        {value}
      </span>
    </div>
  )
}

function ShiftNote({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="shrink-0 font-medium tabular-nums">{value}</span>
    </div>
  )
}

// Склонение «заказ/заказа/заказов» для счётчиков доставки.
function pluralOrders(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return "заказ"
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "заказа"
  return "заказов"
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
    pendingPrepaidTotal: detail.summary.pendingPrepaidTotal,
    revenueReceivedInOtherShifts: detail.summary.revenueReceivedInOtherShifts,
    cashIn: detail.summary.cashIn,
    cashOutOther: detail.breakdown.cashOutOther,
    courierPayouts: detail.breakdown.courierPayouts,
    deliveryPaidCount: detail.summary.deliveryPaidCount,
    deliveryPaidTotal: detail.summary.deliveryPaidTotal,
    deliveryFreeCount: detail.summary.deliveryFreeCount,
    deliveryPickupCount: detail.summary.deliveryPickupCount,
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
