import { normalizeDiscountType, type DiscountType } from "@/lib/pricing"
import type {
  CashTransactionType,
  CustomerOption,
  Movement,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  Product,
  Sale,
  ShiftRelatedOrder,
} from "@/lib/db"

type Row = Record<string, unknown>

export function cleanRowString(value: unknown) {
  return String(value ?? "").trim()
}

export function numberFromRow(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

// --- Кодеки чтения строк БД (ARCH-4) ---
// Сохраняют точную семантику текущих ручных кастов в мапперах.
// ВНИМАНИЕ: rowStr НЕ тримит (в отличие от FormData-хелперов clean/toNumber).

// Эквивалент `String(x ?? "")` — без trim.
export function rowStr(value: unknown) {
  return String(value ?? "")
}

// Число или null: сохраняет SQL NULL вместо приведения к 0.
export function rowNumOrNull(value: unknown) {
  return value === null || value === undefined ? null : numberFromRow(value)
}

// Булево из 0/1-флага БД (как `numberFromRow(x) === 1`).
export function rowBool(value: unknown) {
  return numberFromRow(value) === 1
}

export function normalizeOrderStatus(value: unknown): OrderStatus {
  const status = String(value ?? "")
  const legacy: Record<string, OrderStatus> = {
    new: "Новый",
    in_progress: "В работе",
    ready: "Готов",
    done: "Выдан",
    canceled: "Отменен",
  }
  const current = new Set<OrderStatus>([
    "Черновик",
    "Новый",
    "В работе",
    "Готов",
    "Передан курьеру",
    "Выдан",
    "Отменен",
  ])

  if (current.has(status as OrderStatus)) {
    return status as OrderStatus
  }

  return legacy[status] ?? "Новый"
}

export function mapProductRow(row: Row): Product {
  const stock = numberFromRow(row.stock)
  const reserved = numberFromRow(row.reserved)

  return {
    code: String(row.code),
    categoryPath: String(row.category_path ?? ""),
    article: String(row.article ?? ""),
    name: String(row.name),
    unit: String(row.unit),
    imagePath: String(row.image_path ?? ""),
    stock,
    reserved,
    expected: numberFromRow(row.expected),
    costPrice: numberFromRow(row.cost_price),
    salePrice: numberFromRow(row.sale_price),
    isActive: numberFromRow(row.is_active ?? 1) === 1,
    trackLots: numberFromRow(row.track_lots ?? 0) === 1,
    vaseLifeDays: row.vase_life_days == null ? null : numberFromRow(row.vase_life_days),
    available: stock - reserved,
    updatedAt: String(row.updated_at),
  }
}

export function mapOrderRow(row: Row, items: OrderItem[] = []): Order {
  return {
    id: numberFromRow(row.id),
    number: row.number === null ? null : String(row.number ?? ""),
    createdByUserId: row.createdByUserId === null ? null : numberFromRow(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null ? null : numberFromRow(row.updatedByUserId),
    customerId: row.customerId === null ? null : numberFromRow(row.customerId),
    dealId: row.dealId === null ? null : numberFromRow(row.dealId),
    customer: String(row.customer ?? ""),
    phone: String(row.phone ?? ""),
    recipientPhone: String(row.recipientPhone ?? ""),
    source: String(row.source ?? ""),
    deliveryType: cleanRowString(row.deliveryType) || "pickup",
    address: String(row.address ?? ""),
    dueAt: String(row.dueAt ?? ""),
    status: normalizeOrderStatus(row.status),
    itemsTotalBeforeDiscount: numberFromRow(row.itemsTotalBeforeDiscount) || numberFromRow(row.total),
    itemsDiscountTotal: numberFromRow(row.itemsDiscountTotal),
    orderDiscountType: normalizeDiscountType(String(row.orderDiscountType ?? "none")),
    orderDiscountValue: numberFromRow(row.orderDiscountValue),
    orderDiscountAmount: numberFromRow(row.orderDiscountAmount),
    totalBeforeDiscount: numberFromRow(row.totalBeforeDiscount) || numberFromRow(row.total),
    total: numberFromRow(row.total),
    prepaid: numberFromRow(row.prepaid),
    paid: numberFromRow(row.paid),
    draftPrepaidMethod: row.draftPrepaidMethod == null ? null : String(row.draftPrepaidMethod),
    deliveryPrice: numberFromRow(row.deliveryPrice),
    courierPayout: numberFromRow(row.courierPayout),
    deliveryPayoutPaid: numberFromRow(row.deliveryPayoutPaid) === 1,
    isReserved: numberFromRow(row.isReserved) === 1,
    note: String(row.note ?? ""),
    readyAt: row.readyAt === null ? null : String(row.readyAt ?? ""),
    handedToCourierAt: row.handedToCourierAt === null ? null : String(row.handedToCourierAt ?? ""),
    completedAt: row.completedAt === null ? null : String(row.completedAt ?? ""),
    courierName: String(row.courierName ?? ""),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: row.updatedAt === null ? null : String(row.updatedAt ?? ""),
    isModified: numberFromRow(row.isModified) === 1,
    items,
  }
}

// --- Типизированные строки SELECT'ов + rowToX мапперы (ARCH-4 фазы 2-3) ---
// Интерфейсы *Row описывают РОВНО те алиасы, что отдаёт SQL соответствующих запросов.
// Мапперы воспроизводят 1:1 поведение прежних «голых» кастов (`.all() as X[]`),
// сохраняя NULL там, где доменный тип допускает null, и не нормализуя то,
// что прежний каст не нормализовал (например saleDiscountType).

// Алиасы из getDashboardData (db.ts) и getShiftDetails/listCustomerSales — совпадают.
export interface SaleRow {
  id: number
  shiftId: number | null
  userId: number | null
  userName: string | null
  paymentMethod: string
  customerId: number | null
  customerName: string
  customerPhone: string
  itemsTotalBeforeDiscount: number
  itemsDiscountTotal: number
  saleDiscountType: string
  saleDiscountValue: number
  saleDiscountAmount: number
  totalBeforeDiscount: number
  discountTotal: number
  total: number
  note: string
  createdAt: string
  reversedAt?: string | null
  itemsCount: number
}

export function rowToSale(row: SaleRow): Sale {
  return {
    id: numberFromRow(row.id),
    shiftId: rowNumOrNull(row.shiftId),
    userId: rowNumOrNull(row.userId),
    userName: row.userName === null || row.userName === undefined ? null : rowStr(row.userName),
    paymentMethod: rowStr(row.paymentMethod) as PaymentMethod,
    customerId: rowNumOrNull(row.customerId),
    customerName: rowStr(row.customerName),
    customerPhone: rowStr(row.customerPhone),
    itemsTotalBeforeDiscount: numberFromRow(row.itemsTotalBeforeDiscount),
    itemsDiscountTotal: numberFromRow(row.itemsDiscountTotal),
    saleDiscountType: rowStr(row.saleDiscountType) as DiscountType,
    saleDiscountValue: numberFromRow(row.saleDiscountValue),
    saleDiscountAmount: numberFromRow(row.saleDiscountAmount),
    totalBeforeDiscount: numberFromRow(row.totalBeforeDiscount),
    discountTotal: numberFromRow(row.discountTotal),
    total: numberFromRow(row.total),
    note: rowStr(row.note),
    createdAt: rowStr(row.createdAt),
    reversedAt: row.reversedAt == null ? null : rowStr(row.reversedAt),
    itemsCount: numberFromRow(row.itemsCount),
  }
}

// sale_items с алиасами getShiftDetails — ремаппинг происходит inline в db.ts,
// этот интерфейс лишь типизирует промежуточные строки (без rowTo-маппера).
export interface SaleItemRow {
  id: number
  saleId: number
  productCode: string | null
  name: string
  qty: number
  price: number
  bouquetId: number | null
  bouquetName: string
  bouquetGroupId: string
  discountType: string
  discountValue: number
  discountAmount: number
  totalBeforeDiscount: number
  total: number
}

// order_items с алиасами getDashboardData/getShiftDetails — ремаппинг inline в db.ts.
export interface OrderItemRow {
  id: number
  orderId: number
  productCode: string | null
  name: string
  imagePath: string
  qty: number
  price: number
  bouquetId: number | null
  bouquetName: string
  bouquetGroupId: string
  discountType: string
  discountValue: number
  discountAmount: number
  totalBeforeDiscount: number
  total: number
}

// Алиасы historyOperationsQuery/stockMovementsQuery (db.ts).
export interface MovementRow {
  id: number
  userId: number | null
  userName: string | null
  type: string
  productCode: string | null
  productName: string | null
  qty: number | null
  unitPrice: number | null
  total: number | null
  beforeStock: number | null
  afterStock: number | null
  beforeReserved: number | null
  afterReserved: number | null
  orderId: number | null
  saleId: number | null
  shiftId: number | null
  documentId: number | null
  documentNumber: string | null
  note: string
  createdAt: string
}

export function rowToMovement(row: MovementRow): Movement {
  return {
    id: numberFromRow(row.id),
    userId: rowNumOrNull(row.userId),
    userName: row.userName === null || row.userName === undefined ? null : rowStr(row.userName),
    type: rowStr(row.type),
    productCode: row.productCode === null || row.productCode === undefined ? null : rowStr(row.productCode),
    productName: row.productName === null || row.productName === undefined ? null : rowStr(row.productName),
    qty: rowNumOrNull(row.qty),
    unitPrice: rowNumOrNull(row.unitPrice),
    total: rowNumOrNull(row.total),
    beforeStock: rowNumOrNull(row.beforeStock),
    afterStock: rowNumOrNull(row.afterStock),
    beforeReserved: rowNumOrNull(row.beforeReserved),
    afterReserved: rowNumOrNull(row.afterReserved),
    orderId: rowNumOrNull(row.orderId),
    saleId: rowNumOrNull(row.saleId),
    shiftId: rowNumOrNull(row.shiftId),
    documentId: rowNumOrNull(row.documentId),
    documentNumber:
      row.documentNumber === null || row.documentNumber === undefined ? null : rowStr(row.documentNumber),
    note: rowStr(row.note),
    createdAt: rowStr(row.createdAt),
  }
}

// Алиасы customers-запроса в getDashboardData (db.ts).
export interface CustomerOptionRow {
  id: number
  name: string
  phone: string
  defaultDiscountPercent: number
}

export function rowToCustomerOption(row: CustomerOptionRow): CustomerOption {
  return {
    id: numberFromRow(row.id),
    name: rowStr(row.name),
    phone: rowStr(row.phone),
    defaultDiscountPercent: numberFromRow(row.defaultDiscountPercent),
  }
}

// Алиасы related-orders-запроса в getShiftDetails (db.ts). items добавляется отдельно.
export interface ShiftRelatedOrderRow {
  transactionId: number
  orderId: number
  userId: number | null
  userName: string | null
  number: string | null
  customer: string
  type: string
  totalBeforeDiscount: number
  discountTotal: number
  total: number
  paymentMethod: string
  amount: number
  comment: string
  createdAt: string
}

export function rowToShiftRelatedOrder(row: ShiftRelatedOrderRow, items: OrderItem[] = []): ShiftRelatedOrder {
  return {
    transactionId: numberFromRow(row.transactionId),
    orderId: numberFromRow(row.orderId),
    userId: rowNumOrNull(row.userId),
    userName: row.userName === null || row.userName === undefined ? null : rowStr(row.userName),
    number: row.number === null || row.number === undefined ? null : rowStr(row.number),
    customer: rowStr(row.customer),
    type: rowStr(row.type) as CashTransactionType,
    paymentMethod: rowStr(row.paymentMethod) as PaymentMethod,
    totalBeforeDiscount: numberFromRow(row.totalBeforeDiscount),
    discountTotal: numberFromRow(row.discountTotal),
    total: numberFromRow(row.total),
    amount: numberFromRow(row.amount),
    comment: rowStr(row.comment),
    createdAt: rowStr(row.createdAt),
    items,
  }
}

// Алиасы shifts-запросов под mapShift (getDashboardData/getShiftShellData/getShiftDetails).
export interface ShiftRow {
  id: number
  openedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  cashierName: string
  note: string
  status: string
  userId: number | null
  openedByUserId: number | null
  closedByUserId: number | null
  type: string
}

