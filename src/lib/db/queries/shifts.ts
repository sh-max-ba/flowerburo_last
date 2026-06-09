import type Database from "better-sqlite3"
import { numberFromRow, rowToSale, rowToShiftRelatedOrder } from "@/lib/db-row"
import type { SaleItemRow, OrderItemRow, ShiftRow, SaleRow, ShiftRelatedOrderRow } from "@/lib/db-row"
import { normalizeDiscountType } from "@/lib/pricing"
import type {
  CashTransaction,
  CashTransactionType,
  OperatorSummary,
  OrderItem,
  PaymentMethod,
  SaleItem,
  Shift,
  ShiftDetails,
  ShiftPaymentBreakdown,
  ShiftShellData,
  ShiftSummary,
} from "../types"
import { db } from "../connection"

export function mapShift(row: ShiftRow, client: Database.Database, precomputedSummary?: ShiftSummary): Shift {
  const id = numberFromRow(row.id)
  const summary = precomputedSummary ?? calculateShiftSummary(id, client)
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

// Лёгкая загрузка контекста смены для шапки CRM: только открытая смена и её детали.
// Раньше эти 3 значения брались из полного getDashboardData() на каждой странице.
export function getShiftShellData(client: Database.Database = db()): ShiftShellData {
  const openShiftRow = client
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
    .get() as ShiftRow | undefined

  const openShift = openShiftRow ? mapShift(openShiftRow, client) : null

  return {
    defaultOpeningCash: getDefaultOpeningCash(client),
    openShift,
    openShiftDetails: openShift ? getShiftDetails(openShift.id, client) : null,
  }
}

// Лёгкая «ревизия» активных заказов для поллинга: меняется при новом заказе,
// смене статуса или оплате. Клиент делает полный refresh только когда она изменилась.
export function getOrdersActivityRevision(client: Database.Database = db()) {
  const row = client
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(MAX(COALESCE(updated_at, created_at)), '') as latest
       FROM orders
       WHERE status NOT IN ('Выдан', 'Отменен')`
    )
    .get() as { count: number; latest: string }

  return `${numberFromRow(row.count)}:${String(row.latest ?? "")}`
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
    deferredPrepayments: 0,
  }

  for (const row of rows) {
    const amount = numberFromRow(row.amount)

    // Физический разбор по наличке для expectedCash (по факту получения в смене).
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

  // Выручка признаётся по моменту ЗАВЕРШЕНИЯ заказа (кассовый принцип): продажи кассы этой
  // смены + ВСЕ деньги, полученные по заказам, завершённым в этой смене (предоплаты + доплаты),
  // независимо от того, в какую смену они оплачены. expectedCash выше остаётся «физическим»
  // (по факту получения), чтобы касса сходилась при пересчёте.
  const salesRevenueRow = client
    .prepare("SELECT COALESCE(SUM(total), 0) as v FROM sales WHERE shift_id = ? AND reversed_at IS NULL")
    .get(shiftId) as { v: number }
  const completedOrdersRevenueRow = client
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as v
       FROM cash_transactions
       WHERE type IN ('prepayment', 'order_payment', 'deal_payment')
        AND order_id IN (SELECT id FROM orders WHERE completed_shift_id = ? AND status != 'Отменен')`
    )
    .get(shiftId) as { v: number }
  summary.revenueTotal = numberFromRow(salesRevenueRow.v) + numberFromRow(completedOrdersRevenueRow.v)

  // Деньги, полученные В ЭТУ смену по заказам, ещё НЕ завершённым — в выручку не идут, но
  // физически лежат в кассе. Отдельной строкой, чтобы был виден разрыв «касса > выручка».
  const deferredRow = client
    .prepare(
      `SELECT COALESCE(SUM(cash_transactions.amount), 0) as v
       FROM cash_transactions
       JOIN orders ON orders.id = cash_transactions.order_id
       WHERE cash_transactions.shift_id = ?
        AND cash_transactions.type IN ('prepayment', 'order_payment', 'deal_payment')
        AND orders.completed_shift_id IS NULL
        AND orders.status != 'Отменен'`
    )
    .get(shiftId) as { v: number }
  summary.deferredPrepayments = numberFromRow(deferredRow.v)

  const saleDiscountRow = client
    .prepare(
      `SELECT
        COALESCE(SUM(
          COALESCE(NULLIF(total_before_discount, 0), total) - COALESCE(total, 0)
        ), 0) as discount
       FROM sales
       WHERE shift_id = ? AND reversed_at IS NULL`
    )
    .get(shiftId) as { discount: number } | undefined
  const orderDiscountRow = client
    .prepare(
      `SELECT COALESCE(SUM(
        COALESCE(items_discount_total, 0) + COALESCE(order_discount_amount, 0)
      ), 0) as discount
       FROM orders
       WHERE completed_shift_id = ? AND status != 'Отменен'`
    )
    .get(shiftId) as { discount: number } | undefined
  summary.discountTotal = numberFromRow(saleDiscountRow?.discount) + numberFromRow(orderDiscountRow?.discount)
  summary.revenueBeforeDiscount = summary.revenueTotal + summary.discountTotal

  return summary
}

// Итоги по операторам за смену (атрибуция «кто сколько провёл»). Группировка по user_id операций.
// Продажи — из sales (без сторнированных). Кассовые проводки — по типу; курьерские выплаты (cash_out
// с order_id) отделены от ручных изъятий. Возвращаем только операторов с ненулевой активностью.
export function calculateOperatorSummaries(shiftId: number, client: Database.Database = db()): OperatorSummary[] {
  const map = new Map<string, OperatorSummary>()
  const keyOf = (userId: number | null) => (userId == null ? "null" : String(userId))
  const ensure = (userId: number | null, userName: string): OperatorSummary => {
    const key = keyOf(userId)
    let entry = map.get(key)
    if (!entry) {
      entry = {
        userId,
        userName: userName.trim() || "не зафиксирован",
        salesCount: 0,
        salesTotal: 0,
        orderPaymentsTotal: 0,
        cashInTotal: 0,
        cashOutTotal: 0,
        courierPayoutTotal: 0,
        refundTotal: 0,
      }
      map.set(key, entry)
    } else if (entry.userName === "не зафиксирован" && userName.trim()) {
      entry.userName = userName.trim()
    }
    return entry
  }

  const salesRows = client
    .prepare(
      `SELECT sales.user_id as userId, COALESCE(users.name, '') as userName,
        COUNT(*) as cnt, COALESCE(SUM(sales.total), 0) as total
       FROM sales LEFT JOIN users ON users.id = sales.user_id
       WHERE sales.shift_id = ? AND sales.reversed_at IS NULL
       GROUP BY sales.user_id`
    )
    .all(shiftId) as Array<{ userId: number | null; userName: string; cnt: number; total: number }>
  for (const row of salesRows) {
    const userId = row.userId == null ? null : numberFromRow(row.userId)
    const entry = ensure(userId, String(row.userName ?? ""))
    entry.salesCount += numberFromRow(row.cnt)
    entry.salesTotal += numberFromRow(row.total)
  }

  const cashRows = client
    .prepare(
      `SELECT cash_transactions.user_id as userId, COALESCE(users.name, '') as userName,
        cash_transactions.type as type, (cash_transactions.order_id IS NOT NULL) as hasOrder,
        COALESCE(SUM(cash_transactions.amount), 0) as total
       FROM cash_transactions LEFT JOIN users ON users.id = cash_transactions.user_id
       WHERE cash_transactions.shift_id = ?
       GROUP BY cash_transactions.user_id, cash_transactions.type, hasOrder`
    )
    .all(shiftId) as Array<{
    userId: number | null
    userName: string
    type: string
    hasOrder: number
    total: number
  }>
  for (const row of cashRows) {
    const userId = row.userId == null ? null : numberFromRow(row.userId)
    const entry = ensure(userId, String(row.userName ?? ""))
    const total = numberFromRow(row.total)
    if (row.type === "prepayment" || row.type === "order_payment" || row.type === "deal_payment") {
      entry.orderPaymentsTotal += total
    } else if (row.type === "cash_in") {
      entry.cashInTotal += total
    } else if (row.type === "cash_out") {
      if (numberFromRow(row.hasOrder) === 1) {
        entry.courierPayoutTotal += total
      } else {
        entry.cashOutTotal += total
      }
    } else if (row.type === "cash_refund") {
      entry.refundTotal += total
    }
    // type === 'sale' учтён через таблицу sales (salesTotal), здесь не дублируем.
  }

  return Array.from(map.values()).filter(
    (operator) =>
      operator.salesCount > 0 ||
      operator.orderPaymentsTotal !== 0 ||
      operator.cashInTotal !== 0 ||
      operator.cashOutTotal !== 0 ||
      operator.courierPayoutTotal !== 0 ||
      operator.refundTotal !== 0
  )
}

export function getShiftDetails(
  shiftId: number,
  client: Database.Database = db(),
  options: { includeOperators?: boolean } = {}
): ShiftDetails {
  const shiftRow = client
    .prepare(
      `SELECT id, opened_at as openedAt, closed_at as closedAt, opening_cash as openingCash,
        closing_cash as closingCash, COALESCE(cashier_name, '') as cashierName, note, status,
        user_id as userId, opened_by_user_id as openedByUserId, closed_by_user_id as closedByUserId,
        COALESCE(type, 'day') as type
       FROM shifts
       WHERE id = ?`
    )
    .get(shiftId) as ShiftRow | undefined

  if (!shiftRow) {
    throw new Error("Смена не найдена.")
  }

  const summary = calculateShiftSummary(shiftId, client)
  const shift = mapShift(shiftRow, client, summary)
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
    bakaiSales: 0,
    transferSales: 0,
    cashPrepayments: 0,
    cardPrepayments: 0,
    terminalPrepayments: 0,
    mbankPrepayments: 0,
    optimaPrepayments: 0,
    elsomPrepayments: 0,
    bakaiPrepayments: 0,
    transferPrepayments: 0,
    cashOrderPayments: 0,
    cardOrderPayments: 0,
    terminalOrderPayments: 0,
    mbankOrderPayments: 0,
    optimaOrderPayments: 0,
    elsomOrderPayments: 0,
    bakaiOrderPayments: 0,
    transferOrderPayments: 0,
    cashDealPayments: 0,
    cardDealPayments: 0,
    terminalDealPayments: 0,
    mbankDealPayments: 0,
    optimaDealPayments: 0,
    elsomDealPayments: 0,
    bakaiDealPayments: 0,
    transferDealPayments: 0,
    cashIn: 0,
    cashOutOther: 0,
    courierPayouts: 0,
    cashRefund: 0,
    cardRefund: 0,
    terminalRefund: 0,
    mbankRefund: 0,
    optimaRefund: 0,
    elsomRefund: 0,
    bakaiRefund: 0,
    transferRefund: 0,
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
      if (transaction.paymentMethod === "bakai") breakdown.bakaiSales += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferSales += amount
    } else if (transaction.type === "prepayment") {
      if (transaction.paymentMethod === "cash") breakdown.cashPrepayments += amount
      if (transaction.paymentMethod === "card") breakdown.cardPrepayments += amount
      if (transaction.paymentMethod === "terminal") breakdown.terminalPrepayments += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankPrepayments += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaPrepayments += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomPrepayments += amount
      if (transaction.paymentMethod === "bakai") breakdown.bakaiPrepayments += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferPrepayments += amount
    } else if (transaction.type === "order_payment") {
      if (transaction.paymentMethod === "cash") breakdown.cashOrderPayments += amount
      if (transaction.paymentMethod === "card") breakdown.cardOrderPayments += amount
      if (transaction.paymentMethod === "terminal") breakdown.terminalOrderPayments += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankOrderPayments += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaOrderPayments += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomOrderPayments += amount
      if (transaction.paymentMethod === "bakai") breakdown.bakaiOrderPayments += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferOrderPayments += amount
    } else if (transaction.type === "deal_payment") {
      if (transaction.paymentMethod === "cash") breakdown.cashDealPayments += amount
      if (transaction.paymentMethod === "card") breakdown.cardDealPayments += amount
      if (transaction.paymentMethod === "terminal") breakdown.terminalDealPayments += amount
      if (transaction.paymentMethod === "mbank") breakdown.mbankDealPayments += amount
      if (transaction.paymentMethod === "optima") breakdown.optimaDealPayments += amount
      if (transaction.paymentMethod === "elsom") breakdown.elsomDealPayments += amount
      if (transaction.paymentMethod === "bakai") breakdown.bakaiDealPayments += amount
      if (transaction.paymentMethod === "transfer") breakdown.transferDealPayments += amount
    } else if (transaction.type === "cash_in" && transaction.paymentMethod === "cash") {
      breakdown.cashIn += amount
    } else if (transaction.type === "cash_out" && transaction.paymentMethod === "cash") {
      if (isCourierPayout) {
        breakdown.courierPayouts += amount
      } else {
        breakdown.cashOutOther += amount
      }
    }
  }

  // Возвраты для разбивки выручки по способам атрибутируются к смене ИСХОДНОГО прихода
  // (source_shift_id), а не к физической смене возврата — чтобы кросс-сменный возврат
  // уменьшал выручку прошлой смены, а не текущей. У старых строк source_shift_id = NULL →
  // COALESCE даёт физическую смену (прежнее поведение). expectedCash и summary.cashRefund
  // остаются по ФИЗИЧЕСКОЙ смене (см. calculateShiftSummary) — это другая величина.
  const refundsByMethod = client
    .prepare(
      `SELECT payment_method as paymentMethod, COALESCE(SUM(amount), 0) as amount
       FROM cash_transactions
       WHERE type = 'cash_refund' AND COALESCE(source_shift_id, shift_id) = ?
       GROUP BY payment_method`
    )
    .all(shiftId) as Array<{ paymentMethod: string; amount: number }>

  for (const refundRow of refundsByMethod) {
    const refundAmount = numberFromRow(refundRow.amount)
    if (refundRow.paymentMethod === "cash") breakdown.cashRefund += refundAmount
    else if (refundRow.paymentMethod === "card") breakdown.cardRefund += refundAmount
    else if (refundRow.paymentMethod === "terminal") breakdown.terminalRefund += refundAmount
    else if (refundRow.paymentMethod === "mbank") breakdown.mbankRefund += refundAmount
    else if (refundRow.paymentMethod === "optima") breakdown.optimaRefund += refundAmount
    else if (refundRow.paymentMethod === "elsom") breakdown.elsomRefund += refundAmount
    else if (refundRow.paymentMethod === "bakai") breakdown.bakaiRefund += refundAmount
    else if (refundRow.paymentMethod === "transfer") breakdown.transferRefund += refundAmount
  }

  const sales = (
    client
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
      .all(shiftId) as SaleRow[]
  ).map(rowToSale)
  const saleItems = client
    .prepare(
      `SELECT sale_items.id, sale_items.sale_id as saleId, sale_items.product_code as productCode,
        COALESCE(products.name, sale_items.product_code) as name, sale_items.qty,
        sale_items.unit_price as price, COALESCE(sale_items.discount_type, 'none') as discountType,
        COALESCE(sale_items.discount_value, 0) as discountValue,
        COALESCE(sale_items.discount_amount, 0) as discountAmount,
        sale_items.bouquet_id as bouquetId, COALESCE(sale_items.bouquet_name, '') as bouquetName,
        COALESCE(sale_items.bouquet_group_id, '') as bouquetGroupId,
        COALESCE(NULLIF(sale_items.total_before_discount, 0), sale_items.total) as totalBeforeDiscount,
        sale_items.total
       FROM sale_items
       LEFT JOIN products ON products.code = sale_items.product_code
       WHERE sale_items.sale_id IN (SELECT id FROM sales WHERE shift_id = ?)
       ORDER BY sale_items.sale_id DESC, sale_items.id ASC`
    )
    .all(shiftId) as SaleItemRow[]
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
        bouquetId: item.bouquetId === null || item.bouquetId === undefined ? null : numberFromRow(item.bouquetId),
        bouquetName: String(item.bouquetName ?? ""),
        bouquetGroupId: String(item.bouquetGroupId ?? ""),
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
    .all(shiftId) as ShiftRelatedOrderRow[]
  const relatedOrderItems = client
    .prepare(
      `SELECT order_items.id, order_items.order_id as orderId, order_items.product_code as productCode,
        order_items.name, COALESCE(products.image_path, '') as imagePath,
        order_items.qty, order_items.price, order_items.total,
        COALESCE(order_items.discount_type, 'none') as discountType,
        COALESCE(order_items.discount_value, 0) as discountValue,
        COALESCE(order_items.discount_amount, 0) as discountAmount,
        order_items.bouquet_id as bouquetId, COALESCE(order_items.bouquet_name, '') as bouquetName,
        COALESCE(order_items.bouquet_group_id, '') as bouquetGroupId,
        COALESCE(NULLIF(order_items.total_before_discount, 0), order_items.total) as totalBeforeDiscount
       FROM order_items
       LEFT JOIN products ON products.code = order_items.product_code
       WHERE order_id IN (
        SELECT DISTINCT order_id
        FROM cash_transactions
        WHERE shift_id = ? AND order_id IS NOT NULL
       )
       ORDER BY order_id DESC, id ASC`
    )
    .all(shiftId) as OrderItemRow[]
  const orderItemsByOrderId = new Map<number, OrderItem[]>()

  for (const item of relatedOrderItems) {
    const orderId = numberFromRow(item.orderId)
    const items = orderItemsByOrderId.get(orderId) ?? []
      items.push({
        id: numberFromRow(item.id),
        orderId,
        productCode: String(item.productCode ?? ""),
        name: String(item.name ?? ""),
        imagePath: String(item.imagePath ?? ""),
        qty: numberFromRow(item.qty),
        price: numberFromRow(item.price),
        bouquetId: item.bouquetId === null || item.bouquetId === undefined ? null : numberFromRow(item.bouquetId),
        bouquetName: String(item.bouquetName ?? ""),
        bouquetGroupId: String(item.bouquetGroupId ?? ""),
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
    relatedOrders: relatedOrderRows.map((order) =>
      rowToShiftRelatedOrder(order, orderItemsByOrderId.get(numberFromRow(order.orderId)) ?? [])
    ),
    // Свод по операторам считаем только по требованию (опция) — getShiftDetails вызывается для каждой
    // смены в дашборде, поэтому по умолчанию пропускаем (perf). Включаем на странице отчёта /shifts/[id].
    operatorSummaries: options.includeOperators ? calculateOperatorSummaries(shiftId, client) : [],
  }
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
