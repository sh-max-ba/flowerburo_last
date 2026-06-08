"use client"

import type React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { parseWallClock } from "@/lib/datetime"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ExternalLinkIcon,
  ReceiptTextIcon,
  ShoppingBagIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import {
  addDealItemAction,
  addDealBouquetAction,
  acceptDealPaymentAction,
  createOrderFromDealAction,
  updateOrderFromDealAction,
  removeDealItemAction,
  removeDealItemGroupAction,
  updateDealFieldsAction,
  updateDealItemAction,
} from "@/app/actions"
import type { Customer, Deal, DealItem, DealSource, DealStage } from "@/lib/crm"
import { getBouquetAvailability } from "@/lib/bouquet-availability"
import { calculateCommercialTotals, calculateLineTotal, type DiscountType } from "@/lib/pricing"
import type { BouquetTemplate, CurrentUser, Order, PaymentMethod, Product } from "@/lib/db"
import { deliveryTypeLabel, getPaymentMethodLabel, paymentMethodOptions, sourceLabel as getSourceLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { WazzupCustomChat } from "@/components/deals/wazzup-custom-chat"
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
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type SaveStatus = "saved" | "saving" | "error"
type DealTab = "overview" | "composition" | "payment"
// Статус оплаты выводится из реальных сумм (итого/оплачено), не хардкодится. "none" — суммы ещё
// нет (пустая сделка/нет заказа): бейдж «Оплачено» НЕ показываем (это была ложная отметка).
type PaymentStatus = "none" | "unpaid" | "partial" | "paid"

// Whether the Wazzup chat column should occupy its half of the deal layout.
// "checking" — we don't yet know (keep the split so the frame can show its own skeleton);
// "available" — integration is on (chat is open OR offers a link action) → show the chat column;
// "unavailable" — integration is off / not configured → collapse the column and give the form full width.
type ChatLayout = "checking" | "available" | "unavailable"

// Per-deal iframe statuses. We only need the discriminant to decide the layout; the
// WazzupDealFrame itself owns the full rendering of each state.
type WazzupIframeStatus = "ok" | "not_configured" | "disabled" | "no_chat" | "error"

type DealDraft = {
  customerId: string
  title: string
  source: DealSource
  stageId: string
  responsibleUserId: string
  dueAt: string
  deliveryType: string
  address: string
  recipientPhone: string
  comment: string
  dealDiscountType: DiscountType
  dealDiscountValue: string
}

type CreateOrderDraft = {
  dueDate: string
  dueTime: string
  deliveryType: "pickup" | "delivery"
  address: string
  recipientPhone: string
  comment: string
  deliveryPrice: string
  courierPayout: string
}

// Локальная строка корзины в модалке «Изменить заказ» (правится без автосохранения).
type OrderLineDraft = {
  key: string
  productCode: string
  name: string
  imagePath: string
  qty: string
  price: string
  discountType: DiscountType
  discountValue: string
  bouquetId: number | null
  bouquetName: string
  bouquetGroupId: string
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

const activeOrderStatuses = new Set(["Новый", "В работе", "Готов", "Передан курьеру", "new", "in_progress", "ready"])

const deliveryOptions = [
  { value: "pickup", label: "Самовывоз" },
  { value: "delivery", label: "Доставка" },
] as const

export function DealDetailPage({
  deal,
  stages,
  customers,
  users,
  products,
  bouquets,
  dealOrders,
  openShift,
  chatMode,
}: {
  deal: Deal
  stages: DealStage[]
  customers: Customer[]
  users: CurrentUser[]
  products: Product[]
  bouquets: BouquetTemplate[]
  dealOrders: Order[]
  openShift: { id: number; status: "open" | "closed" } | null
  chatMode: "iframe" | "custom"
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(() => createDealDraft(deal))
  const [activeTab, setActiveTab] = useState<DealTab>("overview")
  const [items, setItems] = useState(() => createItemDrafts(deal.items))
  const [fieldSaveStatus, setFieldSaveStatus] = useState<SaveStatus>("saved")
  const [itemSaveStatus, setItemSaveStatus] = useState<SaveStatus>("saved")
  const [saveError, setSaveError] = useState("")
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash")
  const [paymentComment, setPaymentComment] = useState("")
  const [createOrderDialogOpen, setCreateOrderDialogOpen] = useState(false)
  const [orderDraft, setOrderDraft] = useState<CreateOrderDraft>(() => createOrderDraftFromDealDraft(createDealDraft(deal)))
  const [orderDialogMode, setOrderDialogMode] = useState<"create" | "edit">("create")
  const [orderItems, setOrderItems] = useState<OrderLineDraft[]>([])
  const [showShiftWarning, setShowShiftWarning] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [actionPending, startActionTransition] = useTransition()
  // Drives the responsive layout: when the Wazzup integration is off/unconfigured we drop the
  // empty chat column and let the deal form use the full width. The WazzupDealFrame still owns
  // rendering its own states; this only governs whether its column is present.
  const [chatLayout, setChatLayout] = useState<ChatLayout>("checking")
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
      const nextDraft = createDealDraft(deal)
      currentDealIdRef.current = deal.id
      setDraft(nextDraft)
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

    const nextDraft = createDealDraft(deal)
    setDraft(nextDraft)
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

  // Resolve whether to keep the Wazzup chat column. We ask the same lightweight iframe endpoint the
  // frame uses; only a globally disabled / not-configured integration collapses the column. A
  // per-deal "no_chat" still shows the column (it offers a "link by customer" action), and transient
  // errors keep the split so a retry stays visible.
  // Сброс на "checking" при смене сделки — во время рендера (не в эффекте), чтобы не
  // провоцировать каскадный ререндер; сам опрос статуса остаётся в эффекте.
  const [chatLayoutDealId, setChatLayoutDealId] = useState(deal.id)
  if (chatLayoutDealId !== deal.id) {
    setChatLayoutDealId(deal.id)
    setChatLayout("checking")
  }
  useEffect(() => {
    let isActive = true

    void resolveChatStatus(deal.id, chatMode).then((status) => {
      if (!isActive) {
        return
      }
      setChatLayout(status === "disabled" || status === "not_configured" ? "unavailable" : "available")
    })

    return () => {
      isActive = false
    }
  }, [deal.id, chatMode])

  const customersById = useMemo(() => new Map(customers.map((customer) => [String(customer.id), customer])), [customers])
  const stagesById = useMemo(() => new Map(stages.map((stage) => [String(stage.id), stage])), [stages])
  const usersById = useMemo(() => new Map(users.map((user) => [String(user.id), user])), [users])
  const selectedCustomer = draft.customerId === noValue ? null : customersById.get(draft.customerId) ?? null

  const pricedItems = useMemo(
    () =>
      items.map((item) => {
        const qtyNumber = normalizedQty(item.qty)
        const priceNumber = normalizedPrice(item.price)
        const discountValueNumber = normalizedPrice(item.discountValue)
        const pricingQty = item.bouquetGroupId && priceNumber > 0 ? 1 : qtyNumber
        const line = calculateLineTotal({
          qty: pricingQty,
          price: priceNumber,
          discountType: item.discountType,
          discountValue: discountValueNumber,
        })

        return {
          ...item,
          qtyNumber,
          priceNumber,
          discountValueNumber,
          pricingQty,
          line,
        }
      }),
    [items]
  )
  const itemGroups = useMemo(() => {
    const groups: Array<
      | { type: "single"; key: string; item: (typeof pricedItems)[number] }
      | { type: "bouquet"; key: string; bouquetName: string; items: Array<(typeof pricedItems)[number]> }
    > = []
    const bouquetGroups = new Map<string, Extract<(typeof groups)[number], { type: "bouquet" }>>()

    for (const item of pricedItems) {
      if (!item.bouquetGroupId) {
        groups.push({ type: "single", key: `item-${item.id}`, item })
        continue
      }

      let group = bouquetGroups.get(item.bouquetGroupId)
      if (!group) {
        group = {
          type: "bouquet",
          key: item.bouquetGroupId,
          bouquetName: item.bouquetName,
          items: [],
        }
        bouquetGroups.set(item.bouquetGroupId, group)
        groups.push(group)
      }
      group.items.push(item)
    }

    return groups
  }, [pricedItems])

  const totals = useMemo(
    () =>
      calculateCommercialTotals(
        pricedItems.map((item) => ({
          qty: item.pricingQty,
          price: item.priceNumber,
          discountType: item.discountType,
          discountValue: item.discountValueNumber,
        })),
        draft.dealDiscountType,
        normalizedPrice(draft.dealDiscountValue)
      ),
    [draft.dealDiscountType, draft.dealDiscountValue, pricedItems]
  )

  const hasPendingSaves = fieldSaveStatus === "saving" || itemSaveStatus === "saving"
  const hasItems = pricedItems.length > 0
  const activeDealOrder = useMemo(
    () => dealOrders.find((order) => activeOrderStatuses.has(order.status)) ?? null,
    [dealOrders]
  )
  const latestDealOrder = dealOrders[0] ?? null
  // После создания заказа источник истины по составу и суммам — сам заказ. Карточка показывает
  // суммы заказа, корзина сделки блокируется (заблокированное отражение до «Изменить заказ»).
  const orderLocked = Boolean(activeDealOrder)
  const orderEditable =
    activeDealOrder !== null &&
    activeDealOrder.isReserved &&
    (activeDealOrder.status === "Новый" || activeDealOrder.status === "В работе")
  const displayTotal = activeDealOrder ? activeDealOrder.total : totals.total
  const displayPaid = activeDealOrder ? activeDealOrder.paid : deal.paid
  const balance = Math.max(0, displayTotal - displayPaid)
  const paymentStatus: PaymentStatus =
    displayTotal <= 0 ? "none" : displayPaid <= 0 ? "unpaid" : balance <= 0 ? "paid" : "partial"
  const orderHref = activeDealOrder ? `/orders?orderId=${activeDealOrder.id}` : "/orders"

  // Локальный расчёт корзины модалки «Изменить заказ» (живой пересчёт, без автосохранения).
  const isEditOrderMode = orderDialogMode === "edit"
  const editPricedLines = useMemo(
    () =>
      orderItems.map((line) => {
        const qtyNumber = normalizedQty(line.qty)
        const priceNumber = normalizedPrice(line.price)
        const discountValueNumber = normalizedPrice(line.discountValue)
        const pricingQty = line.bouquetGroupId && priceNumber > 0 ? 1 : qtyNumber
        const lineTotal = calculateLineTotal({
          qty: pricingQty,
          price: priceNumber,
          discountType: line.discountType,
          discountValue: discountValueNumber,
        })
        return { ...line, qtyNumber, priceNumber, discountValueNumber, pricingQty, line: lineTotal }
      }),
    [orderItems]
  )
  const editTotals = useMemo(
    () =>
      calculateCommercialTotals(
        editPricedLines.map((line) => ({
          qty: line.pricingQty,
          price: line.priceNumber,
          discountType: line.discountType,
          discountValue: line.discountValueNumber,
        })),
        draft.dealDiscountType,
        normalizedPrice(draft.dealDiscountValue)
      ),
    [draft.dealDiscountType, draft.dealDiscountValue, editPricedLines]
  )

  const dialogItemsBreakdown = isEditOrderMode ? editTotals : totals
  const dialogItemsTotal = dialogItemsBreakdown.total
  const dialogHasItems = isEditOrderMode ? editPricedLines.length > 0 : hasItems
  const orderDeliveryPrice = normalizedPrice(orderDraft.deliveryPrice)
  const orderCourierPayout = normalizedPrice(orderDraft.courierPayout)
  const orderTotal = dialogItemsTotal + orderDeliveryPrice
  const orderBalance = Math.max(0, orderTotal - displayPaid)
  const paidExceedsOrderTotal = displayPaid - orderTotal > 0.009
  const orderDueAt = buildOrderDueAt(orderDraft)
  const missingOrderDueAt = !orderDueAt
  const missingDeliveryAddress = orderDraft.deliveryType === "delivery" && !orderDraft.address.trim()
  const hasAppliedCustomerDiscount =
    Boolean(selectedCustomer?.defaultDiscountPercent) &&
    draft.dealDiscountType === "percent" &&
    normalizedPrice(draft.dealDiscountValue) === selectedCustomer?.defaultDiscountPercent

  // Reasons the primary actions are unavailable — surfaced as tooltips in the sticky header.
  const paymentDisabledReason = !openShift
    ? "Откройте смену в кассе, чтобы принять оплату"
    : balance <= 0
      ? "Сделка уже полностью оплачена"
      : hasPendingSaves
        ? "Дождитесь сохранения изменений"
        : null
  const createOrderDisabledReason = !hasItems
    ? "Добавьте товары, чтобы создать заказ"
    : hasPendingSaves
      ? "Дождитесь сохранения изменений"
      : null
  const editOrderDisabledReason = !orderEditable
    ? "Заказ уже собран — изменить состав нельзя"
    : actionPending
      ? "Дождитесь завершения операции"
      : null
  const orderButtonLabel = latestDealOrder && !activeDealOrder ? "Создать новый заказ" : "Создать заказ"

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
      const existing = current.find((item) => item.productCode === product.code && !item.bouquetGroupId)
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

  async function addBouquet(bouquet: BouquetTemplate, options: { showWarning?: boolean } = {}) {
    if (options.showWarning !== false && !getBouquetAvailability(bouquet).available) {
      toast.warning("На складе сейчас не хватает компонентов для этого букета.")
    }

    const version = ++itemSaveVersionRef.current
    setItemSaveStatus("saving")
    setSaveError("")

    const result = await addDealBouquetAction(deal.id, bouquet.id)
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

  async function removeGroup(groupId: string) {
    setItems((current) => current.filter((item) => item.bouquetGroupId !== groupId))
    const version = ++itemSaveVersionRef.current
    setItemSaveStatus("saving")
    setSaveError("")

    const result = await removeDealItemGroupAction(deal.id, groupId)
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

  function updateOrderDraftField<K extends keyof CreateOrderDraft>(key: K, value: CreateOrderDraft[K]) {
    setOrderDraft((current) => ({ ...current, [key]: value }))
  }

  function openCreateOrderDialog() {
    if (!hasItems) {
      toast.error("Добавьте товары в сделку перед созданием заказа")
      return
    }

    if (activeDealOrder) {
      toast.error("По сделке уже есть активный заказ")
      return
    }

    setOrderDraft(createOrderDraftFromDealDraft(draft))
    setOrderItems([])
    setOrderDialogMode("create")
    setCreateOrderDialogOpen(true)
  }

  function openEditOrderDialog() {
    if (!activeDealOrder || !orderEditable) {
      toast.error("Заказ уже собран — изменить состав нельзя")
      return
    }

    const [dueDate, dueTime] = splitDatetimeLocal(activeDealOrder.dueAt)
    setOrderDraft({
      dueDate,
      dueTime,
      deliveryType: activeDealOrder.deliveryType === "delivery" ? "delivery" : "pickup",
      address: activeDealOrder.address ?? "",
      recipientPhone: activeDealOrder.recipientPhone ?? "",
      comment: activeDealOrder.note ?? "",
      deliveryPrice: String(activeDealOrder.deliveryPrice ?? 0),
      courierPayout: String(activeDealOrder.courierPayout ?? 0),
    })
    setOrderItems(orderLinesFromItems(items))
    setOrderDialogMode("edit")
    setCreateOrderDialogOpen(true)
  }

  function updateOrderLine(key: string, patch: Partial<OrderLineDraft>) {
    setOrderItems((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function removeOrderLine(key: string) {
    setOrderItems((current) => current.filter((line) => line.key !== key))
  }

  function addOrderProduct(product: Product) {
    setOrderItems((current) => {
      const existing = current.find((line) => line.productCode === product.code && !line.bouquetGroupId)
      if (existing) {
        return current.map((line) =>
          line.key === existing.key ? { ...line, qty: String(normalizedQty(line.qty) + 1) } : line
        )
      }

      return [
        ...current,
        {
          key: `new-${product.code}-${temporaryItemIdRef.current--}`,
          productCode: product.code,
          name: product.name,
          imagePath: product.imagePath,
          qty: "1",
          price: String(product.salePrice ?? 0),
          discountType: "none",
          discountValue: "0",
          bouquetId: null,
          bouquetName: "",
          bouquetGroupId: "",
        },
      ]
    })
  }

  function submitCreateOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasItems) {
      toast.error("Добавьте товары в сделку перед созданием заказа")
      return
    }

    if (activeDealOrder) {
      toast.error("По сделке уже есть активный заказ")
      return
    }

    if (paidExceedsOrderTotal) {
      toast.error("Оплата по сделке не может быть больше суммы заказа.")
      return
    }

    startActionTransition(async () => {
      await flushPendingSaves()
      const result = await createOrderFromDealAction(createOrderFromDealFormData(deal.id, orderDraft))
      if (result.ok) {
        toast.success(result.message)
        setCreateOrderDialogOpen(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function submitEditOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeDealOrder || !orderEditable) {
      toast.error("Заказ уже собран — изменить состав нельзя")
      return
    }

    if (editPricedLines.length === 0) {
      toast.error("В заказе должна остаться хотя бы одна позиция")
      return
    }

    if (paidExceedsOrderTotal) {
      toast.error("Сумма заказа не может быть меньше уже принятой оплаты.")
      return
    }

    const formData = new FormData()
    formData.set("dealId", String(deal.id))
    formData.set("orderId", String(activeDealOrder.id))
    formData.set("dueAt", buildOrderDueAt(orderDraft))
    formData.set("deliveryType", orderDraft.deliveryType)
    formData.set("address", orderDraft.address.trim())
    formData.set("recipientPhone", orderDraft.recipientPhone.trim())
    formData.set("comment", orderDraft.comment.trim())
    formData.set("deliveryPrice", String(normalizedPrice(orderDraft.deliveryPrice)))
    formData.set("courierPayout", String(normalizedPrice(orderDraft.courierPayout)))
    for (const line of orderItems) {
      formData.append("itemProductCode", line.productCode)
      formData.append("itemQty", String(normalizedQty(line.qty)))
      formData.append("itemPrice", String(normalizedPrice(line.price)))
      formData.append("itemDiscountType", line.discountType)
      formData.append(
        "itemDiscountValue",
        String(line.discountType === "none" ? 0 : normalizedPrice(line.discountValue))
      )
      formData.append("itemBouquetId", line.bouquetId ? String(line.bouquetId) : "")
      formData.append("itemBouquetName", line.bouquetName)
      formData.append("itemBouquetGroupId", line.bouquetGroupId)
    }

    startActionTransition(async () => {
      await flushPendingSaves()
      const result = await updateOrderFromDealAction(formData)
      if (result.ok) {
        toast.success(result.message)
        setCreateOrderDialogOpen(false)
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

  const showChatColumn = chatLayout !== "unavailable"

  return (
    <div className="h-auto overflow-visible xl:h-[calc(100vh-6rem)] xl:overflow-hidden">
      <div
        className={cn(
          "grid h-full grid-cols-1 gap-5",
          showChatColumn
            ? "xl:grid-cols-[minmax(0,1fr)_minmax(420px,520px)] 2xl:grid-cols-[minmax(640px,1fr)_minmax(560px,680px)]"
            : "xl:grid-cols-1"
        )}
      >
        {showChatColumn && (
          <section className="flex min-w-0 flex-col gap-3 xl:min-h-0">
            <ClientHeader
              name={selectedCustomer?.name || deal.customerName}
              phone={selectedCustomer?.phone || deal.customerPhone}
              customerId={draft.customerId === noValue ? null : draft.customerId}
              discountPercent={selectedCustomer?.defaultDiscountPercent ?? 0}
            />
            <div className="min-h-[520px] flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              {chatMode === "custom" ? (
                <WazzupCustomChat key={`custom:${deal.id}`} dealId={deal.id} bouquets={bouquets} />
              ) : (
                <WazzupDealFrame
                  key={`${deal.id}:${deal.wazzupChatType}:${deal.wazzupChatId}:${deal.wazzupChannelId}`}
                  dealId={deal.id}
                />
              )}
            </div>
          </section>
        )}

        <aside
          className={cn(
            "flex min-w-0 flex-col gap-4 overflow-visible xl:min-h-0 xl:overflow-hidden xl:pr-2",
            // Full width without the chat column: keep the form readable with a centered max width.
            !showChatColumn && "xl:mx-auto xl:w-full xl:max-w-4xl"
          )}
        >
          {!showChatColumn && (
            <ClientHeader
              name={selectedCustomer?.name || deal.customerName}
              phone={selectedCustomer?.phone || deal.customerPhone}
              customerId={draft.customerId === noValue ? null : draft.customerId}
              discountPercent={selectedCustomer?.defaultDiscountPercent ?? 0}
            />
          )}
          <div className="sticky top-0 z-20 grid gap-3 overflow-visible rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">{deal.number || `Сделка #${deal.id}`}</div>
                <div className="truncate text-lg font-semibold text-zinc-950">
                  {draft.title || customerLabel(draft.customerId, customersById, deal) || "Без названия"}
                </div>
              </div>
              <Select
                value={draft.stageId}
                onValueChange={(value) => updateDraftField("stageId", value || draft.stageId, { immediate: true })}
              >
                <SelectTrigger className="h-9 w-auto min-w-[150px] bg-white">
                  <SelectValue>{(value) => stageLabel(String(value ?? ""), stagesById, deal)}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end" className="z-[9999]">
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={String(stage.id)}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SaveIndicator status={mergeStatus(fieldSaveStatus, itemSaveStatus)} error={saveError} />
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as DealTab)}
            className="min-h-0 flex-1 gap-4 overflow-visible"
          >
            <div className="overflow-visible rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="overview" className="min-w-0 px-1">
                  Обзор
                </TabsTrigger>
                <TabsTrigger value="composition" className="min-w-0 px-1">
                  <span className="truncate">Состав</span>
                  {pricedItems.length > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                      {pricedItems.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-visible xl:overflow-y-auto xl:pr-1">
          <Card
            className={cn(
              "overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm",
              activeTab !== "overview" && "hidden"
            )}
          >
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              className="flex w-full items-center justify-between gap-2 px-6 py-4 text-left"
            >
              <div>
                <div className="text-base font-semibold text-zinc-950">Детали сделки</div>
                <div className="text-sm text-muted-foreground">Клиент, ответственный, комментарий</div>
              </div>
              <ChevronDownIcon
                className={cn("size-4 shrink-0 text-zinc-500 transition-transform", detailsOpen && "rotate-180")}
              />
            </button>
            {detailsOpen && (
              <CardContent className="grid gap-4 overflow-visible pt-0">
                <Field>
                  <FieldLabel className="text-xs text-muted-foreground">Клиент</FieldLabel>
                  <FieldContent>
                    <Select value={draft.customerId} onValueChange={handleCustomerChange}>
                      <SelectTrigger className="h-10 w-full bg-white">
                        <SelectValue>
                          {(value) => customerLabel(String(value ?? noValue), customersById, deal)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" className="z-[9999] min-w-[280px]">
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
            )}
          </Card>

          <Card
            className={cn(
              "overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm",
              activeTab !== "composition" && "hidden"
            )}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Состав</CardTitle>
              <CardDescription>Позиции и скидки сохраняются после изменения</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 overflow-visible">
              {orderLocked ? (
                <Alert className="border-sky-200 bg-sky-50 text-sky-950">
                  <AlertTitle>Состав зафиксирован заказом</AlertTitle>
                  <AlertDescription>
                    По сделке создан заказ — он источник истины по составу и суммам. Нажмите «Изменить заказ»,
                    чтобы внести правки.
                  </AlertDescription>
                </Alert>
              ) : (
                <ProductCombobox
                  products={products}
                  bouquets={bouquets}
                  includeBouquets
                  portalDropdown
                  onSelect={addProduct}
                  onSelectBouquet={(bouquet) => void addBouquet(bouquet, { showWarning: false })}
                />
              )}
              <div className="grid gap-2">
                {pricedItems.length === 0 && (
                  <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-muted-foreground">
                    Состав пуст
                  </div>
                )}
                {itemGroups.map((group) => {
                  if (group.type === "bouquet") {
                    const groupPrice = group.items.reduce((sum, item) => sum + item.priceNumber, 0)
                    const groupTotal = group.items.reduce((sum, item) => sum + item.line.total, 0)

                    return (
                      <div key={group.key} className="rounded-lg border border-zinc-200 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge variant="secondary">Букет</Badge>
                              <span className="truncate font-medium text-zinc-950">{group.bouquetName || "Букет"}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              Цена букета {formatMoney(groupPrice)}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-semibold text-zinc-950">{formatMoney(groupTotal)}</span>
                            {!orderLocked && (
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="destructive"
                                onClick={() => void removeGroup(group.key)}
                              >
                                <Trash2Icon />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 grid gap-1 rounded-lg bg-zinc-50 p-2 text-xs text-muted-foreground">
                          {group.items.map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-2">
                                <ProductThumbnail name={item.productName} imagePath={item.imagePath} size="xs" />
                                <span className="truncate">{item.productName}</span>
                              </span>
                              <span className="shrink-0">{formatNumber(item.qtyNumber)} шт</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  }

                  const item = group.item
                  return (
                    <div key={item.id} className="rounded-lg border border-zinc-200 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <ProductThumbnail name={item.productName} imagePath={item.imagePath} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-zinc-950" title={item.productName}>
                              {item.productName}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{item.productCode}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-semibold text-zinc-950">{formatMoney(item.line.total)}</span>
                          {!orderLocked && (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="destructive"
                              onClick={() => void removeItem(item)}
                            >
                              <Trash2Icon />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div>
                          <div className="text-[11px] text-muted-foreground">Кол-во</div>
                          <Input
                            className="h-8 w-16"
                            type="number"
                            min="1"
                            step="1"
                            value={item.qty}
                            disabled={item.isTemporary || orderLocked}
                            onChange={(event) => updateItemField(item.id, { qty: event.target.value })}
                            onBlur={() => {
                              updateItemField(item.id, { qty: item.qty }, { immediate: true, normalize: true })
                            }}
                          />
                        </div>
                        <div>
                          <div className="text-[11px] text-muted-foreground">Цена</div>
                          <Input
                            className="h-8 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.price}
                            disabled={item.isTemporary || orderLocked}
                            onChange={(event) => updateItemField(item.id, { price: event.target.value })}
                            onBlur={() => {
                              updateItemField(item.id, { price: item.price }, { immediate: true, normalize: true })
                            }}
                          />
                        </div>
                        <div>
                          <div className="text-[11px] text-muted-foreground">Скидка</div>
                          <div className="flex items-center gap-1">
                            <Select
                              value={item.discountType}
                              onValueChange={(value) =>
                                updateItemField(item.id, { discountType: normalizeDiscountValue(value) }, { immediate: true })
                              }
                            >
                              <SelectTrigger className="h-8 w-24 bg-white" disabled={item.isTemporary || orderLocked}>
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
                              disabled={item.isTemporary || item.discountType === "none" || orderLocked}
                              onChange={(event) => updateItemField(item.id, { discountValue: event.target.value })}
                              onBlur={() => {
                                updateItemField(item.id, { discountValue: item.discountValue }, { immediate: true, normalize: true })
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card
            className={cn(
              "overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm",
              activeTab !== "composition" && "hidden"
            )}
          >
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
                      <SelectTrigger className="h-10 w-full bg-white" disabled={orderLocked}>
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
                      disabled={draft.dealDiscountType === "none" || orderLocked}
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

          <Card
            className={cn(
              "overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm",
              activeTab !== "overview" && "hidden"
            )}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Оплата и заказ</CardTitle>
              <CardDescription>После создания заказа суммы берутся из него</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 overflow-visible text-sm">
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <SummaryBox label="Итого" value={formatMoney(displayTotal)} />
                <SummaryBox label="Оплачено" value={formatMoney(displayPaid)} />
                <SummaryBox label="Остаток" value={formatMoney(balance)} strong={balance > 0} />
              </div>
              <PaymentStatusBadge status={paymentStatus} balance={balance} />
              {(showShiftWarning || (!openShift && balance > 0)) && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                  <AlertTitle>Смена не открыта</AlertTitle>
                  <AlertDescription>Откройте смену в кассе, чтобы принять оплату по сделке.</AlertDescription>
                </Alert>
              )}

              {activeDealOrder ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase text-sky-900">Активный заказ</div>
                    <div className="font-semibold text-sky-950">
                      {activeDealOrder.number || `Заказ #${activeDealOrder.id}`} · {activeDealOrder.status}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" render={<Link href={orderHref} />}>
                    <ExternalLinkIcon data-icon="inline-start" />
                    Открыть заказ
                  </Button>
                </div>
              ) : latestDealOrder ? (
                <div
                  className={cn(
                    "rounded-lg border p-3",
                    latestDealOrder.status === "Отменен" ? "border-red-200 bg-red-50" : "border-zinc-200 bg-zinc-50"
                  )}
                >
                  <div
                    className={cn(
                      "text-xs font-medium uppercase",
                      latestDealOrder.status === "Отменен" ? "text-red-900" : "text-zinc-700"
                    )}
                  >
                    {latestDealOrder.status === "Отменен" ? "Заказ отменён" : "Последний заказ не активен"}
                  </div>
                  <div className="font-semibold text-zinc-950">
                    {latestDealOrder.number || `Заказ #${latestDealOrder.id}`} · {latestDealOrder.status}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-zinc-600">Заказ ещё не создан</div>
              )}

              {dealOrders.length > 0 && (
                <details className="mt-1 text-xs text-zinc-500">
                  <summary className="cursor-pointer select-none">История заказов сделки ({dealOrders.length})</summary>
                  <div className="mt-2 grid gap-2">
                    {dealOrders.map((order) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-950">{order.number || `Заказ #${order.id}`}</div>
                          <div className="truncate">
                            {order.dueAt ? formatDateTime(order.dueAt) : "Без срока"} · {formatMoney(order.total)}
                          </div>
                        </div>
                        <Badge variant={order.status === "Отменен" ? "destructive" : "outline"}>{order.status}</Badge>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          <Card
            className={cn(
              "overflow-visible rounded-2xl border-zinc-200 bg-white shadow-sm",
              activeTab !== "composition" && "hidden"
            )}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-950">Итог по составу</CardTitle>
              <CardDescription>Суммы считаются текущими правилами расчета</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 overflow-visible text-sm">
              <SummaryRow label="Товары до скидки" value={formatMoney(totals.itemsTotalBeforeDiscount)} />
              <SummaryRow label="Скидки по позициям" value={formatMoney(totals.itemsDiscountTotal)} />
              <SummaryRow label="Скидка на чек" value={formatMoney(totals.dealDiscountAmount)} />
              <SummaryRow label="Итого" value={formatMoney(totals.total)} strong total />
            </CardContent>
          </Card>
            </div>
          </Tabs>

          {!createOrderDialogOpen && !paymentDialogOpen && (
          <div className="flex gap-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
            <div className="flex-1">
              <ActionButton
                grow
                icon={<ReceiptTextIcon data-icon="inline-start" />}
                label="Принять оплату"
                disabledReason={paymentDisabledReason}
                disabled={actionPending || hasPendingSaves || balance <= 0 || !openShift}
                onClick={openPaymentDialog}
              />
            </div>
            <div className="flex-1">
              {orderLocked ? (
                <ActionButton
                  grow
                  icon={<ShoppingBagIcon data-icon="inline-start" />}
                  label="Изменить заказ"
                  variant="outline"
                  disabledReason={editOrderDisabledReason}
                  disabled={actionPending || !orderEditable}
                  onClick={openEditOrderDialog}
                />
              ) : (
                <ActionButton
                  grow
                  icon={<ShoppingBagIcon data-icon="inline-start" />}
                  label={orderButtonLabel}
                  variant="outline"
                  disabledReason={createOrderDisabledReason}
                  disabled={actionPending || hasPendingSaves || !hasItems}
                  onClick={openCreateOrderDialog}
                />
              )}
            </div>
          </div>
          )}
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
                <SummaryBox label="Итого" value={formatMoney(displayTotal)} />
                <SummaryBox label="Оплачено" value={formatMoney(displayPaid)} />
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
              <Button type="submit" disabled={actionPending || !openShift || balance <= 0}>
                Принять оплату
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createOrderDialogOpen} onOpenChange={setCreateOrderDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <form onSubmit={isEditOrderMode ? submitEditOrder : submitCreateOrder}>
            <DialogHeader>
              <DialogTitle>{isEditOrderMode ? "Изменение заказа" : "Создание заказа из сделки"}</DialogTitle>
              <DialogDescription>{deal.number || `Сделка #${deal.id}`}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm sm:grid-cols-5">
                <SummaryBox label="Состав" value={formatMoney(dialogItemsTotal)} />
                <SummaryBox label="Доставка" value={formatMoney(orderDeliveryPrice)} />
                <SummaryBox label="Курьеру" value={formatMoney(orderCourierPayout)} />
                <SummaryBox label="Итого" value={formatMoney(orderTotal)} strong />
                <SummaryBox label="Остаток" value={formatMoney(orderBalance)} strong={orderBalance > 0} />
              </div>

              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Клиент</FieldLabel>
                    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
                      <div className="font-medium text-zinc-950">{deal.customerName || "Клиент сделки"}</div>
                      <div className="text-xs text-zinc-500">{deal.customerPhone || "Телефон не указан"}</div>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deal-order-recipient-phone">Номер получателя</FieldLabel>
                    <FieldContent>
                      <Input
                        id="deal-order-recipient-phone"
                        value={orderDraft.recipientPhone}
                        placeholder="Например, +996 ..."
                        onChange={(event) => updateOrderDraftField("recipientPhone", event.target.value)}
                      />
                    </FieldContent>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field data-invalid={missingOrderDueAt ? true : undefined}>
                    <FieldLabel>Дата и время</FieldLabel>
                    <FieldContent>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                        <Input
                          type="date"
                          value={orderDraft.dueDate}
                          aria-invalid={missingOrderDueAt}
                          onChange={(event) => updateOrderDraftField("dueDate", event.target.value)}
                        />
                        <Input
                          type="time"
                          step="900"
                          value={orderDraft.dueTime}
                          aria-invalid={missingOrderDueAt}
                          onChange={(event) => updateOrderDraftField("dueTime", event.target.value)}
                        />
                      </div>
                      {missingOrderDueAt && <FieldDescription>Срок не указан, заказ уйдет на стол без даты.</FieldDescription>}
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>Тип получения</FieldLabel>
                    <FieldContent>
                      <Select
                        value={orderDraft.deliveryType}
                        onValueChange={(value) => updateOrderDraftField("deliveryType", normalizeDeliveryTypeValue(value))}
                      >
                        <SelectTrigger className="h-10 w-full bg-white">
                          <SelectValue>{(value) => deliveryTypeLabel(String(value ?? "pickup"))}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {deliveryOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FieldContent>
                  </Field>
                </div>

                {orderDraft.deliveryType === "delivery" && (
                  <Field data-invalid={missingDeliveryAddress ? true : undefined}>
                    <FieldLabel htmlFor="deal-order-address">Адрес доставки</FieldLabel>
                    <FieldContent>
                      <Input
                        id="deal-order-address"
                        value={orderDraft.address}
                        aria-invalid={missingDeliveryAddress}
                        onChange={(event) => updateOrderDraftField("address", event.target.value)}
                      />
                      {missingDeliveryAddress && <FieldDescription>Адрес не указан для доставки.</FieldDescription>}
                    </FieldContent>
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="deal-order-comment">Комментарий для заказа</FieldLabel>
                  <FieldContent>
                    <Textarea
                      id="deal-order-comment"
                      rows={3}
                      value={orderDraft.comment}
                      onChange={(event) => updateOrderDraftField("comment", event.target.value)}
                    />
                  </FieldContent>
                </Field>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="deal-order-delivery-price">Платит клиент за доставку</FieldLabel>
                    <FieldContent>
                      <Input
                        id="deal-order-delivery-price"
                        type="number"
                        min="0"
                        step="1"
                        value={orderDraft.deliveryPrice}
                        onChange={(event) => updateOrderDraftField("deliveryPrice", event.target.value)}
                        onBlur={(event) =>
                          updateOrderDraftField("deliveryPrice", String(normalizedPrice(event.currentTarget.value)))
                        }
                      />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deal-order-courier-payout">Выдать курьеру из кассы</FieldLabel>
                    <FieldContent>
                      <Input
                        id="deal-order-courier-payout"
                        type="number"
                        min="0"
                        step="1"
                        value={orderDraft.courierPayout}
                        onChange={(event) => updateOrderDraftField("courierPayout", event.target.value)}
                        onBlur={(event) =>
                          updateOrderDraftField("courierPayout", String(normalizedPrice(event.currentTarget.value)))
                        }
                      />
                    </FieldContent>
                  </Field>
                </div>
              </FieldGroup>

              <div className="grid gap-2 rounded-xl border border-zinc-200 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-zinc-950">Состав заказа</div>
                  {isEditOrderMode && <span className="text-xs text-zinc-500">Можно править позиции</span>}
                </div>
                {isEditOrderMode ? (
                  <div className="grid gap-2">
                    <ProductCombobox products={products} bouquets={bouquets} portalDropdown onSelect={addOrderProduct} />
                    {editPricedLines.length ? (
                      editPricedLines.map((line) => (
                        <div
                          key={line.key}
                          className="grid gap-2 rounded-lg border border-zinc-200 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <ProductThumbnail name={line.name} imagePath={line.imagePath} size="sm" />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-zinc-950" title={line.name}>
                                {line.name}
                              </div>
                              <div className="truncate text-xs text-zinc-500">
                                {line.bouquetGroupId ? `Букет · ${line.productCode}` : line.productCode}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Input
                              className="h-8 w-16"
                              type="number"
                              min="1"
                              step="1"
                              value={line.qty}
                              onChange={(event) => updateOrderLine(line.key, { qty: event.target.value })}
                              onBlur={() => updateOrderLine(line.key, { qty: String(normalizedQty(line.qty)) })}
                            />
                            <Input
                              className="h-8 w-24"
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.price}
                              onChange={(event) => updateOrderLine(line.key, { price: event.target.value })}
                              onBlur={() => updateOrderLine(line.key, { price: String(normalizedPrice(line.price)) })}
                            />
                            <Select
                              value={line.discountType}
                              onValueChange={(value) =>
                                updateOrderLine(line.key, { discountType: normalizeDiscountValue(value) })
                              }
                            >
                              <SelectTrigger className="h-8 w-24 bg-white">
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
                              value={line.discountValue}
                              disabled={line.discountType === "none"}
                              onChange={(event) => updateOrderLine(line.key, { discountValue: event.target.value })}
                              onBlur={() =>
                                updateOrderLine(line.key, { discountValue: String(normalizedPrice(line.discountValue)) })
                              }
                            />
                            <span className="w-24 text-right font-semibold text-zinc-950">
                              {formatMoney(line.line.total)}
                            </span>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="destructive"
                              onClick={() => removeOrderLine(line.key)}
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-zinc-500">Состав пуст</div>
                    )}
                  </div>
                ) : pricedItems.length ? (
                  pricedItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-zinc-950">{item.productName}</div>
                        <div className="text-xs text-zinc-500">
                          {formatNumber(item.qtyNumber)} шт · {discountLabel(item.discountType)}
                          {item.bouquetGroupId ? ` · ${item.bouquetName || "Букет"}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 font-medium text-zinc-950">{formatMoney(item.line.total)}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-zinc-500">Состав пуст</div>
                )}
              </div>

              <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
                <SummaryRow label="Товары до скидки" value={formatMoney(dialogItemsBreakdown.itemsTotalBeforeDiscount)} />
                <SummaryRow label="Скидки по позициям" value={formatMoney(dialogItemsBreakdown.itemsDiscountTotal)} />
                <SummaryRow label="Скидка на чек" value={formatMoney(dialogItemsBreakdown.dealDiscountAmount)} />
                <SummaryRow label="Доставка" value={formatMoney(orderDeliveryPrice)} />
                <SummaryRow label="Курьеру из кассы" value={formatMoney(orderCourierPayout)} />
                <SummaryRow label="Итого" value={formatMoney(orderTotal)} strong total />
                <SummaryRow label="Оплачено" value={formatMoney(displayPaid)} />
                <SummaryRow label="Остаток" value={formatMoney(orderBalance)} strong danger={orderBalance > 0} />
              </div>

              {!isEditOrderMode && activeDealOrder && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                  <AlertTriangleIcon />
                  <AlertTitle>У сделки уже есть активный заказ</AlertTitle>
                  <AlertDescription>Создать новый заказ можно после отмены или завершения активного.</AlertDescription>
                </Alert>
              )}
              {paidExceedsOrderTotal && (
                <Alert variant="destructive">
                  <AlertTriangleIcon />
                  <AlertTitle>Оплата выше итога заказа</AlertTitle>
                  <AlertDescription>Итог заказа не может быть меньше уже принятой оплаты.</AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOrderDialogOpen(false)}>
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={
                  actionPending ||
                  paidExceedsOrderTotal ||
                  (isEditOrderMode ? !orderEditable || !dialogHasItems : !hasItems || Boolean(activeDealOrder))
                }
              >
                {isEditOrderMode ? "Сохранить заказ" : "Создать заказ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// A primary action button that, when disabled, explains why via a tooltip on a wrapper.
function ActionButton({
  icon,
  label,
  disabled,
  disabledReason,
  variant = "default",
  onClick,
  grow = false,
}: {
  icon: React.ReactNode
  label: string
  disabled: boolean
  disabledReason: string | null
  variant?: "default" | "outline"
  onClick: () => void
  grow?: boolean
}) {
  const button = (
    <Button
      type="button"
      variant={variant}
      className={cn(grow ? "h-12 w-full text-base" : "h-10")}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  )

  if (disabled && disabledReason) {
    // base-ui tooltips don't fire on a disabled button, so anchor on a focusable wrapper.
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} className={cn("cursor-help rounded-lg", grow ? "flex w-full" : "inline-flex")} />}
        >
          {button}
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    )
  }

  return button
}

// Компактная шапка чата сделки: имя клиента, телефон, ссылка «Открыть клиента». Работает для
// обоих режимов чата (custom/iframe); при выключенном чате рендерится над карточкой справа.
function ClientHeader({
  name,
  phone,
  customerId,
  discountPercent,
}: {
  name: string
  phone: string
  customerId: string | null
  discountPercent: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 shadow-sm">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-zinc-950">
          {name || "Без клиента"}
          {discountPercent > 0 ? (
            <span className="ml-2 text-xs font-normal text-emerald-700">скидка {discountPercent}%</span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{phone || "Телефон не указан"}</div>
      </div>
      {customerId ? (
        <Link href={`/clients/${customerId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ExternalLinkIcon data-icon="inline-start" />
          Открыть клиента
        </Link>
      ) : null}
    </div>
  )
}

// Единый бейдж статуса оплаты. "none" → ничего не рисуем (нет суммы — нет ложного «Оплачено»).
function PaymentStatusBadge({
  status,
  balance,
  className,
}: {
  status: PaymentStatus
  balance: number
  className?: string
}) {
  if (status === "none") {
    return null
  }
  if (status === "paid") {
    return (
      <Badge variant="secondary" className={cn("bg-emerald-100 text-emerald-900", className)}>
        <CheckCircle2Icon data-icon="inline-start" />
        Оплачено
      </Badge>
    )
  }
  if (status === "unpaid") {
    return (
      <Badge variant="outline" className={cn("border-amber-200 bg-amber-50 text-amber-900", className)}>
        Не оплачено
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cn("border-amber-200 bg-amber-50 text-amber-900", className)}>
      Остаток {formatMoney(balance)}
    </Badge>
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
    recipientPhone: deal.recipientPhone ?? "",
    comment: deal.comment ?? "",
    dealDiscountType: deal.dealDiscountType ?? "none",
    dealDiscountValue: String(deal.dealDiscountValue ?? 0),
  }
}

function createOrderDraftFromDealDraft(draft: DealDraft): CreateOrderDraft {
  const [dueDate, dueTime] = splitDatetimeLocal(draft.dueAt)

  return {
    dueDate,
    dueTime,
    deliveryType: normalizeDeliveryTypeValue(draft.deliveryType),
    address: draft.address ?? "",
    recipientPhone: draft.recipientPhone ?? "",
    comment: draft.comment ?? "",
    deliveryPrice: "0",
    courierPayout: "0",
  }
}

function orderLinesFromItems(items: DealItemDraft[]): OrderLineDraft[] {
  return items.map((item, index) => ({
    key: `line-${item.id}-${index}`,
    productCode: item.productCode,
    name: item.productName,
    imagePath: item.imagePath,
    qty: item.qty,
    price: item.price,
    discountType: item.discountType,
    discountValue: item.discountValue,
    bouquetId: item.bouquetId,
    bouquetName: item.bouquetName,
    bouquetGroupId: item.bouquetGroupId,
  }))
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
    bouquetId: null,
    bouquetName: "",
    bouquetGroupId: "",
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
  formData.set("recipientPhone", draft.recipientPhone ?? "")
  formData.set("comment", draft.comment ?? "")
  formData.set("dealDiscountType", draft.dealDiscountType ?? "none")
  formData.set("dealDiscountValue", String(normalizedPrice(draft.dealDiscountValue)))

  return formData
}

function createOrderFromDealFormData(dealId: number, draft: CreateOrderDraft) {
  const formData = new FormData()
  formData.set("dealId", String(dealId))
  formData.set("dueAt", buildOrderDueAt(draft))
  formData.set("deliveryType", draft.deliveryType)
  formData.set("address", draft.address.trim())
  formData.set("recipientPhone", draft.recipientPhone.trim())
  formData.set("comment", draft.comment.trim())
  formData.set("deliveryPrice", String(normalizedPrice(draft.deliveryPrice)))
  formData.set("courierPayout", String(normalizedPrice(draft.courierPayout)))

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

function normalizeDeliveryTypeValue(value: string | null | undefined): CreateOrderDraft["deliveryType"] {
  const normalized = String(value ?? "").trim().toLowerCase()
  return normalized === "delivery" || normalized === "доставка" ? "delivery" : "pickup"
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function formatDateTime(value: string) {
  if (!value) {
    return "-"
  }

  // Срок заказа (due_at) — наивное локальное время, показываем без сдвига пояса.
  const date = parseWallClock(value)
  if (!date) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function splitDatetimeLocal(value: string) {
  if (!value) {
    return ["", ""] as const
  }

  const normalized = value.includes("T") ? value : toDatetimeLocal(value)
  const [date = "", rawTime = ""] = normalized.split("T")
  return [date, rawTime.slice(0, 5)] as const
}

function buildOrderDueAt(draft: CreateOrderDraft) {
  return draft.dueDate && draft.dueTime ? `${draft.dueDate}T${draft.dueTime}` : ""
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

// Asks the chat/iframe endpoint only for its status discriminant so the page can decide the layout.
// Custom mode probes the lightweight DB-backed chat endpoint (no Wazzup API call); iframe mode asks
// the iframe endpoint. On any failure we fall back to "error" → the chat column stays (with a retry).
async function resolveChatStatus(dealId: number, mode: "iframe" | "custom"): Promise<WazzupIframeStatus> {
  try {
    const endpoint =
      mode === "custom" ? `/api/wazzup/chat?dealId=${dealId}&probe=1` : `/api/wazzup/iframe?dealId=${dealId}`
    const response = await fetch(endpoint, { cache: "no-store" })
    const data = (await response.json()) as { status?: string }
    switch (data.status) {
      case "ok":
      case "disabled":
      case "not_configured":
      case "no_chat":
        return data.status
      default:
        return "error"
    }
  } catch {
    return "error"
  }
}
