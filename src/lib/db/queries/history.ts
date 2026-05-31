import { rowToMovement } from "@/lib/db-row"
import type { MovementRow } from "@/lib/db-row"
import type { HistoryReportData } from "../types"
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
