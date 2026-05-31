import type Database from "better-sqlite3"
import { fromDatetimeLocalValue } from "@/lib/datetime"
import { numberFromRow } from "@/lib/db-row"
import type { CurrentUser, StockDocumentType } from "../types"
import { db } from "../connection"
import { getProduct, recordStockMovement } from "../ledger"
import { mapStockDocument, mapStockDocumentItem } from "../mappers"
import { clean, parsePositiveInteger, parseStockDocumentType } from "../form-parsers"

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
