import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import type { CashTransactionType, PaymentMethod, ProductRow, StockMovementType } from "./types"
import { cashTransactionTypes, paymentMethods, stockMovementTypes } from "./types"

export function getProduct(client: Database.Database, code: string) {
  return client.prepare("SELECT * FROM products WHERE code = ?").get(code) as ProductRow | undefined
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

export function addMovement(
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

export function applyProductDelta(
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
    enforceAvailable?: boolean
  }
) {
  const product = getProduct(client, input.productCode)
  if (!product) {
    throw new Error(`Товар ${input.productCode} не найден.`)
  }

  const beforeStock = numberFromRow(product.stock)
  const beforeReserved = numberFromRow(product.reserved)

  // Запрет перепродажи при резервировании (заказы/сделки). Касса остаётся без проверки.
  if (input.enforceAvailable && (input.reservedDelta ?? 0) > 0) {
    const available = beforeStock - beforeReserved
    if (available < (input.reservedDelta ?? 0)) {
      throw new Error(
        `Недостаточно остатка для «${String(product.name)}»: доступно ${available}, требуется ${input.reservedDelta ?? 0}.`
      )
    }
  }

  const afterStock = beforeStock + (input.stockDelta ?? 0)
  // Резерв не может быть отрицательным: защита от рассинхрона ledger'а (например,
  // если резерв был перезаписан импортом, а затем отменяется заказ).
  const afterReserved = Math.max(0, beforeReserved + (input.reservedDelta ?? 0))

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
