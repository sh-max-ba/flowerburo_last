export type DiscountType = "none" | "percent" | "amount"

export type CommercialLineInput = {
  qty: number
  price: number
  discountType?: string | null
  discountValue?: number | null
}

export type CommercialLineTotal = {
  totalBeforeDiscount: number
  discountAmount: number
  total: number
}

export type CommercialTotals = {
  itemsTotalBeforeDiscount: number
  itemsDiscountTotal: number
  itemsTotalAfterItemDiscounts: number
  dealDiscountAmount: number
  checkDiscountAmount: number
  total: number
}

export function calculateLineTotal(item: CommercialLineInput): CommercialLineTotal {
  const totalBeforeDiscount = money(Math.max(0, number(item.qty) * number(item.price)))
  const discountType = normalizeDiscountType(item.discountType)
  const discountValue = Math.max(0, number(item.discountValue))
  let discountAmount = 0

  if (discountType === "percent") {
    discountAmount = totalBeforeDiscount * Math.min(100, discountValue) / 100
  } else if (discountType === "amount") {
    discountAmount = discountValue
  }

  discountAmount = money(clamp(discountAmount, 0, totalBeforeDiscount))

  return {
    totalBeforeDiscount,
    discountAmount,
    total: money(Math.max(0, totalBeforeDiscount - discountAmount)),
  }
}

export function calculateCommercialTotals(
  items: CommercialLineInput[],
  dealDiscountType?: string | null,
  dealDiscountValue?: number | null
): CommercialTotals {
  const lineTotals = items.map(calculateLineTotal)
  const itemsTotalBeforeDiscount = money(lineTotals.reduce((sum, item) => sum + item.totalBeforeDiscount, 0))
  const itemsDiscountTotal = money(lineTotals.reduce((sum, item) => sum + item.discountAmount, 0))
  const itemsTotalAfterItemDiscounts = money(lineTotals.reduce((sum, item) => sum + item.total, 0))
  const normalizedDealDiscountType = normalizeDiscountType(dealDiscountType)
  const normalizedDealDiscountValue = Math.max(0, number(dealDiscountValue))
  let dealDiscountAmount = 0

  if (normalizedDealDiscountType === "percent") {
    dealDiscountAmount = itemsTotalAfterItemDiscounts * Math.min(100, normalizedDealDiscountValue) / 100
  } else if (normalizedDealDiscountType === "amount") {
    dealDiscountAmount = normalizedDealDiscountValue
  }

  dealDiscountAmount = money(clamp(dealDiscountAmount, 0, itemsTotalAfterItemDiscounts))

  return {
    itemsTotalBeforeDiscount,
    itemsDiscountTotal,
    itemsTotalAfterItemDiscounts,
    dealDiscountAmount,
    checkDiscountAmount: dealDiscountAmount,
    total: money(Math.max(0, itemsTotalAfterItemDiscounts - dealDiscountAmount)),
  }
}

export function normalizeDiscountType(value: string | null | undefined): DiscountType {
  return value === "percent" || value === "amount" ? value : "none"
}

export function getDiscountLabel(type: string | null | undefined, value: number | null | undefined) {
  const discountType = normalizeDiscountType(type)
  const discountValue = Math.max(0, number(value))

  if (discountType === "percent") {
    return discountValue > 0 ? `${discountValue}%` : "Без скидки"
  }

  if (discountType === "amount") {
    return discountValue > 0 ? `Сумма ${formatDiscountAmount(discountValue)}` : "Без скидки"
  }

  return "Без скидки"
}

export function formatDiscountAmount(amount: number | null | undefined) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(money(Math.max(0, number(amount))))
}

function number(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function money(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
