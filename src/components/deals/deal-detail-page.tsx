"use client"

import type React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { CheckCircle2Icon, ExternalLinkIcon, ReceiptTextIcon, ShoppingBagIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import {
  addDealItemAction,
  acceptDealPaymentAction,
  createOrderFromDealAction,
  removeDealItemAction,
  updateDealFieldsAction,
  updateDealItemAction,
} from "@/app/actions"
import type { Customer, Deal, DealItem, DealSource, DealStage } from "@/lib/crm"
import { calculateCommercialTotals, calculateLineTotal, type DiscountType } from "@/lib/pricing"
import type { CurrentUser, PaymentMethod, Product } from "@/lib/db"
import { getPaymentMethodLabel, paymentMethodOptions, sourceLabel as getSourceLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { WazzupDealFrame } from "@/components/deals/wazzup-deal-frame"
import { ProductCombobox } from "@/components/products/product-combobox"
import { ProductThumbnail } from "@/components/products/product-thumbnail"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

type SaveStatus = "saved" | "saving" | "error"

type DealDraft = {
  customerId: string
  title: string
  source: DealSource
  stageId: string
  responsibleUserId: string
  dueAt: string
  deliveryType: string
  address: string
  comment: string
  dealDiscountType: DiscountType
  dealDiscountValue: string
}

type DealItemDraft = Omit<DealItem, "qty" | "price" | "discountValue"> & {
  qty: string
  price: string
  discountValue: string
  isTemporary?: boolean
}

const noValue = "none"
const fieldDebounceMs = 650
const itemDebounceMs = 650

const sourceOptions: Array<{ value: DealSource; label: string }> = [
  { value: "manual", label: "Ручная" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
  { value: "site", label: "Сайт" },
  { value: "phone", label: "Телефон" },
]

const discountOptions: Array<{ value: DiscountType; label: string }> = [
  { value: "none", label: "Без скидки" },
  { value: "percent", label: "%" },
  { value: "amount", label: "Сумма" },
]

export function DealDetailPage({
  deal,
  stages,
  customers,
  users,
  products,
  openShift,
}: {
  deal: Deal
  stages: DealStage[]
  customers: Customer[]
  users: CurrentUser[]
  products: Product[]
  openShift: { id: number; status: "open" | "closed" } | null
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(() => createDealDraft(deal))
  const [items, setItems] = useState(() => createItemDrafts(deal.items))
  const [fieldSaveStatus, setFieldSaveStatus] = useState<SaveStatus>("saved")
  const [itemSaveStatus, setItemSaveStatus] = useState<SaveStatus>("saved")
  const [saveError, setSaveError] = useState("")
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash")
  const [paymentComment, setPaymentComment] = useState("")
  const [showShiftWarning, setShowShiftWarning] = useState(false)
  const [actionPending, startActionTransition] = useTransition()
  const currentDealIdRef = useRef(deal.id)
  const fieldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fieldSaveChainRef = useRef<Promise<void>>(Promise.resolve())
  const fieldSaveVersionRef = useRef(0)
  const fieldDirtyRef = useRef(false)
  const itemTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const itemSaveChainsRef = useRef(new Map<number, Promise<void>>())
  const itemSaveVersionRef = useRef(0)
  const itemDirtyRef = useRef(false)
  const temporaryItemIdRef = useRef(-1)

  useEffect(() => {
    const isNewDeal = deal.id !== currentDealIdRef.current
    if (isNewDeal) {
      currentDealIdRef.current = deal.id
      setDraft(createDealDraft(deal))
      setItems(createItemDrafts(deal.items))
      fieldDirtyRef.current = false
      itemDirtyRef.current = false
      setFieldSaveStatus("saved")
      setItemSaveStatus("saved")
      return
    }

    if (
      fieldDirtyRef.current ||
      itemDirtyRef.current ||
      fieldTimerRef.current ||
      itemTimersRef.current.size > 0 ||
      fieldSaveStatus === "saving" ||
      itemSaveStatus === "saving"
    ) {
      return
    }

    setDraft(createDealDraft(deal))
    setItems(createItemDrafts(deal.items))
  }, [deal, fieldSaveStatus, itemSaveStatus])

  useEffect(() => {
    const itemTimers = itemTimersRef.current
    return () => {
      if (fieldTimerRef.current) {
        clearTimeout(fieldTimerRef.current)
      }
      itemTimers.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const customersById = useMemo(() => new Map(customers.map((customer) => [String(customer.id), customer])), [customers])
  const stagesById = useMemo(() => new Map(stages.map((stage) => [String(stage.id), stage])), [stages])
  const usersById = useMemo(() => new Map(users.map((user) => [String(user.id), user])), [users])
  const selectedCustomer = draft.customerId === noValue ? null : customersById.get(draft.customerId) ?? null

  const pricedItems = useMemo(
    () =>
      items.map((item) => {
        const line = calculateLineTotal({
          qty: normalizedQty(item.qty),
          price: normalizedPrice(item.price),
          discountType: item.discountType,
          discountValue: normalizedPrice(item.discountValue),
        })

        return {
          ...item,
          qtyNumber: normalizedQty(item.qty),
          priceNumber: normalizedPrice(item.price),
          discountValueNumber: normalizedPrice(item.discountValue),
          line,
        }
      }),
    [items]
  )

  const totals = useMemo(
    () =>
      calculateCommercialTotals(
        pricedItems.map((item) => ({
          qty: item.qtyNumber,
          price: item.priceNumber,
          discountType: item.discountType,
          discountValue: item.discountValueNumber,
        })),
        draft.dealDiscountType,
        normalizedPrice(draft.dealDiscountValue)
      ),
    [draft.dealDiscountType, draft.dealDiscountValue, pricedItems]
  )

  const balance = Math.max(0, totals.total - deal.paid)
  const hasPendingSaves = fieldSaveStatus === "saving" || itemSaveStatus === "saving"
  const hasItems = pricedItems.length > 0
  const orderHref = deal.orderId ? `/orders?orderId=${deal.orderId}` : "/orders"
  const hasAppliedCustomerDiscount =
    Boolean(selectedCustomer?.defaultDiscountPercent) &&
    draft.dealDiscountType === "percent" &&
    normalizedPrice(draft.dealDiscountValue) === selectedCustomer?.defaultDiscountPercent

  function updateDraftField<K extends keyof DealDraft>(
    key: K,
    value: DealDraft[K],
    options: { immediate?: boolean; markDiscountManual?: boolean } = {}
  ) {
    setDraft((current) => {
      const next = { ...current, [key]: value }
      if (options.markDiscountManual) {
        fieldDirtyRef.current = true
      }
      scheduleFieldSave(next, options.immediate)
      return next
    })
  }

  function handleCustomerChange(value: string | null) {
    setDraft((current) => {
      const nextCustomerId = value || noValue
      const customer = nextCustomerId === noValue ? null : customersById.get(nextCustomerId) ?? null
      const shouldApplyCustomerDiscount =
        customer &&
        customer.defaultDiscountPercent > 0 &&
        (current.dealDiscountType === "none" || normalizedPrice(current.dealDiscountValue) <= 0)
      const next: DealDraft = {
        ...current,
        customerId: nextCustomerId,
        dealDiscountType: shouldApplyCustomerDiscount ? "percent" : current.dealDiscountType,
        dealDiscountValue: shouldApplyCustomerDiscount
          ? String(customer.defaultDiscountPercent)
          : current.dealDiscountValue,
      }

      scheduleFieldSave(next, true)
      return next
    })
  }

  function scheduleFieldSave(next: DealDraft, immediate = false) {
    fieldDirtyRef.current = true
    if (fieldTimerRef.current) {
      clearTimeout(fieldTimerRef.current)
      fieldTimerRef.current = null
    }

    if (immediate) {
      void saveFields(next)
      return
    }

    fieldTimerRef.current = setTimeout(() => {
      fieldTimerRef.current = null
      void saveFields(next)
    }, fieldDebounceMs)
  }

  function flushFieldSave(next = draft) {
    if (fieldTimerRef.current) {
      clearTimeout(fieldTimerRef.current)
      fieldTimerRef.current = null
    }
    void saveFields(next)
  }

  function saveFields(snapshot: DealDraft) {
    const version = ++fieldSaveVersionRef.current
    fieldDirtyRef.current = false
    setFieldSaveStatus("saving")
    setSaveError("")

    fieldSaveChainRef.current = fieldSaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const result = await updateDealFieldsAction(createDealFormData(deal.id, snapshot))
        if (version !== fieldSaveVersionRef.current) {
          return
        }

        if (result.ok) {
          setFieldSaveStatus("saved")
          router.refresh()
        } else {
          setFieldSaveStatus("error")
          setSaveError(result.message)
        }
      })

    return fieldSaveChainRef.current
  }

  function updateItemField(
    itemId: number,
    patch: Partial<Pick<DealItemDraft, "qty" | "price" | "discountType" | "discountValue">>,
    options: { immediate?: boolean; normalize?: boolean } = {}
  ) {
    setItems((current) => {
      const currentItem = current.find((item) => item.id === itemId)
      if (!currentItem) {
        return current
      }

      const changedItem: DealItemDraft = {
        ...currentItem,
        ...patch,
        qty: options.normalize ? String(normalizedQty(patch.qty ?? currentItem.qty)) : (patch.qty ?? currentItem.qty),
        price: options.normalize
          ? String(normalizedPrice(patch.price ?? currentItem.price))
          : (patch.price ?? currentItem.price),
        discountValue: options.normalize
          ? String(normalizedPrice(patch.discountValue ?? currentItem.discountValue))
          : (patch.discountValue ?? currentItem.discountValue),
      }

      if (!changedItem.isTemporary) {
        scheduleItemSave(changedItem, options.immediate)
      }

      return current.map((item) => (item.id === itemId ? changedItem : item))
    })
  }

  function scheduleItemSave(item: DealItemDraft, immediate = false) {
    itemDirtyRef.current = true
    const currentTimer = itemTimersRef.current.get(item.id)
    if (currentTimer) {
      clearTimeout(currentTimer)
      itemTimersRef.current.delete(item.id)
    }

    if (immediate) {
      void saveItem(item)
      return
    }

    const timer = setTimeout(() => {
      itemTimersRef.current.delete(item.id)
      void saveItem(item)
    }, itemDebounceMs)
    itemTimersRef.current.set(item.id, timer)
  }

  function saveItem(item: DealItemDraft) {
    const version = ++itemSaveVersionRef.current
    itemDirtyRef.current = false
    setItemSaveStatus("saving")
    setSaveError("")

    const previous = itemSaveChainsRef.current.get(item.id) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const result = await updateDealItemAction(createItemFormData(deal.id, item))
        if (version !== itemSaveVersionRef.current) {
          return
        }

        if (result.ok) {
          setItemSaveStatus("saved")
          router.refresh()
        } else {
          setItemSaveStatus("error")
          setSaveError(result.message)
        }
      })

    itemSaveChainsRef.current.set(item.id, next)
    return next
  }

  async function addProduct(product: Product) {
    const version = ++itemSaveVersionRef.current
    setItemSaveStatus("saving")
    setSaveError("")
    setItems((current) => {
      const existing = current.find((item) => item.productCode === product.code)
      if (existing) {
        const updated = { ...existing, qty: String(normalizedQty(existing.qty) + 1) }
        return [
          updated,
          ...current.filter((item) => item.id !== existing.id),
        ]
      }

      return [
        createTemporaryItem(deal.id, product, temporaryItemIdRef.current--),
        ...current,
      ]
    })

    const result = await addDealItemAction(deal.id, product.code)
    if (version !== itemSaveVersionRef.current) {
      return
    }

    if (result.ok) {
      setItemSaveStatus("saved")
      router.refresh()
    } else {
      setItemSaveStatus("error")
      setSaveError(result.message)
    }
  }

  async function removeItem(item: DealItemDraft) {
    setItems((current) => current.filter((currentItem) => currentItem.id !== item.id))
    if (item.isTemporary) {
      return
    }

    const version = ++itemSaveVersionRef.current
    setItemSaveStatus("saving")
    setSaveError("")
    const result = await removeDealItemAction(deal.id, item.id)
    if (version !== itemSaveVersionRef.current) {
      return
    }

    if (result.ok) {
      setItemSaveStatus("saved")
      router.refresh()
    } else {
      setItemSaveStatus("error")
      setSaveError(result.message)
    }
  }

  async function flushPendingSaves() {
    const saves: Promise<void>[] = []

    if (fieldTimerRef.current) {
      clearTimeout(fieldTimerRef.current)
      fieldTimerRef.current = null
      saves.push(saveFields(draft))
    } else {
      saves.push(fieldSaveChainRef.current)
    }

    for (const [itemId, timer] of itemTimersRef.current.entries()) {
      clearTimeout(timer)
      itemTimersRef.current.delete(itemId)
      const item = items.find((current) => current.id === itemId)
      if (item && !item.isTemporary) {
        saves.push(saveItem(item))
      }
    }

    saves.push(...itemSaveChainsRef.current.values())
    await Promise.allSettled(saves)
  }

  function openPaymentDialog() {
    setShowShiftWarning(false)
    if (!openShift) {
      setShowShiftWarning(true)
      return
    }

    setPaymentAmount(String(roundMoney(balance)))
    setPaymentMethod("cash")
    setPaymentComment("")
    setPaymentDialogOpen(true)
  }

  function createOrderFromDeal() {
    if (!hasItems) {
      toast.error("Добавьте товары в сделку перед созданием заказа")
      return
    }

    startActionTransition(async () => {
      await flushPendingSaves()
      const result = await createOrderFromDealAction(deal.id)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = normalizedPrice(paymentAmount)
    if (amount <= 0) {
      toast.error("Сумма оплаты должна быть больше нуля.")
      return
    }

    if (amount - balance > 0.009) {
      toast.error("Сумма оплаты не может быть больше остатка.")
      return
    }

    const formData = new FormData()
    formData.set("dealId", String(deal.id))
    formData.set("amount", String(amount))
    formData.set("paymentMethod", paymentMethod)
    formData.set("comment", paymentComment)

    startActionTransition(async () => {
      await flushPendingSaves()
      const result = await acceptDealPaymentAction(formData)
      if (result.ok) {
        toast.success(result.message)
        setPaymentDialogOpen(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="h-auto overflow-visible xl:h-[calc(100vh-10rem)] xl:overflow-hidden">
      <div className="grid h-full grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,520px)] 2xl:grid-cols-[minmax(640px,1fr)_minmax(560px,680px)]">
        <section className="min-w-0 xl:min-h-0">
          <div className="h-full min-h-[520px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <WazzupDealFrame
              key={`${deal.id}:${deal.wazzupChatType}:${deal.wazzupChatId}:${deal.wazzupChannelId}`}
              dealId={deal.id}
            />
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-4 overflow-visible xl:min-h-0 xl:overflow-y-auto xl:pr-2">
          <div className="overflow-visible rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{deal.number || `Сделка #${deal.id}`}</div>
              <div className="truncate text-lg font-semibold text-zinc-950">
                {draft.title || customerLabel(draft.customerId, customersById, deal) || "Без названия"}
              </div>
            </div>
            <SaveIndicator status={mergeStatus(fieldSaveStatus, itemSaveStatus)} error={saveError} />
            </div>
          </div>

          <Card className="overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Клиент</CardTitle>
              <CardDescription>Контакт и персональная скидка</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 overflow-visible">
              <Field>
                <FieldLabel className="text-xs text-muted-foreground">Клиент</FieldLabel>
                <FieldContent>
                  <Select value={draft.customerId} onValueChange={handleCustomerChange}>
                    <SelectTrigger className="h-10 w-full bg-white">
                      <SelectValue>
                        {(value) => customerLabel(String(value ?? noValue), customersById, deal)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" className="z-[9999] min-w-[420px]">
                      <SelectItem value={noValue}>Без клиента</SelectItem>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={String(customer.id)}>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium text-zinc-950">{customer.name || "Без имени"}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {customer.phone || "Телефон не указан"}
                              {customer.defaultDiscountPercent > 0
                                ? ` · скидка ${customer.defaultDiscountPercent}%`
                                : ""}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <div className="text-xs text-muted-foreground">Телефон</div>
                  <div className="mt-1 min-h-8 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-950">
                    {selectedCustomer?.phone || deal.customerPhone || "Не указан"}
                  </div>
                </div>
                {draft.customerId !== noValue && (
                  <Link
                    href={`/clients/${draft.customerId}`}
                    className={buttonVariants({ variant: "outline", size: "default", className: "justify-center" })}
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    Открыть клиента
                  </Link>
                )}
              </div>
              {selectedCustomer?.defaultDiscountPercent ? (
                <Badge className="w-fit bg-emerald-50 text-emerald-900">
                  Скидка клиента {selectedCustomer.defaultDiscountPercent}%
                </Badge>
              ) : null}
            </CardContent>
          </Card>

          <Card className="overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Детали сделки</CardTitle>
              <CardDescription>Основные поля сохраняются автоматически</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 overflow-visible">
              <Field>
                <FieldLabel className="text-xs text-muted-foreground">Название</FieldLabel>
                <FieldContent>
                  <Input
                    value={draft.title}
                    onChange={(event) => updateDraftField("title", event.target.value)}
                    onBlur={() => flushFieldSave()}
                  />
                </FieldContent>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Этап</FieldLabel>
                  <FieldContent>
                    <Select
                      value={draft.stageId}
                      onValueChange={(value) => updateDraftField("stageId", value || draft.stageId, { immediate: true })}
                    >
                      <SelectTrigger className="h-10 w-full bg-white">
                        <SelectValue>{(value) => stageLabel(String(value ?? ""), stagesById, deal)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" className="z-[9999]">
                        {stages.map((stage) => (
                          <SelectItem key={stage.id} value={String(stage.id)}>
                            {stage.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Источник</FieldLabel>
                  <FieldContent>
                    <Select
                      value={draft.source}
                      onValueChange={(value) =>
                        updateDraftField("source", normalizeSourceValue(value), { immediate: true })
                      }
                    >
                      <SelectTrigger className="h-10 w-full bg-white">
                        <SelectValue>{(value) => getSourceLabel(String(value ?? "manual"))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" className="z-[9999]">
                        {sourceOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Ответственный</FieldLabel>
                  <FieldContent>
                    <Select
                      value={draft.responsibleUserId}
                      onValueChange={(value) =>
                        updateDraftField("responsibleUserId", value || noValue, { immediate: true })
                      }
                    >
                      <SelectTrigger className="h-10 w-full bg-white">
                        <SelectValue>
                          {(value) => responsibleLabel(String(value ?? noValue), usersById, deal)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" className="z-[9999]">
                        <SelectItem value={noValue}>Не назначен</SelectItem>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={String(user.id)}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Дата/время</FieldLabel>
                  <FieldContent>
                    <Input
                      type="datetime-local"
                      value={draft.dueAt}
                      onChange={(event) => updateDraftField("dueAt", event.target.value)}
                      onBlur={() => flushFieldSave()}
                    />
                  </FieldContent>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Получение</FieldLabel>
                  <FieldContent>
                    <Input
                      value={draft.deliveryType}
                      onChange={(event) => updateDraftField("deliveryType", event.target.value)}
                      onBlur={() => flushFieldSave()}
                    />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Адрес</FieldLabel>
                  <FieldContent>
                    <Input
                      value={draft.address}
                      onChange={(event) => updateDraftField("address", event.target.value)}
                      onBlur={() => flushFieldSave()}
                    />
                  </FieldContent>
                </Field>
              </div>
              <Field>
                <FieldLabel className="text-xs text-muted-foreground">Комментарий</FieldLabel>
                <FieldContent>
                  <Textarea
                    value={draft.comment}
                    rows={3}
                    onChange={(event) => updateDraftField("comment", event.target.value)}
                    onBlur={() => flushFieldSave()}
                  />
                </FieldContent>
              </Field>
            </CardContent>
          </Card>

          <Card className="overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Состав</CardTitle>
              <CardDescription>Позиции и скидки сохраняются после изменения</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 overflow-visible">
              <ProductCombobox products={products} portalDropdown onSelect={addProduct} />
              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                <Table className="min-w-[620px]">
                  <TableHeader>
                    <TableRow className="bg-zinc-50">
                      <TableHead className="min-w-[180px] max-w-[240px] text-xs font-semibold text-zinc-950">
                        Товар
                      </TableHead>
                      <TableHead className="w-16 text-xs font-semibold text-zinc-950">Кол-во</TableHead>
                      <TableHead className="w-24 text-xs font-semibold text-zinc-950">Цена</TableHead>
                      <TableHead className="w-52 text-xs font-semibold text-zinc-950">Скидка</TableHead>
                      <TableHead className="w-28 text-right text-xs font-semibold text-zinc-950">Итого</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pricedItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                          Состав пуст
                        </TableCell>
                      </TableRow>
                    )}
                    {pricedItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="min-w-[180px] max-w-[240px]">
                          <div className="flex min-w-0 items-center gap-2">
                            <ProductThumbnail
                              name={item.productName}
                              imagePath={item.imagePath}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-zinc-950" title={item.productName}>
                                {item.productName}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">{item.productCode}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="w-16">
                          <Input
                            className="h-8 w-16"
                            type="number"
                            min="1"
                            step="1"
                            value={item.qty}
                            disabled={item.isTemporary}
                            onChange={(event) => updateItemField(item.id, { qty: event.target.value })}
                            onBlur={() => {
                              updateItemField(item.id, { qty: item.qty }, { immediate: true, normalize: true })
                            }}
                          />
                        </TableCell>
                        <TableCell className="w-24">
                          <Input
                            className="h-8 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.price}
                            disabled={item.isTemporary}
                            onChange={(event) => updateItemField(item.id, { price: event.target.value })}
                            onBlur={() => {
                              updateItemField(item.id, { price: item.price }, { immediate: true, normalize: true })
                            }}
                          />
                        </TableCell>
                        <TableCell className="w-52">
                          <div className="flex items-center gap-1">
                            <Select
                              value={item.discountType}
                              onValueChange={(value) =>
                                updateItemField(
                                  item.id,
                                  { discountType: normalizeDiscountValue(value) },
                                  { immediate: true }
                                )
                              }
                            >
                              <SelectTrigger className="h-8 w-28 bg-white" disabled={item.isTemporary}>
                                <SelectValue>{(value) => discountLabel(String(value ?? "none"))}</SelectValue>
                              </SelectTrigger>
                              <SelectContent align="start" className="z-[9999]">
                                {discountOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              className="h-8 w-20"
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.discountValue}
                              disabled={item.isTemporary || item.discountType === "none"}
                              onChange={(event) => updateItemField(item.id, { discountValue: event.target.value })}
                              onBlur={() => {
                                updateItemField(
                                  item.id,
                                  { discountValue: item.discountValue },
                                  { immediate: true, normalize: true }
                                )
                              }}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="w-28 text-right font-semibold text-zinc-950">
                          {formatMoney(item.line.total)}
                        </TableCell>
                        <TableCell className="w-8 text-right">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="destructive"
                            onClick={() => void removeItem(item)}
                          >
                            <Trash2Icon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold text-zinc-950">Скидка на чек</CardTitle>
                {hasAppliedCustomerDiscount && selectedCustomer && (
                  <Badge className="bg-emerald-50 text-emerald-900">
                    Скидка клиента {selectedCustomer.defaultDiscountPercent}%
                  </Badge>
                )}
              </div>
              <CardDescription>Применяется после скидок по позициям</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 overflow-visible">
              <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Тип скидки</FieldLabel>
                  <FieldContent>
                    <Select
                      value={draft.dealDiscountType}
                      onValueChange={(value) =>
                        updateDraftField("dealDiscountType", normalizeDiscountValue(value), {
                          immediate: true,
                          markDiscountManual: true,
                        })
                      }
                    >
                      <SelectTrigger className="h-10 w-full bg-white">
                        <SelectValue>{(value) => discountLabel(String(value ?? "none"))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" className="z-[9999]">
                        {discountOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Значение</FieldLabel>
                  <FieldContent>
                    <Input
                      className="h-10"
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.dealDiscountValue}
                      disabled={draft.dealDiscountType === "none"}
                      onChange={(event) =>
                        updateDraftField("dealDiscountValue", event.target.value, { markDiscountManual: true })
                      }
                      onBlur={() => {
                        const next = { ...draft, dealDiscountValue: String(normalizedPrice(draft.dealDiscountValue)) }
                        setDraft(next)
                        flushFieldSave(next)
                      }}
                    />
                  </FieldContent>
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Оплата</CardTitle>
              <CardDescription>Оплаты проходят через открытую смену кассы</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 overflow-visible text-sm">
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <SummaryBox label="Итого" value={formatMoney(totals.total)} />
                <SummaryBox label="Оплачено" value={formatMoney(deal.paid)} />
                <SummaryBox label="Остаток" value={formatMoney(balance)} strong={balance > 0} />
              </div>
              {balance <= 0 && totals.total > 0 ? (
                <Badge className="w-fit bg-emerald-100 text-emerald-900">
                  <CheckCircle2Icon data-icon="inline-start" />
                  Оплачено
                </Badge>
              ) : (
                <Button
                  type="button"
                  disabled={actionPending || hasPendingSaves}
                  className="h-10 bg-zinc-950 text-white hover:bg-zinc-800"
                  onClick={openPaymentDialog}
                >
                  <ReceiptTextIcon data-icon="inline-start" />
                  Принять оплату
                </Button>
              )}
              {showShiftWarning && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                  <AlertTitle>Смена не открыта</AlertTitle>
                  <AlertDescription>Откройте смену в кассе, чтобы принять оплату по сделке.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Заказ</CardTitle>
              <CardDescription>Создание заказа из текущей сделки</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 overflow-visible text-sm">
              {deal.orderId ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                  <div className="text-xs font-medium uppercase text-sky-900">Связанный заказ</div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sky-950">
                        {deal.orderNumber || `Заказ #${deal.orderId}`}
                      </div>
                      <div className="text-xs text-sky-800">{deal.orderStatus || "Статус не указан"}</div>
                    </div>
                    <Button size="sm" variant="outline" render={<Link href={orderHref} />}>
                      <ExternalLinkIcon data-icon="inline-start" />
                      Открыть заказ
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-zinc-600">
                    Заказ еще не создан
                  </div>
                  <Button
                    type="button"
                    disabled={!hasItems || actionPending || hasPendingSaves}
                    className="h-10 bg-zinc-950 text-white hover:bg-zinc-800"
                    onClick={createOrderFromDeal}
                  >
                    <ShoppingBagIcon data-icon="inline-start" />
                    Создать заказ
                  </Button>
                  {!hasItems && <div className="text-xs text-zinc-500">Добавьте товары, чтобы создать заказ</div>}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm xl:sticky xl:bottom-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Итог</CardTitle>
              <CardDescription>Суммы считаются текущими правилами расчета</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 overflow-visible text-sm">
              <SummaryRow label="Товары до скидки" value={formatMoney(totals.itemsTotalBeforeDiscount)} />
              <SummaryRow label="Скидки по позициям" value={formatMoney(totals.itemsDiscountTotal)} />
              <SummaryRow label="Скидка на чек" value={formatMoney(totals.dealDiscountAmount)} />
              <SummaryRow label="Итого" value={formatMoney(totals.total)} strong total />
              <SummaryRow label="Оплачено" value={formatMoney(deal.paid)} />
              <SummaryRow label="Остаток" value={formatMoney(balance)} strong danger={balance > 0} />

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {deal.orderId ? (
                  <Button type="button" variant="outline" render={<Link href={orderHref} />}>
                    <ExternalLinkIcon data-icon="inline-start" />
                    Открыть заказ
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={!hasItems || actionPending || hasPendingSaves}
                    className="bg-zinc-950 text-white hover:bg-zinc-800"
                    onClick={createOrderFromDeal}
                  >
                    Создать заказ
                  </Button>
                )}
                {balance <= 0 ? (
                  <div className="flex h-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-900">
                    <CheckCircle2Icon data-icon="inline-start" />
                    Оплачено
                  </div>
                ) : (
                  <Button
                    type="button"
                    disabled={actionPending || hasPendingSaves}
                    className="bg-zinc-950 text-white hover:bg-zinc-800"
                    onClick={openPaymentDialog}
                  >
                    <ReceiptTextIcon data-icon="inline-start" />
                    Принять оплату
                  </Button>
                )}
              </div>
              {!hasItems && <div className="text-xs text-zinc-500">Добавьте товары, чтобы создать заказ</div>}
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <form onSubmit={submitPayment}>
            <DialogHeader>
              <DialogTitle>Принять оплату</DialogTitle>
              <DialogDescription>{deal.number || `Сделка #${deal.id}`}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-3 gap-2 rounded-2xl border bg-muted/30 p-3 text-sm">
                <SummaryBox label="Итого" value={formatMoney(totals.total)} />
                <SummaryBox label="Оплачено" value={formatMoney(deal.paid)} />
                <SummaryBox label="Остаток" value={formatMoney(balance)} strong />
              </div>
              <Field>
                <FieldLabel htmlFor="deal-payment-amount">Сумма оплаты</FieldLabel>
                <FieldContent>
                  <Input
                    id="deal-payment-amount"
                    type="number"
                    min="0.01"
                    max={roundMoney(balance)}
                    step="0.01"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    onBlur={() => {
                      const amount = Math.min(normalizedPrice(paymentAmount), roundMoney(balance))
                      setPaymentAmount(String(roundMoney(amount)))
                    }}
                  />
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel>Способ оплаты</FieldLabel>
                <FieldContent>
                  <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                    <SelectTrigger className="h-10 w-full bg-white">
                      <SelectValue>{(value) => getPaymentMethodLabel(String(value ?? "cash"))}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" className="z-[9999]">
                      {paymentMethodOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="deal-payment-comment">Комментарий</FieldLabel>
                <FieldContent>
                  <Textarea
                    id="deal-payment-comment"
                    rows={3}
                    value={paymentComment}
                    onChange={(event) => setPaymentComment(event.target.value)}
                  />
                </FieldContent>
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={actionPending}>
                Принять оплату
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SaveIndicator({ status, error }: { status: SaveStatus; error: string }) {
  const label = status === "saving" ? "Сохраняем..." : status === "error" ? "Ошибка сохранения" : "Сохранено"

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <Badge
        variant="outline"
        className={cn(
          "border-zinc-200 bg-white",
          status === "saving" && "text-zinc-600",
          status === "saved" && "border-emerald-200 bg-emerald-50 text-emerald-700",
          status === "error" && "border-red-200 bg-red-50 text-red-700"
        )}
      >
        {label}
      </Badge>
      {status === "error" && error && <div className="max-w-56 truncate text-xs text-red-700">{error}</div>}
    </div>
  )
}

function SummaryRow({
  label,
  value,
  strong,
  total,
  danger,
}: {
  label: string
  value: string
  strong?: boolean
  total?: boolean
  danger?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-600">{label}</span>
      <span
        className={cn(
          "font-medium text-zinc-950",
          strong && "font-semibold",
          total && "text-xl",
          danger && "text-amber-700"
        )}
      >
        {value}
      </span>
    </div>
  )
}

function SummaryBox({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate font-semibold text-zinc-950", strong && "text-amber-800")}>
        {value}
      </div>
    </div>
  )
}

function createDealDraft(deal: Deal): DealDraft {
  return {
    customerId: deal.customerId ? String(deal.customerId) : noValue,
    title: deal.title ?? "",
    source: deal.source ?? "manual",
    stageId: deal.stageId ? String(deal.stageId) : "",
    responsibleUserId: deal.responsibleUserId ? String(deal.responsibleUserId) : noValue,
    dueAt: toDatetimeLocal(deal.dueAt ?? ""),
    deliveryType: deal.deliveryType ?? "",
    address: deal.address ?? "",
    comment: deal.comment ?? "",
    dealDiscountType: deal.dealDiscountType ?? "none",
    dealDiscountValue: String(deal.dealDiscountValue ?? 0),
  }
}

function createItemDrafts(items: DealItem[]): DealItemDraft[] {
  return items.map((item) => ({
    ...item,
    qty: String(item.qty ?? 1),
    price: String(item.price ?? 0),
    discountValue: String(item.discountValue ?? 0),
  }))
}

function createTemporaryItem(dealId: number, product: Product, itemId: number): DealItemDraft {
  return {
    id: itemId,
    dealId,
    productCode: product.code,
    productName: product.name,
    imagePath: product.imagePath,
    qty: "1",
    price: String(product.salePrice ?? 0),
    discountType: "none",
    discountValue: "0",
    discountAmount: 0,
    totalBeforeDiscount: product.salePrice ?? 0,
    total: product.salePrice ?? 0,
    createdAt: "",
    updatedAt: "",
    isTemporary: true,
  }
}

function createDealFormData(dealId: number, draft: DealDraft) {
  const formData = new FormData()
  formData.set("dealId", String(dealId))
  formData.set("customerId", draft.customerId === noValue ? "" : draft.customerId)
  formData.set("title", draft.title ?? "")
  formData.set("source", draft.source ?? "manual")
  formData.set("stageId", draft.stageId ?? "")
  formData.set("responsibleUserId", draft.responsibleUserId === noValue ? "" : draft.responsibleUserId)
  formData.set("dueAt", draft.dueAt ?? "")
  formData.set("deliveryType", draft.deliveryType ?? "")
  formData.set("address", draft.address ?? "")
  formData.set("comment", draft.comment ?? "")
  formData.set("dealDiscountType", draft.dealDiscountType ?? "none")
  formData.set("dealDiscountValue", String(normalizedPrice(draft.dealDiscountValue)))

  return formData
}

function createItemFormData(dealId: number, item: DealItemDraft) {
  const formData = new FormData()
  formData.set("dealId", String(dealId))
  formData.set("itemId", String(item.id))
  formData.set("qty", String(normalizedQty(item.qty)))
  formData.set("price", String(normalizedPrice(item.price)))
  formData.set("discountType", item.discountType)
  formData.set("discountValue", String(item.discountType === "none" ? 0 : normalizedPrice(item.discountValue)))

  return formData
}

function customerLabel(value: string, customersById: Map<string, Customer>, deal: Deal) {
  if (!value || value === noValue) {
    return "Без клиента"
  }

  const customer = customersById.get(value)
  if (customer) {
    return [customer.name || "Без имени", customer.phone].filter(Boolean).join(" · ")
  }

  if (deal.customerId && String(deal.customerId) === value) {
    return [deal.customerName || `Клиент #${value}`, deal.customerPhone].filter(Boolean).join(" · ")
  }

  return `Клиент #${value}`
}

function stageLabel(value: string, stagesById: Map<string, DealStage>, deal: Deal) {
  if (!value) {
    return "Без этапа"
  }

  return stagesById.get(value)?.name || (deal.stageId && String(deal.stageId) === value ? deal.stageName : "") || `Этап #${value}`
}

function responsibleLabel(value: string, usersById: Map<string, CurrentUser>, deal: Deal) {
  if (!value || value === noValue) {
    return "Не назначен"
  }

  return usersById.get(value)?.name || (deal.responsibleUserId && String(deal.responsibleUserId) === value
    ? deal.responsibleUserName
    : "") || `Пользователь #${value}`
}

function discountLabel(value: string) {
  return discountOptions.find((option) => option.value === value)?.label ?? "Без скидки"
}

function normalizeSourceValue(value: string | null): DealSource {
  return value || "manual"
}

function normalizeDiscountValue(value: string | null): DiscountType {
  return value === "percent" || value === "amount" ? value : "none"
}

function normalizedQty(value: string | number) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(1, Math.round(number)) : 1
}

function normalizedPrice(value: string | number) {
  const number = Number(String(value).replace(",", "."))
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function mergeStatus(fieldStatus: SaveStatus, itemStatus: SaveStatus): SaveStatus {
  if (fieldStatus === "error" || itemStatus === "error") {
    return "error"
  }
  if (fieldStatus === "saving" || itemStatus === "saving") {
    return "saving"
  }
  return "saved"
}

function toDatetimeLocal(value: string) {
  if (!value) {
    return ""
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toISOString().slice(0, 16)
}
