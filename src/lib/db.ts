import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"
import { hashPassword } from "@/lib/password"

export type UserRole = "owner" | "manager" | "florist"
export type PaymentMethod = "cash" | "card" | "mbank" | "optima" | "elsom" | "transfer"
export type CashTransactionType =
  | "sale"
  | "prepayment"
  | "order_payment"
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

export type Sale = {
  id: number
  shiftId: number | null
  paymentMethod: PaymentMethod
  total: number
  note: string
  createdAt: string
  itemsCount: number
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
  total: number
}

export type Order = {
  id: number
  number: string | null
  customer: string
  phone: string
  source: string
  deliveryType: string
  address: string
  dueAt: string
  status: OrderStatus
  total: number
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
  type: string
  productCode: string | null
  productName: string | null
  qty: number | null
  unitPrice: number | null
  total: number | null
  note: string
  createdAt: string
}

export type ShiftSummary = {
  shiftId: number
  openingCash: number
  revenueTotal: number
  cashSales: number
  cashPrepayments: number
  cashOrderPayments: number
  cashIn: number
  cashOut: number
  cashRefund: number
  expectedCash: number
}

export type CashTransaction = {
  id: number
  shiftId: number
  orderId: number | null
  saleId: number | null
  type: CashTransactionType
  paymentMethod: PaymentMethod
  amount: number
  comment: string
  createdAt: string
}

export type ShiftPaymentBreakdown = {
  cashSales: number
  cardSales: number
  mbankSales: number
  optimaSales: number
  elsomSales: number
  transferSales: number
  cashPrepayments: number
  cardPrepayments: number
  mbankPrepayments: number
  optimaPrepayments: number
  elsomPrepayments: number
  transferPrepayments: number
  cashOrderPayments: number
  cardOrderPayments: number
  mbankOrderPayments: number
  optimaOrderPayments: number
  elsomOrderPayments: number
  transferOrderPayments: number
  cashIn: number
  cashOutOther: number
  courierPayouts: number
  cashRefund: number
}

export type ShiftRelatedOrder = {
  transactionId: number
  orderId: number
  number: string | null
  customer: string
  type: CashTransactionType
  paymentMethod: PaymentMethod
  amount: number
  comment: string
  createdAt: string
}

export type ShiftDetails = {
  shift: Shift
  cashier: string
  summary: ShiftSummary
  breakdown: ShiftPaymentBreakdown
  cashTransactions: CashTransaction[]
  sales: Sale[]
  relatedOrders: ShiftRelatedOrder[]
}

export type DashboardData = {
  products: Product[]
  sales: Sale[]
  shifts: Shift[]
  shiftDetails: ShiftDetails[]
  orders: Order[]
  movements: Movement[]
  users: CurrentUser[]
  stats: {
    productsCount: number
    lowStockCount: number
    negativeStockCount: number
    reservedCount: number
    openOrdersCount: number
    todaySalesTotal: number
    openShift: Shift | null
  }
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
const paymentMethods = new Set<PaymentMethod>(["cash", "card", "mbank", "optima", "elsom", "transfer"])
const cashTransactionTypes = new Set<CashTransactionType>([
  "sale",
  "prepayment",
  "order_payment",
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
      payment_method TEXT DEFAULT 'cash',
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
      customer TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      source TEXT,
      delivery_type TEXT,
      address TEXT,
      due_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
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
      total REAL NOT NULL,
      is_custom INTEGER DEFAULT 0
    );
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
  ensureColumn("shifts", "cashier_name", "ALTER TABLE shifts ADD COLUMN cashier_name TEXT NOT NULL DEFAULT ''", client)
  ensureColumn("shifts", "user_id", "ALTER TABLE shifts ADD COLUMN user_id INTEGER", client)
  ensureColumn("shifts", "opened_by_user_id", "ALTER TABLE shifts ADD COLUMN opened_by_user_id INTEGER", client)
  ensureColumn("shifts", "closed_by_user_id", "ALTER TABLE shifts ADD COLUMN closed_by_user_id INTEGER", client)
  ensureColumn("shifts", "type", "ALTER TABLE shifts ADD COLUMN type TEXT DEFAULT 'day'", client)
  ensureColumn("sales", "shift_id", "ALTER TABLE sales ADD COLUMN shift_id INTEGER", client)
  ensureColumn("sales", "payment_method", "ALTER TABLE sales ADD COLUMN payment_method TEXT DEFAULT 'cash'", client)
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
      `INSERT INTO movements (type, product_code, product_name, qty, unit_price, total, note)
       VALUES (@type, @productCode, @productName, @qty, @unitPrice, @total, @note)`
    )
    .run({
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
    revenueTotal: 0,
    cashSales: 0,
    cashPrepayments: 0,
    cashOrderPayments: 0,
    cashIn: 0,
    cashOut: 0,
    cashRefund: 0,
    expectedCash: 0,
  }

  for (const row of rows) {
    const amount = numberFromRow(row.amount)

    if (["sale", "prepayment", "order_payment"].includes(row.type)) {
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
    summary.cashIn -
    summary.cashOut -
    summary.cashRefund

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
      `SELECT id, shift_id as shiftId, order_id as orderId, sale_id as saleId, type,
        payment_method as paymentMethod, amount, COALESCE(comment, '') as comment,
        created_at as createdAt
       FROM cash_transactions
       WHERE shift_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(shiftId) as CashTransaction[]

  const breakdown: ShiftPaymentBreakdown = {
    cashSales: 0,
    cardSales: 0,
    mbankSales: 0,
    optimaSales: 0,
    elsomSales: 0,
    transferSales: 0,
    cashPrepayments: 0,
    cardPrepayments: 0,
    mbankPrepayments: 0,
    optimaPrepayments: 0,
    elsomPrepayments: 0,
    transferPrepayments: 0,
    cashOrderPayments: 0,
    cardOrderPayments: 0,
    mbankOrderPayments: 0,
    optimaOrderPayments: 0,
    elsomOrderPayments: 0,
    transferOrderPayments: 0,
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
      if (transaction.paymentMethod === "mbank") breakdown.mbankSales += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaSales += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomSales += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferSales += amount
    } else if (transaction.type === "prepayment") {
      if (transaction.paymentMethod === "cash") breakdown.cashPrepayments += amount
      if (transaction.paymentMethod === "card") breakdown.cardPrepayments += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankPrepayments += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaPrepayments += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomPrepayments += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferPrepayments += amount
    } else if (transaction.type === "order_payment") {
      if (transaction.paymentMethod === "cash") breakdown.cashOrderPayments += amount
      if (transaction.paymentMethod === "card") breakdown.cardOrderPayments += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankOrderPayments += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaOrderPayments += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomOrderPayments += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferOrderPayments += amount
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
      `SELECT sales.id, sales.shift_id as shiftId, COALESCE(sales.payment_method, 'cash') as paymentMethod,
        sales.total, sales.note, sales.created_at as createdAt, COUNT(sale_items.id) as itemsCount
       FROM sales
       LEFT JOIN sale_items ON sale_items.sale_id = sales.id
       WHERE sales.shift_id = ?
       GROUP BY sales.id
       ORDER BY sales.created_at DESC, sales.id DESC`
    )
    .all(shiftId) as Sale[]

  const relatedOrders = client
    .prepare(
      `SELECT cash_transactions.id as transactionId, cash_transactions.order_id as orderId,
        orders.number, COALESCE(orders.customer, '') as customer, cash_transactions.type,
        cash_transactions.payment_method as paymentMethod, cash_transactions.amount,
        COALESCE(cash_transactions.comment, '') as comment, cash_transactions.created_at as createdAt
       FROM cash_transactions
       LEFT JOIN orders ON orders.id = cash_transactions.order_id
       WHERE cash_transactions.shift_id = ? AND cash_transactions.order_id IS NOT NULL
       ORDER BY cash_transactions.created_at DESC, cash_transactions.id DESC`
    )
    .all(shiftId) as ShiftRelatedOrder[]

  return {
    shift,
    cashier: shift.cashierName || "Кассир не указан",
    summary,
    breakdown,
    cashTransactions,
    sales,
    relatedOrders,
  }
}

export function recordCashTransaction(
  client: Database.Database,
  input: {
    shiftId: number
    orderId?: number | null
    saleId?: number | null
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
        shift_id, order_id, sale_id, type, payment_method, amount, comment
      ) VALUES (
        @shiftId, @orderId, @saleId, @type, @paymentMethod, @amount, @comment
      )`
    )
    .run({
      shiftId: input.shiftId,
      orderId: input.orderId ?? null,
      saleId: input.saleId ?? null,
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
        order_id, sale_id, shift_id, comment
      ) VALUES (
        @productCode, @type, @qty, @beforeStock, @afterStock, @beforeReserved, @afterReserved,
        @orderId, @saleId, @shiftId, @comment
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
        sales.total, sales.note, sales.created_at as createdAt, COUNT(sale_items.id) as itemsCount
       FROM sales
       LEFT JOIN sale_items ON sale_items.sale_id = sales.id
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
      `SELECT id, number, customer, phone, COALESCE(source, '') as source,
        COALESCE(delivery_type, 'pickup') as deliveryType, COALESCE(address, '') as address,
        due_at as dueAt, status, total, COALESCE(prepaid, 0) as prepaid,
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
        `SELECT id, order_id as orderId, product_code as productCode, name, qty, price, total
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
        customer: String(row.customer ?? ""),
        phone: String(row.phone ?? ""),
        source: String(row.source ?? ""),
        deliveryType: String(row.deliveryType ?? "pickup"),
        address: String(row.address ?? ""),
        dueAt: String(row.dueAt ?? ""),
        status: normalizeOrderStatus(row.status),
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
    .prepare(
      `SELECT id, type, productCode, productName, qty, unitPrice, total, note, createdAt
       FROM (
         SELECT id, type, product_code as productCode, product_name as productName, qty,
           unit_price as unitPrice, total, note, created_at as createdAt
         FROM movements
         UNION ALL
         SELECT stock_movements.id, stock_movements.type, stock_movements.product_code as productCode,
           products.name as productName, stock_movements.qty, NULL as unitPrice, NULL as total,
           COALESCE(stock_movements.comment, '') as note, stock_movements.created_at as createdAt
         FROM stock_movements
         LEFT JOIN products ON products.code = stock_movements.product_code
         WHERE stock_movements.type = 'adjustment'
       )
       ORDER BY createdAt DESC, id DESC
       LIMIT 80`
    )
    .all() as Movement[]

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
    users: listUsers(client),
    stats: {
      productsCount: products.length,
      lowStockCount: products.filter((product) => product.available > 0 && product.available <= 3).length,
      negativeStockCount: products.filter((product) => product.available < 0).length,
      reservedCount: products.filter((product) => product.reserved > 0).length,
      openOrdersCount: orders.filter((order) => !["Выдан", "Отменен"].includes(order.status)).length,
      todaySalesTotal: Number(todaySales.total),
      openShift: shifts.find((shift) => shift.status === "open") ?? null,
    },
  }
}

export function upsertProduct(formData: FormData) {
  const client = db()
  const code = clean(formData.get("code"))
  const name = clean(formData.get("name"))

  if (!code || !name) {
    throw new Error("Код и название обязательны.")
  }

  const saveProduct = client.transaction(() => {
    const before = getProduct(client, code)

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
        stock: toNumber(formData.get("stock")),
        reserved: toNumber(formData.get("reserved")),
        expected: toNumber(formData.get("expected")),
        costPrice: toNumber(formData.get("costPrice")),
        salePrice: toNumber(formData.get("salePrice")),
      })

    const after = getProduct(client, code)
    recordStockMovement(client, {
      productCode: code,
      type: "adjustment",
      qty: numberFromRow(after?.stock) - numberFromRow(before?.stock),
      beforeStock: before ? numberFromRow(before.stock) : null,
      afterStock: after ? numberFromRow(after.stock) : null,
      beforeReserved: before ? numberFromRow(before.reserved) : null,
      afterReserved: after ? numberFromRow(after.reserved) : null,
      comment: `Обновлен товар ${code}`,
    })

    addMovement(client, {
      type: "stock_update",
      productCode: code,
      productName: name,
      note: `Обновлен товар ${code}`,
    })
  })

  saveProduct()
}

export function deleteProduct(code: string) {
  const client = db()

  const removeProduct = client.transaction(() => {
    const product = getProduct(client, code)

    if (!product) {
      return
    }

    recordStockMovement(client, {
      productCode: code,
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

function adjustProductStock(formData: FormData, direction: "in" | "out") {
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

export function replenishProductStock(formData: FormData) {
  adjustProductStock(formData, "in")
}

export function writeOffProductStock(formData: FormData) {
  adjustProductStock(formData, "out")
}

function buildSaleItems(client: Database.Database, formData: FormData) {
  const multiProductCodes = formData.getAll("itemProductCode").map((value) => clean(value))
  const productCodes = multiProductCodes.length ? multiProductCodes : [clean(formData.get("productCode"))]
  const qtyValues = multiProductCodes.length ? formData.getAll("itemQty") : [formData.get("qty")]
  const priceValues = multiProductCodes.length ? formData.getAll("itemPrice") : [formData.get("price")]

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

    return {
      productCode,
      product,
      qty,
      unitPrice,
      total: qty * unitPrice,
    }
  })
}

export function createSale(formData: FormData) {
  const client = db()
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const note = clean(formData.get("note"))

  const saveSale = client.transaction(() => {
    const shift = requireOpenShift(client)
    const items = buildSaleItems(client, formData)
    const total = items.reduce((sum, item) => sum + item.total, 0)
    const sale = client
      .prepare("INSERT INTO sales (shift_id, payment_method, total, note) VALUES (?, ?, ?, ?)")
      .run(shift.id, paymentMethod, total, note)
    const saleId = Number(sale.lastInsertRowid)

    const insertItem = client.prepare(
      "INSERT INTO sale_items (sale_id, product_code, qty, unit_price, total) VALUES (?, ?, ?, ?, ?)"
    )
    for (const item of items) {
      insertItem.run(saleId, item.productCode, item.qty, item.unitPrice, item.total)
      applyProductDelta(client, {
        productCode: item.productCode,
        stockDelta: -item.qty,
        type: "sale",
        qty: -item.qty,
        saleId,
        shiftId: shift.id,
        comment: note || "Продажа на кассе",
      })
      addMovement(client, {
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

    const cash = toNumber(formData.get("openingCash"))
    const cashierName = currentUser.name
    const note = clean(formData.get("note"))

    const shift = client
      .prepare(
        `INSERT INTO shifts (opening_cash, cashier_name, note, user_id, opened_by_user_id, type)
         VALUES (?, ?, ?, ?, ?, 'day')`
      )
      .run(cash, cashierName, note, currentUser.id, currentUser.id)

    addMovement(client, {
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
        type: "shift_open",
        total: cash,
        note: `Открыта ночная смена #${nightShift.lastInsertRowid}: ${florist.name}`,
      })
    }
  })

  finishShift()
}

function recordManualCash(formData: FormData, type: "cash_in" | "cash_out") {
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
      type,
      paymentMethod: "cash",
      amount,
      comment,
    })
  })

  record()
}

export function cashIn(formData: FormData) {
  recordManualCash(formData, "cash_in")
}

export function cashOut(formData: FormData) {
  recordManualCash(formData, "cash_out")
}

function buildOrderItems(client: Database.Database, formData: FormData) {
  const productCodes = formData.getAll("itemProductCode").map((value) => clean(value))
  const qtyValues = formData.getAll("itemQty")
  const priceValues = formData.getAll("itemPrice")

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

    return {
      productCode,
      name: String(product.name),
      qty,
      price,
      total: qty * price,
    }
  })
}

export function createOrder(formData: FormData) {
  const client = db()
  const customer = clean(formData.get("customer")) || clean(formData.get("customer_name"))
  const phone = clean(formData.get("phone"))
  const dueAt = clean(formData.get("dueAt"))
  const deliveryType = clean(formData.get("deliveryType")) || "pickup"
  const address = clean(formData.get("address"))
  const deliveryPrice = toNumber(formData.get("deliveryPrice"))
  const courierPayout = toNumber(formData.get("courierPayout"))
  const prepaid = toNumber(formData.get("prepaid"))
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
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
    const itemsTotal = items.reduce((sum, item) => sum + item.total, 0)
    const total = itemsTotal + deliveryPrice

    if (prepaid > total && total >= 0) {
      throw new Error("Предоплата не может быть больше суммы заказа.")
    }

    const shift = prepaid > 0 ? requireOpenShift(client) : null
    const order = client
      .prepare(
        `INSERT INTO orders (
          customer, phone, source, delivery_type, address, due_at, status, total, prepaid, paid,
          delivery_price, courier_payout, is_reserved, note, updated_at
        ) VALUES (
          @customer, @phone, @source, @deliveryType, @address, @dueAt, 'Новый', @total, @prepaid, @paid,
          @deliveryPrice, @courierPayout, 1, @note, CURRENT_TIMESTAMP
        )`
      )
      .run({
        customer,
        phone,
        source: clean(formData.get("source")),
        deliveryType,
        address: deliveryType === "delivery" ? address : "",
        dueAt,
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
      `INSERT INTO order_items (order_id, product_code, name, qty, price, total, is_custom)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const item of items) {
      insertItem.run(orderId, item.productCode, item.name, item.qty, item.price, item.total, 0)
      applyProductDelta(client, {
        productCode: item.productCode,
        reservedDelta: item.qty,
        type: "reserve",
        qty: item.qty,
        orderId,
        comment: "Резерв при создании заказа",
      })
    }

    if (shift && prepaid > 0) {
      recordCashTransaction(client, {
        shiftId: shift.id,
        orderId,
        type: "prepayment",
        paymentMethod,
        amount: prepaid,
        comment: `Предоплата по заказу ${number}`,
      })
    }

    addMovement(client, {
      type: "order_create",
      total,
      note: `Создан заказ ${number}: ${customer}`,
    })
  })

  saveOrder()
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
  items: Array<{ product_code: string; qty: number; name: string }>
) {
  for (const item of items) {
    applyProductDelta(client, {
      productCode: item.product_code,
      reservedDelta: -numberFromRow(item.qty),
      type: "reserve_cancel",
      qty: -numberFromRow(item.qty),
      orderId,
      comment: "Отмена резерва при отмене заказа",
    })
  }
}

function fulfillOrderItems(
  client: Database.Database,
  orderId: number,
  items: Array<{ product_code: string; qty: number; name: string }>,
  wasReserved: boolean
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
      comment: "Списание при готовности букета",
    })
  }
}

export function startOrderWork(orderId: number) {
  const client = db()

  const changeStatus = client.transaction(() => {
    const { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Новый") {
      return
    }

    client
      .prepare("UPDATE orders SET status = 'В работе', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(orderId)
    addMovement(client, {
      type: "order_status",
      note: `Заказ #${orderId}: В работе`,
    })
  })

  changeStatus()
}

export function markOrderReady(orderId: number) {
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

    fulfillOrderItems(client, orderId, items, wasReserved)

    client
      .prepare(
        `UPDATE orders
         SET status = 'Готов', is_reserved = 0, ready_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(orderId)
    addMovement(client, {
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
  shiftId: number
) {
  const amount = toNumber(formData.get("paymentAmount"))
  if (amount <= 0) {
    return 0
  }

  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  recordCashTransaction(client, {
    shiftId,
    orderId,
    type: "order_payment",
    paymentMethod,
    amount,
    comment: `Доплата по заказу #${orderId}`,
  })
  client
    .prepare("UPDATE orders SET paid = COALESCE(paid, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(amount, orderId)

  return amount
}

export function completePickupOrder(orderId: number, formData: FormData) {
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
      acceptedPayment = applyOrderPayment(client, orderId, formData, shift.id) > 0
    }

    order = getOrderWithItems(client, orderId).order
    const balance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (balance > 0) {
      throw new Error("Нельзя выдать заказ, пока сумма не закрыта.")
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Выдан', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(orderId)
    addMovement(client, {
      type: "order_status",
      note: `Заказ #${orderId}: Выдан`,
    })
  })

  complete()
  return acceptedPayment
}

export function handOrderToCourier(orderId: number, formData: FormData) {
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
      result.acceptedPayment = applyOrderPayment(client, orderId, formData, shift.id) > 0
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
        type: "cash_out",
        paymentMethod: "cash",
        amount,
        comment: `Оплата курьеру за заказ №${String(order.number ?? orderId)}`,
      })
      client
        .prepare("UPDATE orders SET delivery_payout_paid = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(orderId)
      result.paidCourier = true
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Передан курьеру', handed_to_courier_at = CURRENT_TIMESTAMP,
          courier_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(clean(formData.get("courierName")), orderId)
    addMovement(client, {
      type: "order_status",
      note: `Заказ #${orderId}: Передан курьеру`,
    })
  })

  handOver()
  return result
}

export function closeDeliveredOrder(orderId: number) {
  const client = db()
  const close = client.transaction(() => {
    const { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Передан курьеру") {
      throw new Error("Закрыть доставку можно только после передачи курьеру.")
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Выдан', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(orderId)
    addMovement(client, {
      type: "order_status",
      note: `Заказ #${orderId}: Выдан`,
    })
  })

  close()
}

export function cancelOrder(orderId: number) {
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
        cancelOrderReserve(client, orderId, items)
      }
    } else if (["Готов", "Передан курьеру"].includes(order.status)) {
      alreadyBuilt = true
    }

    client
      .prepare("UPDATE orders SET status = 'Отменен', is_reserved = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(orderId)
    addMovement(client, {
      type: "order_status",
      note: `Заказ #${orderId}: Отменен`,
    })
  })

  cancel()
  return alreadyBuilt
}
