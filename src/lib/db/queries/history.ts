import { rowToMovement } from "@/lib/db-row"
import type { MovementRow } from "@/lib/db-row"
import { SHOP_UTC_OFFSET_SQL } from "@/lib/datetime"
import type { CashLedgerEntry, CashLedgerLineItem, HistoryReportData, Movement } from "../types"
import { db } from "../connection"

export function getHistoryReportData(): HistoryReportData {
  const client = db()

  return {
    operations: (client.prepare(historyOperationsQuery()).all() as MovementRow[]).map(rowToMovement),
    stockMovements: (client.prepare(stockMovementsQuery()).all() as MovementRow[]).map(rowToMovement),
  }
}

// Типы движений, доступные фильтру «Истории склада» (совпадают с бейджами в таблице).
const filterableMovementTypes = new Set(["sale", "order_fulfill", "stock_in", "stock_out", "adjustment", "import"])

export type StockMovementFilters = {
  dateFrom?: string
  dateTo?: string
  direction?: string
  type?: string
  query?: string
  category?: string
}

// Значение фильтра «Без категории» (товар с пустым category_path).
export const NO_CATEGORY_FILTER = "__none__"

// Реализация со склада = продажи с кассы и выдача заказов.
const SOLD_TYPES_SQL = "stock_movements.type IN ('sale', 'order_fulfill')"

// Верхний уровень категории товара («Базовый цветок 65%/Розы» → «Базовый цветок 65%»).
const TOP_CATEGORY_SQL = `CASE
    WHEN instr(COALESCE(products.category_path, ''), '/') > 0
    THEN substr(products.category_path, 1, instr(products.category_path, '/') - 1)
    ELSE COALESCE(NULLIF(products.category_path, ''), 'Без категории')
  END`

// Общий WHERE для списка, сводки и экспорта «Истории склада» — фильтры считаются
// по одной и той же выборке, иначе плитки сводки разойдутся с таблицей.
function buildStockMovementConditions(filters?: StockMovementFilters) {
  const conditions = ["stock_movements.type NOT IN ('reserve', 'reserve_cancel')"]
  const params: Record<string, string | number> = {}
  const operationDate = `DATE(stock_movements.created_at, '${SHOP_UTC_OFFSET_SQL}')`
  const dateFrom = String(filters?.dateFrom ?? "").trim()
  const dateTo = String(filters?.dateTo ?? "").trim()
  const direction = filters?.direction ?? "all"
  const query = String(filters?.query ?? "").trim()
  const category = String(filters?.category ?? "").trim()

  if (dateFrom) {
    conditions.push(`${operationDate} >= @dateFrom`)
    params.dateFrom = dateFrom
  }
  if (dateTo) {
    conditions.push(`${operationDate} <= @dateTo`)
    params.dateTo = dateTo
  }
  if (direction === "in") {
    conditions.push("stock_movements.qty > 0")
  } else if (direction === "out") {
    conditions.push("stock_movements.qty < 0")
  }
  const type = String(filters?.type ?? "").trim()
  if (type && filterableMovementTypes.has(type)) {
    conditions.push("stock_movements.type = @type")
    params.type = type
  }
  if (query) {
    conditions.push("(products.name LIKE @query OR stock_movements.product_code LIKE @query)")
    params.query = `%${query}%`
  }
  if (category === NO_CATEGORY_FILTER) {
    conditions.push("(products.category_path IS NULL OR products.category_path = '')")
  } else if (category && category !== "all") {
    // Фильтр по верхней категории: точное совпадение или подкатегория «Топ/…».
    conditions.push("(products.category_path = @category OR products.category_path LIKE @categoryPrefix)")
    params.category = category
    params.categoryPrefix = `${category}/%`
  }

  return { conditions, params }
}

// Движение с товарной аналитикой: категория и ТЕКУЩИЕ цены карточки товара. Движения не хранят
// цену на момент операции, поэтому суммы по себестоимости/цене продажи — оценка по текущим ценам
// (так же считает отчёт «Остатки»).
export type StockHistoryMovement = Movement & {
  categoryPath: string
  unitCost: number | null
  salePrice: number | null
}

// Фильтруемый список складских движений для страницы «История склада».
// Период — по дате в таймзоне магазина; направление — приход (qty>0) / расход (qty<0);
// тип — конкретный вид движения; поиск — по названию/коду товара; категория — верхний уровень.
// Лимит + флаг усечения, чтобы не грузить всю историю.
export function listStockMovements(
  filters?: StockMovementFilters,
  limit = 1000
): { movements: StockHistoryMovement[]; truncated: boolean } {
  const client = db()
  const { conditions, params } = buildStockMovementConditions(filters)

  const sql = `SELECT
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
     stock_movements.created_at as createdAt,
     COALESCE(products.category_path, '') as categoryPath,
     products.cost_price as unitCost,
     products.sale_price as salePrice
   FROM stock_movements
   LEFT JOIN products ON products.code = stock_movements.product_code
   LEFT JOIN users ON users.id = stock_movements.user_id
   LEFT JOIN stock_documents ON stock_documents.id = stock_movements.document_id
   WHERE ${conditions.join(" AND ")}
   ORDER BY stock_movements.created_at DESC, stock_movements.id DESC
   LIMIT @limitPlusOne`

  const rows = client.prepare(sql).all({ ...params, limitPlusOne: limit + 1 }) as Array<
    MovementRow & { categoryPath: string | null; unitCost: number | null; salePrice: number | null }
  >
  const truncated = rows.length > limit
  const movements = rows.slice(0, limit).map((row) => ({
    ...rowToMovement(row),
    categoryPath: String(row.categoryPath ?? ""),
    unitCost: row.unitCost === null || row.unitCost === undefined ? null : Number(row.unitCost),
    salePrice: row.salePrice === null || row.salePrice === undefined ? null : Number(row.salePrice),
  }))
  return { movements, truncated }
}

export type StockMovementsSummary = {
  movementsCount: number
  // Реализация (продажи + выдача заказов), нетто по qty.
  soldQty: number
  soldCost: number
  soldValue: number
  // Приход на склад (qty > 0, все типы) и расход БЕЗ реализации (списания/корректировки/минус).
  inQty: number
  outQty: number
  byType: Array<{ type: string; count: number; inQty: number; outQty: number }>
  soldByCategory: Array<{ category: string; qty: number; cost: number; value: number }>
}

// Аналитика по ВСЕЙ отфильтрованной выборке (без лимита списка): итоги, разбивка по типам движений
// и разбивка реализации по верхним категориям. Суммы — по текущим ценам карточки товара.
export function summarizeStockMovements(filters?: StockMovementFilters): StockMovementsSummary {
  const client = db()
  const { conditions, params } = buildStockMovementConditions(filters)
  const fromWhere = `FROM stock_movements
   LEFT JOIN products ON products.code = stock_movements.product_code
   WHERE ${conditions.join(" AND ")}`

  const totals = client
    .prepare(
      `SELECT
        COUNT(*) as movementsCount,
        COALESCE(SUM(CASE WHEN ${SOLD_TYPES_SQL} THEN -stock_movements.qty ELSE 0 END), 0) as soldQty,
        COALESCE(SUM(CASE WHEN ${SOLD_TYPES_SQL} THEN -stock_movements.qty * COALESCE(products.cost_price, 0) ELSE 0 END), 0) as soldCost,
        COALESCE(SUM(CASE WHEN ${SOLD_TYPES_SQL} THEN -stock_movements.qty * COALESCE(products.sale_price, 0) ELSE 0 END), 0) as soldValue,
        COALESCE(SUM(CASE WHEN stock_movements.qty > 0 THEN stock_movements.qty ELSE 0 END), 0) as inQty,
        COALESCE(SUM(CASE WHEN stock_movements.qty < 0 AND NOT ${SOLD_TYPES_SQL} THEN -stock_movements.qty ELSE 0 END), 0) as outQty
       ${fromWhere}`
    )
    .get(params) as {
    movementsCount: number
    soldQty: number
    soldCost: number
    soldValue: number
    inQty: number
    outQty: number
  }

  const byType = client
    .prepare(
      `SELECT
        stock_movements.type as type,
        COUNT(*) as count,
        COALESCE(SUM(CASE WHEN stock_movements.qty > 0 THEN stock_movements.qty ELSE 0 END), 0) as inQty,
        COALESCE(SUM(CASE WHEN stock_movements.qty < 0 THEN -stock_movements.qty ELSE 0 END), 0) as outQty
       ${fromWhere}
       GROUP BY stock_movements.type
       ORDER BY count DESC`
    )
    .all(params) as StockMovementsSummary["byType"]

  const soldByCategory = client
    .prepare(
      `SELECT
        ${TOP_CATEGORY_SQL} as category,
        COALESCE(SUM(-stock_movements.qty), 0) as qty,
        COALESCE(SUM(-stock_movements.qty * COALESCE(products.cost_price, 0)), 0) as cost,
        COALESCE(SUM(-stock_movements.qty * COALESCE(products.sale_price, 0)), 0) as value
       ${fromWhere} AND ${SOLD_TYPES_SQL}
       GROUP BY category
       ORDER BY qty DESC, category`
    )
    .all(params) as StockMovementsSummary["soldByCategory"]

  return {
    movementsCount: totals.movementsCount,
    soldQty: round2(totals.soldQty),
    soldCost: round2(totals.soldCost),
    soldValue: round2(totals.soldValue),
    inQty: round2(totals.inQty),
    outQty: round2(totals.outQty),
    byType: byType.map((row) => ({ ...row, inQty: round2(row.inQty), outQty: round2(row.outQty) })),
    soldByCategory: soldByCategory.map((row) => ({
      category: row.category,
      qty: round2(row.qty),
      cost: round2(row.cost),
      value: round2(row.value),
    })),
  }
}

export type StockMovementsProductSummary = {
  productCode: string
  productName: string
  categoryPath: string
  soldQty: number
  soldCost: number
  soldValue: number
  inQty: number
  outQty: number
  movementsCount: number
}

// Разбивка отфильтрованной выборки по товарам (для листа «По товарам» в отчёте): сколько продано,
// поступило и списано по каждой позиции. Сортировка — сначала самые продаваемые.
export function summarizeStockMovementsByProduct(filters?: StockMovementFilters): StockMovementsProductSummary[] {
  const client = db()
  const { conditions, params } = buildStockMovementConditions(filters)

  const rows = client
    .prepare(
      `SELECT
        COALESCE(stock_movements.product_code, '') as productCode,
        COALESCE(products.name, stock_movements.product_code, '—') as productName,
        COALESCE(products.category_path, '') as categoryPath,
        COALESCE(SUM(CASE WHEN ${SOLD_TYPES_SQL} THEN -stock_movements.qty ELSE 0 END), 0) as soldQty,
        COALESCE(SUM(CASE WHEN ${SOLD_TYPES_SQL} THEN -stock_movements.qty * COALESCE(products.cost_price, 0) ELSE 0 END), 0) as soldCost,
        COALESCE(SUM(CASE WHEN ${SOLD_TYPES_SQL} THEN -stock_movements.qty * COALESCE(products.sale_price, 0) ELSE 0 END), 0) as soldValue,
        COALESCE(SUM(CASE WHEN stock_movements.qty > 0 THEN stock_movements.qty ELSE 0 END), 0) as inQty,
        COALESCE(SUM(CASE WHEN stock_movements.qty < 0 AND NOT ${SOLD_TYPES_SQL} THEN -stock_movements.qty ELSE 0 END), 0) as outQty,
        COUNT(*) as movementsCount
       FROM stock_movements
       LEFT JOIN products ON products.code = stock_movements.product_code
       WHERE ${conditions.join(" AND ")}
       GROUP BY stock_movements.product_code
       ORDER BY soldQty DESC, productName ASC`
    )
    .all(params) as StockMovementsProductSummary[]

  return rows.map((row) => ({
    ...row,
    soldQty: round2(row.soldQty),
    soldCost: round2(row.soldCost),
    soldValue: round2(row.soldValue),
    inQty: round2(row.inQty),
    outQty: round2(row.outQty),
  }))
}

function round2(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

export function historyOperationsQuery(limit?: number) {
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

export function stockMovementsQuery(limit?: number) {
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

// Единый кассовый реестр: все движения cash_transactions в одной хронологии
// (продажи, предоплаты, доплаты, оплаты сделок, внесения, изъятия, возвраты),
// с подписью заказа/продажи и клиента. Для страницы «История кассы» (/history).
// Имя клиента берём из денормализованного orders.customer / sales.customer_name.
export function getCashLedger(limit = 1000): CashLedgerEntry[] {
  const client = db()

  const rawEntries = client
    .prepare(
      `SELECT cash_transactions.id, cash_transactions.shift_id as shiftId,
        cash_transactions.order_id as orderId, orders.number as orderNumber,
        orders.status as orderStatus, orders.paid as orderPaid,
        orders.courier_payout as orderCourierPayout,
        cash_transactions.sale_id as saleId, cash_transactions.deal_id as dealId,
        cash_transactions.user_id as userId, COALESCE(users.name, '') as userName,
        COALESCE(NULLIF(orders.customer, ''), NULLIF(sales.customer_name, ''), '') as customerName,
        cash_transactions.type, cash_transactions.payment_method as paymentMethod,
        cash_transactions.amount,
        -- Скидка связанного документа: позиционные скидки + скидка на чек/заказ.
        -- Проводка сама скидку не хранит, поэтому берём её у продажи или заказа.
        -- Только типы, которые ЯВЛЯЮТСЯ оплатой документа: у возврата (cash_refund) и выплаты
        -- курьеру (cash_out) order_id/sale_id тоже заполнен, но скидка документа к этим деньгам
        -- отношения не имеет и в колонке читалась бы как скидка на сам возврат.
        CASE
          WHEN cash_transactions.type NOT IN ('sale', 'prepayment', 'order_payment') THEN 0
          WHEN cash_transactions.sale_id IS NOT NULL
            THEN COALESCE(sales.items_discount_total, 0) + COALESCE(sales.sale_discount_amount, 0)
          WHEN cash_transactions.order_id IS NOT NULL
            THEN COALESCE(orders.items_discount_total, 0) + COALESCE(orders.order_discount_amount, 0)
          ELSE 0
        END as discountAmount,
        -- total_before_discount появился позже документов: у старых записей там 0. Тогда
        -- восстанавливаем сумму до скидки как итог + скидка, иначе подсказка показала бы «0 сом».
        CASE
          WHEN cash_transactions.type NOT IN ('sale', 'prepayment', 'order_payment') THEN 0
          WHEN cash_transactions.sale_id IS NOT NULL
            THEN COALESCE(
              NULLIF(sales.total_before_discount, 0),
              sales.total + COALESCE(sales.items_discount_total, 0) + COALESCE(sales.sale_discount_amount, 0)
            )
          WHEN cash_transactions.order_id IS NOT NULL
            THEN COALESCE(
              NULLIF(orders.total_before_discount, 0),
              orders.total + COALESCE(orders.items_discount_total, 0) + COALESCE(orders.order_discount_amount, 0)
            )
          ELSE 0
        END as totalBeforeDiscount,
        COALESCE(cash_transactions.comment, '') as comment,
        (cash_transactions.reverses_id IS NOT NULL) as isReversal,
        EXISTS(SELECT 1 FROM cash_transactions r WHERE r.reverses_id = cash_transactions.id) as reversed,
        cash_transactions.created_at as createdAt
       FROM cash_transactions
       LEFT JOIN orders ON orders.id = cash_transactions.order_id
       LEFT JOIN sales ON sales.id = cash_transactions.sale_id
       LEFT JOIN users ON users.id = cash_transactions.user_id
       ORDER BY cash_transactions.created_at DESC, cash_transactions.id DESC
       LIMIT ?`
    )
    .all(limit) as Array<Omit<CashLedgerEntry, "items">>

  // Подтягиваем состав связанных продаж и заказов одним запросом на каждый тип —
  // для раскрытия строки по клику. Ручные внесения/изъятия позиций не имеют.
  const saleIds = [...new Set(rawEntries.map((e) => e.saleId).filter((v): v is number => v !== null))]
  const orderIds = [...new Set(rawEntries.map((e) => e.orderId).filter((v): v is number => v !== null))]

  const saleItemsBySaleId = groupItemsByParent(
    saleIds.length
      ? (client
          .prepare(
            `SELECT sale_items.sale_id as parentId, sale_items.id,
              COALESCE(products.name, sale_items.product_code) as name, sale_items.qty, sale_items.total,
              COALESCE(sale_items.bouquet_group_id, '') as bouquetGroupId,
              COALESCE(sale_items.bouquet_name, '') as bouquetName
             FROM sale_items
             LEFT JOIN products ON products.code = sale_items.product_code
             WHERE sale_items.sale_id IN (${saleIds.map(() => "?").join(",")})
             ORDER BY sale_items.sale_id DESC, sale_items.id ASC`
          )
          .all(...saleIds) as Array<CashLedgerLineItem & { parentId: number }>)
      : []
  )

  const orderItemsByOrderId = groupItemsByParent(
    orderIds.length
      ? (client
          .prepare(
            `SELECT order_items.order_id as parentId, order_items.id, order_items.name,
              order_items.qty, order_items.total,
              COALESCE(order_items.bouquet_group_id, '') as bouquetGroupId,
              COALESCE(order_items.bouquet_name, '') as bouquetName
             FROM order_items
             WHERE order_items.order_id IN (${orderIds.map(() => "?").join(",")})
             ORDER BY order_items.order_id DESC, order_items.id ASC`
          )
          .all(...orderIds) as Array<CashLedgerLineItem & { parentId: number }>)
      : []
  )

  return rawEntries.map((entry) => ({
    ...entry,
    reversed: Boolean(entry.reversed),
    isReversal: Boolean(entry.isReversal),
    discountAmount: Number(entry.discountAmount) || 0,
    totalBeforeDiscount: Number(entry.totalBeforeDiscount) || 0,
    items:
      entry.saleId !== null
        ? (saleItemsBySaleId.get(entry.saleId) ?? [])
        : entry.orderId !== null
          ? (orderItemsByOrderId.get(entry.orderId) ?? [])
          : [],
  }))
}

function groupItemsByParent(rows: Array<CashLedgerLineItem & { parentId: number }>) {
  const byParent = new Map<number, CashLedgerLineItem[]>()
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? []
    list.push({
      id: row.id,
      name: row.name,
      qty: row.qty,
      total: row.total,
      bouquetGroupId: row.bouquetGroupId,
      bouquetName: row.bouquetName,
    })
    byParent.set(row.parentId, list)
  }
  return byParent
}
