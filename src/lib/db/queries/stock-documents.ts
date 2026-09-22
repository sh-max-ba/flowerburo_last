import type Database from "better-sqlite3"
import { fromDatetimeLocalValue, SHOP_UTC_OFFSET_SQL } from "@/lib/datetime"
import { numberFromRow } from "@/lib/db-row"
import type { AllocationMethod, CurrentUser, StockDocumentType, StockOverheadKind } from "../types"
import { stockOverheadKinds } from "../types"
import { db } from "../connection"
import { getProduct, recordStockMovement } from "../ledger"
import { mapStockDocument, mapStockDocumentItem, mapStockDocumentOverhead, normalizeAllocationMethod } from "../mappers"
import { clean, parsePositiveInteger, parseStockDocumentType, roundMoney, toNumber } from "../form-parsers"
import { allocateOverheadShares, landedUnitCostOf } from "@/lib/stock-costing"
import { getRecomputeCostOnReceipt, getTrackLotsEnabled } from "./app-settings"
import { maybeCreateReceiptLot, revertLotsForDocument } from "./stock-lots"

export function listStockDocuments(filters?: {
  type?: string
  status?: string
  query?: string
  supplierId?: string
  dateFrom?: string
  dateTo?: string
  sumFrom?: string
  sumTo?: string
}) {
  const client = db()
  const conditions: string[] = []
  const params: Record<string, string | number> = {}
  const type = filters?.type && filters.type !== "all" ? filters.type : ""
  const status = filters?.status && filters.status !== "all" ? filters.status : ""
  const query = String(filters?.query ?? "").trim()
  // supplier: "all" | "none" (без поставщика) | список id через запятую («1,4,7»).
  // Множественный выбор — фильтр контрагентов в тулбаре; одиночный id из старых ссылок тоже работает.
  const supplierRaw = String(filters?.supplierId ?? "").trim()
  const supplierIds =
    supplierRaw && supplierRaw !== "all" && supplierRaw !== "none"
      ? [
          ...new Set(
            supplierRaw
              .split(",")
              .map((value) => Number(value.trim()))
              .filter((value) => Number.isInteger(value) && value > 0)
          ),
        ]
      : []
  // Период по «дате операции» (operation_at, при отсутствии — created_at), приведённой к таймзоне магазина.
  const dateFrom = String(filters?.dateFrom ?? "").trim()
  const dateTo = String(filters?.dateTo ?? "").trim()
  const operationDate = `DATE(COALESCE(stock_documents.operation_at, stock_documents.created_at), '${SHOP_UTC_OFFSET_SQL}')`

  if (type) {
    conditions.push("stock_documents.type = @type")
    params.type = type
  }
  if (status) {
    conditions.push("stock_documents.status = @status")
    params.status = status
  }
  if (supplierRaw === "none") {
    conditions.push("stock_documents.supplier_id IS NULL")
  } else if (supplierIds.length === 1) {
    conditions.push("stock_documents.supplier_id = @supplierId")
    params.supplierId = supplierIds[0]
  } else if (supplierIds.length > 1) {
    // Значения — уже провалидированные целые, поэтому инлайн безопасен (именованных
    // параметров переменной длины better-sqlite3 не даёт).
    conditions.push(`stock_documents.supplier_id IN (${supplierIds.join(",")})`)
  }
  if (query) {
    conditions.push("(stock_documents.number LIKE @query OR stock_documents.comment LIKE @query)")
    params.query = `%${query}%`
  }
  if (dateFrom) {
    conditions.push(`${operationDate} >= @dateFrom`)
    params.dateFrom = dateFrom
  }
  if (dateTo) {
    conditions.push(`${operationDate} <= @dateTo`)
    params.dateTo = dateTo
  }
  // Фильтр по сумме документа — по той же величине, что показана в колонке «Сумма»
  // (итог с накладными расходами, при отсутствии — стоимость товаров).
  const documentSum = "COALESCE(NULLIF(stock_documents.landed_total, 0), stock_documents.goods_total, 0)"
  const sumFrom = Number(filters?.sumFrom ?? "")
  const sumTo = Number(filters?.sumTo ?? "")
  if (String(filters?.sumFrom ?? "").trim() && Number.isFinite(sumFrom)) {
    conditions.push(`${documentSum} >= @sumFrom`)
    params.sumFrom = sumFrom
  }
  if (String(filters?.sumTo ?? "").trim() && Number.isFinite(sumTo)) {
    conditions.push(`${documentSum} <= @sumTo`)
    params.sumTo = sumTo
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const rows = client
    .prepare(
      `SELECT stock_documents.*, COUNT(stock_document_items.id) as items_count,
        -- Сумма доставки = накладные расходы вида delivery по этому акту (подзапрос, а не JOIN:
        -- иначе COUNT позиций умножится на число строк расходов).
        (SELECT COALESCE(SUM(o.amount), 0) FROM stock_document_overheads o
          WHERE o.document_id = stock_documents.id AND o.kind = 'delivery') as delivery_total
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
        products.reserved as current_reserved,
        products.category_path as current_category
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
  const prefix = type === "stock_in" ? "IN" : type === "count" ? "INV" : "OUT"
  const row = client
    .prepare("SELECT number FROM stock_documents WHERE type = ? AND number LIKE ? ORDER BY id DESC LIMIT 1")
    .get(type, `${prefix}-%`) as { number: string } | undefined
  const lastSequence = row?.number ? Number(row.number.slice(prefix.length + 1)) : 0
  const nextSequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1

  return `${prefix}-${String(nextSequence).padStart(6, "0")}`
}

export function generateStockDocumentNumberInTransaction(client: Database.Database, type: StockDocumentType) {
  const prefix = type === "stock_in" ? "IN" : type === "count" ? "INV" : "OUT"
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
  const defectValues = formData.getAll("itemDefectQty")
  const commentValues = formData.getAll("itemComment")

  if (!productCodes.length || productCodes.every((code) => !code)) {
    throw new Error("Добавьте в акт хотя бы один товар.")
  }

  return productCodes.map((productCode, index) => {
    if (!productCode) {
      throw new Error("У каждой позиции акта должен быть товар.")
    }

    // Цена закупки/себестоимость опциональна (по умолчанию 0); не может быть отрицательной.
    // Точность 6 знаков (не 2): при вводе «суммой строки» клиент шлёт цену = сумма / кол-во,
    // и округление до копеек здесь дало бы расхождение итога (1000 за 3 шт → 999.99).
    const unitCost = roundUnitCost(Math.max(0, toNumber(unitCostValues[index])))
    const qty = parsePositiveInteger(qtyValues[index], "Количество")
    // Брак (только приход; у других типов поля нет → 0): целое 0..qty. На остаток идёт qty − брак.
    const defectQty = Math.max(0, Math.floor(toNumber(defectValues[index])))
    if (defectQty > qty) {
      throw new Error("Брак не может превышать количество в строке.")
    }

    return {
      productCode,
      qty,
      defectQty,
      unitCost,
      comment: clean(commentValues[index]),
    }
  })
}

// Цена за единицу хранится с точностью до 6 знаков (см. buildStockDocumentItems); денежные
// итоги по-прежнему округляются до копеек через roundMoney.
function roundUnitCost(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 1_000_000) / 1_000_000
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

// Распределение суммы накладных расходов по позициям. Сама формула (веса, фолбэк, остаток
// округления) — в общем модуле stock-costing.ts, тот же расчёт использует живой предпросмотр в
// формах акта. Здесь только привязка долей к id строк.
function allocateOverhead(
  lines: Array<{ id: number; qty: number; lineValue: number }>,
  overheadTotal: number,
  method: AllocationMethod
): Map<number, number> {
  const shares = allocateOverheadShares(lines, overheadTotal, method)
  const allocated = new Map<number, number>()
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
  // Оплачено поставщику (v23) — только у прихода; долг по акту = goods_total − paid_amount.
  const paidAmount = isStockIn ? roundMoney(Math.max(0, toNumber(input.formData.get("paidAmount")))) : 0
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
    // Инвентаризацию (type='count') редактируют ТОЛЬКО в её разделе: здесь UPDATE сменил бы тип,
    // а DELETE строк уничтожил бы снимок expected_qty и весь подсчёт. Зеркало гейта в post-функции.
    if (String(existing.type) === "count") {
      throw new Error("Это инвентаризация — редактируйте её в разделе инвентаризации.")
    }
    // У корректировки тип жёстко равен типу исходного акта: проведение откатывает исходный по его
    // типу и применяет позиции по типу корректировки — смена типа разъехалась бы с откатом.
    if (existing.corrects_document_id != null && documentType !== String(existing.type)) {
      throw new Error("У корректировки нельзя менять тип акта.")
    }

    client
      .prepare(
        `UPDATE stock_documents
         SET type = ?, supplier_id = ?, supplier_name = ?, comment = ?, operation_at = ?,
             overhead_total = ?, allocation_method = ?, paid_amount = ?
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
        paidAmount,
        documentId
      )
    client.prepare("DELETE FROM stock_document_items WHERE document_id = ?").run(documentId)
  } else {
    const documentNumber = generateStockDocumentNumberInTransaction(client, documentType)
    const document = client
      .prepare(
        `INSERT INTO stock_documents (
          number, type, status, supplier_id, supplier_name, comment, operation_at,
          overhead_total, allocation_method, paid_amount, created_by_user_id, created_by_name
        ) VALUES (
          @number, @type, 'draft', @supplierId, @supplierName, @comment, @operationAt,
          @overheadTotal, @allocationMethod, @paidAmount, @createdByUserId, @createdByName
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
        paidAmount,
        createdByUserId: input.currentUser.id,
        createdByName: input.currentUser.name,
      })
    documentId = Number(document.lastInsertRowid)
  }

  const insertItem = client.prepare(
    `INSERT INTO stock_document_items (
      document_id, product_code, product_name, qty, unit_cost, defect_qty, comment
    ) VALUES (
      @documentId, @productCode, @productName, @qty, @unitCost, @defectQty, @comment
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
      defectQty: item.defectQty,
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
  // Инвентаризацию (type='count') проводят ТОЛЬКО через её раздел (postInventory): здесь qty —
  // плейсхолдер/дельта, а движение должно быть 'adjustment'. Строгий гейт, а не дисциплина UI.
  if (String(document.type) === "count") {
    throw new Error("Инвентаризацию проводите через её раздел.")
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
    // Брак — только приход: на склад входит годное (qty − брак), но ОПЛАЧЕНО всё количество.
    // Сумма строки — оплаченная (qty × цена), брак не уменьшает её, а поднимает себестоимость
    // единицы годного (см. landedUnitCostOf).
    const defectQty =
      type === "stock_in" ? Math.max(0, Math.min(qty, Math.floor(numberFromRow(item.defect_qty)))) : 0
    const effectiveQty = qty - defectQty
    return { item, qty, defectQty, effectiveQty, unitCost, lineValue: qty * unitCost }
  })
  const goodsTotal = roundMoney(lines.reduce((sum, line) => sum + line.lineValue, 0))

  const allocated =
    type === "stock_in"
      ? allocateOverhead(
          // Накладные ложатся только на строки, у которых есть годное (иначе доля потерялась бы —
          // ей не на что лечь). Вес строки — полное оплаченное количество/стоимость.
          lines.map((line) => ({
            id: Number(line.item.id),
            qty: line.effectiveQty > 0 ? line.qty : 0,
            lineValue: line.effectiveQty > 0 ? line.lineValue : 0,
          })),
          overheadTotal,
          allocationMethod
        )
      : new Map<number, number>()

  for (const line of lines) {
    const { item, qty, effectiveQty, unitCost } = line
    const productCode = String(item.product_code)
    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }

    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    // type здесь только stock_in|stock_out (count отсеян гейтом выше) — сужаем для StockMovementType.
    const movementType = type === "stock_in" ? "stock_in" : "stock_out"
    // Приход зачисляет только годное (qty − брак); списание уводит весь qty.
    const movementQty = type === "stock_in" ? effectiveQty : -qty
    const afterStock = beforeStock + movementQty

    const allocatedOverhead = allocated.get(Number(item.id)) ?? 0
    // Себестоимость единицы годного = (оплачено за ВСЁ количество + доля накладных) / годное:
    // стоимость брака не пропадает, а размазывается по годным единицам (формула в stock-costing.ts).
    // Вся строка — брак (effectiveQty = 0): на склад/себестоимость ничего не идёт, landed = NULL.
    const landedUnitCost =
      type === "stock_in" ? landedUnitCostOf({ qty, effectiveQty, unitCost, allocatedOverhead }) : null

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
        basis + effectiveQty > 0
          ? roundMoney((basis * oldCost + effectiveQty * landedUnitCost) / (basis + effectiveQty))
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

    // Нулевое движение (вся строка — брак) в журнал не пишем: остаток не менялся.
    if (movementQty !== 0) {
      recordStockMovement(client, {
        productCode,
        type: movementType,
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

    // Партия по строке прихода — только на годное (если включён учёт по партиям).
    if (type === "stock_in" && trackLotsEnabled && effectiveQty > 0) {
      maybeCreateReceiptLot(client, {
        product,
        qty: effectiveQty,
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

// Проведение корректировки (приход и списание): откатываем влияние исходного акта на остаток и
// применяем исправленные позиции. Себестоимость (products.cost_price) НЕ пересчитывается — точное
// переигрывание средневзвешенной невозможно (начальные остатки не в журнале); при необходимости
// правится вручную. Исходный акт остаётся в истории (статус 'corrected'), журнал движений append-only.
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
  // Тип фиксируется при создании корректировки и защищён гейтом в save-функции; сверяем на случай
  // прямых правок БД — формулы отката/применения ниже зависят от типа.
  const correctionType = parseStockDocumentType(String(correction.type))
  if (correctionType === "count" || correctionType !== parseStockDocumentType(String(original.type))) {
    throw new Error("Тип корректировки не совпадает с типом исходного акта.")
  }
  const isStockIn = correctionType === "stock_in"

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

  // 1) Откат остатка исходного акта. Приход заносил на склад только годное (qty − брак) — снимаем
  // ровно его (иначе строка с браком увела бы остаток в минус на величину брака). Списание уводило
  // полное qty — возвращаем его целиком.
  for (const item of originalItems) {
    const productCode = String(item.product_code)
    const originalDefect = isStockIn ? Math.max(0, Math.floor(numberFromRow(item.defect_qty))) : 0
    const affectedQty = Math.max(0, numberFromRow(item.qty) - originalDefect)
    if (affectedQty === 0) {
      continue
    }
    const revertDelta = isStockIn ? -affectedQty : affectedQty
    const product = getProduct(client, productCode)
    if (!product) {
      continue
    }
    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    const afterStock = beforeStock + revertDelta
    client.prepare("UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?").run(afterStock, productCode)
    recordStockMovement(client, {
      productCode,
      type: "adjustment",
      qty: revertDelta,
      beforeStock,
      afterStock,
      beforeReserved,
      afterReserved: beforeReserved,
      documentId: correctionId,
      userId: currentUser.id,
      comment: `Откат акта ${origNumber} (корректировка ${corrNumber})`,
    })
  }

  // Откат партий исходного акта (если создавались) — по document_id. Партии есть только у приходов;
  // новые партии для исправленных строк создаются ниже при включённом учёте по партиям.
  if (isStockIn) {
    revertLotsForDocument(client, originalId, currentUser, `Откат партии: корректировка ${corrNumber}`)
  }
  const trackLotsEnabled = getTrackLotsEnabled(client)
  const correctionReceivedAt = correction.operation_at == null ? null : String(correction.operation_at)
  const correctionSupplierId = correction.supplier_id == null ? null : numberFromRow(correction.supplier_id)
  const correctionSupplierName = String(correction.supplier_name ?? "")

  // 2) Применение исправленных позиций: приход — +годное, списание — −qty. Накладные расходы
  // (только приход) распределяем для отображения; себестоимость не трогаем.
  const overheadRows = client
    .prepare("SELECT amount FROM stock_document_overheads WHERE document_id = ?")
    .all(correctionId) as Array<Record<string, unknown>>
  const overheadTotal = roundMoney(overheadRows.reduce((sum, row) => sum + numberFromRow(row.amount), 0))
  const allocationMethod = normalizeAllocationMethod(correction.allocation_method)

  const lines = correctionItems.map((item) => {
    const qty = parsePositiveInteger(String(item.qty), "Количество")
    const unitCost = numberFromRow(item.unit_cost)
    // Как и в обычном проведении: брак есть только у прихода (оплачено всё количество, на склад
    // идёт годное qty − брак); у списания defect всегда 0 и уходит полное qty.
    const defectQty = isStockIn ? Math.max(0, Math.min(qty, Math.floor(numberFromRow(item.defect_qty)))) : 0
    const effectiveQty = qty - defectQty
    return { item, qty, effectiveQty, unitCost, lineValue: qty * unitCost }
  })
  const goodsTotal = roundMoney(lines.reduce((sum, line) => sum + line.lineValue, 0))
  const allocated = isStockIn
    ? allocateOverhead(
        lines.map((line) => ({
          id: Number(line.item.id),
          qty: line.effectiveQty > 0 ? line.qty : 0,
          lineValue: line.effectiveQty > 0 ? line.lineValue : 0,
        })),
        overheadTotal,
        allocationMethod
      )
    : new Map<number, number>()

  for (const line of lines) {
    const { item, qty, effectiveQty, unitCost } = line
    const productCode = String(item.product_code)
    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }
    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    const movementDelta = isStockIn ? effectiveQty : -qty
    const afterStock = beforeStock + movementDelta
    const allocatedOverhead = allocated.get(Number(item.id)) ?? 0
    const landedUnitCost = isStockIn ? landedUnitCostOf({ qty, effectiveQty, unitCost, allocatedOverhead }) : null

    client.prepare("UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?").run(afterStock, productCode)
    client
      .prepare(
        `UPDATE stock_document_items
         SET before_stock = ?, after_stock = ?, allocated_overhead = ?, landed_unit_cost = ?
         WHERE id = ?`
      )
      .run(beforeStock, afterStock, allocatedOverhead, landedUnitCost, item.id)
    // Вся строка прихода — брак: остаток не меняется, нулевое движение в журнал не пишем.
    if (movementDelta !== 0) {
      recordStockMovement(client, {
        productCode,
        type: "adjustment",
        qty: movementDelta,
        beforeStock,
        afterStock,
        beforeReserved,
        afterReserved: beforeReserved,
        documentId: correctionId,
        userId: currentUser.id,
        comment: `Корректировка акта ${origNumber}`,
      })
    }

    // Новая партия по исправленной строке (привязана к корректировке) — только приход и только годное.
    if (isStockIn && trackLotsEnabled && effectiveQty > 0) {
      maybeCreateReceiptLot(client, {
        product,
        qty: effectiveQty,
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

// Создаёт черновик корректировки по проведённому акту (приход или списание): копирует позиции
// (с ценами), накладные расходы, поставщика и метод распределения. Тип корректировки наследуется
// от исходного. Если незакрытый черновик корректировки уже существует — возвращает его (повторное
// нажатие «Редактировать» продолжает начатую правку, а не плодит дубликаты).
export function createStockCorrectionDraft(originalDocumentId: number, currentUser: CurrentUser) {
  const client = db()
  const run = client.transaction(() => {
    const original = client.prepare("SELECT * FROM stock_documents WHERE id = ?").get(originalDocumentId) as
      | Record<string, unknown>
      | undefined
    if (!original) {
      throw new Error("Акт склада не найден.")
    }
    const originalType = parseStockDocumentType(String(original.type))
    if (originalType === "count") {
      throw new Error("Инвентаризацию нельзя корректировать — проведите новую инвентаризацию.")
    }
    // Сначала точная причина: у скорректированного акта status уже не 'posted', и generic-сообщение
    // «можно только проведённый» скрывало бы, что исправление уже существует.
    if (original.corrected_by_document_id != null) {
      throw new Error("Этот акт уже скорректирован.")
    }
    if (String(original.status) !== "posted") {
      throw new Error("Корректировать можно только проведённый акт.")
    }

    const existingDraft = client
      .prepare("SELECT id FROM stock_documents WHERE corrects_document_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1")
      .get(originalDocumentId) as { id: number } | undefined
    if (existingDraft) {
      return Number(existingDraft.id)
    }

    const number = generateStockDocumentNumberInTransaction(client, originalType)
    const inserted = client
      .prepare(
        `INSERT INTO stock_documents (
          number, type, status, supplier_id, supplier_name, comment, operation_at,
          overhead_total, allocation_method, paid_amount, corrects_document_id,
          created_by_user_id, created_by_name
        ) VALUES (
          @number, @type, 'draft', @supplierId, @supplierName, @comment, @operationAt,
          @overheadTotal, @allocationMethod, @paidAmount, @correctsId,
          @createdByUserId, @createdByName
        )`
      )
      .run({
        number,
        type: originalType,
        supplierId: original.supplier_id ?? null,
        supplierName: String(original.supplier_name ?? ""),
        comment: String(original.comment ?? ""),
        operationAt: original.operation_at ?? null,
        overheadTotal: numberFromRow(original.overhead_total),
        allocationMethod: normalizeAllocationMethod(original.allocation_method),
        // Оплату переносим в корректировку: исходный акт получает статус corrected и из долга
        // выпадает — иначе уже уплаченная сумма «потерялась» бы и долг вырос.
        paidAmount: numberFromRow(original.paid_amount),
        correctsId: originalDocumentId,
        createdByUserId: currentUser.id,
        createdByName: currentUser.name,
      })
    const newId = Number(inserted.lastInsertRowid)

    const items = client
      .prepare("SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY id")
      .all(originalDocumentId) as Array<Record<string, unknown>>
    const insertItem = client.prepare(
      `INSERT INTO stock_document_items (document_id, product_code, product_name, qty, unit_cost, defect_qty, comment)
       VALUES (@documentId, @productCode, @productName, @qty, @unitCost, @defectQty, @comment)`
    )
    for (const item of items) {
      insertItem.run({
        documentId: newId,
        productCode: String(item.product_code),
        productName: String(item.product_name ?? ""),
        qty: numberFromRow(item.qty),
        unitCost: numberFromRow(item.unit_cost),
        // Брак копируем: иначе корректировка «теряла» бы брак исходного акта и заносила его на склад.
        defectQty: numberFromRow(item.defect_qty),
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

// Незакрытый черновик корректировки по акту (если есть) — чтобы страница акта вела «Редактировать»
// в уже начатую корректировку, а не предлагала создать новую.
export function getDraftCorrectionId(documentId: number): number | null {
  const client = db()
  const row = client
    .prepare("SELECT id FROM stock_documents WHERE corrects_document_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1")
    .get(documentId) as { id: number } | undefined

  return row ? Number(row.id) : null
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
