import {
  mapOrderRow,
  mapProductRow,
  numberFromRow,
  rowToCustomerOption,
  rowToMovement,
  rowToSale,
} from "@/lib/db-row"
import type {
  CustomerOptionRow,
  MovementRow,
  OrderItemRow,
  SaleRow,
  ShiftRow,
} from "@/lib/db-row"
import { normalizeDiscountType } from "@/lib/pricing"
import type { DashboardData, Order, OrderItem, ProductRow } from "../types"
import type Database from "better-sqlite3"
import { db } from "../connection"
import { getDraftPriceChanges } from "../domain/order-lifecycle"
import { orderStatusSort } from "../form-parsers"
import { getDefaultOpeningCash, getShiftDetails, mapShift } from "./shifts"
import { listUsers } from "./users"
import { listSuppliers } from "./suppliers"
import { listBouquetTemplates } from "./bouquets"
import { historyOperationsQuery, stockMovementsQuery } from "./history"

export function getDashboardData(): DashboardData {
  const client = db()
  const products = (
    client
      .prepare(
        `SELECT * FROM products
         WHERE COALESCE(is_active, 1) = 1
         ORDER BY
          CASE WHEN stock - reserved < 0 THEN 0 WHEN stock - reserved <= 3 THEN 1 ELSE 2 END,
          name COLLATE NOCASE
         LIMIT 234`
      )
      .all() as ProductRow[]
  ).map(mapProductRow)

  const sales = (
    client
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
        sales.total, sales.note, sales.created_at as createdAt, sales.reversed_at as reversedAt,
        COUNT(sale_items.id) as itemsCount
       FROM sales
       LEFT JOIN sale_items ON sale_items.sale_id = sales.id
       LEFT JOIN users ON users.id = sales.user_id
       GROUP BY sales.id
       ORDER BY sales.created_at DESC
       LIMIT 30`
      )
      .all() as SaleRow[]
  ).map(rowToSale)

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
      .all() as ShiftRow[]
  ).map((shift) => mapShift(shift, client))
  const shiftDetails = shifts.map((shift) => getShiftDetails(shift.id, client))

  const orderRows = client
    .prepare(
      `SELECT ${ORDER_LIST_COLUMNS}
       FROM orders
       WHERE status != 'Черновик'
       ORDER BY due_at ASC, created_at DESC
       LIMIT 80`
    )
    .all() as Array<Record<string, unknown>>

  const itemsByOrder = loadOrderItemsByOrder(client, orderRows.map((order) => numberFromRow(order.id)))

  const orders = orderRows
    .map((row) => mapOrderRow(row, itemsByOrder.get(numberFromRow(row.id)) ?? []))
    .sort((left, right) => orderStatusSort(left.status) - orderStatusSort(right.status))

  const movements = (client
    .prepare(historyOperationsQuery(80))
    .all() as MovementRow[]).map(rowToMovement)

  const stockMovements = (client
    .prepare(stockMovementsQuery(120))
    .all() as MovementRow[]).map(rowToMovement)

  const customers = (client
    .prepare(
      `SELECT id, name, COALESCE(phone, '') as phone,
        COALESCE(default_discount_percent, 0) as defaultDiscountPercent
       FROM customers
       ORDER BY name COLLATE NOCASE, id DESC
       LIMIT 200`
    )
    .all() as CustomerOptionRow[]).map(rowToCustomerOption)

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
    bouquetTemplates: listBouquetTemplates(),
    stats: {
      productsCount: products.length,
      lowStockCount: products.filter((product) => product.available > 0 && product.available <= 3).length,
      negativeStockCount: products.filter((product) => product.available < 0).length,
      reservedCount: products.filter((product) => product.reserved > 0).length,
      openOrdersCount: orders.filter((order) => !["Выдан", "Отменен", "Передан курьеру"].includes(order.status)).length,
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

// Единый список колонок заказа (используется основным запросом дашборда и списком черновиков).
const ORDER_LIST_COLUMNS = `id, number, customer_id as customerId, deal_id as dealId, customer, phone,
  COALESCE(recipient_phone, '') as recipientPhone, COALESCE(source, '') as source,
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
  COALESCE(courier_name, '') as courierName, created_at as createdAt, updated_at as updatedAt,
  COALESCE(is_modified, 0) as isModified`

function loadOrderItemsByOrder(client: Database.Database, orderIds: number[]): Map<number, OrderItem[]> {
  const itemsByOrder = new Map<number, OrderItem[]>()
  if (!orderIds.length) {
    return itemsByOrder
  }
  const placeholders = orderIds.map(() => "?").join(", ")
  const itemRows = client
    .prepare(
      `SELECT order_items.id, order_items.order_id as orderId, order_items.product_code as productCode,
        order_items.name, COALESCE(products.image_path, '') as imagePath,
        order_items.qty, order_items.price,
        COALESCE(order_items.discount_type, 'none') as discountType,
        COALESCE(order_items.discount_value, 0) as discountValue,
        COALESCE(order_items.discount_amount, 0) as discountAmount,
        order_items.bouquet_id as bouquetId, COALESCE(order_items.bouquet_name, '') as bouquetName,
        COALESCE(order_items.bouquet_group_id, '') as bouquetGroupId,
        COALESCE(NULLIF(order_items.total_before_discount, 0), order_items.total) as totalBeforeDiscount,
        order_items.total
       FROM order_items
       LEFT JOIN products ON products.code = order_items.product_code
       WHERE order_id IN (${placeholders})
       ORDER BY id ASC`
    )
    .all(...orderIds) as OrderItemRow[]

  for (const row of itemRows) {
    const orderId = numberFromRow(row.orderId)
    const items = itemsByOrder.get(orderId) ?? []
    items.push({
      id: numberFromRow(row.id),
      orderId,
      productCode: String(row.productCode ?? ""),
      name: String(row.name ?? ""),
      imagePath: String(row.imagePath ?? ""),
      qty: numberFromRow(row.qty),
      price: numberFromRow(row.price),
      bouquetId: row.bouquetId === null || row.bouquetId === undefined ? null : numberFromRow(row.bouquetId),
      bouquetName: String(row.bouquetName ?? ""),
      bouquetGroupId: String(row.bouquetGroupId ?? ""),
      discountType: normalizeDiscountType(String(row.discountType ?? "none")),
      discountValue: numberFromRow(row.discountValue),
      discountAmount: numberFromRow(row.discountAmount),
      totalBeforeDiscount: numberFromRow(row.totalBeforeDiscount) || numberFromRow(row.total),
      total: numberFromRow(row.total),
    })
    itemsByOrder.set(orderId, items)
  }
  return itemsByOrder
}

export type DraftOrderView = Order & { priceChanges: Array<{ name: string; oldPrice: number; newPrice: number }> }

// Черновики заказов для стола /orders (отдельной выборкой — НЕ в основном окне LIMIT 80). С позициями
// и расхождениями цен (для подтверждения при отправке в работу).
export function listOrderDrafts(): DraftOrderView[] {
  const client = db()
  const orderRows = client
    .prepare(`SELECT ${ORDER_LIST_COLUMNS} FROM orders WHERE status = 'Черновик' ORDER BY created_at DESC LIMIT 200`)
    .all() as Array<Record<string, unknown>>
  const itemsByOrder = loadOrderItemsByOrder(client, orderRows.map((order) => numberFromRow(order.id)))
  return orderRows.map((row) => {
    const order = mapOrderRow(row, itemsByOrder.get(numberFromRow(row.id)) ?? [])
    return { ...order, priceChanges: getDraftPriceChanges(order.id) }
  })
}
