import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { fromDatetimeLocalValue, SHOP_UTC_OFFSET_SQL } from "@/lib/datetime"
import type { CurrentUser, PaymentMethod } from "../types"
import { db } from "../connection"
import { recordCashTransaction } from "../ledger"
import { clean, parsePaymentMethod, roundMoney, toNumber } from "../form-parsers"
import { requireOpenShift } from "./shifts"

// Расчёты с поставщиками. Долг по акту = goods_total − paid_amount (только проведённый приход, см.
// mapStockDocument). Погашение долга разносится по актам поставщика от старого к новому (FIFO) или
// по одному указанному акту; каждая доля пишется строкой журнала supplier_payments и увеличивает
// paid_amount акта — так все существующие места (список актов, аналитика) видят новый долг.

export type SupplierPaymentSource = "repayment" | "document" | "backfill"

export type SupplierPayment = {
  id: number
  supplierId: number | null
  supplierName: string
  documentId: number | null
  documentNumber: string | null
  batchId: string
  amount: number
  paymentMethod: PaymentMethod
  source: SupplierPaymentSource
  paidAt: string
  comment: string
  cashTransactionId: number | null
  userName: string
  createdAt: string
}

export type SupplierDebtDocument = {
  id: number
  number: string
  operationAt: string
  goodsTotal: number
  paidAmount: number
  debt: number
}

export type SupplierSettlement = {
  supplierId: number
  purchasedTotal: number
  paidTotal: number
  debt: number
  debtDocsCount: number
  lastPaymentAt: string | null
}

const PAYMENT_SELECT = `SELECT p.id, p.supplier_id as supplierId, p.supplier_name as supplierName,
    p.document_id as documentId, d.number as documentNumber, p.batch_id as batchId, p.amount,
    p.payment_method as paymentMethod, p.source, p.paid_at as paidAt, COALESCE(p.comment, '') as comment,
    p.cash_transaction_id as cashTransactionId, COALESCE(p.user_name, '') as userName, p.created_at as createdAt
   FROM supplier_payments p
   LEFT JOIN stock_documents d ON d.id = p.document_id`

function mapPayment(row: Record<string, unknown>): SupplierPayment {
  return {
    id: numberFromRow(row.id),
    supplierId: row.supplierId === null || row.supplierId === undefined ? null : numberFromRow(row.supplierId),
    supplierName: String(row.supplierName ?? ""),
    documentId: row.documentId === null || row.documentId === undefined ? null : numberFromRow(row.documentId),
    documentNumber: row.documentNumber ? String(row.documentNumber) : null,
    batchId: String(row.batchId ?? ""),
    amount: roundMoney(numberFromRow(row.amount)),
    paymentMethod: String(row.paymentMethod ?? "cash") as PaymentMethod,
    source: (String(row.source ?? "repayment") as SupplierPaymentSource) ?? "repayment",
    paidAt: String(row.paidAt ?? ""),
    comment: String(row.comment ?? ""),
    cashTransactionId:
      row.cashTransactionId === null || row.cashTransactionId === undefined ? null : numberFromRow(row.cashTransactionId),
    userName: String(row.userName ?? ""),
    createdAt: String(row.createdAt ?? ""),
  }
}

// Оплаты поставщика (или всех) — свежие сверху. Период — по дате оплаты в поясе магазина.
export function listSupplierPayments(
  filters?: { supplierId?: number | null; documentId?: number; dateFrom?: string; dateTo?: string; limit?: number },
  client: Database.Database = db()
): SupplierPayment[] {
  const conditions: string[] = []
  const params: Record<string, string | number> = {}
  if (filters?.supplierId !== undefined && filters.supplierId !== null) {
    conditions.push("p.supplier_id = @supplierId")
    params.supplierId = filters.supplierId
  }
  if (filters?.documentId) {
    conditions.push("p.document_id = @documentId")
    params.documentId = filters.documentId
  }
  if (filters?.dateFrom) {
    conditions.push(`DATE(p.paid_at, '${SHOP_UTC_OFFSET_SQL}') >= @dateFrom`)
    params.dateFrom = filters.dateFrom
  }
  if (filters?.dateTo) {
    conditions.push(`DATE(p.paid_at, '${SHOP_UTC_OFFSET_SQL}') <= @dateTo`)
    params.dateTo = filters.dateTo
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const rows = client
    .prepare(`${PAYMENT_SELECT} ${where} ORDER BY p.paid_at DESC, p.id DESC LIMIT @limit`)
    .all({ ...params, limit: filters?.limit ?? 500 }) as Array<Record<string, unknown>>
  return rows.map(mapPayment)
}

// Проведённые приходы поставщика с непогашенным долгом — от старого к новому (порядок погашения).
export function listSupplierDebtDocuments(supplierId: number, client: Database.Database = db()): SupplierDebtDocument[] {
  const rows = client
    .prepare(
      `SELECT id, number, COALESCE(operation_at, created_at) as operationAt, goods_total as goodsTotal,
        paid_amount as paidAmount
       FROM stock_documents
       WHERE type = 'stock_in' AND status = 'posted' AND supplier_id = ? AND goods_total - paid_amount > 0.005
       ORDER BY COALESCE(operation_at, created_at) ASC, id ASC`
    )
    .all(supplierId) as Array<Record<string, unknown>>
  return rows.map((row) => {
    const goodsTotal = roundMoney(numberFromRow(row.goodsTotal))
    const paidAmount = roundMoney(numberFromRow(row.paidAmount))
    return {
      id: numberFromRow(row.id),
      number: String(row.number ?? ""),
      operationAt: String(row.operationAt ?? ""),
      goodsTotal,
      paidAmount,
      debt: roundMoney(Math.max(0, goodsTotal - paidAmount)),
    }
  })
}

// Итоги расчётов с поставщиком за всё время: закуплено (проведённые приходы), оплачено, долг.
export function getSupplierSettlement(supplierId: number, client: Database.Database = db()): SupplierSettlement {
  const row = client
    .prepare(
      `SELECT COALESCE(SUM(goods_total), 0) as purchasedTotal, COALESCE(SUM(paid_amount), 0) as paidTotal,
        COALESCE(SUM(MAX(0, goods_total - paid_amount)), 0) as debt,
        COALESCE(SUM(CASE WHEN goods_total - paid_amount > 0.005 THEN 1 ELSE 0 END), 0) as debtDocsCount
       FROM stock_documents WHERE type = 'stock_in' AND status = 'posted' AND supplier_id = ?`
    )
    .get(supplierId) as Record<string, unknown>
  const last = client
    .prepare("SELECT MAX(paid_at) as lastPaymentAt FROM supplier_payments WHERE supplier_id = ? AND amount > 0")
    .get(supplierId) as { lastPaymentAt: string | null }
  return {
    supplierId,
    purchasedTotal: roundMoney(numberFromRow(row.purchasedTotal)),
    paidTotal: roundMoney(numberFromRow(row.paidTotal)),
    debt: roundMoney(numberFromRow(row.debt)),
    debtDocsCount: numberFromRow(row.debtDocsCount),
    lastPaymentAt: last?.lastPaymentAt ? String(last.lastPaymentAt) : null,
  }
}

export type SupplierPaymentResult = {
  amount: number
  allocations: Array<{ documentId: number; number: string; amount: number }>
  cashTransactionId: number | null
}

// Погашение долга поставщику из формы: supplierId, amount, paymentMethod, paidAt (datetime-local,
// пусто = сейчас), comment, documentId (только этот акт) и fromCash=1 (изъять наличные из кассы
// открытой смены — только для способа «наличные»). Сумма не может превышать долг: аванс хранить негде.
export function recordSupplierPayment(formData: FormData, currentUser: CurrentUser): SupplierPaymentResult {
  const client = db()
  const supplierId = Number(clean(formData.get("supplierId")))
  const amount = roundMoney(toNumber(formData.get("amount")))
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const paidAt = fromDatetimeLocalValue(formData.get("paidAt"))
  const comment = clean(formData.get("comment"))
  const documentIdRaw = Number(clean(formData.get("documentId")))
  const documentId = Number.isInteger(documentIdRaw) && documentIdRaw > 0 ? documentIdRaw : null
  const fromCash = clean(formData.get("fromCash")) === "1"

  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    throw new Error("Поставщик не указан.")
  }
  if (!(amount > 0)) {
    throw new Error("Сумма оплаты должна быть больше нуля.")
  }
  if (fromCash && paymentMethod !== "cash") {
    throw new Error("Из кассы смены можно изъять только наличные.")
  }

  const apply = client.transaction((): SupplierPaymentResult => {
    const supplier = client.prepare("SELECT id, name FROM suppliers WHERE id = ?").get(supplierId) as
      | { id: number; name: string }
      | undefined
    if (!supplier) {
      throw new Error("Поставщик не найден.")
    }

    let debtDocuments = listSupplierDebtDocuments(supplierId, client)
    if (documentId) {
      debtDocuments = debtDocuments.filter((document) => document.id === documentId)
      if (!debtDocuments.length) {
        throw new Error("По этому акту долга нет.")
      }
    }
    const totalDebt = roundMoney(debtDocuments.reduce((sum, document) => sum + document.debt, 0))
    if (totalDebt <= 0) {
      throw new Error("Долга перед поставщиком нет.")
    }
    if (amount > totalDebt + 0.005) {
      throw new Error(`Сумма больше долга (${formatSom(totalDebt)}). Аванс поставщику не учитывается.`)
    }

    // Наличные из кассы — проводка cash_out в открытой смене, до записи оплат (нет смены — ничего не пишем).
    let cashTransactionId: number | null = null
    if (fromCash) {
      const shift = requireOpenShift(client)
      recordCashTransaction(client, {
        shiftId: shift.id,
        userId: currentUser.id,
        type: "cash_out",
        paymentMethod: "cash",
        amount,
        comment: `Оплата поставщику «${supplier.name}»${comment ? ` — ${comment}` : ""}`,
      })
      cashTransactionId = numberFromRow((client.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id)
    }

    const batchId = `pay:${randomUUID()}`
    const insert = client.prepare(
      `INSERT INTO supplier_payments (
        supplier_id, supplier_name, document_id, batch_id, amount, payment_method, source, paid_at, comment,
        cash_transaction_id, user_id, user_name
      ) VALUES (
        @supplierId, @supplierName, @documentId, @batchId, @amount, @paymentMethod, 'repayment', @paidAt, @comment,
        @cashTransactionId, @userId, @userName
      )`
    )
    const bump = client.prepare("UPDATE stock_documents SET paid_amount = ROUND(paid_amount + ?, 2) WHERE id = ?")

    const allocations: SupplierPaymentResult["allocations"] = []
    let remaining = amount
    for (const document of debtDocuments) {
      if (remaining <= 0.005) break
      const share = roundMoney(Math.min(document.debt, remaining))
      insert.run({
        supplierId,
        supplierName: supplier.name,
        documentId: document.id,
        batchId,
        amount: share,
        paymentMethod,
        paidAt,
        comment,
        cashTransactionId,
        userId: currentUser.id,
        userName: currentUser.name,
      })
      bump.run(share, document.id)
      allocations.push({ documentId: document.id, number: document.number, amount: share })
      remaining = roundMoney(remaining - share)
    }

    return { amount, allocations, cashTransactionId }
  })

  return apply()
}

// Сумма «оплачено» изменилась в форме акта — фиксируем дельту в журнале (source = document), чтобы
// журнал сходился с paid_amount. Вызывается из сохранения черновика внутри его транзакции.
export function recordDocumentPaidDelta(
  client: Database.Database,
  input: {
    documentId: number
    documentNumber: string
    supplierId: number | null
    supplierName: string
    previousPaid: number
    nextPaid: number
    paidAt: string
    currentUser: CurrentUser
  }
) {
  const delta = roundMoney(input.nextPaid - input.previousPaid)
  if (Math.abs(delta) < 0.005) {
    return
  }
  client
    .prepare(
      `INSERT INTO supplier_payments (
        supplier_id, supplier_name, document_id, batch_id, amount, payment_method, source, paid_at, comment,
        user_id, user_name
      ) VALUES (
        @supplierId, @supplierName, @documentId, @batchId, @amount, 'cash', 'document', @paidAt, @comment,
        @userId, @userName
      )`
    )
    .run({
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      documentId: input.documentId,
      batchId: `doc:${input.documentId}:${randomUUID()}`,
      amount: delta,
      paidAt: input.paidAt,
      comment: delta > 0 ? `Оплачено в акте ${input.documentNumber}` : `Уменьшено «оплачено» в акте ${input.documentNumber}`,
      userId: input.currentUser.id,
      userName: input.currentUser.name,
    })
}

// Корректировка заменила исходный акт — оплаты переезжают на новый документ, чтобы журнал и долг
// (paid_amount скопирован в корректировку) указывали на один и тот же акт.
export function moveSupplierPaymentsToDocument(client: Database.Database, fromDocumentId: number, toDocumentId: number) {
  client.prepare("UPDATE supplier_payments SET document_id = ? WHERE document_id = ?").run(toDocumentId, fromDocumentId)
}

function formatSom(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value).replace(/ /g, " ")} сом`
}
