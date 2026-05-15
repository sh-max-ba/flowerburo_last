import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import { fromDatetimeLocalValue } from "@/lib/datetime"
import { hashPassword } from "@/lib/password"
import {
  calculateCommercialTotals,
  calculateLineTotal,
  normalizeDiscountType,
  type DiscountType,
} from "@/lib/pricing"

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
  stock: number
  reserved: number
  expected: number
  costPrice: number
  salePrice: number
  available: number
  updatedAt: string
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

export type OrderItem = {
  id: number
  orderId: number
  productCode: string
  name: string
  qty: number
  price: number
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

export type HistoryReportData = {
  operations: Movement[]
  stockMovements: Movement[]
}

type CsvProduct = {
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

type ProductRow = Record<string, unknown>

const dbPath = path.join(process.cwd(), "app.db")
const csvPath = path.join(process.cwd(), "moysklad_stock_report_2026-05-09.csv")
const paymentMethods = new Set<PaymentMethod>(["cash", "card", "terminal", "mbank", "optima", "elsom", "transfer"])
const cashTransactionTypes = new Set<CashTransactionType>([
  "sale",
  "prepayment",
  "order_payment",
  "deal_payment",
  "cash_in",
  "cash_out",
  "cash_refund",
])
const stockMovementTypes = new Set<StockMovementType>([
  "sale",
  "adjustment",
  "reserve",
  "reserve_cancel",
  "order_fulfill",
  "import",
  "stock_in",
  "stock_out",
])

let database: Database.Database | null = null

export function initDb() {
  return db()
}

function db() {
  if (!database) {
    database = new Database(dbPath)
    database.pragma("journal_mode = WAL")
    database.pragma("foreign_keys = ON")
    migrate(database)
    seedDefaultUsers(database)
    seedFromCsv(database)
  }

  return database
}

function migrate(client: Database.Database) {
  client.exec(`
    CREATE TABLE IF NOT EXISTS products (
      code TEXT PRIMARY KEY,
      category_path TEXT NOT NULL DEFAULT '',
      article TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт',
      stock REAL NOT NULL DEFAULT 0,
      reserved REAL NOT NULL DEFAULT 0,
      expected REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER,
      user_id INTEGER,
      payment_method TEXT DEFAULT 'cash',
      customer_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      items_total_before_discount REAL DEFAULT 0,
      items_discount_total REAL DEFAULT 0,
      sale_discount_type TEXT DEFAULT 'none',
      sale_discount_value REAL DEFAULT 0,
      sale_discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_code TEXT NOT NULL REFERENCES products(code),
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount_type TEXT DEFAULT 'none',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      opening_cash REAL NOT NULL DEFAULT 0,
      closing_cash REAL,
      cashier_name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      user_id INTEGER,
      opened_by_user_id INTEGER,
      closed_by_user_id INTEGER,
      type TEXT DEFAULT 'day'
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT,
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      customer TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      source TEXT,
      delivery_type TEXT,
      address TEXT,
      due_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      items_total_before_discount REAL DEFAULT 0,
      items_discount_total REAL DEFAULT 0,
      order_discount_type TEXT DEFAULT 'none',
      order_discount_value REAL DEFAULT 0,
      order_discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      prepaid REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      is_reserved INTEGER DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL,
      product_code TEXT,
      product_name TEXT,
      qty REAL,
      unit_price REAL,
      total REAL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL,
      order_id INTEGER,
      sale_id INTEGER,
      user_id INTEGER,
      type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT,
      type TEXT NOT NULL,
      qty REAL NOT NULL,
      before_stock REAL,
      after_stock REAL,
      before_reserved REAL,
      after_reserved REAL,
      order_id INTEGER,
      sale_id INTEGER,
      shift_id INTEGER,
      document_id INTEGER,
      user_id INTEGER,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      supplier_id INTEGER,
      supplier_name TEXT,
      comment TEXT,
      operation_at TEXT,
      created_by_user_id INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      posted_by_user_id INTEGER,
      posted_by_name TEXT,
      posted_at TEXT,
      cancelled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      phone TEXT,
      contact_name TEXT,
      comment TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_document_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      qty REAL NOT NULL,
      before_stock REAL,
      after_stock REAL,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_code TEXT,
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      discount_type TEXT DEFAULT 'none',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL NOT NULL,
      is_custom INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS warehouse_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      status TEXT NOT NULL,
      total_rows INTEGER DEFAULT 0,
      created_count INTEGER DEFAULT 0,
      updated_count INTEGER DEFAULT 0,
      unchanged_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      created_by_user_id INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      applied_at TEXT,
      report_json TEXT
    );

    CREATE TABLE IF NOT EXISTS warehouse_import_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      row_number INTEGER,
      code TEXT,
      name TEXT,
      category_path TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      old_stock REAL,
      new_stock REAL,
      stock_delta REAL,
      old_reserved REAL,
      new_reserved REAL,
      old_sale_price REAL,
      new_sale_price REAL,
      old_cost_price REAL,
      new_cost_price REAL,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      normalized_phone TEXT,
      instagram TEXT,
      source TEXT,
      default_discount_percent REAL DEFAULT 0,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deal_pipelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deal_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      color TEXT,
      is_closed INTEGER DEFAULT 0,
      is_won INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE,
      customer_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      responsible_user_id INTEGER,
      responsible_user_name TEXT,
      pipeline_id INTEGER,
      stage_id INTEGER,
      status TEXT DEFAULT 'open',
      source TEXT DEFAULT 'manual',
      title TEXT,
      due_at TEXT,
      delivery_type TEXT,
      address TEXT,
      comment TEXT,
      items_total REAL DEFAULT 0,
      items_discount_total REAL DEFAULT 0,
      deal_discount_type TEXT DEFAULT 'none',
      deal_discount_value REAL DEFAULT 0,
      deal_discount_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      order_id INTEGER,
      wazzup_chat_type TEXT,
      wazzup_chat_id TEXT,
      wazzup_channel_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      discount_type TEXT DEFAULT 'none',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_customers_normalized_phone ON customers(normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
    CREATE INDEX IF NOT EXISTS idx_deal_stages_pipeline_position ON deal_stages(pipeline_id, position);
    CREATE INDEX IF NOT EXISTS idx_deals_customer_id ON deals(customer_id);
    CREATE INDEX IF NOT EXISTS idx_deals_stage_id ON deals(stage_id);
    CREATE INDEX IF NOT EXISTS idx_deal_items_deal_id ON deal_items(deal_id);
  `)

  ensureColumn("orders", "number", "ALTER TABLE orders ADD COLUMN number TEXT", client)
  ensureColumn("orders", "source", "ALTER TABLE orders ADD COLUMN source TEXT", client)
  ensureColumn("orders", "delivery_type", "ALTER TABLE orders ADD COLUMN delivery_type TEXT", client)
  ensureColumn("orders", "address", "ALTER TABLE orders ADD COLUMN address TEXT", client)
  ensureColumn("orders", "prepaid", "ALTER TABLE orders ADD COLUMN prepaid REAL DEFAULT 0", client)
  ensureColumn("orders", "paid", "ALTER TABLE orders ADD COLUMN paid REAL DEFAULT 0", client)
  ensureColumn("orders", "delivery_price", "ALTER TABLE orders ADD COLUMN delivery_price REAL DEFAULT 0", client)
  ensureColumn("orders", "courier_payout", "ALTER TABLE orders ADD COLUMN courier_payout REAL DEFAULT 0", client)
  ensureColumn(
    "orders",
    "delivery_payout_paid",
    "ALTER TABLE orders ADD COLUMN delivery_payout_paid INTEGER DEFAULT 0",
    client
  )
  ensureColumn("orders", "ready_at", "ALTER TABLE orders ADD COLUMN ready_at TEXT", client)
  ensureColumn(
    "orders",
    "handed_to_courier_at",
    "ALTER TABLE orders ADD COLUMN handed_to_courier_at TEXT",
    client
  )
  ensureColumn("orders", "completed_at", "ALTER TABLE orders ADD COLUMN completed_at TEXT", client)
  ensureColumn("orders", "courier_name", "ALTER TABLE orders ADD COLUMN courier_name TEXT", client)
  ensureColumn("orders", "is_reserved", "ALTER TABLE orders ADD COLUMN is_reserved INTEGER DEFAULT 0", client)
  ensureColumn("orders", "updated_at", "ALTER TABLE orders ADD COLUMN updated_at TEXT", client)
  ensureColumn("orders", "customer_id", "ALTER TABLE orders ADD COLUMN customer_id INTEGER", client)
  ensureColumn("orders", "deal_id", "ALTER TABLE orders ADD COLUMN deal_id INTEGER", client)
  ensureColumn(
    "orders",
    "items_total_before_discount",
    "ALTER TABLE orders ADD COLUMN items_total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "orders",
    "items_discount_total",
    "ALTER TABLE orders ADD COLUMN items_discount_total REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "orders",
    "order_discount_type",
    "ALTER TABLE orders ADD COLUMN order_discount_type TEXT DEFAULT 'none'",
    client
  )
  ensureColumn(
    "orders",
    "order_discount_value",
    "ALTER TABLE orders ADD COLUMN order_discount_value REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "orders",
    "order_discount_amount",
    "ALTER TABLE orders ADD COLUMN order_discount_amount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "orders",
    "total_before_discount",
    "ALTER TABLE orders ADD COLUMN total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn("shifts", "cashier_name", "ALTER TABLE shifts ADD COLUMN cashier_name TEXT NOT NULL DEFAULT ''", client)
  ensureColumn("shifts", "user_id", "ALTER TABLE shifts ADD COLUMN user_id INTEGER", client)
  ensureColumn("shifts", "opened_by_user_id", "ALTER TABLE shifts ADD COLUMN opened_by_user_id INTEGER", client)
  ensureColumn("shifts", "closed_by_user_id", "ALTER TABLE shifts ADD COLUMN closed_by_user_id INTEGER", client)
  ensureColumn("shifts", "type", "ALTER TABLE shifts ADD COLUMN type TEXT DEFAULT 'day'", client)
  ensureColumn("sales", "shift_id", "ALTER TABLE sales ADD COLUMN shift_id INTEGER", client)
  ensureColumn("sales", "user_id", "ALTER TABLE sales ADD COLUMN user_id INTEGER", client)
  ensureColumn("sales", "payment_method", "ALTER TABLE sales ADD COLUMN payment_method TEXT DEFAULT 'cash'", client)
  ensureColumn("sales", "customer_id", "ALTER TABLE sales ADD COLUMN customer_id INTEGER", client)
  ensureColumn("sales", "customer_name", "ALTER TABLE sales ADD COLUMN customer_name TEXT", client)
  ensureColumn("sales", "customer_phone", "ALTER TABLE sales ADD COLUMN customer_phone TEXT", client)
  ensureColumn(
    "sales",
    "items_total_before_discount",
    "ALTER TABLE sales ADD COLUMN items_total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sales",
    "items_discount_total",
    "ALTER TABLE sales ADD COLUMN items_discount_total REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sales",
    "sale_discount_type",
    "ALTER TABLE sales ADD COLUMN sale_discount_type TEXT DEFAULT 'none'",
    client
  )
  ensureColumn(
    "sales",
    "sale_discount_value",
    "ALTER TABLE sales ADD COLUMN sale_discount_value REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sales",
    "sale_discount_amount",
    "ALTER TABLE sales ADD COLUMN sale_discount_amount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sales",
    "total_before_discount",
    "ALTER TABLE sales ADD COLUMN total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sale_items",
    "discount_type",
    "ALTER TABLE sale_items ADD COLUMN discount_type TEXT DEFAULT 'none'",
    client
  )
  ensureColumn(
    "sale_items",
    "discount_value",
    "ALTER TABLE sale_items ADD COLUMN discount_value REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sale_items",
    "discount_amount",
    "ALTER TABLE sale_items ADD COLUMN discount_amount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sale_items",
    "total_before_discount",
    "ALTER TABLE sale_items ADD COLUMN total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "order_items",
    "discount_type",
    "ALTER TABLE order_items ADD COLUMN discount_type TEXT DEFAULT 'none'",
    client
  )
  ensureColumn(
    "order_items",
    "discount_value",
    "ALTER TABLE order_items ADD COLUMN discount_value REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "order_items",
    "discount_amount",
    "ALTER TABLE order_items ADD COLUMN discount_amount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "order_items",
    "total_before_discount",
    "ALTER TABLE order_items ADD COLUMN total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn("orders", "created_by_user_id", "ALTER TABLE orders ADD COLUMN created_by_user_id INTEGER", client)
  ensureColumn("orders", "updated_by_user_id", "ALTER TABLE orders ADD COLUMN updated_by_user_id INTEGER", client)
  ensureColumn("movements", "user_id", "ALTER TABLE movements ADD COLUMN user_id INTEGER", client)
  ensureColumn("cash_transactions", "user_id", "ALTER TABLE cash_transactions ADD COLUMN user_id INTEGER", client)
  ensureColumn(
    "cash_transactions",
    "customer_id",
    "ALTER TABLE cash_transactions ADD COLUMN customer_id INTEGER",
    client
  )
  ensureColumn("cash_transactions", "deal_id", "ALTER TABLE cash_transactions ADD COLUMN deal_id INTEGER", client)
  ensureColumn("stock_movements", "user_id", "ALTER TABLE stock_movements ADD COLUMN user_id INTEGER", client)
  ensureColumn("stock_movements", "document_id", "ALTER TABLE stock_movements ADD COLUMN document_id INTEGER", client)
  ensureColumn("stock_documents", "supplier_id", "ALTER TABLE stock_documents ADD COLUMN supplier_id INTEGER", client)
  ensureColumn("stock_documents", "supplier_name", "ALTER TABLE stock_documents ADD COLUMN supplier_name TEXT", client)
  ensureColumn("stock_documents", "operation_at", "ALTER TABLE stock_documents ADD COLUMN operation_at TEXT", client)
  ensureColumn(
    "warehouse_import_items",
    "category_path",
    "ALTER TABLE warehouse_import_items ADD COLUMN category_path TEXT NOT NULL DEFAULT ''",
    client
  )

  seedDefaultDealPipeline(client)
}

function seedDefaultDealPipeline(client: Database.Database) {
  const row = client.prepare("SELECT COUNT(*) as count FROM deal_pipelines").get() as { count: number }
  if (row.count > 0) {
    return
  }

  const createPipeline = client.transaction(() => {
    const pipeline = client
      .prepare("INSERT INTO deal_pipelines (name, is_default) VALUES (?, 1)")
      .run("Основная воронка")
    const pipelineId = Number(pipeline.lastInsertRowid)
    const insertStage = client.prepare(
      `INSERT INTO deal_stages (pipeline_id, name, position, color, is_closed, is_won)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const stages = [
      ["Новая", "#2563eb", 0, 0],
      ["В работе", "#7c3aed", 0, 0],
      ["Ожидает оплату", "#d97706", 0, 0],
      ["Оформлен заказ", "#0891b2", 0, 0],
      ["Готов", "#16a34a", 0, 0],
      ["Закрыта", "#15803d", 1, 1],
      ["Отменена", "#dc2626", 1, 0],
    ] as const

    stages.forEach(([name, color, isClosed, isWon], index) => {
      insertStage.run(pipelineId, name, index + 1, color, isClosed, isWon)
    })
  })

  createPipeline()
}

export function ensureColumn(
  table: string,
  column: string,
  ddl: string,
  client: Database.Database = db()
) {
  const columns = client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((existing) => existing.name === column)) {
    client.exec(ddl)
  }
}

function mapUser(row: Record<string, unknown>): User {
  const role = String(row.role)

  return {
    id: numberFromRow(row.id),
    login: String(row.login),
    name: String(row.name),
    role: role === "manager" || role === "florist" ? role : "owner",
    passwordHash: String(row.password_hash),
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }
}

function mapSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: numberFromRow(row.id),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    contactName: String(row.contact_name ?? ""),
    comment: String(row.comment ?? ""),
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }
}

function publicUser(user: User): CurrentUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

function seedDefaultUsers(client: Database.Database) {
  const count = client.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }

  if (count.count > 0) {
    return
  }

  client
    .prepare(
      `INSERT INTO users (login, name, role, password_hash)
       VALUES (?, ?, ?, ?)`
    )
    .run("admin", "Управляющий", "owner", hashPassword("fb2026"))
}

function normalizeRole(value: FormDataEntryValue | string | null): UserRole {
  const role = String(value ?? "").trim()
  if (role === "owner" || role === "manager" || role === "florist") {
    return role
  }

  throw new Error("Выберите роль пользователя.")
}

function getUserById(userId: number, client: Database.Database = db()) {
  const row = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE id = ?`
    )
    .get(userId) as Record<string, unknown> | undefined

  return row ? mapUser(row) : null
}

export function getCurrentUserById(userId: number) {
  const user = getUserById(userId)
  return user && user.isActive ? publicUser(user) : null
}

function getUserByLoginForWrite(login: string, client: Database.Database) {
  const row = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE login = ?`
    )
    .get(login) as Record<string, unknown> | undefined

  return row ? mapUser(row) : null
}

function countActiveOwners(client: Database.Database) {
  const row = client
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'owner' AND is_active = 1")
    .get() as { count: number }

  return Number(row.count)
}

function assertCanDemoteOrDisableUser(target: User, nextRole: UserRole, nextActive: boolean, client: Database.Database) {
  if (target.role !== "owner" || !target.isActive) {
    return
  }

  if (nextRole === "owner" && nextActive) {
    return
  }

  if (countActiveOwners(client) <= 1) {
    throw new Error("Нельзя отключить или снять роль у единственного активного управляющего.")
  }
}

export function listUsers(client: Database.Database = db()) {
  const rows = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       ORDER BY is_active DESC, role, name COLLATE NOCASE, login COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[]

  return rows.map((row) => publicUser(mapUser(row)))
}

export function listSuppliers(options?: { activeOnly?: boolean }, client: Database.Database = db()) {
  const rows = client
    .prepare(
      `SELECT *
       FROM suppliers
       ${options?.activeOnly ? "WHERE is_active = 1" : ""}
       ORDER BY is_active DESC, name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[]

  return rows.map(mapSupplier)
}

export function upsertSupplier(formData: FormData) {
  const client = db()
  const id = Number(clean(formData.get("id")))
  const name = clean(formData.get("name"))
  const phone = clean(formData.get("phone"))
  const contactName = clean(formData.get("contactName"))
  const comment = clean(formData.get("comment"))
  const isActive = clean(formData.get("isActive")) !== "0"

  if (!name) {
    throw new Error("Название поставщика обязательно.")
  }

  const duplicate = client.prepare("SELECT id FROM suppliers WHERE name = ?").get(name) as
    | { id: number }
    | undefined
  if (duplicate && duplicate.id !== id) {
    throw new Error("Поставщик с таким названием уже существует.")
  }

  if (id) {
    const result = client
      .prepare(
        `UPDATE suppliers
         SET name = ?, phone = ?, contact_name = ?, comment = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(name, phone, contactName, comment, isActive ? 1 : 0, id)
    if (!result.changes) {
      throw new Error("Поставщик не найден.")
    }
    return
  }

  client
    .prepare(
      `INSERT INTO suppliers (name, phone, contact_name, comment, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(name, phone, contactName, comment, isActive ? 1 : 0)
}

export function setSupplierActive(supplierId: number, isActive: boolean) {
  const client = db()
  const result = client
    .prepare("UPDATE suppliers SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(isActive ? 1 : 0, supplierId)
  if (!result.changes) {
    throw new Error("Поставщик не найден.")
  }
}

export function createUser(formData: FormData) {
  const client = db()
  const login = clean(formData.get("login"))
  const name = clean(formData.get("name"))
  const role = normalizeRole(formData.get("role"))
  const password = String(formData.get("password") ?? "")
  const isActive = clean(formData.get("isActive")) !== "0"

  if (!login || !name || !password) {
    throw new Error("Логин, имя, роль и пароль обязательны.")
  }

  if (password.length < 4) {
    throw new Error("Пароль должен быть не короче 4 символов.")
  }

  if (getUserByLoginForWrite(login, client)) {
    throw new Error("Пользователь с таким логином уже существует.")
  }

  client
    .prepare(
      `INSERT INTO users (login, name, role, password_hash, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(login, name, role, hashPassword(password), isActive ? 1 : 0)
}

export function updateUser(formData: FormData) {
  const client = db()
  const id = Number(clean(formData.get("id")))
  const login = clean(formData.get("login"))
  const name = clean(formData.get("name"))
  const role = normalizeRole(formData.get("role"))
  const isActive = clean(formData.get("isActive")) !== "0"

  if (!id || !login || !name) {
    throw new Error("Логин, имя и роль обязательны.")
  }

  const target = getUserById(id, client)
  if (!target) {
    throw new Error("Пользователь не найден.")
  }

  const duplicate = getUserByLoginForWrite(login, client)
  if (duplicate && duplicate.id !== id) {
    throw new Error("Пользователь с таким логином уже существует.")
  }

  assertCanDemoteOrDisableUser(target, role, isActive, client)

  client
    .prepare(
      `UPDATE users
       SET login = ?, name = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(login, name, role, isActive ? 1 : 0, id)
}

export function setUserActive(userId: number, isActive: boolean) {
  const client = db()
  const target = getUserById(userId, client)
  if (!target) {
    throw new Error("Пользователь не найден.")
  }

  assertCanDemoteOrDisableUser(target, target.role, isActive, client)

  client
    .prepare(
      `UPDATE users
       SET is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(isActive ? 1 : 0, userId)
}

export function changeUserPassword(formData: FormData) {
  const client = db()
  const id = Number(clean(formData.get("id")))
  const newPassword = String(formData.get("newPassword") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")

  if (!id) {
    throw new Error("Пользователь не найден.")
  }

  if (newPassword.length < 4) {
    throw new Error("Пароль должен быть не короче 4 символов.")
  }

  if (newPassword !== confirmPassword) {
    throw new Error("Пароли не совпадают.")
  }

  if (!getUserById(id, client)) {
    throw new Error("Пользователь не найден.")
  }

  client
    .prepare(
      `UPDATE users
       SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(hashPassword(newPassword), id)
}

export function getUserByLogin(login: string) {
  const row = db()
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE login = ?`
    )
    .get(login) as Record<string, unknown> | undefined

  return row ? mapUser(row) : null
}

export function getUserBySessionToken(token: string) {
  const row = db()
    .prepare(
      `SELECT users.id, users.login, users.name, users.role, users.password_hash,
        users.is_active, users.created_at, users.updated_at
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?
        AND users.is_active = 1
        AND (sessions.expires_at IS NULL OR DATETIME(sessions.expires_at) > DATETIME('now'))
       LIMIT 1`
    )
    .get(token) as Record<string, unknown> | undefined

  return row ? publicUser(mapUser(row)) : null
}

export function getActiveFlorists(client: Database.Database = db()) {
  const rows = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE role = 'florist' AND is_active = 1
       ORDER BY name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[]

  return rows.map((row) => publicUser(mapUser(row)))
}

function getActiveFloristById(userId: number, client: Database.Database) {
  const row = client
    .prepare(
      `SELECT id, login, name, role, password_hash, is_active, created_at, updated_at
       FROM users
       WHERE id = ? AND role = 'florist' AND is_active = 1`
    )
    .get(userId) as Record<string, unknown> | undefined

  return row ? publicUser(mapUser(row)) : null
}

export function createSessionRecord(userId: number, token: string, expiresAt: Date) {
  db()
    .prepare(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES (?, ?, ?)`
    )
    .run(userId, token, expiresAt.toISOString())
}

export function deleteSessionRecord(token: string) {
  db().prepare("DELETE FROM sessions WHERE token = ?").run(token)
}

export function getShiftAccessInfo(shiftId: number) {
  return db()
    .prepare(
      `SELECT id, status, user_id as userId, opened_by_user_id as openedByUserId,
        closed_by_user_id as closedByUserId, COALESCE(type, 'day') as type
       FROM shifts
       WHERE id = ?`
    )
    .get(shiftId) as
    | {
        id: number
        status: "open" | "closed"
        userId: number | null
        openedByUserId: number | null
        closedByUserId: number | null
        type: "day" | "night"
      }
    | undefined
}

export function userHasOpenNightShift(userId: number) {
  const row = db()
    .prepare(
      `SELECT id
       FROM shifts
       WHERE status = 'open' AND COALESCE(type, 'day') = 'night' AND user_id = ?
       LIMIT 1`
    )
    .get(userId) as { id: number } | undefined

  return Boolean(row)
}

function seedFromCsv(client: Database.Database) {
  const count = client.prepare("SELECT COUNT(*) as count FROM products").get() as {
    count: number
  }

  if (count.count > 0 || !fs.existsSync(csvPath)) {
    return
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf8")) as CsvProduct[]
  const insert = client.prepare(`
    INSERT INTO products (
      code, category_path, article, name, unit, stock, reserved, expected, cost_price, sale_price
    ) VALUES (
      @code, @categoryPath, @article, @name, @unit, @stock, @reserved, @expected, @costPrice, @salePrice
    )
  `)

  const importProducts = client.transaction(() => {
    for (const row of rows) {
      if (!row.code) {
        continue
      }

      insert.run({
        code: row.code,
        categoryPath: row.category_path ?? "",
        article: row.article ?? "",
        name: row.name || row.code,
        unit: row.unit || "шт",
        stock: toNumber(row.stock),
        reserved: toNumber(row.reserved),
        expected: toNumber(row.expected),
        costPrice: toNumber(row.cost_price),
        salePrice: toNumber(row.sale_price),
      })
    }

    recordStockMovement(client, {
      type: "import",
      qty: rows.length,
      comment: `Импорт CSV: ${rows.length} товаров`,
    })
    addMovement(client, {
      type: "import",
      note: `Импорт CSV: ${rows.length} товаров`,
    })
  })

  importProducts()
}

function parseCsv(input: string) {
  const text = input.replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let cell = ""
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      row.push(cell)
      cell = ""
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1
      }
      row.push(cell)
      if (row.some(Boolean)) {
        rows.push(row)
      }
      row = []
      cell = ""
    } else {
      cell += char
    }
  }

  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }

  const [headers, ...body] = rows
  return body.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  )
}

function toNumber(value: FormDataEntryValue | string | number | null | undefined) {
  const raw = String(value ?? "").replace(",", ".").trim()
  const number = Number(raw)
  return Number.isFinite(number) ? number : 0
}

function toOptionalNumber(value: FormDataEntryValue | string | number | null | undefined) {
  const raw = String(value ?? "").replace(",", ".").trim()
  if (!raw) {
    return null
  }

  const number = Number(raw)
  return Number.isFinite(number) ? number : null
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim()
}

function cleanRowString(value: unknown) {
  return String(value ?? "").trim()
}

function numberFromRow(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalizeOrderStatus(value: unknown): OrderStatus {
  const status = String(value ?? "")
  const legacy: Record<string, OrderStatus> = {
    new: "Новый",
    in_progress: "В работе",
    ready: "Готов",
    done: "Выдан",
    canceled: "Отменен",
  }
  const current = new Set<OrderStatus>([
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

function orderStatusSort(status: OrderStatus) {
  const order: Record<OrderStatus, number> = {
    "Новый": 0,
    "В работе": 1,
    "Готов": 2,
    "Передан курьеру": 3,
    "Выдан": 4,
    "Отменен": 5,
  }

  return order[status]
}

function parsePaymentMethod(value: FormDataEntryValue | string | null | undefined): PaymentMethod {
  const method = (typeof value === "string" ? value.trim() : "") || "cash"
  if (!paymentMethods.has(method as PaymentMethod)) {
    throw new Error("Некорректный способ оплаты.")
  }

  return method as PaymentMethod
}

function mapProduct(row: ProductRow): Product {
  const stock = numberFromRow(row.stock)
  const reserved = numberFromRow(row.reserved)

  return {
    code: String(row.code),
    categoryPath: String(row.category_path ?? ""),
    article: String(row.article ?? ""),
    name: String(row.name),
    unit: String(row.unit),
    stock,
    reserved,
    expected: numberFromRow(row.expected),
    costPrice: numberFromRow(row.cost_price),
    salePrice: numberFromRow(row.sale_price),
    available: stock - reserved,
    updatedAt: String(row.updated_at),
  }
}

function mapWarehouseImport(row: Record<string, unknown>): WarehouseImport {
  const status = String(row.status)

  return {
    id: numberFromRow(row.id),
    filename: String(row.filename ?? ""),
    status: status === "applied" || status === "failed" ? status : "preview",
    totalRows: numberFromRow(row.total_rows),
    createdCount: numberFromRow(row.created_count),
    updatedCount: numberFromRow(row.updated_count),
    unchangedCount: numberFromRow(row.unchanged_count),
    errorCount: numberFromRow(row.error_count),
    createdByUserId: row.created_by_user_id === null ? null : numberFromRow(row.created_by_user_id),
    createdByName: String(row.created_by_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    appliedAt: row.applied_at === null ? null : String(row.applied_at ?? ""),
    reportJson: String(row.report_json ?? ""),
  }
}

function mapWarehouseImportItem(row: Record<string, unknown>): WarehouseImportItem {
  const action = String(row.action)

  return {
    id: numberFromRow(row.id),
    importId: numberFromRow(row.import_id),
    rowNumber: row.row_number === null ? null : numberFromRow(row.row_number),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    categoryPath: String(row.category_path ?? ""),
    action: action === "create" || action === "update" || action === "unchanged" ? action : "error",
    oldStock: row.old_stock === null ? null : numberFromRow(row.old_stock),
    newStock: row.new_stock === null ? null : numberFromRow(row.new_stock),
    stockDelta: row.stock_delta === null ? null : numberFromRow(row.stock_delta),
    oldReserved: row.old_reserved === null ? null : numberFromRow(row.old_reserved),
    newReserved: row.new_reserved === null ? null : numberFromRow(row.new_reserved),
    oldSalePrice: row.old_sale_price === null ? null : numberFromRow(row.old_sale_price),
    newSalePrice: row.new_sale_price === null ? null : numberFromRow(row.new_sale_price),
    oldCostPrice: row.old_cost_price === null ? null : numberFromRow(row.old_cost_price),
    newCostPrice: row.new_cost_price === null ? null : numberFromRow(row.new_cost_price),
    error: String(row.error ?? ""),
    createdAt: String(row.created_at ?? ""),
  }
}

function mapShift(row: Record<string, unknown>, client: Database.Database): Shift {
  const id = numberFromRow(row.id)
  const summary = calculateShiftSummary(id, client)
  const type = String(row.type ?? "day")

  return {
    id,
    openedAt: String(row.openedAt),
    closedAt: row.closedAt === null ? null : String(row.closedAt),
    openingCash: numberFromRow(row.openingCash),
    closingCash: row.closingCash === null ? null : numberFromRow(row.closingCash),
    expectedCash: summary.expectedCash,
    cashierName: String(row.cashierName ?? ""),
    note: String(row.note ?? ""),
    status: row.status === "closed" ? "closed" : "open",
    userId: row.userId === null ? null : numberFromRow(row.userId),
    openedByUserId: row.openedByUserId === null ? null : numberFromRow(row.openedByUserId),
    closedByUserId: row.closedByUserId === null ? null : numberFromRow(row.closedByUserId),
    type: type === "night" ? "night" : "day",
  }
}

function addMovement(
  client: Database.Database,
  input: {
    userId?: number | null
    type: string
    productCode?: string | null
    productName?: string | null
    qty?: number | null
    unitPrice?: number | null
    total?: number | null
    note?: string
  }
) {
  client
    .prepare(
      `INSERT INTO movements (user_id, type, product_code, product_name, qty, unit_price, total, note)
       VALUES (@userId, @type, @productCode, @productName, @qty, @unitPrice, @total, @note)`
    )
    .run({
      userId: input.userId ?? null,
      type: input.type,
      productCode: input.productCode ?? null,
      productName: input.productName ?? null,
      qty: input.qty ?? null,
      unitPrice: input.unitPrice ?? null,
      total: input.total ?? null,
      note: input.note ?? "",
    })
}

export function getOpenShift(client: Database.Database = db()) {
  return client
    .prepare(
      `SELECT id, opened_at as openedAt, closed_at as closedAt, opening_cash as openingCash,
        closing_cash as closingCash, COALESCE(cashier_name, '') as cashierName, note, status,
        user_id as userId, opened_by_user_id as openedByUserId, closed_by_user_id as closedByUserId,
        COALESCE(type, 'day') as type
       FROM shifts
       WHERE status = 'open'
       ORDER BY opened_at DESC
       LIMIT 1`
    )
    .get() as
    | {
        id: number
        openedAt: string
        closedAt: string | null
        openingCash: number
        closingCash: number | null
        cashierName: string
        note: string
        status: "open" | "closed"
        userId: number | null
        openedByUserId: number | null
        closedByUserId: number | null
        type: "day" | "night"
      }
    | undefined
}

export function requireOpenShift(client: Database.Database = db()) {
  const shift = getOpenShift(client)
  if (!shift) {
    throw new Error("Откройте смену перед операцией.")
  }

  return shift
}

export function getDefaultOpeningCash(client: Database.Database = db()) {
  const row = client
    .prepare(
      `SELECT closing_cash as closingCash
       FROM shifts
       WHERE status = 'closed' AND closing_cash IS NOT NULL
       ORDER BY closed_at DESC, id DESC
       LIMIT 1`
    )
    .get() as { closingCash: number | null } | undefined

  return row?.closingCash === null || row?.closingCash === undefined ? 0 : numberFromRow(row.closingCash)
}

export function calculateShiftSummary(shiftId: number, client: Database.Database = db()): ShiftSummary {
  const shift = client.prepare("SELECT opening_cash FROM shifts WHERE id = ?").get(shiftId) as
    | { opening_cash: number }
    | undefined

  if (!shift) {
    throw new Error("Смена не найдена.")
  }

  const rows = client
    .prepare(
      `SELECT type, payment_method as paymentMethod, COALESCE(SUM(amount), 0) as amount
       FROM cash_transactions
       WHERE shift_id = ?
       GROUP BY type, payment_method`
    )
    .all(shiftId) as Array<{ type: CashTransactionType; paymentMethod: PaymentMethod; amount: number }>

  const summary: ShiftSummary = {
    shiftId,
    openingCash: numberFromRow(shift.opening_cash),
    revenueBeforeDiscount: 0,
    discountTotal: 0,
    revenueTotal: 0,
    cashSales: 0,
    cashPrepayments: 0,
    cashOrderPayments: 0,
    cashDealPayments: 0,
    cashIn: 0,
    cashOut: 0,
    cashRefund: 0,
    expectedCash: 0,
  }

  for (const row of rows) {
    const amount = numberFromRow(row.amount)

    if (["sale", "prepayment", "order_payment", "deal_payment"].includes(row.type)) {
      summary.revenueTotal += amount
    }

    if (row.paymentMethod !== "cash") {
      continue
    }

    if (row.type === "sale") {
      summary.cashSales += amount
    } else if (row.type === "prepayment") {
      summary.cashPrepayments += amount
    } else if (row.type === "order_payment") {
      summary.cashOrderPayments += amount
    } else if (row.type === "deal_payment") {
      summary.cashDealPayments += amount
    } else if (row.type === "cash_in") {
      summary.cashIn += amount
    } else if (row.type === "cash_out") {
      summary.cashOut += amount
    } else if (row.type === "cash_refund") {
      summary.cashRefund += amount
    }
  }

  summary.expectedCash =
    summary.openingCash +
    summary.cashSales +
    summary.cashPrepayments +
    summary.cashOrderPayments +
    summary.cashDealPayments +
    summary.cashIn -
    summary.cashOut -
    summary.cashRefund

  const saleDiscountRow = client
    .prepare(
      `SELECT
        COALESCE(SUM(
          COALESCE(NULLIF(total_before_discount, 0), total) - COALESCE(total, 0)
        ), 0) as discount
       FROM sales
       WHERE shift_id = ?`
    )
    .get(shiftId) as { discount: number } | undefined
  const orderDiscountRow = client
    .prepare(
      `SELECT COALESCE(SUM(order_discount), 0) as discount
       FROM (
        SELECT DISTINCT orders.id,
          COALESCE(orders.items_discount_total, 0) + COALESCE(orders.order_discount_amount, 0) as order_discount
        FROM orders
        INNER JOIN cash_transactions ON cash_transactions.order_id = orders.id
        WHERE cash_transactions.shift_id = ?
       )`
    )
    .get(shiftId) as { discount: number } | undefined
  summary.discountTotal = numberFromRow(saleDiscountRow?.discount) + numberFromRow(orderDiscountRow?.discount)
  summary.revenueBeforeDiscount = summary.revenueTotal + summary.discountTotal

  return summary
}

export function getShiftDetails(shiftId: number, client: Database.Database = db()): ShiftDetails {
  const shiftRow = client
    .prepare(
      `SELECT id, opened_at as openedAt, closed_at as closedAt, opening_cash as openingCash,
        closing_cash as closingCash, COALESCE(cashier_name, '') as cashierName, note, status,
        user_id as userId, opened_by_user_id as openedByUserId, closed_by_user_id as closedByUserId,
        COALESCE(type, 'day') as type
       FROM shifts
       WHERE id = ?`
    )
    .get(shiftId) as Record<string, unknown> | undefined

  if (!shiftRow) {
    throw new Error("Смена не найдена.")
  }

  const shift = mapShift(shiftRow, client)
  const summary = calculateShiftSummary(shiftId, client)
  const cashTransactions = client
    .prepare(
      `SELECT cash_transactions.id, cash_transactions.shift_id as shiftId,
        cash_transactions.order_id as orderId, cash_transactions.sale_id as saleId,
        cash_transactions.customer_id as customerId, cash_transactions.deal_id as dealId,
        cash_transactions.user_id as userId, users.name as userName, cash_transactions.type,
        cash_transactions.payment_method as paymentMethod, cash_transactions.amount,
        COALESCE(cash_transactions.comment, '') as comment, cash_transactions.created_at as createdAt
       FROM cash_transactions
       LEFT JOIN users ON users.id = cash_transactions.user_id
       WHERE cash_transactions.shift_id = ?
       ORDER BY cash_transactions.created_at DESC, cash_transactions.id DESC`
    )
    .all(shiftId) as CashTransaction[]

  const breakdown: ShiftPaymentBreakdown = {
    cashSales: 0,
    cardSales: 0,
    terminalSales: 0,
    mbankSales: 0,
    optimaSales: 0,
    elsomSales: 0,
    transferSales: 0,
    cashPrepayments: 0,
    cardPrepayments: 0,
    terminalPrepayments: 0,
    mbankPrepayments: 0,
    optimaPrepayments: 0,
    elsomPrepayments: 0,
    transferPrepayments: 0,
    cashOrderPayments: 0,
    cardOrderPayments: 0,
    terminalOrderPayments: 0,
    mbankOrderPayments: 0,
    optimaOrderPayments: 0,
    elsomOrderPayments: 0,
    transferOrderPayments: 0,
    cashDealPayments: 0,
    cardDealPayments: 0,
    terminalDealPayments: 0,
    mbankDealPayments: 0,
    optimaDealPayments: 0,
    elsomDealPayments: 0,
    transferDealPayments: 0,
    cashIn: 0,
    cashOutOther: 0,
    courierPayouts: 0,
    cashRefund: 0,
  }

  for (const transaction of cashTransactions) {
    const amount = numberFromRow(transaction.amount)
    const isCourierPayout =
      transaction.type === "cash_out" &&
      (transaction.orderId !== null || transaction.comment.toLowerCase().includes("курьер"))

    if (transaction.type === "sale") {
      if (transaction.paymentMethod === "cash") breakdown.cashSales += amount
      if (transaction.paymentMethod === "card") breakdown.cardSales += amount
      if (transaction.paymentMethod === "terminal") breakdown.terminalSales += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankSales += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaSales += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomSales += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferSales += amount
    } else if (transaction.type === "prepayment") {
      if (transaction.paymentMethod === "cash") breakdown.cashPrepayments += amount
      if (transaction.paymentMethod === "card") breakdown.cardPrepayments += amount
      if (transaction.paymentMethod === "terminal") breakdown.terminalPrepayments += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankPrepayments += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaPrepayments += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomPrepayments += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferPrepayments += amount
    } else if (transaction.type === "order_payment") {
      if (transaction.paymentMethod === "cash") breakdown.cashOrderPayments += amount
      if (transaction.paymentMethod === "card") breakdown.cardOrderPayments += amount
      if (transaction.paymentMethod === "terminal") breakdown.terminalOrderPayments += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankOrderPayments += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaOrderPayments += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomOrderPayments += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferOrderPayments += amount
    } else if (transaction.type === "deal_payment") {
      if (transaction.paymentMethod === "cash") breakdown.cashDealPayments += amount
      if (transaction.paymentMethod === "card") breakdown.cardDealPayments += amount
      if (transaction.paymentMethod === "terminal") breakdown.terminalDealPayments += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankDealPayments += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaDealPayments += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomDealPayments += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferDealPayments += amount
    } else if (transaction.type === "cash_in" && transaction.paymentMethod === "cash") {
      breakdown.cashIn += amount
    } else if (transaction.type === "cash_out" && transaction.paymentMethod === "cash") {
      if (isCourierPayout) {
        breakdown.courierPayouts += amount
      } else {
        breakdown.cashOutOther += amount
      }
    } else if (transaction.type === "cash_refund" && transaction.paymentMethod === "cash") {
      breakdown.cashRefund += amount
    }
  }

  const sales = client
    .prepare(
      `SELECT sales.id, sales.shift_id as shiftId, sales.user_id as userId,
        users.name as userName,
        COALESCE(sales.payment_method, 'cash') as paymentMethod,
        sales.customer_id as customerId, COALESCE(sales.customer_name, '') as customerName,
        COALESCE(sales.customer_phone, '') as customerPhone,
        COALESCE(NULLIF(sales.items_total_before_discount, 0), sales.total) as itemsTotalBeforeDiscount,
        COALESCE(sales.items_discount_total, 0) as itemsDiscountTotal,
        COALESCE(sales.sale_discount_type, 'none') as saleDiscountType,
        COALESCE(sales.sale_discount_value, 0) as saleDiscountValue,
        COALESCE(sales.sale_discount_amount, 0) as saleDiscountAmount,
        COALESCE(NULLIF(sales.total_before_discount, 0), sales.total) as totalBeforeDiscount,
        COALESCE(sales.items_discount_total, 0) + COALESCE(sales.sale_discount_amount, 0) as discountTotal,
        sales.total, sales.note, sales.created_at as createdAt, COUNT(sale_items.id) as itemsCount
       FROM sales
       LEFT JOIN sale_items ON sale_items.sale_id = sales.id
       LEFT JOIN users ON users.id = sales.user_id
       WHERE sales.shift_id = ?
       GROUP BY sales.id
       ORDER BY sales.created_at DESC, sales.id DESC`
    )
    .all(shiftId) as Sale[]
  const saleItems = client
    .prepare(
      `SELECT sale_items.id, sale_items.sale_id as saleId, sale_items.product_code as productCode,
        COALESCE(products.name, sale_items.product_code) as name, sale_items.qty,
        sale_items.unit_price as price, COALESCE(sale_items.discount_type, 'none') as discountType,
        COALESCE(sale_items.discount_value, 0) as discountValue,
        COALESCE(sale_items.discount_amount, 0) as discountAmount,
        COALESCE(NULLIF(sale_items.total_before_discount, 0), sale_items.total) as totalBeforeDiscount,
        sale_items.total
       FROM sale_items
       LEFT JOIN products ON products.code = sale_items.product_code
       WHERE sale_items.sale_id IN (SELECT id FROM sales WHERE shift_id = ?)
       ORDER BY sale_items.sale_id DESC, sale_items.id ASC`
    )
    .all(shiftId) as SaleItem[]
  const saleItemsBySaleId = new Map<number, SaleItem[]>()

  for (const item of saleItems) {
    const saleId = numberFromRow(item.saleId)
    const items = saleItemsBySaleId.get(saleId) ?? []
      items.push({
        id: numberFromRow(item.id),
        saleId,
        productCode: String(item.productCode ?? ""),
        name: String(item.name ?? ""),
        qty: numberFromRow(item.qty),
        price: numberFromRow(item.price),
        discountType: normalizeDiscountType(String(item.discountType ?? "none")),
        discountValue: numberFromRow(item.discountValue),
        discountAmount: numberFromRow(item.discountAmount),
        totalBeforeDiscount: numberFromRow(item.totalBeforeDiscount) || numberFromRow(item.total),
        total: numberFromRow(item.total),
      })
    saleItemsBySaleId.set(saleId, items)
  }

  const relatedOrderRows = client
    .prepare(
      `SELECT cash_transactions.id as transactionId, cash_transactions.order_id as orderId,
        cash_transactions.user_id as userId, users.name as userName, orders.number,
        COALESCE(orders.customer, '') as customer, cash_transactions.type,
        COALESCE(NULLIF(orders.total_before_discount, 0), orders.total) as totalBeforeDiscount,
        COALESCE(orders.items_discount_total, 0) + COALESCE(orders.order_discount_amount, 0) as discountTotal,
        orders.total as total,
        cash_transactions.payment_method as paymentMethod, cash_transactions.amount,
        COALESCE(cash_transactions.comment, '') as comment, cash_transactions.created_at as createdAt
       FROM cash_transactions
       LEFT JOIN orders ON orders.id = cash_transactions.order_id
       LEFT JOIN users ON users.id = cash_transactions.user_id
       WHERE cash_transactions.shift_id = ? AND cash_transactions.order_id IS NOT NULL
       ORDER BY cash_transactions.created_at DESC, cash_transactions.id DESC`
    )
    .all(shiftId) as ShiftRelatedOrder[]
  const relatedOrderItems = client
    .prepare(
      `SELECT id, order_id as orderId, product_code as productCode, name, qty, price, total
        , COALESCE(discount_type, 'none') as discountType, COALESCE(discount_value, 0) as discountValue,
        COALESCE(discount_amount, 0) as discountAmount, COALESCE(NULLIF(total_before_discount, 0), total) as totalBeforeDiscount
       FROM order_items
       WHERE order_id IN (
        SELECT DISTINCT order_id
        FROM cash_transactions
        WHERE shift_id = ? AND order_id IS NOT NULL
       )
       ORDER BY order_id DESC, id ASC`
    )
    .all(shiftId) as OrderItem[]
  const orderItemsByOrderId = new Map<number, OrderItem[]>()

  for (const item of relatedOrderItems) {
    const orderId = numberFromRow(item.orderId)
    const items = orderItemsByOrderId.get(orderId) ?? []
      items.push({
        id: numberFromRow(item.id),
        orderId,
        productCode: String(item.productCode ?? ""),
        name: String(item.name ?? ""),
        qty: numberFromRow(item.qty),
        price: numberFromRow(item.price),
        discountType: normalizeDiscountType(String(item.discountType ?? "none")),
        discountValue: numberFromRow(item.discountValue),
        discountAmount: numberFromRow(item.discountAmount),
        totalBeforeDiscount: numberFromRow(item.totalBeforeDiscount) || numberFromRow(item.total),
        total: numberFromRow(item.total),
      })
    orderItemsByOrderId.set(orderId, items)
  }

  return {
    shift,
    cashier: shift.cashierName || "Кассир не указан",
    summary,
    breakdown,
    cashTransactions,
    sales: sales.map((sale) => ({
      ...sale,
      items: saleItemsBySaleId.get(numberFromRow(sale.id)) ?? [],
    })),
    relatedOrders: relatedOrderRows.map((order) => ({
      ...order,
      items: orderItemsByOrderId.get(numberFromRow(order.orderId)) ?? [],
    })),
  }
}

export function recordCashTransaction(
  client: Database.Database,
  input: {
    shiftId: number
    orderId?: number | null
    saleId?: number | null
    customerId?: number | null
    dealId?: number | null
    userId?: number | null
    type: CashTransactionType
    paymentMethod: PaymentMethod
    amount: number
    comment?: string
  }
) {
  if (!cashTransactionTypes.has(input.type)) {
    throw new Error("Некорректный тип денежной операции.")
  }

  if (!paymentMethods.has(input.paymentMethod)) {
    throw new Error("Некорректный способ оплаты.")
  }

  if (input.amount <= 0) {
    throw new Error("Сумма операции должна быть больше нуля.")
  }

  client
    .prepare(
      `INSERT INTO cash_transactions (
        shift_id, order_id, sale_id, customer_id, deal_id, user_id, type, payment_method, amount, comment
      ) VALUES (
        @shiftId, @orderId, @saleId, @customerId, @dealId, @userId, @type, @paymentMethod, @amount, @comment
      )`
    )
    .run({
      shiftId: input.shiftId,
      orderId: input.orderId ?? null,
      saleId: input.saleId ?? null,
      customerId: input.customerId ?? null,
      dealId: input.dealId ?? null,
      userId: input.userId ?? null,
      type: input.type,
      paymentMethod: input.paymentMethod,
      amount: input.amount,
      comment: input.comment ?? null,
    })
}

export function recordStockMovement(
  client: Database.Database,
  input: {
    productCode?: string | null
    type: StockMovementType
    qty: number
    beforeStock?: number | null
    afterStock?: number | null
    beforeReserved?: number | null
    afterReserved?: number | null
    orderId?: number | null
    saleId?: number | null
    shiftId?: number | null
    documentId?: number | null
    userId?: number | null
    comment?: string
  }
) {
  if (!stockMovementTypes.has(input.type)) {
    throw new Error("Некорректный тип складского движения.")
  }

  client
    .prepare(
      `INSERT INTO stock_movements (
        product_code, type, qty, before_stock, after_stock, before_reserved, after_reserved,
        order_id, sale_id, shift_id, document_id, user_id, comment
      ) VALUES (
        @productCode, @type, @qty, @beforeStock, @afterStock, @beforeReserved, @afterReserved,
        @orderId, @saleId, @shiftId, @documentId, @userId, @comment
      )`
    )
    .run({
      productCode: input.productCode ?? null,
      type: input.type,
      qty: input.qty,
      beforeStock: input.beforeStock ?? null,
      afterStock: input.afterStock ?? null,
      beforeReserved: input.beforeReserved ?? null,
      afterReserved: input.afterReserved ?? null,
      orderId: input.orderId ?? null,
      saleId: input.saleId ?? null,
      shiftId: input.shiftId ?? null,
      documentId: input.documentId ?? null,
      userId: input.userId ?? null,
      comment: input.comment ?? null,
    })
}

export function formatOrderNumber(orderId: number, date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "")
  return `ORD-${day}-${String(orderId).padStart(4, "0")}`
}

export function generateOrderNumber(orderId: number, date = new Date()) {
  return formatOrderNumber(orderId, date)
}

function getProduct(client: Database.Database, code: string) {
  return client.prepare("SELECT * FROM products WHERE code = ?").get(code) as ProductRow | undefined
}

function applyProductDelta(
  client: Database.Database,
  input: {
    productCode: string
    stockDelta?: number
    reservedDelta?: number
    type: StockMovementType
    qty: number
    orderId?: number | null
    saleId?: number | null
    shiftId?: number | null
    userId?: number | null
    comment?: string
  }
) {
  const product = getProduct(client, input.productCode)
  if (!product) {
    throw new Error(`Товар ${input.productCode} не найден.`)
  }

  const beforeStock = numberFromRow(product.stock)
  const beforeReserved = numberFromRow(product.reserved)
  const afterStock = beforeStock + (input.stockDelta ?? 0)
  const afterReserved = beforeReserved + (input.reservedDelta ?? 0)

  client
    .prepare(
      `UPDATE products
       SET stock = ?, reserved = ?, updated_at = CURRENT_TIMESTAMP
       WHERE code = ?`
    )
    .run(afterStock, afterReserved, input.productCode)

  recordStockMovement(client, {
    productCode: input.productCode,
    type: input.type,
    qty: input.qty,
    beforeStock,
    afterStock,
    beforeReserved,
    afterReserved,
    orderId: input.orderId ?? null,
    saleId: input.saleId ?? null,
    shiftId: input.shiftId ?? null,
    userId: input.userId ?? null,
    comment: input.comment,
  })

  return product
}

export function getDashboardData(): DashboardData {
  const client = db()
  const products = (
    client
      .prepare(
        `SELECT * FROM products
         ORDER BY
          CASE WHEN stock - reserved < 0 THEN 0 WHEN stock - reserved <= 3 THEN 1 ELSE 2 END,
          name COLLATE NOCASE
         LIMIT 234`
      )
      .all() as ProductRow[]
  ).map(mapProduct)

  const sales = client
    .prepare(
      `SELECT sales.id, sales.shift_id as shiftId, COALESCE(sales.payment_method, 'cash') as paymentMethod,
        sales.user_id as userId, users.name as userName,
        sales.customer_id as customerId, COALESCE(sales.customer_name, '') as customerName,
        COALESCE(sales.customer_phone, '') as customerPhone,
        COALESCE(NULLIF(sales.items_total_before_discount, 0), sales.total) as itemsTotalBeforeDiscount,
        COALESCE(sales.items_discount_total, 0) as itemsDiscountTotal,
        COALESCE(sales.sale_discount_type, 'none') as saleDiscountType,
        COALESCE(sales.sale_discount_value, 0) as saleDiscountValue,
        COALESCE(sales.sale_discount_amount, 0) as saleDiscountAmount,
        COALESCE(NULLIF(sales.total_before_discount, 0), sales.total) as totalBeforeDiscount,
        COALESCE(sales.items_discount_total, 0) + COALESCE(sales.sale_discount_amount, 0) as discountTotal,
        sales.total, sales.note, sales.created_at as createdAt, COUNT(sale_items.id) as itemsCount
       FROM sales
       LEFT JOIN sale_items ON sale_items.sale_id = sales.id
       LEFT JOIN users ON users.id = sales.user_id
       GROUP BY sales.id
       ORDER BY sales.created_at DESC
       LIMIT 30`
    )
    .all() as Sale[]

  const shifts = (
    client
      .prepare(
        `SELECT id, opened_at as openedAt, closed_at as closedAt, opening_cash as openingCash,
          closing_cash as closingCash, COALESCE(cashier_name, '') as cashierName, note, status,
          user_id as userId, opened_by_user_id as openedByUserId, closed_by_user_id as closedByUserId,
          COALESCE(type, 'day') as type
         FROM shifts
         ORDER BY opened_at DESC
         LIMIT 20`
      )
      .all() as Record<string, unknown>[]
  ).map((shift) => mapShift(shift, client))
  const shiftDetails = shifts.map((shift) => getShiftDetails(shift.id, client))

  const orderRows = client
    .prepare(
      `SELECT id, number, customer_id as customerId, deal_id as dealId, customer, phone, COALESCE(source, '') as source,
        created_by_user_id as createdByUserId, updated_by_user_id as updatedByUserId,
        COALESCE(delivery_type, 'pickup') as deliveryType, COALESCE(address, '') as address,
        due_at as dueAt, status,
        COALESCE(NULLIF(items_total_before_discount, 0), total) as itemsTotalBeforeDiscount,
        COALESCE(items_discount_total, 0) as itemsDiscountTotal,
        COALESCE(order_discount_type, 'none') as orderDiscountType,
        COALESCE(order_discount_value, 0) as orderDiscountValue,
        COALESCE(order_discount_amount, 0) as orderDiscountAmount,
        COALESCE(NULLIF(total_before_discount, 0), total) as totalBeforeDiscount,
        total, COALESCE(prepaid, 0) as prepaid,
        COALESCE(paid, 0) as paid, COALESCE(delivery_price, 0) as deliveryPrice,
        COALESCE(courier_payout, 0) as courierPayout,
        COALESCE(delivery_payout_paid, 0) as deliveryPayoutPaid,
        COALESCE(is_reserved, 0) as isReserved, note, ready_at as readyAt,
        handed_to_courier_at as handedToCourierAt, completed_at as completedAt,
        COALESCE(courier_name, '') as courierName, created_at as createdAt, updated_at as updatedAt
       FROM orders
       ORDER BY due_at ASC, created_at DESC
       LIMIT 80`
    )
    .all() as Array<Record<string, unknown>>

  const itemsByOrder = new Map<number, OrderItem[]>()
  const orderIds = orderRows.map((order) => numberFromRow(order.id))
  if (orderIds.length) {
    const placeholders = orderIds.map(() => "?").join(", ")
    const itemRows = client
      .prepare(
        `SELECT id, order_id as orderId, product_code as productCode, name, qty, price,
          COALESCE(discount_type, 'none') as discountType, COALESCE(discount_value, 0) as discountValue,
          COALESCE(discount_amount, 0) as discountAmount, COALESCE(NULLIF(total_before_discount, 0), total) as totalBeforeDiscount,
          total
         FROM order_items
         WHERE order_id IN (${placeholders})
         ORDER BY id ASC`
      )
      .all(...orderIds) as Array<Record<string, unknown>>

    for (const row of itemRows) {
      const orderId = numberFromRow(row.orderId)
      const items = itemsByOrder.get(orderId) ?? []
      items.push({
        id: numberFromRow(row.id),
        orderId,
        productCode: String(row.productCode ?? ""),
        name: String(row.name ?? ""),
        qty: numberFromRow(row.qty),
        price: numberFromRow(row.price),
        discountType: normalizeDiscountType(String(row.discountType ?? "none")),
        discountValue: numberFromRow(row.discountValue),
        discountAmount: numberFromRow(row.discountAmount),
        totalBeforeDiscount: numberFromRow(row.totalBeforeDiscount) || numberFromRow(row.total),
        total: numberFromRow(row.total),
      })
      itemsByOrder.set(orderId, items)
    }
  }

  const orders = orderRows
    .map((row) => {
      const id = numberFromRow(row.id)
      return {
        id,
        number: row.number === null ? null : String(row.number ?? ""),
        createdByUserId: row.createdByUserId === null ? null : numberFromRow(row.createdByUserId),
        updatedByUserId: row.updatedByUserId === null ? null : numberFromRow(row.updatedByUserId),
        customerId: row.customerId === null ? null : numberFromRow(row.customerId),
        dealId: row.dealId === null ? null : numberFromRow(row.dealId),
        customer: String(row.customer ?? ""),
        phone: String(row.phone ?? ""),
        source: String(row.source ?? ""),
        deliveryType: String(row.deliveryType ?? "pickup"),
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
        deliveryPrice: numberFromRow(row.deliveryPrice),
        courierPayout: numberFromRow(row.courierPayout),
        deliveryPayoutPaid: Number(row.deliveryPayoutPaid ?? 0) === 1,
        isReserved: Number(row.isReserved ?? 0) === 1,
        note: String(row.note ?? ""),
        readyAt: row.readyAt === null ? null : String(row.readyAt ?? ""),
        handedToCourierAt: row.handedToCourierAt === null ? null : String(row.handedToCourierAt ?? ""),
        completedAt: row.completedAt === null ? null : String(row.completedAt ?? ""),
        courierName: String(row.courierName ?? ""),
        createdAt: String(row.createdAt ?? ""),
        updatedAt: row.updatedAt === null ? null : String(row.updatedAt ?? ""),
        items: itemsByOrder.get(id) ?? [],
      } satisfies Order
    })
    .sort((left, right) => orderStatusSort(left.status) - orderStatusSort(right.status))

  const movements = client
    .prepare(historyOperationsQuery(80))
    .all() as Movement[]

  const stockMovements = client
    .prepare(stockMovementsQuery(120))
    .all() as Movement[]

  const customers = client
    .prepare(
      `SELECT id, name, COALESCE(phone, '') as phone,
        COALESCE(default_discount_percent, 0) as defaultDiscountPercent
       FROM customers
       ORDER BY name COLLATE NOCASE, id DESC
       LIMIT 200`
    )
    .all() as CustomerOption[]

  const today = new Date().toISOString().slice(0, 10)
  const todaySales = client
    .prepare("SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(created_at) = DATE(?)")
    .get(today) as { total: number }

  return {
    products,
    sales,
    shifts,
    shiftDetails,
    orders,
    movements,
    stockMovements,
    users: listUsers(client),
    customers,
    suppliers: listSuppliers({}, client),
    stats: {
      productsCount: products.length,
      lowStockCount: products.filter((product) => product.available > 0 && product.available <= 3).length,
      negativeStockCount: products.filter((product) => product.available < 0).length,
      reservedCount: products.filter((product) => product.reserved > 0).length,
      openOrdersCount: orders.filter((order) => !["Выдан", "Отменен"].includes(order.status)).length,
      todaySalesTotal: Number(todaySales.total),
      openShift: shifts.find((shift) => shift.status === "open") ?? null,
      defaultOpeningCash: getDefaultOpeningCash(client),
    },
  }
}

export function getReadyOrdersActionCount() {
  const row = db().prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'Готов'").get() as
    | { count: number }
    | undefined

  return numberFromRow(row?.count ?? 0)
}

export function getHistoryReportData(): HistoryReportData {
  const client = db()

  return {
    operations: client.prepare(historyOperationsQuery()).all() as Movement[],
    stockMovements: client.prepare(stockMovementsQuery()).all() as Movement[],
  }
}

function normalizeStockDocumentStatus(value: unknown): StockDocumentStatus {
  const status = String(value)
  if (status === "posted" || status === "cancelled") {
    return status
  }

  return "draft"
}

function mapStockDocumentItem(row: Record<string, unknown>): StockDocumentItem {
  return {
    id: numberFromRow(row.id),
    documentId: numberFromRow(row.document_id),
    productCode: String(row.product_code ?? ""),
    productName: String(row.product_name ?? ""),
    qty: numberFromRow(row.qty),
    beforeStock: row.before_stock === null ? null : numberFromRow(row.before_stock),
    afterStock: row.after_stock === null ? null : numberFromRow(row.after_stock),
    currentStock: row.current_stock === null || row.current_stock === undefined ? null : numberFromRow(row.current_stock),
    currentReserved:
      row.current_reserved === null || row.current_reserved === undefined ? null : numberFromRow(row.current_reserved),
    comment: String(row.comment ?? ""),
    createdAt: String(row.created_at ?? ""),
  }
}

function mapStockDocument(row: Record<string, unknown>, items: StockDocumentItem[] = []): StockDocument {
  return {
    id: numberFromRow(row.id),
    number: String(row.number ?? ""),
    type: parseStockDocumentType(String(row.type)),
    status: normalizeStockDocumentStatus(row.status),
    supplierId: row.supplier_id === null || row.supplier_id === undefined ? null : numberFromRow(row.supplier_id),
    supplierName: String(row.supplier_name ?? ""),
    comment: String(row.comment ?? ""),
    operationAt: row.operation_at === null || row.operation_at === undefined ? null : String(row.operation_at),
    createdByUserId: row.created_by_user_id === null ? null : numberFromRow(row.created_by_user_id),
    createdByName: String(row.created_by_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    postedByUserId: row.posted_by_user_id === null ? null : numberFromRow(row.posted_by_user_id),
    postedByName: String(row.posted_by_name ?? ""),
    postedAt: row.posted_at === null ? null : String(row.posted_at ?? ""),
    cancelledAt: row.cancelled_at === null ? null : String(row.cancelled_at ?? ""),
    itemsCount: numberFromRow(row.items_count ?? items.length),
    items,
  }
}

export function listStockDocuments(filters?: { type?: string; status?: string; query?: string }) {
  const client = db()
  const conditions: string[] = []
  const params: Record<string, string> = {}
  const type = filters?.type && filters.type !== "all" ? filters.type : ""
  const status = filters?.status && filters.status !== "all" ? filters.status : ""
  const query = String(filters?.query ?? "").trim()

  if (type) {
    conditions.push("stock_documents.type = @type")
    params.type = type
  }
  if (status) {
    conditions.push("stock_documents.status = @status")
    params.status = status
  }
  if (query) {
    conditions.push("(stock_documents.number LIKE @query OR stock_documents.comment LIKE @query)")
    params.query = `%${query}%`
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const rows = client
    .prepare(
      `SELECT stock_documents.*, COUNT(stock_document_items.id) as items_count
       FROM stock_documents
       LEFT JOIN stock_document_items ON stock_document_items.document_id = stock_documents.id
       ${where}
       GROUP BY stock_documents.id
       ORDER BY stock_documents.created_at DESC, stock_documents.id DESC`
    )
    .all(params) as Array<Record<string, unknown>>

  return rows.map((row) => mapStockDocument(row))
}

export function getStockDocument(documentId: number) {
  const client = db()
  const row = client
    .prepare(
      `SELECT stock_documents.*, COUNT(stock_document_items.id) as items_count
       FROM stock_documents
       LEFT JOIN stock_document_items ON stock_document_items.document_id = stock_documents.id
       WHERE stock_documents.id = ?
       GROUP BY stock_documents.id`
    )
    .get(documentId) as Record<string, unknown> | undefined
  if (!row) {
    throw new Error("Акт склада не найден.")
  }

  const items = client
    .prepare(
      `SELECT
        stock_document_items.*,
        products.stock as current_stock,
        products.reserved as current_reserved
       FROM stock_document_items
       LEFT JOIN products ON products.code = stock_document_items.product_code
       WHERE stock_document_items.document_id = ?
       ORDER BY stock_document_items.id`
    )
    .all(documentId) as Array<Record<string, unknown>>

  return mapStockDocument(row, items.map(mapStockDocumentItem))
}

type WarehouseImportRow = {
  rowNumber: number
  code: string
  name: string
  article: string
  categoryPath: string
  unit: string
  stockRaw: string
  reservedRaw: string
  salePriceRaw: string
  costPriceRaw: string
  stock: number | null
  reserved: number | null
  salePrice: number | null
  costPrice: number | null
  reservedProvided: boolean
  salePriceProvided: boolean
  costPriceProvided: boolean
  errors: string[]
}

type WarehouseImportReportItem = WarehouseImportRow & {
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
}

type WarehouseImportReport = {
  filename: string
  items: WarehouseImportReportItem[]
}

const warehouseImportColumns = [
  "code",
  "name",
  "article",
  "category_path",
  "unit",
  "stock",
  "reserved",
  "sale_price",
  "cost_price",
]

export function createWarehouseImportTemplateWorkbook() {
  const worksheet = XLSX.utils.json_to_sheet([
    {
      code: "ROSE-001",
      name: "Роза красная",
      article: "",
      category_path: "Цветы/Розы",
      unit: "шт",
      stock: 10,
      reserved: 0,
      sale_price: 150,
      cost_price: 80,
    },
  ], { header: warehouseImportColumns })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Импорт склада")

  return workbook
}

export function createWarehouseExportWorkbook() {
  const client = db()
  const rows = (client.prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all() as ProductRow[])
    .map(mapProduct)
    .map((product) => ({
      code: product.code,
      name: product.name,
      article: product.article,
      category_path: product.categoryPath,
      unit: product.unit,
      stock: product.stock,
      reserved: product.reserved,
      available: product.available,
      sale_price: product.salePrice,
      cost_price: product.costPrice,
    }))

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [...warehouseImportColumns.slice(0, 7), "available", "sale_price", "cost_price"],
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Склад")

  return workbook
}

export function writeWorkbookBuffer(workbook: XLSX.WorkBook) {
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer
}

export function previewWarehouseImport(input: {
  filename: string
  buffer: ArrayBuffer
  currentUser: CurrentUser
}): WarehouseImportPreview {
  const client = db()
  const rows = parseWarehouseImportRows(input.buffer)
  const reportItems = buildWarehouseImportReportItems(client, rows)
  const counts = countWarehouseImportItems(reportItems)
  const report: WarehouseImportReport = {
    filename: input.filename,
    items: reportItems,
  }

  const createPreview = client.transaction(() => {
    const result = client
      .prepare(
        `INSERT INTO warehouse_imports (
          filename, status, total_rows, created_count, updated_count, unchanged_count, error_count,
          created_by_user_id, created_by_name, report_json
        ) VALUES (?, 'preview', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.filename,
        reportItems.length,
        counts.created,
        counts.updated,
        counts.unchanged,
        counts.errors,
        input.currentUser.id,
        input.currentUser.name,
        JSON.stringify(report)
      )

    const importId = Number(result.lastInsertRowid)
    insertWarehouseImportItems(client, importId, reportItems)

    return getWarehouseImport(importId, client)
  })

  return createPreview()
}

export function applyWarehouseImport(importId: number, currentUser: CurrentUser): WarehouseImportPreview {
  const client = db()

  const applyImport = client.transaction(() => {
    const record = getWarehouseImportRecord(importId, client)
    if (!record) {
      throw new Error("Импорт не найден.")
    }

    const current = mapWarehouseImport(record)
    if (current.status === "applied") {
      throw new Error("Этот импорт уже применен.")
    }

    const report = parseWarehouseImportReport(current.reportJson)
    if (report.items.some((item) => item.action === "error")) {
      client
        .prepare("UPDATE warehouse_imports SET status = 'failed' WHERE id = ?")
        .run(importId)
      throw new Error("Исправьте ошибки в XLSX и загрузите файл снова.")
    }

    for (const item of report.items) {
      if (item.action === "unchanged") {
        continue
      }

      const existing = getProduct(client, item.code)
      const oldStock = existing ? numberFromRow(existing.stock) : 0
      const oldReserved = existing ? numberFromRow(existing.reserved) : 0
      const newStock = item.stock ?? 0
      const newReserved = item.reservedProvided ? item.reserved ?? 0 : oldReserved
      const stockDelta = newStock - oldStock

      if (existing) {
        client
          .prepare(
            `UPDATE products
             SET category_path = ?, article = ?, name = ?, unit = ?, stock = ?, reserved = ?,
               cost_price = ?, sale_price = ?, updated_at = CURRENT_TIMESTAMP
             WHERE code = ?`
          )
          .run(
            item.categoryPath || String(existing.category_path ?? ""),
            item.article || String(existing.article ?? ""),
            item.name || String(existing.name ?? ""),
            item.unit || String(existing.unit ?? "шт"),
            newStock,
            newReserved,
            item.costPriceProvided ? item.costPrice ?? 0 : numberFromRow(existing.cost_price),
            item.salePriceProvided ? item.salePrice ?? 0 : numberFromRow(existing.sale_price),
            item.code
          )
      } else {
        client
          .prepare(
            `INSERT INTO products (
              code, category_path, article, name, unit, stock, reserved, expected, cost_price, sale_price, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)`
          )
          .run(
            item.code,
            item.categoryPath,
            item.article,
            item.name,
            item.unit || "шт",
            newStock,
            newReserved,
            item.costPriceProvided ? item.costPrice ?? 0 : 0,
            item.salePriceProvided ? item.salePrice ?? 0 : 0
          )
      }

      if (stockDelta !== 0) {
        recordStockMovement(client, {
          productCode: item.code,
          type: "import",
          qty: stockDelta,
          beforeStock: oldStock,
          afterStock: newStock,
          beforeReserved: oldReserved,
          afterReserved: newReserved,
          userId: currentUser.id,
          comment: `Импорт склада XLSX: ${importId}`,
        })
      }
    }

    const counts = countWarehouseImportItems(report.items)
    client
      .prepare(
        `UPDATE warehouse_imports
         SET status = 'applied', total_rows = ?, created_count = ?, updated_count = ?,
           unchanged_count = ?, error_count = 0, applied_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(report.items.length, counts.created, counts.updated, counts.unchanged, importId)

    client.prepare("DELETE FROM warehouse_import_items WHERE import_id = ?").run(importId)
    insertWarehouseImportItems(client, importId, report.items)

    return getWarehouseImport(importId, client)
  })

  return applyImport()
}

export function listWarehouseImports() {
  const rows = db()
    .prepare(
      `SELECT *
       FROM warehouse_imports
       ORDER BY created_at DESC, id DESC`
    )
    .all() as Record<string, unknown>[]

  return rows.map(mapWarehouseImport)
}

export function getWarehouseImport(importId: number, client: Database.Database = db()): WarehouseImportPreview {
  const record = getWarehouseImportRecord(importId, client)
  if (!record) {
    throw new Error("Импорт не найден.")
  }

  const items = client
    .prepare(
      `SELECT *
       FROM warehouse_import_items
       WHERE import_id = ?
       ORDER BY row_number ASC, id ASC`
    )
    .all(importId) as Record<string, unknown>[]

  return {
    ...mapWarehouseImport(record),
    items: items.map(mapWarehouseImportItem),
  }
}

function getWarehouseImportRecord(importId: number, client: Database.Database) {
  return client.prepare("SELECT * FROM warehouse_imports WHERE id = ?").get(importId) as
    | Record<string, unknown>
    | undefined
}

function parseWarehouseImportRows(buffer: ArrayBuffer) {
  const workbook = XLSX.read(Buffer.from(buffer), { type: "buffer" })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error("В XLSX нет листов.")
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: false,
  })

  return rows
    .map((row, index) => normalizeWarehouseImportRow(row, index + 2))
    .filter((row) =>
      [
        row.code,
        row.name,
        row.article,
        row.categoryPath,
        row.unit,
        row.stockRaw,
        row.reservedRaw,
        row.salePriceRaw,
        row.costPriceRaw,
      ].some((value) => value.trim())
    )
}

function normalizeWarehouseImportRow(row: Record<string, unknown>, rowNumber: number): WarehouseImportRow {
  const stockRaw = cleanCell(row.stock)
  const reservedRaw = cleanCell(row.reserved)
  const salePriceRaw = cleanCell(row.sale_price)
  const costPriceRaw = cleanCell(row.cost_price)
  const stock = parseImportNumber(stockRaw)
  const reserved = parseImportNumber(reservedRaw)
  const salePrice = parseImportNumber(salePriceRaw)
  const costPrice = parseImportNumber(costPriceRaw)
  const errors: string[] = []

  if (!cleanCell(row.code)) {
    errors.push("code пустой")
  }
  if (!stockRaw) {
    errors.push("stock пустой")
  } else if (stock === null) {
    errors.push("stock не число")
  }
  if (reservedRaw && reserved === null) {
    errors.push("reserved не число")
  }
  if (salePriceRaw && salePrice === null) {
    errors.push("sale_price не число")
  }
  if (costPriceRaw && costPrice === null) {
    errors.push("cost_price не число")
  }

  return {
    rowNumber,
    code: cleanCell(row.code),
    name: cleanCell(row.name),
    article: cleanCell(row.article),
    categoryPath: cleanCell(row.category_path),
    unit: cleanCell(row.unit),
    stockRaw,
    reservedRaw,
    salePriceRaw,
    costPriceRaw,
    stock,
    reserved,
    salePrice,
    costPrice,
    reservedProvided: Boolean(reservedRaw),
    salePriceProvided: Boolean(salePriceRaw),
    costPriceProvided: Boolean(costPriceRaw),
    errors,
  }
}

function buildWarehouseImportReportItems(client: Database.Database, rows: WarehouseImportRow[]) {
  return rows.map((row): WarehouseImportReportItem => {
    const product = row.code ? getProduct(client, row.code) : undefined
    const errors = [...row.errors]

    if (!product && !row.name) {
      errors.push("name пустой для нового товара")
    }

    if (errors.length) {
      return withWarehouseImportComputedFields(row, product, "error", errors.join("; "))
    }

    const action = product
      ? isWarehouseImportRowChanged(row, product)
        ? "update"
        : "unchanged"
      : "create"

    return withWarehouseImportComputedFields(row, product, action, "")
  })
}

function withWarehouseImportComputedFields(
  row: WarehouseImportRow,
  product: ProductRow | undefined,
  action: WarehouseImportAction,
  error: string
): WarehouseImportReportItem {
  const oldStock = product ? numberFromRow(product.stock) : null
  const oldReserved = product ? numberFromRow(product.reserved) : null
  const oldSalePrice = product ? numberFromRow(product.sale_price) : null
  const oldCostPrice = product ? numberFromRow(product.cost_price) : null
  const newStock = row.stock
  const newReserved = product
    ? row.reservedProvided
      ? row.reserved
      : oldReserved
    : row.reservedProvided
      ? row.reserved
      : 0
  const newSalePrice = product
    ? row.salePriceProvided
      ? row.salePrice
      : oldSalePrice
    : row.salePriceProvided
      ? row.salePrice
      : 0
  const newCostPrice = product
    ? row.costPriceProvided
      ? row.costPrice
      : oldCostPrice
    : row.costPriceProvided
      ? row.costPrice
      : 0

  return {
    ...row,
    action,
    oldStock,
    newStock,
    stockDelta: oldStock === null || newStock === null ? newStock : newStock - oldStock,
    oldReserved,
    newReserved,
    oldSalePrice,
    newSalePrice,
    oldCostPrice,
    newCostPrice,
    error,
  }
}

function isWarehouseImportRowChanged(row: WarehouseImportRow, product: ProductRow) {
  if ((row.stock ?? 0) !== numberFromRow(product.stock)) {
    return true
  }
  if (row.reservedProvided && (row.reserved ?? 0) !== numberFromRow(product.reserved)) {
    return true
  }
  if (row.salePriceProvided && (row.salePrice ?? 0) !== numberFromRow(product.sale_price)) {
    return true
  }
  if (row.costPriceProvided && (row.costPrice ?? 0) !== numberFromRow(product.cost_price)) {
    return true
  }

  return Boolean(
    (row.name && row.name !== String(product.name ?? "")) ||
      (row.article && row.article !== String(product.article ?? "")) ||
      (row.categoryPath && row.categoryPath !== String(product.category_path ?? "")) ||
      (row.unit && row.unit !== String(product.unit ?? ""))
  )
}

function insertWarehouseImportItems(
  client: Database.Database,
  importId: number,
  items: WarehouseImportReportItem[]
) {
  const insert = client.prepare(
    `INSERT INTO warehouse_import_items (
      import_id, row_number, code, name, category_path, action, old_stock, new_stock, stock_delta,
      old_reserved, new_reserved, old_sale_price, new_sale_price, old_cost_price, new_cost_price, error
    ) VALUES (
      @importId, @rowNumber, @code, @name, @categoryPath, @action, @oldStock, @newStock, @stockDelta,
      @oldReserved, @newReserved, @oldSalePrice, @newSalePrice, @oldCostPrice, @newCostPrice, @error
    )`
  )

  for (const item of items) {
    insert.run({
      importId,
      rowNumber: item.rowNumber,
      code: item.code,
      name: item.name,
      categoryPath: item.categoryPath,
      action: item.action,
      oldStock: item.oldStock,
      newStock: item.newStock,
      stockDelta: item.stockDelta,
      oldReserved: item.oldReserved,
      newReserved: item.newReserved,
      oldSalePrice: item.oldSalePrice,
      newSalePrice: item.newSalePrice,
      oldCostPrice: item.oldCostPrice,
      newCostPrice: item.newCostPrice,
      error: item.error,
    })
  }
}

function countWarehouseImportItems(items: WarehouseImportReportItem[]) {
  return {
    created: items.filter((item) => item.action === "create").length,
    updated: items.filter((item) => item.action === "update").length,
    unchanged: items.filter((item) => item.action === "unchanged").length,
    errors: items.filter((item) => item.action === "error").length,
  }
}

function parseWarehouseImportReport(value: string): WarehouseImportReport {
  const parsed = JSON.parse(value) as WarehouseImportReport
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("Отчет импорта поврежден.")
  }

  return parsed
}

function cleanCell(value: unknown) {
  return String(value ?? "").trim()
}

function parseImportNumber(value: string) {
  if (!value.trim()) {
    return null
  }

  const normalized = value.replace(/\s/g, "").replace(",", ".")
  const number = Number(normalized)

  return Number.isFinite(number) ? number : null
}

function historyOperationsQuery(limit?: number) {
  return `SELECT
     movements.id,
     movements.user_id as userId,
     users.name as userName,
     movements.type,
     movements.product_code as productCode,
     movements.product_name as productName,
     movements.qty,
     movements.unit_price as unitPrice,
     movements.total,
     NULL as beforeStock,
     NULL as afterStock,
     NULL as beforeReserved,
     NULL as afterReserved,
     NULL as orderId,
     NULL as saleId,
     NULL as shiftId,
     NULL as documentId,
     NULL as documentNumber,
     COALESCE(movements.note, '') as note,
     movements.created_at as createdAt
   FROM movements
   LEFT JOIN users ON users.id = movements.user_id
   ORDER BY movements.created_at DESC, movements.id DESC${limit ? `\n   LIMIT ${limit}` : ""}`
}

function stockMovementsQuery(limit?: number) {
  return `SELECT
     stock_movements.id,
     stock_movements.user_id as userId,
     users.name as userName,
     stock_movements.type,
     stock_movements.product_code as productCode,
     products.name as productName,
     stock_movements.qty,
     NULL as unitPrice,
     NULL as total,
     stock_movements.before_stock as beforeStock,
     stock_movements.after_stock as afterStock,
     stock_movements.before_reserved as beforeReserved,
     stock_movements.after_reserved as afterReserved,
     stock_movements.order_id as orderId,
     stock_movements.sale_id as saleId,
     stock_movements.shift_id as shiftId,
     stock_movements.document_id as documentId,
     stock_documents.number as documentNumber,
     COALESCE(stock_movements.comment, '') as note,
     stock_movements.created_at as createdAt
   FROM stock_movements
   LEFT JOIN products ON products.code = stock_movements.product_code
   LEFT JOIN users ON users.id = stock_movements.user_id
   LEFT JOIN stock_documents ON stock_documents.id = stock_movements.document_id
   WHERE stock_movements.type NOT IN ('reserve', 'reserve_cancel')
   ORDER BY stock_movements.created_at DESC, stock_movements.id DESC${limit ? `\n   LIMIT ${limit}` : ""}`
}

export function upsertProduct(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const code = clean(formData.get("code"))
  const name = clean(formData.get("name"))
  const costPrice = toNumber(formData.get("costPrice"))
  const salePrice = toNumber(formData.get("salePrice"))

  if (!code || !name) {
    throw new Error("Код и название обязательны.")
  }
  if (costPrice < 0 || salePrice < 0) {
    throw new Error("Цены не могут быть отрицательными.")
  }

  const saveProduct = client.transaction(() => {
    const before = getProduct(client, code)
    const stock = before ? numberFromRow(before.stock) : toNumber(formData.get("stock"))
    const reserved = before ? numberFromRow(before.reserved) : toNumber(formData.get("reserved"))
    const expected = before ? numberFromRow(before.expected) : toNumber(formData.get("expected"))

    client
      .prepare(
        `INSERT INTO products (
          code, category_path, article, name, unit, stock, reserved, expected, cost_price, sale_price, updated_at
        ) VALUES (
          @code, @categoryPath, @article, @name, @unit, @stock, @reserved, @expected, @costPrice, @salePrice, CURRENT_TIMESTAMP
        )
        ON CONFLICT(code) DO UPDATE SET
          category_path = excluded.category_path,
          article = excluded.article,
          name = excluded.name,
          unit = excluded.unit,
          stock = excluded.stock,
          reserved = excluded.reserved,
          expected = excluded.expected,
          cost_price = excluded.cost_price,
          sale_price = excluded.sale_price,
          updated_at = CURRENT_TIMESTAMP`
      )
      .run({
        code,
        categoryPath: clean(formData.get("categoryPath")),
        article: clean(formData.get("article")),
        name,
        unit: clean(formData.get("unit")) || "шт",
        stock,
        reserved,
        expected,
        costPrice,
        salePrice,
      })

    const after = getProduct(client, code)
    const beforeStock = before ? numberFromRow(before.stock) : null
    const afterStock = after ? numberFromRow(after.stock) : null
    const beforeReserved = before ? numberFromRow(before.reserved) : null
    const afterReserved = after ? numberFromRow(after.reserved) : null

    if (beforeStock !== afterStock || beforeReserved !== afterReserved) {
      recordStockMovement(client, {
        productCode: code,
        userId: currentUser.id,
        type: "adjustment",
        qty: numberFromRow(after?.stock) - numberFromRow(before?.stock),
        beforeStock,
        afterStock,
        beforeReserved,
        afterReserved,
        comment: `Обновлен товар ${code}`,
      })
    }

    addMovement(client, {
      userId: currentUser.id,
      type: "stock_update",
      productCode: code,
      productName: name,
      note: `Обновлен товар ${code}`,
    })
  })

  saveProduct()
}

export function renameProductCategory(formData: FormData) {
  const client = db()
  const oldName = clean(formData.get("oldName"))
  const newName = clean(formData.get("newName"))

  if (!oldName || !newName) {
    throw new Error("Укажите старую и новую категорию.")
  }

  const rename = client.transaction(() => {
    const result = client
      .prepare("UPDATE products SET category_path = ?, updated_at = CURRENT_TIMESTAMP WHERE category_path = ?")
      .run(newName, oldName)

    return result.changes
  })

  return rename()
}

export function clearProductCategory(categoryPath: string) {
  const client = db()
  const name = clean(categoryPath)

  if (!name) {
    throw new Error("Категория не выбрана.")
  }

  const clear = client.transaction(() => {
    const result = client
      .prepare("UPDATE products SET category_path = '', updated_at = CURRENT_TIMESTAMP WHERE category_path = ?")
      .run(name)

    return result.changes
  })

  return clear()
}

export function deleteProduct(code: string, currentUser: CurrentUser) {
  const client = db()

  const removeProduct = client.transaction(() => {
    const product = getProduct(client, code)

    if (!product) {
      return
    }

    recordStockMovement(client, {
      productCode: code,
      userId: currentUser.id,
      type: "adjustment",
      qty: -numberFromRow(product.stock),
      beforeStock: numberFromRow(product.stock),
      afterStock: null,
      beforeReserved: numberFromRow(product.reserved),
      afterReserved: null,
      comment: "Товар удален из склада",
    })

    client.prepare("DELETE FROM products WHERE code = ?").run(code)
    addMovement(client, {
      userId: currentUser.id,
      type: "delete_product",
      productCode: code,
      productName: String(product.name),
      note: "Товар удален из склада",
    })
  })

  removeProduct()
}

function parsePositiveInteger(value: FormDataEntryValue | string | null | undefined, fieldName: string) {
  const raw = String(value ?? "").trim()
  const number = Number(raw)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${fieldName} должно быть целым числом от 1.`)
  }

  return number
}

function adjustProductStock(formData: FormData, direction: "in" | "out", currentUser: CurrentUser) {
  const client = db()
  const productCode = clean(formData.get("productCode"))
  const qty = parsePositiveInteger(formData.get("qty"), "Количество")
  const comment = clean(formData.get("comment"))

  if (!productCode) {
    throw new Error("Товар не выбран.")
  }

  const adjust = client.transaction(() => {
    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error("Товар не найден.")
    }

    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    const stockDelta = direction === "in" ? qty : -qty
    const afterStock = beforeStock + stockDelta
    const operation = direction === "in" ? "Пополнение" : "Списание"

    client
      .prepare("UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?")
      .run(afterStock, productCode)

    recordStockMovement(client, {
      productCode,
      userId: currentUser.id,
      type: "adjustment",
      qty: stockDelta,
      beforeStock,
      afterStock,
      beforeReserved,
      afterReserved: beforeReserved,
      comment: `${operation}: ${comment}`,
    })
  })

  adjust()
}

export function replenishProductStock(formData: FormData, currentUser: CurrentUser) {
  adjustProductStock(formData, "in", currentUser)
}

export function writeOffProductStock(formData: FormData, currentUser: CurrentUser) {
  adjustProductStock(formData, "out", currentUser)
}

function parseStockDocumentType(value: string): StockDocumentType {
  if (value !== "stock_in" && value !== "stock_out") {
    throw new Error("Некорректный тип акта склада.")
  }

  return value
}

export function generateStockDocumentNumber(type: StockDocumentType) {
  const client = db()
  const prefix = type === "stock_in" ? "IN" : "OUT"
  const row = client
    .prepare("SELECT number FROM stock_documents WHERE type = ? AND number LIKE ? ORDER BY id DESC LIMIT 1")
    .get(type, `${prefix}-%`) as { number: string } | undefined
  const lastSequence = row?.number ? Number(row.number.slice(prefix.length + 1)) : 0
  const nextSequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1

  return `${prefix}-${String(nextSequence).padStart(6, "0")}`
}

function generateStockDocumentNumberInTransaction(client: Database.Database, type: StockDocumentType) {
  const prefix = type === "stock_in" ? "IN" : "OUT"
  const row = client
    .prepare("SELECT number FROM stock_documents WHERE type = ? AND number LIKE ? ORDER BY id DESC LIMIT 1")
    .get(type, `${prefix}-%`) as { number: string } | undefined
  const lastSequence = row?.number ? Number(row.number.slice(prefix.length + 1)) : 0
  const nextSequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1

  return `${prefix}-${String(nextSequence).padStart(6, "0")}`
}

function buildStockDocumentItems(formData: FormData) {
  const productCodes = formData.getAll("itemProductCode").map((value) => clean(value))
  const qtyValues = formData.getAll("itemQty")
  const commentValues = formData.getAll("itemComment")

  if (!productCodes.length || productCodes.every((code) => !code)) {
    throw new Error("Добавьте в акт хотя бы один товар.")
  }

  return productCodes.map((productCode, index) => {
    if (!productCode) {
      throw new Error("У каждой позиции акта должен быть товар.")
    }

    return {
      productCode,
      qty: parsePositiveInteger(qtyValues[index], "Количество"),
      comment: clean(commentValues[index]),
    }
  })
}

function getSupplierSnapshot(client: Database.Database, type: StockDocumentType, supplierId: number | null) {
  if (type !== "stock_in" || !supplierId) {
    return { supplierId: null, supplierName: "" }
  }

  const supplier = client.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId) as
    | Record<string, unknown>
    | undefined
  if (!supplier) {
    throw new Error("Поставщик не найден.")
  }

  return { supplierId, supplierName: String(supplier.name ?? "") }
}

function saveStockDocumentDraftInTransaction(
  client: Database.Database,
  input: {
    documentId?: number | null
    type: StockDocumentType
    formData: FormData
    currentUser: CurrentUser
  }
) {
  const documentType = parseStockDocumentType(input.type)
  const parsedItems = buildStockDocumentItems(input.formData)
  const comment = clean(input.formData.get("comment"))
  const operationAt = fromDatetimeLocalValue(input.formData.get("operationAt"))
  const supplierIdValue = Number(clean(input.formData.get("supplierId")))
  const supplier = getSupplierSnapshot(
    client,
    documentType,
    Number.isInteger(supplierIdValue) && supplierIdValue > 0 ? supplierIdValue : null
  )
  let documentId = input.documentId ?? null

  if (documentId) {
    const existing = client.prepare("SELECT * FROM stock_documents WHERE id = ?").get(documentId) as
      | Record<string, unknown>
      | undefined
    if (!existing) {
      throw new Error("Акт склада не найден.")
    }
    if (String(existing.status) !== "draft") {
      throw new Error("Можно редактировать только черновик акта.")
    }

    client
      .prepare(
        `UPDATE stock_documents
         SET type = ?, supplier_id = ?, supplier_name = ?, comment = ?, operation_at = ?
         WHERE id = ?`
      )
      .run(documentType, supplier.supplierId, supplier.supplierName, comment, operationAt, documentId)
    client.prepare("DELETE FROM stock_document_items WHERE document_id = ?").run(documentId)
  } else {
    const documentNumber = generateStockDocumentNumberInTransaction(client, documentType)
    const document = client
      .prepare(
        `INSERT INTO stock_documents (
          number, type, status, supplier_id, supplier_name, comment, operation_at, created_by_user_id, created_by_name
        ) VALUES (
          @number, @type, 'draft', @supplierId, @supplierName, @comment, @operationAt, @createdByUserId, @createdByName
        )`
      )
      .run({
        number: documentNumber,
        type: documentType,
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        comment,
        operationAt,
        createdByUserId: input.currentUser.id,
        createdByName: input.currentUser.name,
      })
    documentId = Number(document.lastInsertRowid)
  }

  const insertItem = client.prepare(
    `INSERT INTO stock_document_items (
      document_id, product_code, product_name, qty, comment
    ) VALUES (
      @documentId, @productCode, @productName, @qty, @comment
    )`
  )

  for (const item of parsedItems) {
    const product = getProduct(client, item.productCode)
    if (!product) {
      throw new Error(`Товар ${item.productCode} не найден.`)
    }

    insertItem.run({
      documentId,
      productCode: item.productCode,
      productName: String(product.name),
      qty: item.qty,
      comment: item.comment,
    })
  }

  return documentId
}

function postStockDocumentInTransaction(client: Database.Database, documentId: number, currentUser: CurrentUser) {
  const document = client.prepare("SELECT * FROM stock_documents WHERE id = ?").get(documentId) as
    | Record<string, unknown>
    | undefined
  if (!document) {
    throw new Error("Акт склада не найден.")
  }
  if (String(document.status) !== "draft") {
    throw new Error("Можно провести только черновик акта.")
  }

  const type = parseStockDocumentType(String(document.type))
  const items = client
    .prepare("SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY id")
    .all(documentId) as Array<Record<string, unknown>>
  if (!items.length) {
    throw new Error("В акте нет позиций.")
  }

  for (const item of items) {
    const productCode = String(item.product_code)
    const qty = parsePositiveInteger(String(item.qty), "Количество")
    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }

    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    const movementQty = type === "stock_in" ? qty : -qty
    const afterStock = beforeStock + movementQty

    client
      .prepare("UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?")
      .run(afterStock, productCode)
    client
      .prepare("UPDATE stock_document_items SET before_stock = ?, after_stock = ? WHERE id = ?")
      .run(beforeStock, afterStock, item.id)

    recordStockMovement(client, {
      productCode,
      type,
      qty: movementQty,
      beforeStock,
      afterStock,
      beforeReserved,
      afterReserved: beforeReserved,
      documentId,
      userId: currentUser.id,
      comment: `Акт ${String(document.number)}`,
    })
  }

  client
    .prepare(
      `UPDATE stock_documents
       SET status = 'posted',
           posted_by_user_id = ?,
           posted_by_name = ?,
           operation_at = COALESCE(NULLIF(operation_at, ''), CURRENT_TIMESTAMP),
           posted_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(currentUser.id, currentUser.name, documentId)
}

export function saveStockDocumentDraft(formData: FormData, type: StockDocumentType, currentUser: CurrentUser) {
  const client = db()
  const rawDocumentId = Number(clean(formData.get("documentId")))
  const documentId = Number.isInteger(rawDocumentId) && rawDocumentId > 0 ? rawDocumentId : null
  const saveDraft = client.transaction(() =>
    saveStockDocumentDraftInTransaction(client, {
      documentId,
      type,
      formData,
      currentUser,
    })
  )

  return saveDraft()
}

export function createStockDocumentDraft(type: StockDocumentType, comment: string, items: FormData, currentUser: CurrentUser) {
  items.set("comment", comment)
  return saveStockDocumentDraft(items, type, currentUser)
}

export function postStockDocument(documentId: number, currentUser: CurrentUser) {
  const client = db()
  const postDocument = client.transaction(() => postStockDocumentInTransaction(client, documentId, currentUser))

  postDocument()
}

export function createAndPostStockDocument(formData: FormData, type: StockDocumentType, currentUser: CurrentUser) {
  const client = db()
  const rawDocumentId = Number(clean(formData.get("documentId")))
  const documentId = Number.isInteger(rawDocumentId) && rawDocumentId > 0 ? rawDocumentId : null
  const createAndPost = client.transaction(() => {
    const savedDocumentId = saveStockDocumentDraftInTransaction(client, {
      documentId,
      type,
      formData,
      currentUser,
    })
    postStockDocumentInTransaction(client, savedDocumentId, currentUser)

    return savedDocumentId
  })

  return createAndPost()
}

export function cancelStockDocument(documentId: number) {
  const client = db()

  const cancelDocument = client.transaction(() => {
    const document = client.prepare("SELECT status FROM stock_documents WHERE id = ?").get(documentId) as
      | { status: string }
      | undefined
    if (!document) {
      throw new Error("Акт склада не найден.")
    }
    if (document.status === "posted") {
      throw new Error("Проведенный акт нельзя отменить. Создайте обратный акт.")
    }
    if (document.status === "cancelled") {
      return
    }

    client
      .prepare("UPDATE stock_documents SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(documentId)
  })

  cancelDocument()
}

function buildSaleItems(client: Database.Database, formData: FormData) {
  const multiProductCodes = formData.getAll("itemProductCode").map((value) => clean(value))
  const productCodes = multiProductCodes.length ? multiProductCodes : [clean(formData.get("productCode"))]
  const qtyValues = multiProductCodes.length ? formData.getAll("itemQty") : [formData.get("qty")]
  const priceValues = multiProductCodes.length ? formData.getAll("itemPrice") : [formData.get("price")]
  const discountTypes = multiProductCodes.length ? formData.getAll("itemDiscountType") : [formData.get("itemDiscountType")]
  const discountValues = multiProductCodes.length ? formData.getAll("itemDiscountValue") : [formData.get("itemDiscountValue")]

  if (!productCodes.length || productCodes.every((code) => !code)) {
    throw new Error("Добавьте в продажу хотя бы одну позицию со склада.")
  }

  return productCodes.map((productCode, index) => {
    if (!productCode) {
      throw new Error("У каждой позиции продажи должен быть товар со склада.")
    }

    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }

    const qty = toNumber(qtyValues[index])
    if (qty <= 0) {
      throw new Error("Количество в каждой позиции продажи должно быть больше нуля.")
    }

    const explicitPrice = toOptionalNumber(priceValues[index])
    if (explicitPrice !== null && explicitPrice < 0) {
      throw new Error("Цена продажи не может быть отрицательной.")
    }

    const unitPrice = explicitPrice ?? numberFromRow(product.sale_price)
    const discountType = normalizeDiscountType(clean(discountTypes[index] ?? null))
    const discountValue = Math.max(0, toNumber(discountValues[index]))
    const totals = calculateLineTotal({
      qty,
      price: unitPrice,
      discountType,
      discountValue,
    })

    return {
      productCode,
      product,
      qty,
      unitPrice,
      price: unitPrice,
      discountType,
      discountValue: discountType === "none" ? 0 : discountValue,
      discountAmount: totals.discountAmount,
      totalBeforeDiscount: totals.totalBeforeDiscount,
      total: totals.total,
    }
  })
}

function resolveCashCustomer(client: Database.Database, formData: FormData) {
  const customerId = toNumber(formData.get("customerId"))
  if (!customerId) {
    return {
      id: null,
      name: clean(formData.get("customer")) || clean(formData.get("customerName")),
      phone: clean(formData.get("phone")) || clean(formData.get("customerPhone")),
    }
  }

  const customer = client.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as
    | Record<string, unknown>
    | undefined

  if (!customer) {
    throw new Error("Клиент не найден.")
  }

  return {
    id: numberFromRow(customer.id),
    name: String(customer.name ?? ""),
    phone: String(customer.phone ?? ""),
  }
}

export function createSale(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const note = clean(formData.get("note"))

  const saveSale = client.transaction(() => {
    const shift = requireOpenShift(client)
    const items = buildSaleItems(client, formData)
    const customer = resolveCashCustomer(client, formData)
    const saleDiscountType = normalizeDiscountType(clean(formData.get("saleDiscountType")))
    const saleDiscountValue = saleDiscountType === "none" ? 0 : Math.max(0, toNumber(formData.get("saleDiscountValue")))
    const totals = calculateCommercialTotals(items, saleDiscountType, saleDiscountValue)
    const total = totals.total
    const sale = client
      .prepare(
        `INSERT INTO sales (
          shift_id, user_id, payment_method, customer_id, customer_name, customer_phone,
          items_total_before_discount, items_discount_total, sale_discount_type, sale_discount_value,
          sale_discount_amount, total_before_discount, total, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        shift.id,
        currentUser.id,
        paymentMethod,
        customer.id,
        customer.name,
        customer.phone,
        totals.itemsTotalBeforeDiscount,
        totals.itemsDiscountTotal,
        saleDiscountType,
        saleDiscountValue,
        totals.dealDiscountAmount,
        totals.itemsTotalBeforeDiscount,
        total,
        note
      )
    const saleId = Number(sale.lastInsertRowid)

    const insertItem = client.prepare(
      `INSERT INTO sale_items (
        sale_id, product_code, qty, unit_price, discount_type, discount_value,
        discount_amount, total_before_discount, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const item of items) {
      insertItem.run(
        saleId,
        item.productCode,
        item.qty,
        item.unitPrice,
        item.discountType,
        item.discountValue,
        item.discountAmount,
        item.totalBeforeDiscount,
        item.total
      )
      applyProductDelta(client, {
        productCode: item.productCode,
        stockDelta: -item.qty,
        type: "sale",
        qty: -item.qty,
        saleId,
        shiftId: shift.id,
        userId: currentUser.id,
        comment: note || "Продажа на кассе",
      })
      addMovement(client, {
        userId: currentUser.id,
        type: "sale",
        productCode: item.productCode,
        productName: String(item.product.name),
        qty: -item.qty,
        unitPrice: item.unitPrice,
        total: item.total,
        note: note || "Продажа на кассе",
      })
    }
    if (total > 0) {
      recordCashTransaction(client, {
        shiftId: shift.id,
        saleId,
        customerId: customer.id,
        userId: currentUser.id,
        type: "sale",
        paymentMethod,
        amount: total,
        comment: note || "Продажа на кассе",
      })
    }
  })

  saveSale()
}

export function openShift(formData: FormData, currentUser: CurrentUser) {
  const client = db()

  const startShift = client.transaction(() => {
    const opened = getOpenShift(client)

    if (opened) {
      throw new Error("Открытая смена уже есть.")
    }

    const rawOpeningCash = clean(formData.get("openingCash"))
    const cash = rawOpeningCash ? toNumber(rawOpeningCash) : getDefaultOpeningCash(client)
    const defaultOpeningCash = getDefaultOpeningCash(client)
    const cashierName = currentUser.name
    const note = clean(formData.get("note"))

    if (Math.abs(cash - defaultOpeningCash) >= 0.01 && !note) {
      throw new Error("Укажите комментарий, если начальная наличка отличается от прошлой закрытой смены.")
    }

    const shift = client
      .prepare(
        `INSERT INTO shifts (opening_cash, cashier_name, note, user_id, opened_by_user_id, type)
         VALUES (?, ?, ?, ?, ?, 'day')`
      )
      .run(cash, cashierName, note, currentUser.id, currentUser.id)

    addMovement(client, {
      userId: currentUser.id,
      type: "shift_open",
      total: cash,
      note: `Открыта смена #${shift.lastInsertRowid}: ${cashierName}`,
    })
  })

  startShift()
}

export function closeShift(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const shiftId = Number(clean(formData.get("shiftId")))
  const rawClosingCash = clean(formData.get("closingCash"))
  const cash = toNumber(rawClosingCash)
  const note = clean(formData.get("note"))
  const openNightShift = clean(formData.get("openNightShift")) === "1"
  const nightFloristId = Number(clean(formData.get("nightFloristId")))

  if (!shiftId) {
    throw new Error("Смена не выбрана.")
  }

  const finishShift = client.transaction(() => {
    if (openNightShift) {
      if (currentUser.role !== "manager") {
        throw new Error("Ночную смену может открыть только менеджер при закрытии своей смены.")
      }

      if (!rawClosingCash) {
        throw new Error("Введите фактическую наличку для открытия ночной смены.")
      }

      if (!nightFloristId) {
        throw new Error("Выберите флориста для ночной смены.")
      }

      const closingShift = getShiftAccessInfo(shiftId)
      if (!closingShift || closingShift.status !== "open") {
        throw new Error("Открытая смена не найдена.")
      }

      if (closingShift.type !== "day" || closingShift.userId !== currentUser.id) {
        throw new Error("Ночную смену можно открыть только при закрытии своей дневной смены.")
      }

      const otherOpenShift = client
        .prepare("SELECT id FROM shifts WHERE status = 'open' AND id <> ? LIMIT 1")
        .get(shiftId) as { id: number } | undefined

      if (otherOpenShift) {
        throw new Error("Открытая смена уже есть.")
      }
    }

    const summary = calculateShiftSummary(shiftId, client)
    if (Math.abs(cash - summary.expectedCash) >= 0.01 && !note) {
      throw new Error("Укажите комментарий, если фактическая наличка отличается от ожидаемой.")
    }

    const result = client
      .prepare(
        `UPDATE shifts
         SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closing_cash = ?, note = ?,
          closed_by_user_id = ?
         WHERE id = ? AND status = 'open'`
      )
      .run(cash, note, currentUser.id, shiftId)

    if (result.changes === 0) {
      throw new Error("Открытая смена не найдена.")
    }

    addMovement(client, {
      userId: currentUser.id,
      type: "shift_close",
      total: cash,
      note: `Закрыта смена #${shiftId}`,
    })

    if (openNightShift) {
      const florist = getActiveFloristById(nightFloristId, client)
      if (!florist) {
        throw new Error("Флорист не найден или неактивен.")
      }

      const opened = getOpenShift(client)
      if (opened) {
        throw new Error("Открытая смена уже есть.")
      }

      const nightShift = client
        .prepare(
          `INSERT INTO shifts (
            opening_cash, cashier_name, note, user_id, opened_by_user_id, type
          ) VALUES (
            ?, ?, ?, ?, ?, 'night'
          )`
        )
        .run(cash, florist.name, "Ночная смена", florist.id, currentUser.id)

      addMovement(client, {
        userId: currentUser.id,
        type: "shift_open",
        total: cash,
        note: `Открыта ночная смена #${nightShift.lastInsertRowid}: ${florist.name}`,
      })
    }
  })

  finishShift()
}

function recordManualCash(formData: FormData, type: "cash_in" | "cash_out", currentUser: CurrentUser) {
  const client = db()
  const amount = toNumber(formData.get("amount"))
  const comment = clean(formData.get("comment"))

  if (amount <= 0) {
    throw new Error("Сумма должна быть больше нуля.")
  }

  const record = client.transaction(() => {
    const shift = requireOpenShift(client)
    recordCashTransaction(client, {
      shiftId: shift.id,
      userId: currentUser.id,
      type,
      paymentMethod: "cash",
      amount,
      comment,
    })
  })

  record()
}

export function cashIn(formData: FormData, currentUser: CurrentUser) {
  recordManualCash(formData, "cash_in", currentUser)
}

export function cashOut(formData: FormData, currentUser: CurrentUser) {
  recordManualCash(formData, "cash_out", currentUser)
}

function buildOrderItems(client: Database.Database, formData: FormData) {
  const productCodes = formData.getAll("itemProductCode").map((value) => clean(value))
  const qtyValues = formData.getAll("itemQty")
  const priceValues = formData.getAll("itemPrice")
  const discountTypes = formData.getAll("itemDiscountType")
  const discountValues = formData.getAll("itemDiscountValue")

  if (!productCodes.length || productCodes.every((code) => !code)) {
    throw new Error("Добавьте в заказ хотя бы одну позицию со склада.")
  }

  return productCodes.map((productCode, index) => {
    if (!productCode) {
      throw new Error("У каждой позиции заказа должен быть товар со склада.")
    }

    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }

    const qty = toNumber(qtyValues[index]) || 0
    if (qty <= 0) {
      throw new Error("Количество в каждой позиции заказа должно быть больше нуля.")
    }

    const explicitPrice = toOptionalNumber(priceValues[index])
    if (explicitPrice !== null && explicitPrice < 0) {
      throw new Error("Цена позиции заказа не может быть отрицательной.")
    }

    const price = explicitPrice ?? numberFromRow(product.sale_price)
    const discountType = normalizeDiscountType(clean(discountTypes[index] ?? null))
    const discountValue = discountType === "none" ? 0 : Math.max(0, toNumber(discountValues[index]))
    const totals = calculateLineTotal({
      qty,
      price,
      discountType,
      discountValue,
    })

    return {
      productCode,
      name: String(product.name),
      qty,
      price,
      discountType,
      discountValue,
      discountAmount: totals.discountAmount,
      totalBeforeDiscount: totals.totalBeforeDiscount,
      total: totals.total,
    }
  })
}

export function createOrder(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const customerSnapshot = resolveCashCustomer(client, formData)
  const customer = customerSnapshot.name || clean(formData.get("customer")) || clean(formData.get("customer_name"))
  const phone = customerSnapshot.phone || clean(formData.get("phone"))
  const dueAt = clean(formData.get("dueAt"))
  const deliveryType = clean(formData.get("deliveryType")) || "pickup"
  const address = clean(formData.get("address"))
  const deliveryPrice = toNumber(formData.get("deliveryPrice"))
  const courierPayout = toNumber(formData.get("courierPayout"))
  const prepaid = toNumber(formData.get("prepaid"))
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const orderDiscountType = normalizeDiscountType(clean(formData.get("orderDiscountType")))
  const orderDiscountValue = orderDiscountType === "none" ? 0 : Math.max(0, toNumber(formData.get("orderDiscountValue")))
  const note = clean(formData.get("note"))

  if (!customer) {
    throw new Error("Укажите имя клиента.")
  }

  if (prepaid < 0) {
    throw new Error("Предоплата не может быть отрицательной.")
  }

  if (!["pickup", "delivery"].includes(deliveryType)) {
    throw new Error("Некорректный тип получения.")
  }

  if (deliveryPrice < 0 || courierPayout < 0) {
    throw new Error("Доставка и выплата курьеру не могут быть отрицательными.")
  }

  const saveOrder = client.transaction(() => {
    const items = buildOrderItems(client, formData)
    const totals = calculateCommercialTotals(items, orderDiscountType, orderDiscountValue)
    const total = totals.total + deliveryPrice

    if (prepaid > total && total >= 0) {
      throw new Error("Предоплата не может быть больше суммы заказа.")
    }

    const shift = prepaid > 0 ? requireOpenShift(client) : null
    const order = client
      .prepare(
        `INSERT INTO orders (
          created_by_user_id, updated_by_user_id, customer_id, customer, phone, source, delivery_type, address,
          due_at, status, items_total_before_discount, items_discount_total, order_discount_type,
          order_discount_value, order_discount_amount, total_before_discount, total, prepaid, paid,
          delivery_price, courier_payout, is_reserved, note, updated_at
        ) VALUES (
          @createdByUserId, @updatedByUserId, @customerId, @customer, @phone, @source, @deliveryType, @address,
          @dueAt, 'Новый', @itemsTotalBeforeDiscount, @itemsDiscountTotal, @orderDiscountType,
          @orderDiscountValue, @orderDiscountAmount, @totalBeforeDiscount, @total, @prepaid, @paid,
          @deliveryPrice, @courierPayout, 1, @note, CURRENT_TIMESTAMP
        )`
      )
      .run({
        createdByUserId: currentUser.id,
        updatedByUserId: currentUser.id,
        customerId: customerSnapshot.id,
        customer,
        phone,
        source: clean(formData.get("source")),
        deliveryType,
        address: deliveryType === "delivery" ? address : "",
        dueAt,
        itemsTotalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        itemsDiscountTotal: totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountAmount: totals.dealDiscountAmount,
        totalBeforeDiscount: totals.itemsTotalBeforeDiscount + deliveryPrice,
        total,
        prepaid,
        paid: prepaid,
        deliveryPrice,
        courierPayout,
        note,
      })
    const orderId = Number(order.lastInsertRowid)
    const number = generateOrderNumber(orderId)

    client.prepare("UPDATE orders SET number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(number, orderId)

    const insertItem = client.prepare(
      `INSERT INTO order_items (
        order_id, product_code, name, qty, price, discount_type, discount_value,
        discount_amount, total_before_discount, total, is_custom
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const item of items) {
      insertItem.run(
        orderId,
        item.productCode,
        item.name,
        item.qty,
        item.price,
        item.discountType,
        item.discountValue,
        item.discountAmount,
        item.totalBeforeDiscount,
        item.total,
        0
      )
      applyProductDelta(client, {
        productCode: item.productCode,
        reservedDelta: item.qty,
        type: "reserve",
        qty: item.qty,
        orderId,
        userId: currentUser.id,
        comment: "Резерв при создании заказа",
      })
    }

    if (shift && prepaid > 0) {
      recordCashTransaction(client, {
        shiftId: shift.id,
        orderId,
        customerId: customerSnapshot.id,
        userId: currentUser.id,
        type: "prepayment",
        paymentMethod,
        amount: prepaid,
        comment: `Предоплата по заказу ${number}`,
      })
    }

    addMovement(client, {
      userId: currentUser.id,
      type: "order_create",
      total,
      note: `Создан заказ ${number}: ${customer}`,
    })
  })

  saveOrder()
}

export function createOrderFromDeal(dealId: number, currentUser: CurrentUser) {
  const client = db()

  if (!dealId) {
    throw new Error("Сделка не найдена.")
  }

  const create = client.transaction(() => {
    const deal = client.prepare("SELECT * FROM deals WHERE id = ?").get(dealId) as
      | Record<string, unknown>
      | undefined

    if (!deal) {
      throw new Error("Сделка не найдена.")
    }

    const existingOrderId = numberFromRow(deal.order_id)
    if (existingOrderId > 0) {
      return existingOrderId
    }

    const dealItems = client
      .prepare(
        `SELECT id, product_code as productCode, product_name as productName,
          qty, price, COALESCE(discount_type, 'none') as discountType,
          COALESCE(discount_value, 0) as discountValue
         FROM deal_items
         WHERE deal_id = ?
         ORDER BY id ASC`
      )
      .all(dealId) as Array<Record<string, unknown>>

    if (!dealItems.length) {
      throw new Error("Добавьте товары в сделку перед созданием заказа")
    }

    const items = dealItems.map((item) => {
      const productCode = String(item.productCode ?? "")
      if (!getProduct(client, productCode)) {
        throw new Error(`Товар ${productCode} не найден.`)
      }

      const qty = numberFromRow(item.qty)
      if (qty <= 0) {
        throw new Error("Количество в каждой позиции сделки должно быть больше нуля.")
      }

      const discountType = normalizeDiscountType(String(item.discountType ?? "none"))
      const discountValue = discountType === "none" ? 0 : Math.max(0, numberFromRow(item.discountValue))
      const line = calculateLineTotal({
        qty,
        price: numberFromRow(item.price),
        discountType,
        discountValue,
      })

      return {
        id: numberFromRow(item.id),
        productCode,
        name: String(item.productName ?? productCode),
        qty,
        price: numberFromRow(item.price),
        discountType,
        discountValue,
        discountAmount: line.discountAmount,
        totalBeforeDiscount: line.totalBeforeDiscount,
        total: line.total,
      }
    })

    const orderDiscountType = normalizeDiscountType(String(deal.deal_discount_type ?? "none"))
    const orderDiscountValue =
      orderDiscountType === "none" ? 0 : Math.max(0, numberFromRow(deal.deal_discount_value))
    const totals = calculateCommercialTotals(items, orderDiscountType, orderDiscountValue)
    const paid = Math.max(0, numberFromRow(deal.paid))
    if (paid - totals.total > 0.009) {
      throw new Error("Оплата по сделке не может быть больше суммы заказа.")
    }
    const customer = cleanRowString(deal.customer_name) || "Клиент сделки"
    const phone = cleanRowString(deal.customer_phone)
    const deliveryType = cleanRowString(deal.delivery_type) || "pickup"
    const address = cleanRowString(deal.address)
    const note = cleanRowString(deal.comment)

    const order = client
      .prepare(
        `INSERT INTO orders (
          created_by_user_id, updated_by_user_id, customer_id, deal_id, customer, phone, source,
          delivery_type, address, due_at, status, items_total_before_discount, items_discount_total,
          order_discount_type, order_discount_value, order_discount_amount, total_before_discount,
          total, prepaid, paid, delivery_price, courier_payout, is_reserved, note, updated_at
        ) VALUES (
          @createdByUserId, @updatedByUserId, @customerId, @dealId, @customer, @phone, 'deal',
          @deliveryType, @address, @dueAt, 'Новый', @itemsTotalBeforeDiscount, @itemsDiscountTotal,
          @orderDiscountType, @orderDiscountValue, @orderDiscountAmount, @totalBeforeDiscount,
          @total, @prepaid, @paid, 0, 0, 1, @note, CURRENT_TIMESTAMP
        )`
      )
      .run({
        createdByUserId: currentUser.id,
        updatedByUserId: currentUser.id,
        customerId: deal.customer_id === null || deal.customer_id === undefined ? null : numberFromRow(deal.customer_id),
        dealId,
        customer,
        phone,
        deliveryType,
        address,
        dueAt: cleanRowString(deal.due_at),
        itemsTotalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        itemsDiscountTotal: totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountAmount: totals.dealDiscountAmount,
        totalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        total: totals.total,
        prepaid: paid,
        paid,
        note,
      })
    const orderId = Number(order.lastInsertRowid)
    const number = generateOrderNumber(orderId)

    client.prepare("UPDATE orders SET number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(number, orderId)

    const insertItem = client.prepare(
      `INSERT INTO order_items (
        order_id, product_code, name, qty, price, discount_type, discount_value,
        discount_amount, total_before_discount, total, is_custom
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    const updateDealItem = client.prepare(
      `UPDATE deal_items
       SET discount_amount = ?, total_before_discount = ?, total = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )

    for (const item of items) {
      insertItem.run(
        orderId,
        item.productCode,
        item.name,
        item.qty,
        item.price,
        item.discountType,
        item.discountValue,
        item.discountAmount,
        item.totalBeforeDiscount,
        item.total
      )
      updateDealItem.run(item.discountAmount, item.totalBeforeDiscount, item.total, item.id)
      applyProductDelta(client, {
        productCode: item.productCode,
        reservedDelta: item.qty,
        type: "reserve",
        qty: item.qty,
        orderId,
        userId: currentUser.id,
        comment: "Резерв при создании заказа из сделки",
      })
    }

    const orderStage = client
      .prepare(
        `SELECT id FROM deal_stages
         WHERE name = 'Оформлен заказ' COLLATE NOCASE
          AND (pipeline_id = ? OR ? IS NULL)
         ORDER BY pipeline_id = ? DESC, position ASC
         LIMIT 1`
      )
      .get(deal.pipeline_id ?? null, deal.pipeline_id ?? null, deal.pipeline_id ?? null) as
      | { id: number }
      | undefined

    client
      .prepare(
        `UPDATE deals
         SET order_id = ?, stage_id = COALESCE(?, stage_id),
          items_total = ?, items_discount_total = ?, deal_discount_type = ?,
          deal_discount_value = ?, deal_discount_amount = ?, total = ?,
          paid = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(
        orderId,
        orderStage?.id ?? null,
        totals.itemsTotalBeforeDiscount,
        totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        totals.dealDiscountAmount,
        totals.total,
        paid,
        dealId
      )

    addMovement(client, {
      userId: currentUser.id,
      type: "order_create",
      total: totals.total,
      note: `Создан заказ ${number} из сделки ${String(deal.number ?? `#${dealId}`)}: ${customer}`,
    })

    return orderId
  })

  return create()
}

export function acceptDealPayment(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const dealId = toNumber(formData.get("dealId"))
  const amount = toNumber(formData.get("amount"))
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const comment = clean(formData.get("comment"))

  if (!dealId) {
    throw new Error("Сделка не найдена.")
  }

  if (amount <= 0) {
    throw new Error("Сумма оплаты должна быть больше нуля.")
  }

  const accept = client.transaction(() => {
    const shift = requireOpenShift(client)
    const deal = client.prepare("SELECT * FROM deals WHERE id = ?").get(dealId) as
      | Record<string, unknown>
      | undefined

    if (!deal) {
      throw new Error("Сделка не найдена.")
    }

    const total = numberFromRow(deal.total)
    const paid = numberFromRow(deal.paid)
    const balance = Math.max(0, total - paid)

    if (balance <= 0) {
      throw new Error("Сделка уже оплачена.")
    }

    if (amount - balance > 0.009) {
      throw new Error("Сумма оплаты не может быть больше остатка.")
    }

    const orderId = numberFromRow(deal.order_id) || null
    const customerId = numberFromRow(deal.customer_id) || null
    let paymentLimit = balance

    if (orderId) {
      const order = client.prepare("SELECT total, paid FROM orders WHERE id = ?").get(orderId) as
        | { total: number; paid: number }
        | undefined
      if (!order) {
        throw new Error("Заказ по сделке не найден.")
      }

      const orderBalance = Math.max(0, numberFromRow(order.total) - numberFromRow(order.paid))
      if (orderBalance <= 0) {
        throw new Error("Заказ уже оплачен.")
      }

      paymentLimit = Math.min(paymentLimit, orderBalance)
    }

    if (amount - paymentLimit > 0.009) {
      throw new Error("Сумма оплаты не может быть больше остатка.")
    }

    recordCashTransaction(client, {
      shiftId: shift.id,
      orderId,
      customerId,
      dealId,
      userId: currentUser.id,
      type: "deal_payment",
      paymentMethod,
      amount,
      comment: comment || `Оплата по сделке ${String(deal.number ?? `#${dealId}`)}`,
    })

    client
      .prepare("UPDATE deals SET paid = COALESCE(paid, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(amount, dealId)

    if (orderId) {
      client
        .prepare(
          `UPDATE orders
           SET paid = COALESCE(paid, 0) + ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(amount, currentUser.id, orderId)
    }
  })

  accept()
}

function getOrderWithItems(client: Database.Database, orderId: number) {
  const order = client.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as
    | Record<string, unknown>
    | undefined

  if (!order) {
    throw new Error("Заказ не найден.")
  }

  const items = client
    .prepare("SELECT * FROM order_items WHERE order_id = ?")
    .all(orderId) as Array<{ product_code: string | null; qty: number; name: string }>

  if (items.some((item) => !item.product_code)) {
    throw new Error("В заказе есть позиция без product_code. Новые операции доступны только для товаров со склада.")
  }

  return {
    order: {
      ...order,
      status: normalizeOrderStatus(order.status),
    } as Record<string, unknown> & { status: OrderStatus },
    items: items as Array<{ product_code: string; qty: number; name: string }>,
  }
}

function cancelOrderReserve(
  client: Database.Database,
  orderId: number,
  items: Array<{ product_code: string; qty: number; name: string }>,
  currentUser: CurrentUser
) {
  for (const item of items) {
    applyProductDelta(client, {
      productCode: item.product_code,
      reservedDelta: -numberFromRow(item.qty),
      type: "reserve_cancel",
      qty: -numberFromRow(item.qty),
      orderId,
      userId: currentUser.id,
      comment: "Отмена резерва при отмене заказа",
    })
  }
}

function fulfillOrderItems(
  client: Database.Database,
  orderId: number,
  items: Array<{ product_code: string; qty: number; name: string }>,
  wasReserved: boolean,
  currentUser: CurrentUser
) {
  for (const item of items) {
    const qty = numberFromRow(item.qty)
    applyProductDelta(client, {
      productCode: item.product_code,
      stockDelta: -qty,
      reservedDelta: wasReserved ? -qty : 0,
      type: "order_fulfill",
      qty: -qty,
      orderId,
      userId: currentUser.id,
      comment: "Списание при готовности букета",
    })
  }
}

export function startOrderWork(orderId: number, currentUser: CurrentUser) {
  const client = db()

  const changeStatus = client.transaction(() => {
    const { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Новый") {
      return
    }

    client
      .prepare("UPDATE orders SET status = 'В работе', updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: В работе`,
    })
  })

  changeStatus()
}

export function markOrderReady(orderId: number, currentUser: CurrentUser) {
  const client = db()
  const changeStatus = client.transaction(() => {
    const { order, items } = getOrderWithItems(client, orderId)
    const wasReserved = Number(order.is_reserved ?? 0) === 1

    if (["Готов", "Передан курьеру", "Выдан"].includes(order.status)) {
      return
    }

    if (!["Новый", "В работе"].includes(order.status)) {
      throw new Error("Этот заказ нельзя отметить готовым.")
    }

    fulfillOrderItems(client, orderId, items, wasReserved, currentUser)

    client
      .prepare(
        `UPDATE orders
         SET status = 'Готов', is_reserved = 0, ready_at = CURRENT_TIMESTAMP,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Готов`,
    })
  })

  changeStatus()
}

function applyOrderPayment(
  client: Database.Database,
  orderId: number,
  formData: FormData,
  shiftId: number,
  currentUser: CurrentUser
) {
  const amount = toNumber(formData.get("paymentAmount"))
  if (amount <= 0) {
    return 0
  }

  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const { order } = getOrderWithItems(client, orderId)
  const dealId = numberFromRow(order.deal_id) || null
  const customerId = numberFromRow(order.customer_id) || null
  const balance = Math.max(0, numberFromRow(order.total) - numberFromRow(order.paid))
  let paymentLimit = balance

  if (balance <= 0) {
    throw new Error("Заказ уже оплачен.")
  }

  if (dealId) {
    const deal = client.prepare("SELECT total, paid FROM deals WHERE id = ?").get(dealId) as
      | { total: number; paid: number }
      | undefined
    if (!deal) {
      throw new Error("Сделка по заказу не найдена.")
    }

    const dealBalance = Math.max(0, numberFromRow(deal.total) - numberFromRow(deal.paid))
    if (dealBalance <= 0) {
      throw new Error("Сделка уже оплачена.")
    }

    paymentLimit = Math.min(paymentLimit, dealBalance)
  }

  if (amount - paymentLimit > 0.009) {
    throw new Error("Сумма оплаты не может быть больше остатка.")
  }

  recordCashTransaction(client, {
    shiftId,
    orderId,
    customerId,
    dealId,
    userId: currentUser.id,
    type: "order_payment",
    paymentMethod,
    amount,
    comment: `Доплата по заказу #${orderId}`,
  })
  client
    .prepare(
      `UPDATE orders
       SET paid = COALESCE(paid, 0) + ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(amount, currentUser.id, orderId)

  if (dealId) {
    client
      .prepare("UPDATE deals SET paid = COALESCE(paid, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(amount, dealId)
  }

  return amount
}

export function completePickupOrder(orderId: number, formData: FormData, currentUser: CurrentUser) {
  const client = db()
  let acceptedPayment = false

  const complete = client.transaction(() => {
    let { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Готов") {
      throw new Error("Выдать клиенту можно только готовый заказ.")
    }

    const beforeBalance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (beforeBalance > 0) {
      const shift = requireOpenShift(client)
      acceptedPayment = applyOrderPayment(client, orderId, formData, shift.id, currentUser) > 0
    }

    order = getOrderWithItems(client, orderId).order
    const balance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (balance > 0) {
      throw new Error("Нельзя выдать заказ, пока сумма не закрыта.")
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Выдан', completed_at = CURRENT_TIMESTAMP,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Выдан`,
    })
  })

  complete()
  return acceptedPayment
}

export function handOrderToCourier(orderId: number, formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const result = { acceptedPayment: false, paidCourier: false }

  const handOver = client.transaction(() => {
    let { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Готов") {
      throw new Error("Передать курьеру можно только готовый заказ.")
    }

    const needsPayment = numberFromRow(order.total) - numberFromRow(order.paid) > 0
    const wantsCourierCash = clean(formData.get("payCourier")) === "on"
    const needsCourierCash =
      numberFromRow(order.courier_payout) > 0 && Number(order.delivery_payout_paid ?? 0) !== 1 && wantsCourierCash
    const shift = needsPayment || needsCourierCash ? requireOpenShift(client) : null

    if (needsPayment && shift) {
      result.acceptedPayment = applyOrderPayment(client, orderId, formData, shift.id, currentUser) > 0
    }

    order = getOrderWithItems(client, orderId).order
    const balance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (balance > 0) {
      throw new Error("Нельзя передать курьеру заказ с остатком к оплате.")
    }

    if (needsCourierCash && shift) {
      const amount = numberFromRow(order.courier_payout)
      recordCashTransaction(client, {
        shiftId: shift.id,
        orderId,
        userId: currentUser.id,
        type: "cash_out",
        paymentMethod: "cash",
        amount,
        comment: `Оплата курьеру за заказ №${String(order.number ?? orderId)}`,
      })
      client
        .prepare(
          `UPDATE orders
           SET delivery_payout_paid = 1, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(currentUser.id, orderId)
      result.paidCourier = true
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Передан курьеру', handed_to_courier_at = CURRENT_TIMESTAMP,
          courier_name = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(clean(formData.get("courierName")), currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Передан курьеру`,
    })
  })

  handOver()
  return result
}

export function closeDeliveredOrder(orderId: number, currentUser: CurrentUser) {
  const client = db()
  const close = client.transaction(() => {
    const { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Передан курьеру") {
      throw new Error("Закрыть доставку можно только после передачи курьеру.")
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Выдан', completed_at = CURRENT_TIMESTAMP,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Выдан`,
    })
  })

  close()
}

export function cancelOrder(orderId: number, currentUser: CurrentUser) {
  const client = db()
  let alreadyBuilt = false

  const cancel = client.transaction(() => {
    const { order, items } = getOrderWithItems(client, orderId)
    const wasReserved = Number(order.is_reserved ?? 0) === 1

    if (["Выдан", "Отменен"].includes(order.status)) {
      return
    }

    if (["Новый", "В работе"].includes(order.status)) {
      if (wasReserved) {
        cancelOrderReserve(client, orderId, items, currentUser)
      }
    } else if (["Готов", "Передан курьеру"].includes(order.status)) {
      alreadyBuilt = true
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Отменен', is_reserved = 0, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Отменен`,
    })
  })

  cancel()
  return alreadyBuilt
}
