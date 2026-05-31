"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  ReceiptTextIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  cashInAction,
  cashOutAction,
  createCashCustomerAction,
  createOrderAction,
  createSaleAction,
} from "@/app/actions"
import type {
  CustomerOption,
  DashboardData,
  PaymentMethod,
  Product,
  BouquetTemplate,
} from "@/lib/db"
import { getPaymentMethodLabel, paymentMethodOptions, sourceOptions } from "@/lib/labels"
import { calculateCommercialTotals, normalizeDiscountType, type DiscountType } from "@/lib/pricing"
import { cn, formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
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

type Result = Awaited<ReturnType<typeof createSaleAction>>
type CustomerCreateResult = Awaited<ReturnType<typeof createCashCustomerAction>>
type CashOperation = "cashIn" | "cashOut"

// Касса (sales) вынесена из монолита backoffice.tsx в самостоятельную CrmShell-страницу.
// Открытие/закрытие смены живут в CrmShell (shiftContext + ShiftSheet) — здесь только
// продажа/заказ/кассовые операции и live-refresh активности заказов.
export function CashPage({ data }: { data: DashboardData }) {
  const router = useRouter()
  const [cashOperation, setCashOperation] = useState<CashOperation | null>(null)
  const [isPending, startTransition] = useTransition()

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
      <SalesSection
        data={data}
        pending={isPending}
        onSaleSubmit={(event, after) => submitForm(event, createSaleAction, after)}
        onOrderSubmit={(event, after) => submitForm(event, createOrderAction, after)}
        onCashOperation={setCashOperation}
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

function SalesSection({
  data,
  pending,
  onSaleSubmit,
  onOrderSubmit,
  onCashOperation,
}: {
  data: DashboardData
  pending: boolean
  onSaleSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
  onOrderSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
  onCashOperation: (operation: CashOperation) => void
}) {
  const openShift = data.stats.openShift
  const activeShiftDetail = openShift
    ? data.shiftDetails.find((detail) => detail.shift.id === openShift.id) ?? null
    : data.shiftDetails[0] ?? null

  return (
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
      <Tabs defaultValue="sale" className="gap-4">
        <TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
          <TabsTrigger value="sale">Быстрая продажа</TabsTrigger>
          <TabsTrigger value="order">Новый заказ</TabsTrigger>
        </TabsList>
        <TabsContent value="sale">
          <QuickSaleForm
            products={data.products}
            bouquets={data.bouquetTemplates}
            customers={data.customers}
            pending={pending}
            disabled={!openShift}
            onSubmit={onSaleSubmit}
          />
        </TabsContent>
        <TabsContent value="order">
          <NewOrderForm
            products={data.products}
            bouquets={data.bouquetTemplates}
            customers={data.customers}
            pending={pending}
            shiftOpen={Boolean(openShift)}
            onSubmit={onOrderSubmit}
          />
        </TabsContent>
      </Tabs>
      <CashShiftBlock
        detail={activeShiftDetail}
        openShift={openShift}
        pending={pending}
        onCashOperation={onCashOperation}
      />
    </div>
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
                <Input id="cash-customer-phone" name="phone" disabled={disabled} />
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
                    <SelectValue placeholder="Источник" />
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

function QuickSaleForm({
  products,
  bouquets,
  customers,
  pending,
  disabled,
  onSubmit,
}: {
  products: Product[]
  bouquets: BouquetTemplate[]
  customers: CustomerOption[]
  pending: boolean
  disabled: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  const [items, setItems] = useState<ProductLineItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [createdCustomers, setCreatedCustomers] = useState<CustomerOption[]>([])
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [saleDiscountType, setSaleDiscountType] = useState<DiscountType>("none")
  const [saleDiscountValue, setSaleDiscountValue] = useState(0)
  const [saleDiscountTouched, setSaleDiscountTouched] = useState(false)
  const availableCustomers = useMemo(
    () => createdCustomers.reduce((current, customer) => upsertCustomerOption(current, customer), customers),
    [createdCustomers, customers]
  )
  const selectedCustomer = selectedCustomerId === null
    ? null
    : availableCustomers.find((customer) => customer.id === selectedCustomerId) ?? null
  const saleTotals = calculateCommercialTotals(getProductLineItemsForTotals(items), saleDiscountType, saleDiscountValue)
  const saleTotal = saleTotals.total

  function addProduct(product: Product) {
    setItems((current) => addProductToLineItems(current, product))
  }

  function addBouquet(bouquet: BouquetTemplate) {
    setItems((current) => addBouquetToLineItems(current, bouquet))
  }

  function resetForm() {
    setItems([])
    setSelectedCustomerId(null)
    setSaleDiscountType("none")
    setSaleDiscountValue(0)
    setSaleDiscountTouched(false)
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
      <div className="flex flex-col gap-5 pt-3">
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="min-w-0 rounded-2xl border-zinc-200 bg-white">
              <CardHeader>
                <CardTitle className="font-semibold text-zinc-950">Быстрая продажа</CardTitle>
                <CardDescription className="text-zinc-500">Поиск товара и компактная корзина продажи</CardDescription>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-col gap-4">
                <ProductCombobox
                  products={products}
                  bouquets={bouquets}
                  includeBouquets
                  portalDropdown
                  disabled={pending}
                  onSelect={addProduct}
                  onSelectBouquet={addBouquet}
                />
                <div className="min-w-0">
                  <div className="mb-2 text-sm font-medium">Корзина</div>
                  <ProductLineItems
                    products={products}
                    items={items}
                    disabled={pending}
                    emptyTitle="Корзина пуста"
                    onItemsChange={setItems}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-2xl border-zinc-200 bg-white xl:sticky xl:top-20 xl:self-start">
              <CardHeader>
                <CardTitle className="font-semibold text-zinc-950">Оплата</CardTitle>
                <CardDescription className="text-zinc-500">Клиент, скидка и итог к чеку</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <FieldGroup>
                  <input type="hidden" name="customerId" value={selectedCustomer?.id ?? ""} />
                  <input type="hidden" name="saleDiscountType" value={saleDiscountType} />
                  <input type="hidden" name="saleDiscountValue" value={saleDiscountValue} />
                  <Field>
                    <FieldLabel>Клиент</FieldLabel>
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
                      <FieldDescription>Продажу можно провести без привязки к клиенту.</FieldDescription>
                    )}
                    {selectedCustomer && (
                      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                        <span className="min-w-0 truncate">{selectedCustomer.phone || "Телефон не указан"}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={disabled || pending}
                          onClick={() => applySaleCustomer(null)}
                        >
                          Очистить
                        </Button>
                      </div>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="salePaymentMethod">Оплата</FieldLabel>
                    <select
                      id="salePaymentMethod"
                      name="paymentMethod"
                      className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                      value={paymentMethod}
                      disabled={disabled || pending}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                    >
                      {paymentMethodOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sale-note">Комментарий</FieldLabel>
                    <Textarea id="sale-note" name="note" disabled={disabled || pending} />
                  </Field>
                </FieldGroup>
                <FieldSet>
                  <FieldLegend>Скидка на чек</FieldLegend>
                  <div className="flex items-end gap-2">
                    <Field>
                      <FieldLabel htmlFor="saleDiscountType">Тип</FieldLabel>
                      <select
                        id="saleDiscountType"
                        className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-sm"
                        value={saleDiscountType}
                        disabled={disabled || pending}
                        onChange={(event) => handleSaleDiscountTypeChange(event.target.value)}
                      >
                        <option value="none">Без скидки</option>
                        <option value="percent">%</option>
                        <option value="amount">Сумма</option>
                      </select>
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
                        className="w-24 text-right"
                        onChange={(event) => {
                          setSaleDiscountTouched(true)
                          setSaleDiscountValue(Number(event.target.value) || 0)
                        }}
                      />
                    </Field>
                  </div>
                </FieldSet>
                <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <Info label="Товары до скидки" value={formatMoney(saleTotals.itemsTotalBeforeDiscount)} />
                  <Info label="Скидка по позициям" value={formatMoney(saleTotals.itemsDiscountTotal)} />
                  <Info label="Скидка на чек" value={formatMoney(saleTotals.dealDiscountAmount)} />
                  <div>
                    <div className="text-xs text-zinc-500">Итого после скидок</div>
                    <div className="text-3xl font-semibold text-zinc-950">{formatMoney(saleTotal)}</div>
                  </div>
                </div>
                <Button className="h-10 w-full bg-zinc-950 text-white hover:bg-zinc-800" type="submit" disabled={pending || disabled || items.length === 0}>
                  <ReceiptTextIcon data-icon="inline-start" />
                  Провести продажу
                </Button>
              </CardContent>
            </Card>
          </div>
        </form>
      </div>
    </>
  )
}

function CashShiftBlock({
  detail,
  openShift,
  pending,
  onCashOperation,
}: {
  detail: DashboardData["shiftDetails"][number] | null
  openShift: DashboardData["stats"]["openShift"]
  pending: boolean
  onCashOperation: (operation: CashOperation) => void
}) {
  const summary = detail ? getShiftCashSummary(detail) : null
  const sales = detail?.sales ?? []

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader className="gap-3">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <CardTitle>Касса за смену</CardTitle>
            <CardDescription>
              {openShift
                ? `Текущая смена #${openShift.id}`
                : detail
                  ? `Последняя смена #${detail.shift.id}`
                  : "Откройте смену"}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {!openShift && <span className="text-xs text-muted-foreground">Откройте смену</span>}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!openShift || pending}
              onClick={() => onCashOperation("cashIn")}
            >
              <PlusCircleIcon data-icon="inline-start" />
              Внесение наличных
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!openShift || pending}
              onClick={() => onCashOperation("cashOut")}
            >
              <MinusCircleIcon data-icon="inline-start" />
              Изъятие наличных
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {summary ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            <CashMetric label="Выручка до скидок" value={formatMoney(summary.revenueBeforeDiscount)} />
            <CashMetric label="Скидки" value={formatMoney(summary.discountTotal)} />
            <CashMetric label="Выручка после скидок" value={formatMoney(summary.revenueTotal)} />
            <CashMetric label="Наличные" value={formatMoney(summary.cash)} />
            <CashMetric label="Карта" value={formatMoney(summary.card)} />
            <CashMetric label="Терминал" value={formatMoney(summary.terminal)} />
            <CashMetric label="Mbank" value={formatMoney(summary.mbank)} />
            <CashMetric label="Optima" value={formatMoney(summary.optima)} />
            <CashMetric label="ЭлСом" value={formatMoney(summary.elsom)} />
            <CashMetric label="Ожидается в кассе" value={formatMoney(summary.expectedCash)} />
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
          <div className="mb-2 text-sm font-medium">Последние продажи</div>
          <ResponsiveTable
            emptyTitle="Продаж пока нет"
            headers={["Дата", "Позиций", "До скидки", "Скидка", "Итого", "Способ оплаты", "Клиент", "Комментарий"]}
            rows={sales.map((sale) => [
              dateTime(sale.createdAt),
              sale.itemsCount,
              formatMoney(sale.totalBeforeDiscount),
              formatMoney(sale.discountTotal),
              formatMoney(sale.total),
              getPaymentMethodLabel(sale.paymentMethod),
              sale.customerName || "-",
              sale.note || "без комментария",
            ])}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function CashMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  )
}

function NewOrderForm({
  products,
  bouquets,
  customers,
  pending,
  shiftOpen,
  onSubmit,
}: {
  products: Product[]
  bouquets: BouquetTemplate[]
  customers: CustomerOption[]
  pending: boolean
  shiftOpen: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  const [deliveryType, setDeliveryType] = useState("pickup")
  const [deliveryPrice, setDeliveryPrice] = useState(0)
  const [courierPayout, setCourierPayout] = useState(0)
  const [prepaid, setPrepaid] = useState(0)
  const [items, setItems] = useState<ProductLineItem[]>([])
  const [customer, setCustomer] = useState("")
  const [phone, setPhone] = useState("")
  const [recipientPhone, setRecipientPhone] = useState("")
  const [createdCustomers, setCreatedCustomers] = useState<CustomerOption[]>([])
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>("none")
  const [orderDiscountValue, setOrderDiscountValue] = useState(0)
  const [orderDiscountTouched, setOrderDiscountTouched] = useState(false)
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
  const orderTotals = calculateCommercialTotals(getProductLineItemsForTotals(items), orderDiscountType, orderDiscountValue)
  const itemsTotal = orderTotals.total
  const total = itemsTotal + deliveryPrice
  const balance = total - prepaid
  const needsShift = prepaid > 0 && !shiftOpen
  const prepaidTooHigh = prepaid > total
  const dueAt = dueDate && dueTime ? `${dueDate}T${dueTime}` : ""

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
    setPhone("")
    setRecipientPhone("")
    setOrderDiscountType("none")
    setOrderDiscountValue(0)
    setOrderDiscountTouched(false)
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

  function applyOrderCustomer(nextCustomer: CustomerOption | null) {
    setSelectedCustomerId(nextCustomer?.id ?? null)
    setCustomer(nextCustomer?.name ?? "")
    setPhone(nextCustomer?.phone ?? "")
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
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
    const date = new Date()
    date.setDate(date.getDate() + offsetDays)
    setDueDate(dateInputValue(date))
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
      <form onSubmit={handleSubmit} className="pt-3">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="rounded-2xl border-zinc-200 bg-white">
              <CardHeader>
                <CardTitle className="font-semibold text-zinc-950">Клиент</CardTitle>
                <CardDescription className="text-zinc-500">Основные контакты для менеджера</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <input type="hidden" name="customerId" value={selectedCustomer?.id ?? ""} />
                  <input type="hidden" name="orderDiscountType" value={orderDiscountType} />
                  <input type="hidden" name="orderDiscountValue" value={orderDiscountValue} />
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
                    {selectedCustomer && (
                      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                        <span className="min-w-0 truncate">{selectedCustomer.phone || "Телефон не указан"}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => applyOrderCustomer(null)}
                        >
                          Очистить
                        </Button>
                      </div>
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
                    <Input id="phone" name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="recipientPhone">Номер получателя</FieldLabel>
                  <Input
                    id="recipientPhone"
                    name="recipientPhone"
                    placeholder="Например, +996 ..."
                    value={recipientPhone}
                    onChange={(event) => setRecipientPhone(event.target.value)}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-zinc-200 bg-white">
            <CardHeader>
              <CardTitle className="font-semibold text-zinc-950">Получение</CardTitle>
              <CardDescription className="text-zinc-500">Срок, самовывоз или доставка</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Дата / время</FieldLabel>
                    <input type="hidden" name="dueAt" value={dueAt} />
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                      <Input
                        id="dueDate"
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                      />
                      <Input
                        id="dueTime"
                        type="time"
                        step="900"
                        value={dueTime}
                        onChange={(event) => setDueTime(event.target.value)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setDueDay(0)}>
                        Сегодня
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setDueDay(1)}>
                        Завтра
                      </Button>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deliveryType">Получение</FieldLabel>
                    <select
                      id="deliveryType"
                      name="deliveryType"
                      className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                      value={deliveryType}
                      onChange={(event) => setDeliveryType(event.target.value)}
                    >
                      <option value="pickup">Самовывоз</option>
                      <option value="delivery">Доставка</option>
                    </select>
                  </Field>
                </div>
                {deliveryType === "delivery" && (
                  <Field>
                    <FieldLabel htmlFor="address">Адрес</FieldLabel>
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
                  <Textarea id="order-note" name="note" value={note} onChange={(event) => setNote(event.target.value)} />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl border-zinc-200 bg-white">
            <CardHeader>
              <CardTitle className="font-semibold text-zinc-950">Состав заказа</CardTitle>
              <CardDescription className="text-zinc-500">Добавляйте товары через поиск.</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
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
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 rounded-2xl border-zinc-200 bg-white xl:sticky xl:top-20 xl:self-start">
          <CardHeader>
            <CardTitle className="font-semibold text-zinc-950">Заказ</CardTitle>
            <CardDescription className="text-zinc-500">Доставка, оплата и итог</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-5">
            <FieldSet>
              <FieldLegend>Доставка</FieldLegend>
              <div className="text-xs text-zinc-500">
                Доставка прибавляется к итогу заказа. Выплата курьеру не входит в total и проводится отдельной кассовой операцией.
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Field>
                  <FieldLabel htmlFor="deliveryPrice">Платит клиент за доставку</FieldLabel>
                  <Input
                    id="deliveryPrice"
                    name="deliveryPrice"
                    type="number"
                    step="1"
                    min="0"
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
                    value={courierPayout}
                    onChange={(event) => setCourierPayout(Number(event.target.value) || 0)}
                  />
                </Field>
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Оплата</FieldLegend>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Field>
                  <FieldLabel htmlFor="prepaid">Предоплата</FieldLabel>
                  <Input
                    id="prepaid"
                    name="prepaid"
                    type="number"
                    step="1"
                    min="0"
                    value={prepaid}
                    onChange={(event) => setPrepaid(Number(event.target.value) || 0)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="orderPaymentMethod">Способ оплаты</FieldLabel>
                  <select
                    id="orderPaymentMethod"
                    name="paymentMethod"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                  >
                    {paymentMethodOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 rounded-lg border bg-background p-3">
                <div className="text-sm font-medium">Скидка на чек</div>
                <div className="flex items-end gap-2">
                  <Field>
                    <FieldLabel htmlFor="orderDiscountType">Тип</FieldLabel>
                    <select
                      id="orderDiscountType"
                      className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-sm"
                      value={orderDiscountType}
                      disabled={pending}
                      onChange={(event) => handleOrderDiscountTypeChange(event.target.value)}
                    >
                      <option value="none">Без скидки</option>
                      <option value="percent">%</option>
                      <option value="amount">Сумма</option>
                    </select>
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
                      className="w-24 text-right"
                      onChange={(event) => {
                        setOrderDiscountTouched(true)
                        setOrderDiscountValue(Number(event.target.value) || 0)
                      }}
                    />
                  </Field>
                </div>
              </div>
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
              <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <Info label="До скидки" value={formatMoney(orderTotals.itemsTotalBeforeDiscount)} />
                <Info label="Скидка по позициям" value={formatMoney(orderTotals.itemsDiscountTotal)} />
                <Info label="Скидка на чек" value={formatMoney(orderTotals.dealDiscountAmount)} />
                <Info label="Доставка" value={formatMoney(deliveryPrice)} />
                <Info label="Итого после скидок" value={formatMoney(total)} />
                <div>
                  <div className="text-xs text-zinc-500">Остаток</div>
                  <div className={cn("text-3xl font-semibold", balance > 0 ? "text-amber-800" : "text-emerald-800")}>
                    {formatMoney(balance)}
                  </div>
                </div>
              </div>
            </FieldSet>

            <div className="mt-auto border-t pt-3">
              <Button
                className="h-10 w-full bg-zinc-950 text-white hover:bg-zinc-800"
                type="submit"
                disabled={pending || needsShift || prepaidTooHigh || items.length === 0}
              >
                Провести заказ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
        </form>
    </>
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

  return (
    <Dialog open={Boolean(operation)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Операция пройдет по текущей открытой смене.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cash-operation-amount">Сумма</FieldLabel>
              <Input id="cash-operation-amount" name="amount" type="number" min="0.01" step="0.01" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="cash-operation-comment">Комментарий</FieldLabel>
              <Textarea id="cash-operation-comment" name="comment" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" variant={isCashOut ? "destructive" : "default"} disabled={pending}>
              {isCashOut ? "Изъять" : "Внести"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResponsiveTable({
  headers,
  rows,
  emptyTitle,
}: {
  headers: string[]
  rows: React.ReactNode[][]
  emptyTitle: string
}) {
  if (!rows.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>Данные появятся после первой операции.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Separator />
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header} className={header ? undefined : "text-right"}>
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex} className={cellIndex === row.length - 1 ? "text-right" : undefined}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
    transfer: 0,
  }

  for (const transaction of detail.cashTransactions) {
    if (revenueTypes.has(transaction.type)) {
      byMethod[transaction.paymentMethod] += transaction.amount
    }
  }

  return {
    ...byMethod,
    revenueBeforeDiscount: detail.summary.revenueBeforeDiscount,
    discountTotal: detail.summary.discountTotal,
    revenueTotal: detail.summary.revenueTotal,
    expectedCash: detail.summary.expectedCash,
  }
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0")
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}
