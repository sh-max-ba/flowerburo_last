import type Database from "better-sqlite3"
import { initDb, listUsers, type CurrentUser, type Order, type Product, type Sale } from "@/lib/db"
import {
  calculateCommercialTotals,
  calculateLineTotal,
  normalizeDiscountType,
  type DiscountType,
} from "@/lib/pricing"

export type DealStatus = "open" | "won" | "lost" | "cancelled"
export type DealSource = "manual" | "whatsapp" | "instagram" | "site" | "phone"

export type Customer = {
  id: number
  name: string
  phone: string
  normalizedPhone: string | null
  instagram: string
  source: string
  defaultDiscountPercent: number
  comment: string
  createdAt: string
  updatedAt: string
  dealsCount?: number
  ordersCount?: number
  salesCount?: number
}

export type DealPipeline = {
  id: number
  name: string
  isDefault: boolean
  createdAt: string
}

export type DealStage = {
  id: number
  pipelineId: number
  name: string
  position: number
  color: string
  isClosed: boolean
  isWon: boolean
  createdAt: string
}

export type DealItem = {
  id: number
  dealId: number
  productCode: string
  productName: string
  imagePath: string
  qty: number
  price: number
  discountType: DiscountType
  discountValue: number
  discountAmount: number
  totalBeforeDiscount: number
  total: number
  createdAt: string
  updatedAt: string
}

export type Deal = {
  id: number
  number: string | null
  customerId: number | null
  customerName: string
  customerPhone: string
  customerDefaultDiscountPercent: number
  responsibleUserId: number | null
  responsibleUserName: string
  pipelineId: number | null
  stageId: number | null
  stageName: string
  stagePosition: number
  status: DealStatus
  source: DealSource
  title: string
  dueAt: string
  deliveryType: string
  address: string
  comment: string
  itemsTotal: number
  itemsDiscountTotal: number
  dealDiscountType: DiscountType
  dealDiscountValue: number
  dealDiscountAmount: number
  total: number
  paid: number
  orderId: number | null
  orderNumber?: string | null
  orderStatus?: string
  wazzupChatType: string
  wazzupChatId: string
  wazzupChannelId: string
  createdAt: string
  updatedAt: string
  items: DealItem[]
}

export type DealBoardData = {
  pipeline: DealPipeline | null
  stages: DealStage[]
  deals: Deal[]
}

export function normalizePhone(value: string | null | undefined) {
  const normalized = clean(value).replace(/\D/g, "")
  return normalized || null
}

export function listProducts(): Product[] {
  const rows = db()
    .prepare(
      `SELECT code, category_path as categoryPath, article, name, unit, stock, reserved, expected,
        cost_price as costPrice, sale_price as salePrice, image_path as imagePath, updated_at as updatedAt
       FROM products
       ORDER BY name COLLATE NOCASE`
    )
    .all() as Array<Record<string, unknown>>

  return rows.map((row) => ({
    code: String(row.code ?? ""),
    categoryPath: String(row.categoryPath ?? ""),
    article: String(row.article ?? ""),
    name: String(row.name ?? ""),
    unit: String(row.unit ?? "шт"),
    imagePath: String(row.imagePath ?? ""),
    stock: toNumber(row.stock),
    reserved: toNumber(row.reserved),
    expected: toNumber(row.expected),
    available: toNumber(row.stock) - toNumber(row.reserved),
    costPrice: toNumber(row.costPrice),
    salePrice: toNumber(row.salePrice),
    updatedAt: String(row.updatedAt ?? ""),
  }))
}

export function listCustomers(options: { search?: string } = {}) {
  const search = clean(options.search)
  const params: Record<string, unknown> = {}
  const conditions: string[] = []

  if (search) {
    conditions.push(
      "(customers.name LIKE @search OR customers.phone LIKE @search OR customers.normalized_phone LIKE @phone)"
    )
    params.search = `%${search}%`
    params.phone = `%${search.replace(/\D/g, "")}%`
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const rows = db()
    .prepare(
      `SELECT customers.*,
        COUNT(DISTINCT deals.id) as deals_count,
        COUNT(DISTINCT orders.id) as orders_count,
        COUNT(DISTINCT sales.id) as sales_count
       FROM customers
       LEFT JOIN deals ON deals.customer_id = customers.id
       LEFT JOIN orders ON orders.customer_id = customers.id
       LEFT JOIN sales ON sales.customer_id = customers.id
       ${where}
       GROUP BY customers.id
       ORDER BY customers.created_at DESC, customers.id DESC
       LIMIT 200`
    )
    .all(params) as Array<Record<string, unknown>>

  return rows.map(mapCustomer)
}

export function getCustomer(customerId: number) {
  const row = db().prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as
    | Record<string, unknown>
    | undefined

  return row ? mapCustomer(row) : null
}

export function createCustomer(formData: FormData) {
  return insertCustomer({
    name: clean(formData.get("name")),
    phone: clean(formData.get("phone")),
    instagram: clean(formData.get("instagram")),
    source: clean(formData.get("source")),
    defaultDiscountPercent: clampPercent(toNumber(formData.get("defaultDiscountPercent"))),
    comment: clean(formData.get("comment")),
  })
}

export function updateCustomer(formData: FormData) {
  const id = toNumber(formData.get("customerId"))
  const name = clean(formData.get("name"))
  if (!id || !name) {
    throw new Error("Укажите клиента и имя.")
  }

  db()
    .prepare(
      `UPDATE customers
       SET name = @name, phone = @phone, normalized_phone = @normalizedPhone,
        instagram = @instagram, source = @source, default_discount_percent = @defaultDiscountPercent,
        comment = @comment, updated_at = CURRENT_TIMESTAMP
       WHERE id = @id`
    )
    .run({
      id,
      name,
      phone: clean(formData.get("phone")),
      normalizedPhone: normalizePhone(String(formData.get("phone") ?? "")),
      instagram: clean(formData.get("instagram")),
      source: clean(formData.get("source")),
      defaultDiscountPercent: clampPercent(toNumber(formData.get("defaultDiscountPercent"))),
      comment: clean(formData.get("comment")),
    })
}

export function listCustomerOrders(customerId: number): Order[] {
  const rows = db()
    .prepare(
      `SELECT id, number, customer_id as customerId, deal_id as dealId,
        created_by_user_id as createdByUserId, updated_by_user_id as updatedByUserId,
        customer, phone, COALESCE(source, '') as source, COALESCE(delivery_type, '') as deliveryType,
        COALESCE(address, '') as address, due_at as dueAt, status,
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
       WHERE customer_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 80`
    )
    .all(customerId) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: toNumber(row.id),
    number: row.number === null ? null : String(row.number ?? ""),
    createdByUserId: row.createdByUserId === null ? null : toNumber(row.createdByUserId),
    updatedByUserId: row.updatedByUserId === null ? null : toNumber(row.updatedByUserId),
    customerId: row.customerId === null ? null : toNumber(row.customerId),
    dealId: row.dealId === null ? null : toNumber(row.dealId),
    customer: String(row.customer ?? ""),
    phone: String(row.phone ?? ""),
    source: String(row.source ?? ""),
    deliveryType: String(row.deliveryType ?? ""),
    address: String(row.address ?? ""),
    dueAt: String(row.dueAt ?? ""),
    status: String(row.status ?? "Новый") as Order["status"],
    itemsTotalBeforeDiscount: toNumber(row.itemsTotalBeforeDiscount) || toNumber(row.total),
    itemsDiscountTotal: toNumber(row.itemsDiscountTotal),
    orderDiscountType: normalizeDiscountType(String(row.orderDiscountType ?? "none")),
    orderDiscountValue: toNumber(row.orderDiscountValue),
    orderDiscountAmount: toNumber(row.orderDiscountAmount),
    totalBeforeDiscount: toNumber(row.totalBeforeDiscount) || toNumber(row.total),
    total: toNumber(row.total),
    prepaid: toNumber(row.prepaid),
    paid: toNumber(row.paid),
    deliveryPrice: toNumber(row.deliveryPrice),
    courierPayout: toNumber(row.courierPayout),
    deliveryPayoutPaid: toNumber(row.deliveryPayoutPaid) === 1,
    isReserved: toNumber(row.isReserved) === 1,
    note: String(row.note ?? ""),
    readyAt: row.readyAt === null ? null : String(row.readyAt ?? ""),
    handedToCourierAt: row.handedToCourierAt === null ? null : String(row.handedToCourierAt ?? ""),
    completedAt: row.completedAt === null ? null : String(row.completedAt ?? ""),
    courierName: String(row.courierName ?? ""),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: row.updatedAt === null ? null : String(row.updatedAt ?? ""),
    items: [],
  }))
}

export function listCustomerSales(customerId: number): Sale[] {
  const rows = db()
    .prepare(
      `SELECT sales.id, sales.shift_id as shiftId, sales.user_id as userId,
        users.name as userName, COALESCE(sales.payment_method, 'cash') as paymentMethod,
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
       WHERE sales.customer_id = ?
       GROUP BY sales.id
       ORDER BY sales.created_at DESC, sales.id DESC
       LIMIT 80`
    )
    .all(customerId) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: toNumber(row.id),
    shiftId: row.shiftId === null ? null : toNumber(row.shiftId),
    userId: row.userId === null ? null : toNumber(row.userId),
    userName: row.userName === null ? null : String(row.userName ?? ""),
    paymentMethod: String(row.paymentMethod ?? "cash") as Sale["paymentMethod"],
    customerId: row.customerId === null ? null : toNumber(row.customerId),
    customerName: String(row.customerName ?? ""),
    customerPhone: String(row.customerPhone ?? ""),
    itemsTotalBeforeDiscount: toNumber(row.itemsTotalBeforeDiscount) || toNumber(row.total),
    itemsDiscountTotal: toNumber(row.itemsDiscountTotal),
    saleDiscountType: normalizeDiscountType(String(row.saleDiscountType ?? "none")),
    saleDiscountValue: toNumber(row.saleDiscountValue),
    saleDiscountAmount: toNumber(row.saleDiscountAmount),
    totalBeforeDiscount: toNumber(row.totalBeforeDiscount) || toNumber(row.total),
    discountTotal: toNumber(row.discountTotal),
    total: toNumber(row.total),
    note: String(row.note ?? ""),
    createdAt: String(row.createdAt ?? ""),
    itemsCount: toNumber(row.itemsCount),
  }))
}

export function listDealStages() {
  return db()
    .prepare(
      `SELECT id, pipeline_id as pipelineId, name, position, COALESCE(color, '') as color,
        COALESCE(is_closed, 0) as isClosed, COALESCE(is_won, 0) as isWon, created_at as createdAt
       FROM deal_stages
       ORDER BY position ASC, id ASC`
    )
    .all() as DealStage[]
}

export function getDealBoardData(): DealBoardData {
  const pipeline = getDefaultPipeline()
  const stages = listDealStages()
  const deals = listDeals()

  return { pipeline, stages, deals }
}

export function listDeals(options: { customerId?: number } = {}) {
  const params: Record<string, unknown> = {}
  const conditions: string[] = []

  if (options.customerId) {
    conditions.push("deals.customer_id = @customerId")
    params.customerId = options.customerId
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const rows = db()
    .prepare(
      `SELECT deals.*, deal_stages.name as stageName, deal_stages.position as stagePosition,
        COALESCE(customers.default_discount_percent, 0) as customerDefaultDiscountPercent,
        orders.number as orderNumber, orders.status as orderStatus
       FROM deals
       LEFT JOIN deal_stages ON deal_stages.id = deals.stage_id
       LEFT JOIN customers ON customers.id = deals.customer_id
       LEFT JOIN orders ON orders.id = deals.order_id
       ${where}
       ORDER BY COALESCE(deal_stages.position, 999), deals.updated_at DESC, deals.id DESC`
    )
    .all(params) as Array<Record<string, unknown>>

  return rows.map((row) => mapDeal(row, []))
}

export function getDeal(dealId: number) {
  const row = db()
    .prepare(
      `SELECT deals.*, deal_stages.name as stageName, deal_stages.position as stagePosition,
        COALESCE(customers.default_discount_percent, 0) as customerDefaultDiscountPercent,
        orders.number as orderNumber, orders.status as orderStatus
       FROM deals
       LEFT JOIN deal_stages ON deal_stages.id = deals.stage_id
       LEFT JOIN customers ON customers.id = deals.customer_id
       LEFT JOIN orders ON orders.id = deals.order_id
       WHERE deals.id = ?`
    )
    .get(dealId) as Record<string, unknown> | undefined

  if (!row) {
    return null
  }

  const items = listDealItems(dealId)
  return mapDeal(row, items)
}

export function createDeal(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const create = client.transaction(() => {
    const customer = resolveCustomerSnapshot(client, formData)
    const pipeline = getDefaultPipeline(client)
    const stageId = toNumber(formData.get("stageId")) || getFirstStageId(client, pipeline?.id ?? null)
    const responsible = resolveResponsible(client, toNumber(formData.get("responsibleUserId")), currentUser, true)
    const discountType = customer.defaultDiscountPercent > 0 ? "percent" : "none"
    const discountValue = customer.defaultDiscountPercent > 0 ? customer.defaultDiscountPercent : 0
    const deal = client
      .prepare(
        `INSERT INTO deals (
          customer_id, customer_name, customer_phone, responsible_user_id, responsible_user_name,
          pipeline_id, stage_id, status, source, title, due_at, delivery_type, address, comment,
          deal_discount_type, deal_discount_value, updated_at
        ) VALUES (
          @customerId, @customerName, @customerPhone, @responsibleUserId, @responsibleUserName,
          @pipelineId, @stageId, 'open', @source, @title, @dueAt, @deliveryType, @address, @comment,
          @dealDiscountType, @dealDiscountValue, CURRENT_TIMESTAMP
        )`
      )
      .run({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        responsibleUserId: responsible.id,
        responsibleUserName: responsible.name,
        pipelineId: pipeline?.id ?? null,
        stageId,
        source: normalizeDealSource(clean(formData.get("source"))),
        title: clean(formData.get("title")),
        dueAt: clean(formData.get("dueAt")),
        deliveryType: clean(formData.get("deliveryType")),
        address: clean(formData.get("address")),
        comment: clean(formData.get("comment")),
        dealDiscountType: discountType,
        dealDiscountValue: discountValue,
      })
    const dealId = Number(deal.lastInsertRowid)
    client
      .prepare("UPDATE deals SET number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(generateDealNumber(dealId), dealId)
    recalculateDealTotals(dealId, client)

    return dealId
  })

  return create()
}

export function updateDealFields(formData: FormData, currentUser: CurrentUser) {
  const dealId = toNumber(formData.get("dealId"))
  if (!dealId) {
    throw new Error("Сделка не найдена.")
  }

  const client = db()
  const update = client.transaction(() => {
    const existing = getDealRecord(client, dealId)
    const customer = resolveCustomerSnapshot(client, formData, existing)
    const stageId = toNumber(formData.get("stageId")) || existing.stage_id
    const stage = stageId ? getStage(client, Number(stageId)) : null
    const responsible = resolveResponsible(client, toNumber(formData.get("responsibleUserId")), currentUser)
    const discountType = normalizeDiscountType(clean(formData.get("dealDiscountType")))
    const discountValue = discountType === "none" ? 0 : Math.max(0, toNumber(formData.get("dealDiscountValue")))
    const status = stage?.isWon ? "won" : stage?.isClosed ? "cancelled" : "open"

    client
      .prepare(
        `UPDATE deals
         SET customer_id = @customerId, customer_name = @customerName, customer_phone = @customerPhone,
          responsible_user_id = @responsibleUserId, responsible_user_name = @responsibleUserName,
          stage_id = @stageId, status = @status, source = @source, title = @title, due_at = @dueAt,
          delivery_type = @deliveryType, address = @address, comment = @comment,
          deal_discount_type = @dealDiscountType, deal_discount_value = @dealDiscountValue,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @dealId`
      )
      .run({
        dealId,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        responsibleUserId: responsible.id,
        responsibleUserName: responsible.name,
        stageId,
        status,
        source: normalizeDealSource(clean(formData.get("source"))),
        title: clean(formData.get("title")),
        dueAt: clean(formData.get("dueAt")),
        deliveryType: clean(formData.get("deliveryType")),
        address: clean(formData.get("address")),
        comment: clean(formData.get("comment")),
        dealDiscountType: discountType,
        dealDiscountValue: discountValue,
      })
    recalculateDealTotals(dealId, client)
  })

  update()
}

export function updateDealStage(dealId: number, stageId: number) {
  const client = db()
  const update = client.transaction(() => {
    const stage = getStage(client, stageId)
    if (!stage) {
      throw new Error("Этап не найден.")
    }
    const status = stage.isWon ? "won" : stage.isClosed ? "cancelled" : "open"
    client
      .prepare("UPDATE deals SET stage_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(stageId, status, dealId)
  })

  update()
}

export function addDealItem(dealId: number, productCode: string) {
  const client = db()
  const add = client.transaction(() => {
    getDealRecord(client, dealId)
    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error("Товар не найден.")
    }
    const existing = client
      .prepare("SELECT id, qty FROM deal_items WHERE deal_id = ? AND product_code = ?")
      .get(dealId, product.code) as { id: number; qty: number } | undefined

    if (existing) {
      client
        .prepare("UPDATE deal_items SET qty = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(toNumber(existing.qty) + 1, existing.id)
    } else {
      client
        .prepare(
          `INSERT INTO deal_items (deal_id, product_code, product_name, qty, price, updated_at)
           VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)`
        )
        .run(dealId, product.code, product.name, product.salePrice)
    }
    recalculateDealTotals(dealId, client)
  })

  add()
}

export function updateDealItem(formData: FormData) {
  const dealId = toNumber(formData.get("dealId"))
  const itemId = toNumber(formData.get("itemId"))
  const qty = Math.max(0.01, toNumber(formData.get("qty")))
  const price = Math.max(0, toNumber(formData.get("price")))
  const discountType = normalizeDiscountType(clean(formData.get("discountType")))
  const discountValue = discountType === "none" ? 0 : Math.max(0, toNumber(formData.get("discountValue")))
  const line = calculateLineTotal({ qty, price, discountType, discountValue })
  const client = db()
  const update = client.transaction(() => {
    getDealRecord(client, dealId)
    client
      .prepare(
        `UPDATE deal_items
         SET qty = ?, price = ?, discount_type = ?, discount_value = ?, discount_amount = ?,
          total_before_discount = ?, total = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND deal_id = ?`
      )
      .run(
        qty,
        price,
        discountType,
        discountValue,
        line.discountAmount,
        line.totalBeforeDiscount,
        line.total,
        itemId,
        dealId
      )
    recalculateDealTotals(dealId, client)
  })

  update()
}

export function removeDealItem(dealId: number, itemId: number) {
  const client = db()
  const remove = client.transaction(() => {
    getDealRecord(client, dealId)
    client.prepare("DELETE FROM deal_items WHERE id = ? AND deal_id = ?").run(itemId, dealId)
    recalculateDealTotals(dealId, client)
  })

  remove()
}

export function recalculateDealTotals(dealId: number, client: Database.Database = db()) {
  const deal = getDealRecord(client, dealId)
  const items = listDealItems(dealId, client)
  const lineTotals = items.map((item) =>
    calculateLineTotal({
      qty: item.qty,
      price: item.price,
      discountType: item.discountType,
      discountValue: item.discountValue,
    })
  )

  const updateItem = client.prepare(
    `UPDATE deal_items
     SET discount_amount = ?, total_before_discount = ?, total = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
  items.forEach((item, index) => {
    const total = lineTotals[index]
    updateItem.run(total.discountAmount, total.totalBeforeDiscount, total.total, item.id)
  })

  const totals = calculateCommercialTotals(items, String(deal.deal_discount_type), toNumber(deal.deal_discount_value))
  client
    .prepare(
      `UPDATE deals
       SET items_total = ?, items_discount_total = ?, deal_discount_amount = ?, total = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(
      totals.itemsTotalBeforeDiscount,
      totals.itemsDiscountTotal,
      totals.dealDiscountAmount,
      totals.total,
      dealId
    )
}

export function generateDealNumber(dealId: number, date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("")

  return `D-${stamp}-${String(dealId).padStart(4, "0")}`
}

function db() {
  return initDb()
}

function insertCustomer(input: {
  name: string
  phone?: string
  instagram?: string
  source?: string
  defaultDiscountPercent?: number
  comment?: string
}) {
  const name = clean(input.name)
  if (!name) {
    throw new Error("Укажите имя клиента.")
  }

  const result = db()
    .prepare(
      `INSERT INTO customers (
        name, phone, normalized_phone, instagram, source, default_discount_percent, comment, updated_at
      ) VALUES (
        @name, @phone, @normalizedPhone, @instagram, @source, @defaultDiscountPercent, @comment, CURRENT_TIMESTAMP
      )`
    )
    .run({
      name,
      phone: clean(input.phone),
      normalizedPhone: normalizePhone(input.phone),
      instagram: clean(input.instagram),
      source: clean(input.source),
      defaultDiscountPercent: clampPercent(input.defaultDiscountPercent ?? 0),
      comment: clean(input.comment),
    })

  return Number(result.lastInsertRowid)
}

function resolveCustomerSnapshot(
  client: Database.Database,
  formData: FormData,
  existing?: Record<string, unknown>
) {
  const hasCustomerField = formData.has("customerId")
  const customerId = toNumber(formData.get("customerId"))
  if (customerId) {
    const customer = client.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as
      | Record<string, unknown>
      | undefined
    if (!customer) {
      throw new Error("Клиент не найден.")
    }
    return {
      id: toNumber(customer.id),
      name: String(customer.name ?? ""),
      phone: String(customer.phone ?? ""),
      defaultDiscountPercent: clampPercent(toNumber(customer.default_discount_percent)),
    }
  }

  const name = clean(formData.get("customerName")) || clean(formData.get("customer_name"))
  const phone = clean(formData.get("customerPhone")) || clean(formData.get("customer_phone"))
  if (existing && hasCustomerField && !name) {
    return {
      id: null,
      name: "",
      phone: "",
      defaultDiscountPercent: 0,
    }
  }

  if (name) {
    const id = insertCustomer({
      name,
      phone,
      source: clean(formData.get("source")),
      defaultDiscountPercent: clampPercent(toNumber(formData.get("customerDefaultDiscountPercent"))),
    })
    return {
      id,
      name,
      phone,
      defaultDiscountPercent: clampPercent(toNumber(formData.get("customerDefaultDiscountPercent"))),
    }
  }

  return {
    id: existing?.customer_id === null || existing?.customer_id === undefined ? null : toNumber(existing.customer_id),
    name: String(existing?.customer_name ?? ""),
    phone: String(existing?.customer_phone ?? ""),
    defaultDiscountPercent: 0,
  }
}

function resolveResponsible(
  client: Database.Database,
  userId: number,
  fallback: CurrentUser,
  allowUnassigned = false
) {
  if (userId) {
    const user = listUsers(client).find((item) => item.id === userId)
    if (user) {
      return { id: user.id, name: user.name }
    }
  }

  if (allowUnassigned) {
    return { id: null, name: "" }
  }

  return { id: fallback.id, name: fallback.name }
}

function getDefaultPipeline(client: Database.Database = db()) {
  const row = client
    .prepare(
      `SELECT id, name, COALESCE(is_default, 0) as isDefault, created_at as createdAt
       FROM deal_pipelines
       ORDER BY is_default DESC, id ASC
       LIMIT 1`
    )
    .get() as DealPipeline | undefined

  return row
    ? {
        id: toNumber(row.id),
        name: String(row.name ?? ""),
        isDefault: Boolean(row.isDefault),
        createdAt: String(row.createdAt ?? ""),
      }
    : null
}

function getFirstStageId(client: Database.Database, pipelineId: number | null) {
  const row = client
    .prepare(
      `SELECT id FROM deal_stages
       WHERE pipeline_id = COALESCE(?, pipeline_id)
       ORDER BY position ASC, id ASC
       LIMIT 1`
    )
    .get(pipelineId) as { id: number } | undefined

  return row ? toNumber(row.id) : null
}

function getStage(client: Database.Database, stageId: number) {
  return client
    .prepare(
      `SELECT id, pipeline_id as pipelineId, name, position, COALESCE(color, '') as color,
        COALESCE(is_closed, 0) as isClosed, COALESCE(is_won, 0) as isWon, created_at as createdAt
       FROM deal_stages
       WHERE id = ?`
    )
    .get(stageId) as DealStage | undefined
}

function getProduct(client: Database.Database, productCode: string) {
  const row = client
    .prepare(
      `SELECT code, category_path as categoryPath, article, name, unit, stock, reserved, expected,
        cost_price as costPrice, sale_price as salePrice, image_path as imagePath, updated_at as updatedAt
       FROM products
       WHERE code = ?`
    )
    .get(productCode) as Record<string, unknown> | undefined

  return row
    ? ({
        code: String(row.code ?? ""),
        categoryPath: String(row.categoryPath ?? ""),
        article: String(row.article ?? ""),
        name: String(row.name ?? ""),
        unit: String(row.unit ?? "шт"),
        imagePath: String(row.imagePath ?? ""),
        stock: toNumber(row.stock),
        reserved: toNumber(row.reserved),
        expected: toNumber(row.expected),
        available: toNumber(row.stock) - toNumber(row.reserved),
        costPrice: toNumber(row.costPrice),
        salePrice: toNumber(row.salePrice),
        updatedAt: String(row.updatedAt ?? ""),
      } satisfies Product)
    : null
}

function getDealRecord(client: Database.Database, dealId: number) {
  const deal = client.prepare("SELECT * FROM deals WHERE id = ?").get(dealId) as
    | Record<string, unknown>
    | undefined
  if (!deal) {
    throw new Error("Сделка не найдена.")
  }

  return deal
}

function listDealItems(dealId: number, client: Database.Database = db()) {
  const rows = client
    .prepare(
      `SELECT id, deal_id as dealId, product_code as productCode, product_name as productName,
        COALESCE(products.image_path, '') as imagePath,
        qty, price, COALESCE(discount_type, 'none') as discountType,
        COALESCE(discount_value, 0) as discountValue, COALESCE(discount_amount, 0) as discountAmount,
        COALESCE(total_before_discount, 0) as totalBeforeDiscount, COALESCE(total, 0) as total,
        deal_items.created_at as createdAt, deal_items.updated_at as updatedAt
       FROM deal_items
       LEFT JOIN products ON products.code = deal_items.product_code
       WHERE deal_id = ?
       ORDER BY deal_items.id ASC`
    )
    .all(dealId) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: toNumber(row.id),
    dealId: toNumber(row.dealId),
    productCode: String(row.productCode ?? ""),
    productName: String(row.productName ?? ""),
    imagePath: String(row.imagePath ?? ""),
    qty: toNumber(row.qty),
    price: toNumber(row.price),
    discountType: normalizeDiscountType(String(row.discountType ?? "none")),
    discountValue: toNumber(row.discountValue),
    discountAmount: toNumber(row.discountAmount),
    totalBeforeDiscount: toNumber(row.totalBeforeDiscount),
    total: toNumber(row.total),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  }))
}

function mapCustomer(row: Record<string, unknown>): Customer {
  return {
    id: toNumber(row.id),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    normalizedPhone: row.normalized_phone === null ? null : String(row.normalized_phone ?? ""),
    instagram: String(row.instagram ?? ""),
    source: String(row.source ?? ""),
    defaultDiscountPercent: clampPercent(toNumber(row.default_discount_percent)),
    comment: String(row.comment ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    dealsCount: row.deals_count === undefined ? undefined : toNumber(row.deals_count),
    ordersCount: row.orders_count === undefined ? undefined : toNumber(row.orders_count),
    salesCount: row.sales_count === undefined ? undefined : toNumber(row.sales_count),
  }
}

function mapDeal(row: Record<string, unknown>, items: DealItem[]): Deal {
  return {
    id: toNumber(row.id),
    number: row.number === null ? null : String(row.number ?? ""),
    customerId: row.customer_id === null || row.customer_id === undefined ? null : toNumber(row.customer_id),
    customerName: String(row.customer_name ?? ""),
    customerPhone: String(row.customer_phone ?? ""),
    customerDefaultDiscountPercent: clampPercent(toNumber(row.customerDefaultDiscountPercent)),
    responsibleUserId:
      row.responsible_user_id === null || row.responsible_user_id === undefined
        ? null
        : toNumber(row.responsible_user_id),
    responsibleUserName: String(row.responsible_user_name ?? ""),
    pipelineId: row.pipeline_id === null || row.pipeline_id === undefined ? null : toNumber(row.pipeline_id),
    stageId: row.stage_id === null || row.stage_id === undefined ? null : toNumber(row.stage_id),
    stageName: String(row.stageName ?? ""),
    stagePosition: toNumber(row.stagePosition),
    status: normalizeDealStatus(String(row.status ?? "open")),
    source: normalizeDealSource(String(row.source ?? "manual")),
    title: String(row.title ?? ""),
    dueAt: String(row.due_at ?? ""),
    deliveryType: String(row.delivery_type ?? ""),
    address: String(row.address ?? ""),
    comment: String(row.comment ?? ""),
    itemsTotal: toNumber(row.items_total),
    itemsDiscountTotal: toNumber(row.items_discount_total),
    dealDiscountType: normalizeDiscountType(String(row.deal_discount_type ?? "none")),
    dealDiscountValue: toNumber(row.deal_discount_value),
    dealDiscountAmount: toNumber(row.deal_discount_amount),
    total: toNumber(row.total),
    paid: toNumber(row.paid),
    orderId: row.order_id === null || row.order_id === undefined ? null : toNumber(row.order_id),
    orderNumber: row.orderNumber === null || row.orderNumber === undefined ? null : String(row.orderNumber ?? ""),
    orderStatus: String(row.orderStatus ?? ""),
    wazzupChatType: String(row.wazzup_chat_type ?? ""),
    wazzupChatId: String(row.wazzup_chat_id ?? ""),
    wazzupChannelId: String(row.wazzup_channel_id ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    items,
  }
}

function normalizeDealStatus(value: string): DealStatus {
  return value === "won" || value === "lost" || value === "cancelled" ? value : "open"
}

function normalizeDealSource(value: string): DealSource {
  return value === "whatsapp" || value === "instagram" || value === "site" || value === "phone"
    ? value
    : "manual"
}

function clean(value: FormDataEntryValue | string | null | undefined) {
  return String(value ?? "").trim()
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
}
