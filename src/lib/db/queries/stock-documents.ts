import type Database from "better-sqlite3"
import { fromDatetimeLocalValue } from "@/lib/datetime"
import { numberFromRow } from "@/lib/db-row"
import type { AllocationMethod, CurrentUser, StockDocumentType, StockOverheadKind } from "../types"
import { stockOverheadKinds } from "../types"
import { db } from "../connection"
import { getProduct, recordStockMovement } from "../ledger"
import { mapStockDocument, mapStockDocumentItem, mapStockDocumentOverhead, normalizeAllocationMethod } from "../mappers"
import { clean, parsePositiveInteger, parseStockDocumentType, roundMoney, toNumber } from "../form-parsers"
import { getRecomputeCostOnReceipt, getTrackLotsEnabled } from "./app-settings"
import { maybeCreateReceiptLot, revertLotsForDocument } from "./stock-lots"

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

// Распределение суммы накладных расходов по позициям: вес = стоимость строки (по стоимости) или
// количество (по количеству); при нулевой сумме весов — падаем на распределение по количеству.
// Остаток округления добавляем к строке с наибольшим весом — сумма долей == overheadTotal ровно.
function allocateOverhead(
  lines: Array<{ id: number; qty: number; lineValue: number }>,
  overheadTotal: number,
  method: AllocationMethod
): Map<number, number> {
  const allocated = new Map<number, number>()
  if (overheadTotal <= 0 || lines.length === 0) {
    return allocated
  }

  let weights = lines.map((line) => (method === "by_qty" ? line.qty : line.lineValue))
  let sumWeights = weights.reduce((a, b) => a + b, 0)
  if (sumWeights <= 0) {
    weights = lines.map((line) => line.qty)
    sumWeights = weights.reduce((a, b) => a + b, 0)
  }
  if (sumWeights <= 0) {
    return allocated
  }

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
  lines.forEach((line, index) => allocated.set(line.id, shares[index]))

  return allocated
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

  // Корректировка (связана с исходным актом) проводится по особому пути: откат исходного + применение
  // исправленного, без пересчёта себестоимости (см. postStockCorrectionInTransaction).
  if (document.corrects_document_id != null) {
    postStockCorrectionInTransaction(client, documentId, currentUser)
    return
  }

  const type = parseStockDocumentType(String(document.type))
  // Пересчёт себестоимости при приходе — за флагом (по умолчанию OFF). При OFF cost_price не меняется.
  const recomputeCost = getRecomputeCostOnReceipt(client)
  // Учёт по партиям — за флагом (по умолчанию OFF). При ON приход создаёт партии для товаров с track_lots.
  const trackLotsEnabled = getTrackLotsEnabled(client)
  const receivedAt = document.operation_at == null ? null : String(document.operation_at)
  const documentSupplierId = document.supplier_id == null ? null : numberFromRow(document.supplier_id)
  const documentSupplierName = String(document.supplier_name ?? "")
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

  const allocated =
    type === "stock_in"
      ? allocateOverhead(
          lines.map((line) => ({ id: Number(line.item.id), qty: line.qty, lineValue: line.lineValue })),
          overheadTotal,
          allocationMethod
        )
      : new Map<number, number>()

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

    // Партия по строке прихода (если включён учёт по партиям и товар учитывается по партиям).
    if (type === "stock_in" && trackLotsEnabled) {
      maybeCreateReceiptLot(client, {
        product,
        qty,
        landedUnitCost,
        documentId,
        supplierId: documentSupplierId,
        supplierName: documentSupplierName,
        receivedAt,
        userId: currentUser.id,
      })
    }
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

// Проведение корректировки: откатываем влияние исходного акта на остаток и применяем исправленные
// позиции. Себестоимость (products.cost_price) НЕ пересчитывается — точное переигрывание
// средневзвешенной невозможно (начальные остатки не в журнале); при необходимости правится вручную.
// Исходный акт остаётся в истории (статус 'corrected'), журнал движений append-only.
function postStockCorrectionInTransaction(client: Database.Database, correctionId: number, currentUser: CurrentUser) {
  const correction = client.prepare("SELECT * FROM stock_documents WHERE id = ?").get(correctionId) as
    | Record<string, unknown>
    | undefined
  if (!correction) {
    throw new Error("Корректировка не найдена.")
  }
  if (String(correction.status) !== "draft") {
    throw new Error("Можно провести только черновик корректировки.")
  }
  const originalId = correction.corrects_document_id == null ? null : numberFromRow(correction.corrects_document_id)
  if (!originalId) {
    throw new Error("Это не корректировка.")
  }

  const original = client.prepare("SELECT * FROM stock_documents WHERE id = ?").get(originalId) as
    | Record<string, unknown>
    | undefined
  if (!original) {
    throw new Error("Исходный акт не найден.")
  }
  if (String(original.status) !== "posted") {
    throw new Error("Исходный акт уже не проведён (возможно, уже скорректирован).")
  }
  if (original.corrected_by_document_id != null) {
    throw new Error("Этот акт уже скорректирован.")
  }

  const correctionItems = client
    .prepare("SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY id")
    .all(correctionId) as Array<Record<string, unknown>>
  if (!correctionItems.length) {
    throw new Error("В корректировке нет позиций.")
  }
  const originalItems = client
    .prepare("SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY id")
    .all(originalId) as Array<Record<string, unknown>>

  const origNumber = String(original.number)
  const corrNumber = String(correction.number)

  // 1) Откат остатка исходного прихода: на каждую позицию -origQty.
  for (const item of originalItems) {
    const productCode = String(item.product_code)
    const qty = numberFromRow(item.qty)
    const product = getProduct(client, productCode)
    if (!product) {
      continue
    }
    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    const afterStock = beforeStock - qty
    client.prepare("UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?").run(afterStock, productCode)
    recordStockMovement(client, {
      productCode,
      type: "adjustment",
      qty: -qty,
      beforeStock,
      afterStock,
      beforeReserved,
      afterReserved: beforeReserved,
      documentId: correctionId,
      userId: currentUser.id,
      comment: `Откат акта ${origNumber} (корректировка ${corrNumber})`,
    })
  }

  // Откат партий исходного акта (если создавались) — безусловно, по document_id. Новые партии для
  // исправленных строк создаются ниже при включённом учёте по партиям.
  revertLotsForDocument(client, originalId, currentUser, `Откат партии: корректировка ${corrNumber}`)
  const trackLotsEnabled = getTrackLotsEnabled(client)
  const correctionReceivedAt = correction.operation_at == null ? null : String(correction.operation_at)
  const correctionSupplierId = correction.supplier_id == null ? null : numberFromRow(correction.supplier_id)
  const correctionSupplierName = String(correction.supplier_name ?? "")

  // 2) Применение исправленных позиций: +newQty. Накладные расходы распределяем для отображения
  // (себестоимость не трогаем).
  const overheadRows = client
    .prepare("SELECT amount FROM stock_document_overheads WHERE document_id = ?")
    .all(correctionId) as Array<Record<string, unknown>>
  const overheadTotal = roundMoney(overheadRows.reduce((sum, row) => sum + numberFromRow(row.amount), 0))
  const allocationMethod = normalizeAllocationMethod(correction.allocation_method)

  const lines = correctionItems.map((item) => {
    const qty = parsePositiveInteger(String(item.qty), "Количество")
    const unitCost = numberFromRow(item.unit_cost)
    return { item, qty, unitCost, lineValue: qty * unitCost }
  })
  const goodsTotal = roundMoney(lines.reduce((sum, line) => sum + line.lineValue, 0))
  const allocated = allocateOverhead(
    lines.map((line) => ({ id: Number(line.item.id), qty: line.qty, lineValue: line.lineValue })),
    overheadTotal,
    allocationMethod
  )

  for (const line of lines) {
    const { item, qty, unitCost } = line
    const productCode = String(item.product_code)
    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }
    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    const afterStock = beforeStock + qty
    const allocatedOverhead = allocated.get(Number(item.id)) ?? 0
    const landedUnitCost = roundMoney((qty * unitCost + allocatedOverhead) / qty)

    client.prepare("UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?").run(afterStock, productCode)
    client
      .prepare(
        `UPDATE stock_document_items
         SET before_stock = ?, after_stock = ?, allocated_overhead = ?, landed_unit_cost = ?
         WHERE id = ?`
      )
      .run(beforeStock, afterStock, allocatedOverhead, landedUnitCost, item.id)
    recordStockMovement(client, {
      productCode,
      type: "adjustment",
      qty,
      beforeStock,
      afterStock,
      beforeReserved,
      afterReserved: beforeReserved,
      documentId: correctionId,
      userId: currentUser.id,
      comment: `Корректировка акта ${origNumber}`,
    })

    // Новая партия по исправленной строке (привязана к корректировке).
    if (trackLotsEnabled) {
      maybeCreateReceiptLot(client, {
        product,
        qty,
        landedUnitCost,
        documentId: correctionId,
        supplierId: correctionSupplierId,
        supplierName: correctionSupplierName,
        receivedAt: correctionReceivedAt,
        userId: currentUser.id,
      })
    }
  }

  const landedTotal = roundMoney(goodsTotal + overheadTotal)
  client
    .prepare(
      `UPDATE stock_documents
       SET status = 'posted', posted_by_user_id = ?, posted_by_name = ?,
           operation_at = COALESCE(NULLIF(operation_at, ''), CURRENT_TIMESTAMP), posted_at = CURRENT_TIMESTAMP,
           goods_total = ?, landed_total = ?
       WHERE id = ?`
    )
    .run(currentUser.id, currentUser.name, goodsTotal, landedTotal, correctionId)
  client
    .prepare(
      "UPDATE stock_documents SET status = 'corrected', corrected_by_document_id = ?, corrected_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
    .run(correctionId, originalId)
}

// Создаёт черновик корректировки по проведённому приходному акту: копирует позиции (с ценами),
// накладные расходы, поставщика и метод распределения. Возвращает id нового черновика.
export function createStockCorrectionDraft(originalDocumentId: number, currentUser: CurrentUser) {
  const client = db()
  const run = client.transaction(() => {
    const original = client.prepare("SELECT * FROM stock_documents WHERE id = ?").get(originalDocumentId) as
      | Record<string, unknown>
      | undefined
    if (!original) {
      throw new Error("Акт склада не найден.")
    }
    if (parseStockDocumentType(String(original.type)) !== "stock_in") {
      throw new Error("Корректировать можно только приходный акт.")
    }
    if (String(original.status) !== "posted") {
      throw new Error("Корректировать можно только проведённый акт.")
    }
    if (original.corrected_by_document_id != null) {
      throw new Error("Этот акт уже скорректирован.")
    }

    const number = generateStockDocumentNumberInTransaction(client, "stock_in")
    const inserted = client
      .prepare(
        `INSERT INTO stock_documents (
          number, type, status, supplier_id, supplier_name, comment, operation_at,
          overhead_total, allocation_method, corrects_document_id, created_by_user_id, created_by_name
        ) VALUES (
          @number, 'stock_in', 'draft', @supplierId, @supplierName, @comment, @operationAt,
          @overheadTotal, @allocationMethod, @correctsId, @createdByUserId, @createdByName
        )`
      )
      .run({
        number,
        supplierId: original.supplier_id ?? null,
        supplierName: String(original.supplier_name ?? ""),
        comment: String(original.comment ?? ""),
        operationAt: original.operation_at ?? null,
        overheadTotal: numberFromRow(original.overhead_total),
        allocationMethod: normalizeAllocationMethod(original.allocation_method),
        correctsId: originalDocumentId,
        createdByUserId: currentUser.id,
        createdByName: currentUser.name,
      })
    const newId = Number(inserted.lastInsertRowid)

    const items = client
      .prepare("SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY id")
      .all(originalDocumentId) as Array<Record<string, unknown>>
    const insertItem = client.prepare(
      `INSERT INTO stock_document_items (document_id, product_code, product_name, qty, unit_cost, comment)
       VALUES (@documentId, @productCode, @productName, @qty, @unitCost, @comment)`
    )
    for (const item of items) {
      insertItem.run({
        documentId: newId,
        productCode: String(item.product_code),
        productName: String(item.product_name ?? ""),
        qty: numberFromRow(item.qty),
        unitCost: numberFromRow(item.unit_cost),
        comment: String(item.comment ?? ""),
      })
    }

    const overheads = client
      .prepare("SELECT * FROM stock_document_overheads WHERE document_id = ? ORDER BY id")
      .all(originalDocumentId) as Array<Record<string, unknown>>
    const insertOverhead = client.prepare(
      `INSERT INTO stock_document_overheads (document_id, kind, label, amount)
       VALUES (@documentId, @kind, @label, @amount)`
    )
    for (const overhead of overheads) {
      insertOverhead.run({
        documentId: newId,
        kind: String(overhead.kind ?? "other"),
        label: String(overhead.label ?? ""),
        amount: numberFromRow(overhead.amount),
      })
    }

    return newId
  })

  return run()
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
