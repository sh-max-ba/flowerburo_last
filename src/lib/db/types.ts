import path from "node:path"
import type { DiscountType } from "@/lib/pricing"

export type UserRole = "owner" | "manager" | "florist"
export type PaymentMethod = "cash" | "card" | "terminal" | "mbank" | "optima" | "elsom" | "transfer"
export type CashTransactionType =
  | "sale"
  | "prepayment"
  | "order_payment"
  | "deal_payment"
  | "cash_in"
  | "cash_out"
  | "cash_refund"
export type StockMovementType =
  | "sale"
  | "adjustment"
  | "reserve"
  | "reserve_cancel"
  | "order_fulfill"
  | "import"
  | "stock_in"
  | "stock_out"

export type StockDocumentType = "stock_in" | "stock_out"
export type StockDocumentStatus = "draft" | "posted" | "cancelled"

export type Product = {
  code: string
  categoryPath: string
  article: string
  name: string
  unit: string
  imagePath: string
  stock: number
  reserved: number
  expected: number
  costPrice: number
  salePrice: number
  available: number
  updatedAt: string
}

export type BouquetTemplateItem = {
  id: number
  bouquetId: number
  productCode: string
  productName: string
  qty: number
  stock: number
  reserved: number
  available: number
  imagePath: string
  createdAt: string
}

export type BouquetTemplate = {
  id: number
  name: string
  description: string
  imagePath: string
  price: number
  isActive: boolean
  createdByUserId: number | null
  createdByName: string
  createdAt: string
  updatedAt: string
  itemsCount: number
  items: BouquetTemplateItem[]
}

export type DealBouquetMessageStatus = "sent" | "failed"

export type DealBouquetMessage = {
  id: number
  dealId: number
  bouquetId: number
  bouquetName: string
  messageText: string
  imagePath: string
  sentByUserId: number | null
  sentByName: string
  sentAt: string
  status: DealBouquetMessageStatus
  error: string
}

export type BouquetTemplateInput = {
  name: string
  description?: string | null
  price?: number | null
  isActive?: boolean
  items: Array<{
    productCode: string
    qty: number
  }>
}

export type WarehouseImportAction = "create" | "update" | "unchanged" | "error"

export type WarehouseImportItem = {
  id: number
  importId: number
  rowNumber: number | null
  code: string
  name: string
  categoryPath: string
  action: WarehouseImportAction
  oldStock: number | null
  newStock: number | null
  stockDelta: number | null
  oldReserved: number | null
  newReserved: number | null
  oldSalePrice: number | null
  newSalePrice: number | null
  oldCostPrice: number | null
  newCostPrice: number | null
  error: string
  createdAt: string
}

export type WarehouseImport = {
  id: number
  filename: string
  status: "preview" | "applied" | "failed"
  totalRows: number
  createdCount: number
  updatedCount: number
  unchangedCount: number
  errorCount: number
  createdByUserId: number | null
  createdByName: string
  createdAt: string
  appliedAt: string | null
  reportJson: string
}

export type WarehouseImportPreview = WarehouseImport & {
  items: WarehouseImportItem[]
}

export type Sale = {
  id: number
  shiftId: number | null
  userId: number | null
  userName: string | null
  paymentMethod: PaymentMethod
  customerId: number | null
  customerName: string
  customerPhone: string
  itemsTotalBeforeDiscount: number
  itemsDiscountTotal: number
  saleDiscountType: DiscountType
  saleDiscountValue: number
  saleDiscountAmount: number
  totalBeforeDiscount: number
  discountTotal: number
  total: number
  note: string
  createdAt: string
  itemsCount: number
}

export type SaleItem = {
  id: number
  saleId: number
  productCode: string
  name: string
  qty: number
  price: number
  bouquetId: number | null
  bouquetName: string
  bouquetGroupId: string
  discountType: DiscountType
  discountValue: number
  discountAmount: number
  totalBeforeDiscount: number
  total: number
}

export type ShiftSale = Sale & {
  items: SaleItem[]
}

export type Shift = {
  id: number
  openedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  expectedCash: number
  cashierName: string
  note: string
  status: "open" | "closed"
  userId: number | null
  openedByUserId: number | null
  closedByUserId: number | null
  type: "day" | "night"
}

export type User = {
  id: number
  login: string
  name: string
  role: UserRole
  passwordHash: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CurrentUser = Omit<User, "passwordHash">

export type OrderStatus =
  | "Новый"
  | "В работе"
  | "Готов"
  | "Передан курьеру"
  | "Выдан"
  | "Отменен"

export const activeDealOrderStatuses = ["Новый", "В работе", "Готов", "Передан курьеру", "new", "in_progress", "ready"]

export type OrderItem = {
  id: number
  orderId: number
  productCode: string
  name: string
  imagePath?: string
  qty: number
  price: number
  bouquetId: number | null
  bouquetName: string
  bouquetGroupId: string
  discountType: DiscountType
  discountValue: number
  discountAmount: number
  totalBeforeDiscount: number
  total: number
}

export type Order = {
  id: number
  number: string | null
  createdByUserId: number | null
  updatedByUserId: number | null
  customer: string
  customerId: number | null
  dealId: number | null
  phone: string
  recipientPhone: string
  source: string
  deliveryType: string
  address: string
  dueAt: string
  status: OrderStatus
  total: number
  itemsTotalBeforeDiscount: number
  itemsDiscountTotal: number
  orderDiscountType: DiscountType
  orderDiscountValue: number
  orderDiscountAmount: number
  totalBeforeDiscount: number
  prepaid: number
  paid: number
  deliveryPrice: number
  courierPayout: number
  deliveryPayoutPaid: boolean
  isReserved: boolean
  note: string
  readyAt: string | null
  handedToCourierAt: string | null
  completedAt: string | null
  courierName: string
  createdAt: string
  updatedAt: string | null
  items: OrderItem[]
}

export type Movement = {
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

export type StockDocumentItem = {
  id: number
  documentId: number
  productCode: string
  productName: string
  qty: number
  beforeStock: number | null
  afterStock: number | null
  currentStock: number | null
  currentReserved: number | null
  comment: string
  createdAt: string
}

export type StockDocument = {
  id: number
  number: string
  type: StockDocumentType
  status: StockDocumentStatus
  supplierId: number | null
  supplierName: string
  comment: string
  operationAt: string | null
  createdByUserId: number | null
  createdByName: string
  createdAt: string
  postedByUserId: number | null
  postedByName: string
  postedAt: string | null
  cancelledAt: string | null
  itemsCount: number
  items: StockDocumentItem[]
}

export type Supplier = {
  id: number
  name: string
  phone: string
  contactName: string
  comment: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ShiftSummary = {
  shiftId: number
  openingCash: number
  revenueBeforeDiscount: number
  discountTotal: number
  revenueTotal: number
  cashSales: number
  cashPrepayments: number
  cashOrderPayments: number
  cashDealPayments: number
  cashIn: number
  cashOut: number
  cashRefund: number
  expectedCash: number
}

export type CustomerOption = {
  id: number
  name: string
  phone: string
  defaultDiscountPercent: number
}

export type CashTransaction = {
  id: number
  shiftId: number
  orderId: number | null
  saleId: number | null
  customerId: number | null
  dealId: number | null
  userId: number | null
  userName: string | null
  type: CashTransactionType
  paymentMethod: PaymentMethod
  amount: number
  comment: string
  createdAt: string
}

export type ShiftPaymentBreakdown = {
  cashSales: number
  cardSales: number
  terminalSales: number
  mbankSales: number
  optimaSales: number
  elsomSales: number
  transferSales: number
  cashPrepayments: number
  cardPrepayments: number
  terminalPrepayments: number
  mbankPrepayments: number
  optimaPrepayments: number
  elsomPrepayments: number
  transferPrepayments: number
  cashOrderPayments: number
  cardOrderPayments: number
  terminalOrderPayments: number
  mbankOrderPayments: number
  optimaOrderPayments: number
  elsomOrderPayments: number
  transferOrderPayments: number
  cashDealPayments: number
  cardDealPayments: number
  terminalDealPayments: number
  mbankDealPayments: number
  optimaDealPayments: number
  elsomDealPayments: number
  transferDealPayments: number
  cashIn: number
  cashOutOther: number
  courierPayouts: number
  cashRefund: number
}

export type ShiftRelatedOrder = {
  transactionId: number
  orderId: number
  userId: number | null
  userName: string | null
  number: string | null
  customer: string
  type: CashTransactionType
  paymentMethod: PaymentMethod
  totalBeforeDiscount: number
  discountTotal: number
  total: number
  amount: number
  comment: string
  createdAt: string
  items: OrderItem[]
}

export type ShiftDetails = {
  shift: Shift
  cashier: string
  summary: ShiftSummary
  breakdown: ShiftPaymentBreakdown
  cashTransactions: CashTransaction[]
  sales: ShiftSale[]
  relatedOrders: ShiftRelatedOrder[]
}

export type DashboardData = {
  products: Product[]
  sales: Sale[]
  shifts: Shift[]
  shiftDetails: ShiftDetails[]
  orders: Order[]
  movements: Movement[]
  stockMovements: Movement[]
  users: CurrentUser[]
  customers: CustomerOption[]
  suppliers: Supplier[]
  bouquetTemplates: BouquetTemplate[]
  stats: {
    productsCount: number
    lowStockCount: number
    negativeStockCount: number
    reservedCount: number
    openOrdersCount: number
    todaySalesTotal: number
    openShift: Shift | null
    defaultOpeningCash: number
  }
}

export type OwnerDashboardDebtor = {
  customerId: number | null
  customerName: string
  amount: number
  ordersCount: number
}

// Лёгкий обзор для дашборда управляющего (/dashboard). Только агрегаты,
// без тяжёлых списков из DashboardData.
export type OwnerDashboardData = {
  shift: {
    isOpen: boolean
    openingCash: number
    cashierName: string
    openedAt: string | null
    type: "day" | "night"
    expectedCash: number
  }
  today: {
    salesTotal: number
    salesCount: number
  }
  stock: {
    lowStockCount: number
    negativeStockCount: number
  }
  work: {
    incomingDealsCount: number
    readyOrdersCount: number
    overdueOrdersCount: number
  }
  debts: {
    totalOutstanding: number
    debtorOrdersCount: number
    topDebtors: OwnerDashboardDebtor[]
  }
}

export type HistoryReportData = {
  operations: Movement[]
  stockMovements: Movement[]
}

export type CsvProduct = {
  category_path: string
  code: string
  article: string
  name: string
  unit: string
  reserved: string
  expected: string
  stock: string
  cost_price: string
  sale_price: string
}

export type ProductRow = Record<string, unknown>

export const dbPath = path.join(process.cwd(), "app.db")
export const csvPath = path.join(process.cwd(), "moysklad_stock_report_2026-05-09.csv")
export const paymentMethods = new Set<PaymentMethod>(["cash", "card", "terminal", "mbank", "optima", "elsom", "transfer"])
export const cashTransactionTypes = new Set<CashTransactionType>([
  "sale",
  "prepayment",
  "order_payment",
  "deal_payment",
  "cash_in",
  "cash_out",
  "cash_refund",
])
export const stockMovementTypes = new Set<StockMovementType>([
  "sale",
  "adjustment",
  "reserve",
  "reserve_cancel",
  "order_fulfill",
  "import",
  "stock_in",
  "stock_out",
])

export type ShiftShellData = {
  defaultOpeningCash: number
  openShift: Shift | null
  openShiftDetails: ShiftDetails | null
}
