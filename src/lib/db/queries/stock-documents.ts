import type Database from "better-sqlite3"
import { fromDatetimeLocalValue } from "@/lib/datetime"
import { numberFromRow } from "@/lib/db-row"
import type { CurrentUser, StockDocumentType, StockOverheadKind } from "../types"
import { stockOverheadKinds } from "../types"
import { db } from "../connection"
import { getProduct, recordStockMovement } from "../ledger"
import { mapStockDocument, mapStockDocumentItem, mapStockDocumentOverhead, normalizeAllocationMethod } from "../mappers"
import { clean, parsePositiveInteger, parseStockDocumentType, roundMoney, toNumber } from "../form-parsers"
import { getRecomputeCostOnReceipt } from "./app-settings"

export function listStockDocuments(filters?: {
  type?: string
  status?: string
  query?: string
  supplierId?: string
}) {
  const client = db()
  const conditions: string[] = []
  const params: Record<string, string | number> = {}
  const type = filters?.type && filters.type !== "all" ? filters.type : ""
  const status = filters?.status && filters.status !== "all" ? filters.status : ""
  const query = String(filters?.query ?? "").trim()
  const supplierId =
    filters?.supplierId && filters.supplierId !== "all" ? Number(filters.supplierId) : 0

  if (type) {
    conditions.push("stock_documents.type = @type")
    params.type = type
  }
  if (status) {
    conditions.push("stock_documents.status = @status")
    params.status = status
  }
  if (supplierId) {
    conditions.push("stock_documents.supplier_id = @supplierId")
    params.supplierId = supplierId
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

  const overheads = client
    .prepare("SELECT * FROM stock_document_overheads WHERE document_id = ? ORDER BY id")
    .all(documentId) as Array<Record<string, unknown>>

  return mapStockDocument(row, items.map(mapStockDocumentItem), overheads.map(mapStockDocumentOverhead))
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
  const unitCostValues = formData.getAll("itemUnitCost")
  const commentValues = formData.getAll("itemComment")

  if (!productCodes.length || productCodes.every((code) => !code)) {
    throw new Error("Добавьте в акт хотя бы один товар.")
  }

  return productCodes.map((productCode, index) => {
    if (!productCode) {
      throw new Error("У каждой позиции акта должен быть товар.")
    }

    // Цена закупки опциональна (по умолчанию 0); не может быть отрицательной.
    const unitCost = roundMoney(Math.max(0, toNumber(unitCostValues[index])))

    return {
      productCode,
      qty: parsePositiveInteger(qtyValues[index], "Количество"),
      unitCost,
      comment: clean(commentValues[index]),
    }
  })
}

// Строки накладных расходов документа. Пустые/нулевые строки пропускаются.
function buildStockDocumentOverheads(formData: FormData) {
  const kinds = formData.getAll("overheadKind")
  const labels = formData.getAll("overheadLabel")
  const amounts = formData.getAll("overheadAmount")
  const count = Math.max(kinds.length, labels.length, amounts.length)

  const overheads: Array<{ kind: StockOverheadKind; label: string; amount: number }> = []
  for (let index = 0; index < count; index += 1) {
    const amount = roundMoney(Math.max(0, toNumber(amounts[index])))
    if (amount <= 0) {
      continue
    }
    const kindRaw = clean(kinds[index])
    const kind = stockOverheadKinds.has(kindRaw as StockOverheadKind) ? (kindRaw as StockOverheadKind) : "other"
    overheads.push({ kind, label: clean(labels[index]), amount })
  }

  return overheads
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
  // Накладные расходы — только для прихода. На черновике сохраняем строки расходов, сумму и метод
  // распределения; сами доли (allocated_overhead) и landed-себестоимость считаются при проведении.
  const isStockIn = documentType === "stock_in"
  const overheads = isStockIn ? buildStockDocumentOverheads(input.formData) : []
  const allocationMethod = isStockIn ? normalizeAllocationMethod(input.formData.get("allocationMethod")) : "by_value"
  const overheadTotal = roundMoney(overheads.reduce((sum, overhead) => sum + overhead.amount, 0))
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
         SET type = ?, supplier_id = ?, supplier_name = ?, comment = ?, operation_at = ?,
             overhead_total = ?, allocation_method = ?
         WHERE id = ?`
      )
      .run(
        documentType,
        supplier.supplierId,
        supplier.supplierName,
        comment,
        operationAt,
        overheadTotal,
        allocationMethod,
        documentId
      )
    client.prepare("DELETE FROM stock_document_items WHERE document_id = ?").run(documentId)
  } else {
    const documentNumber = generateStockDocumentNumberInTransaction(client, documentType)
    const document = client
      .prepare(
        `INSERT INTO stock_documents (
          number, type, status, supplier_id, supplier_name, comment, operation_at,
          overhead_total, allocation_method, created_by_user_id, created_by_name
        ) VALUES (
          @number, @type, 'draft', @supplierId, @supplierName, @comment, @operationAt,
          @overheadTotal, @allocationMethod, @createdByUserId, @createdByName
        )`
      )
      .run({
        number: documentNumber,
        type: documentType,
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        comment,
        operationAt,
        overheadTotal,
        allocationMethod,
        createdByUserId: input.currentUser.id,
        createdByName: input.currentUser.name,
      })
    documentId = Number(document.lastInsertRowid)
  }

  const insertItem = client.prepare(
    `INSERT INTO stock_document_items (
      document_id, product_code, product_name, qty, unit_cost, comment
    ) VALUES (
      @documentId, @productCode, @productName, @qty, @unitCost, @comment
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
      unitCost: item.unitCost,
      comment: item.comment,
    })
  }

  // Строки накладных расходов переписываем целиком (как и позиции).
  client.prepare("DELETE FROM stock_document_overheads WHERE document_id = ?").run(documentId)
  if (overheads.length) {
    const insertOverhead = client.prepare(
      `INSERT INTO stock_document_overheads (document_id, kind, label, amount)
       VALUES (@documentId, @kind, @label, @amount)`
    )
    for (const overhead of overheads) {
      insertOverhead.run({ documentId, kind: overhead.kind, label: overhead.label, amount: overhead.amount })
    }
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
  // Пересчёт себестоимости при приходе — за флагом (по умолчанию OFF). При OFF cost_price не меняется.
  const recomputeCost = getRecomputeCostOnReceipt(client)
  const items = client
    .prepare("SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY id")
    .all(documentId) as Array<Record<string, unknown>>
  if (!items.length) {
    throw new Error("В акте нет позиций.")
  }

  // Накладные расходы документа (только приход) и их распределение на позиции.
  const overheadRows = client
    .prepare("SELECT amount FROM stock_document_overheads WHERE document_id = ?")
    .all(documentId) as Array<Record<string, unknown>>
  const overheadTotal = roundMoney(overheadRows.reduce((sum, row) => sum + numberFromRow(row.amount), 0))
  const allocationMethod = normalizeAllocationMethod(document.allocation_method)

  const lines = items.map((item) => {
    const qty = parsePositiveInteger(String(item.qty), "Количество")
    const unitCost = numberFromRow(item.unit_cost)
    return { item, qty, unitCost, lineValue: qty * unitCost }
  })
  const goodsTotal = roundMoney(lines.reduce((sum, line) => sum + line.lineValue, 0))

  // Доли расходов по позициям: вес = стоимость строки (по стоимости) или количество (по количеству).
  // Остаток округления добавляем к строке с наибольшим весом, чтобы сумма долей сошлась ровно.
  const allocated = new Map<number, number>()
  if (type === "stock_in" && overheadTotal > 0) {
    let weights = lines.map((line) => (allocationMethod === "by_qty" ? line.qty : line.lineValue))
    let sumWeights = weights.reduce((a, b) => a + b, 0)
    if (sumWeights <= 0) {
      // Все цены закупки нулевые — распределяем по количеству.
      weights = lines.map((line) => line.qty)
      sumWeights = weights.reduce((a, b) => a + b, 0)
    }
    if (sumWeights > 0) {
      const shares = weights.map((weight) => roundMoney((overheadTotal * weight) / sumWeights))
      const assigned = roundMoney(shares.reduce((a, b) => a + b, 0))
      const remainder = roundMoney(overheadTotal - assigned)
      if (remainder !== 0) {
        let maxIndex = 0
        for (let i = 1; i < weights.length; i += 1) {
          if (weights[i] > weights[maxIndex]) {
            maxIndex = i
          }
        }
        shares[maxIndex] = roundMoney(shares[maxIndex] + remainder)
      }
      lines.forEach((line, index) => allocated.set(Number(line.item.id), shares[index]))
    }
  }

  for (const line of lines) {
    const { item, qty, unitCost } = line
    const productCode = String(item.product_code)
    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }

    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    const movementQty = type === "stock_in" ? qty : -qty
    const afterStock = beforeStock + movementQty

    const allocatedOverhead = allocated.get(Number(item.id)) ?? 0
    // landed-себестоимость единицы = (стоимость закупки строки + доля накладных) / количество.
    const landedUnitCost = type === "stock_in" ? roundMoney((qty * unitCost + allocatedOverhead) / qty) : null

    // Средневзвешенный пересчёт себестоимости — только приход, при флаге и landed > 0. Снимки
    // cost_before/after/stock_before_cost нужны для будущей корректировки; NULL — позиция не влияла.
    const oldCost = numberFromRow(product.cost_price)
    let newCost = oldCost
    let costBefore: number | null = null
    let costAfter: number | null = null
    let stockBeforeCost: number | null = null
    if (recomputeCost && type === "stock_in" && landedUnitCost !== null && landedUnitCost > 0) {
      const basis = beforeStock > 0 ? beforeStock : 0
      newCost =
        basis + qty > 0
          ? roundMoney((basis * oldCost + qty * landedUnitCost) / (basis + qty))
          : roundMoney(landedUnitCost)
      costBefore = oldCost
      costAfter = newCost
      stockBeforeCost = basis
    }

    client
      .prepare("UPDATE products SET stock = ?, cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?")
      .run(afterStock, newCost, productCode)
    client
      .prepare(
        `UPDATE stock_document_items
         SET before_stock = ?, after_stock = ?, allocated_overhead = ?, landed_unit_cost = ?,
             cost_before = ?, cost_after = ?, stock_before_cost = ?
         WHERE id = ?`
      )
      .run(beforeStock, afterStock, allocatedOverhead, landedUnitCost, costBefore, costAfter, stockBeforeCost, item.id)

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

  const landedTotal = roundMoney(goodsTotal + overheadTotal)

  client
    .prepare(
      `UPDATE stock_documents
       SET status = 'posted',
           posted_by_user_id = ?,
           posted_by_name = ?,
           operation_at = COALESCE(NULLIF(operation_at, ''), CURRENT_TIMESTAMP),
           posted_at = CURRENT_TIMESTAMP,
           goods_total = ?,
           landed_total = ?
       WHERE id = ?`
    )
    .run(currentUser.id, currentUser.name, goodsTotal, landedTotal, documentId)
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
