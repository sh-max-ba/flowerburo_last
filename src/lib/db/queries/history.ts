import { rowToMovement } from "@/lib/db-row"
import type { MovementRow } from "@/lib/db-row"
import type { CashLedgerEntry, CashLedgerLineItem, HistoryReportData } from "../types"
import { db } from "../connection"

export function getHistoryReportData(): HistoryReportData {
  const client = db()

  return {
    operations: (client.prepare(historyOperationsQuery()).all() as MovementRow[]).map(rowToMovement),
    stockMovements: (client.prepare(stockMovementsQuery()).all() as MovementRow[]).map(rowToMovement),
  }
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
        cash_transactions.sale_id as saleId, cash_transactions.deal_id as dealId,
        cash_transactions.user_id as userId, COALESCE(users.name, '') as userName,
        COALESCE(NULLIF(orders.customer, ''), NULLIF(sales.customer_name, ''), '') as customerName,
        cash_transactions.type, cash_transactions.payment_method as paymentMethod,
        cash_transactions.amount, COALESCE(cash_transactions.comment, '') as comment,
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
