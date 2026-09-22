import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { fromDatetimeLocalValue } from "@/lib/datetime"
import { db } from "../connection"
import { getProduct, recordStockMovement } from "../ledger"
import { clean, roundMoney, toNumber } from "../form-parsers"
import type { CurrentUser, StockVarianceReason } from "../types"
import { stockVarianceReasons } from "../types"
import { getTrackLotsEnabled } from "./app-settings"
import { generateStockDocumentNumberInTransaction } from "./stock-documents"
import { reconcileProductLots } from "./stock-lots"

// Реселект статуса под локом — первый шаг каждой мутирующей транзакции инвентаризации. better-sqlite3
// синхронный, соединение одно → даёт корректную сериализацию (второй конкурент увидит не-draft и упадёт).
function loadDraftInventory(client: Database.Database, documentId: number): Record<string, unknown> {
  const document = client.prepare("SELECT * FROM stock_documents WHERE id = ?").get(documentId) as
    | Record<string, unknown>
    | undefined
  if (!document) {
    throw new Error("Акт инвентаризации не найден.")
  }
  if (String(document.type) !== "count") {
    throw new Error("Это не инвентаризация.")
  }
  if (String(document.status) !== "draft") {
    throw new Error("Можно редактировать только черновик инвентаризации.")
  }
  return document
}

function normalizeVarianceReason(value: unknown): string | null {
  const reason = String(value ?? "").trim()
  if (!reason) {
    return null
  }
  return stockVarianceReasons.has(reason as StockVarianceReason) ? reason : "other"
}

// Создаёт черновик инвентаризации со СНИМКОМ расчётного остатка (expected_qty = products.stock на этот
// момент) по охвату: вся активная номенклатура / категория (по префиксу пути) / явный список кодов.
export function createInventoryDraftWithSnapshot(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const scope = clean(formData.get("scope")) || "all"
  const codes = formData.getAll("code").map((value) => clean(value)).filter(Boolean)
  const comment = clean(formData.get("comment"))
  const operationAt = fromDatetimeLocalValue(formData.get("operationAt"))

  const run = client.transaction(() => {
    let products: Array<Record<string, unknown>>
    if (scope === "codes") {
      if (!codes.length) {
        throw new Error("Выберите хотя бы один товар.")
      }
      const placeholders = codes.map(() => "?").join(",")
      products = client
        .prepare(`SELECT code, name, stock FROM products WHERE code IN (${placeholders}) ORDER BY name COLLATE NOCASE`)
        .all(...codes) as Array<Record<string, unknown>>
    } else if (scope === "category") {
      // Несколько категорий: форма шлёт по одному полю `category` на категорию (getAll).
      // Совместимо со старым одиночным выбором (getAll вернёт массив из одного значения).
      // Для каждой категории берём её и подкатегории по префиксу пути, как при одиночном охвате.
      const selectedCategories = Array.from(
        new Set(formData.getAll("category").map((value) => clean(value)).filter(Boolean))
      )
      if (!selectedCategories.length) {
        throw new Error("Укажите категорию.")
      }
      const conditions = selectedCategories.map(() => "(category_path = ? OR category_path LIKE ?)").join(" OR ")
      const params = selectedCategories.flatMap((value) => [value, `${value}%`])
      products = client
        .prepare(
          `SELECT code, name, stock FROM products
           WHERE COALESCE(is_active, 1) = 1 AND (${conditions})
           ORDER BY name COLLATE NOCASE`
        )
        .all(...params) as Array<Record<string, unknown>>
    } else {
      products = client
        .prepare("SELECT code, name, stock FROM products WHERE COALESCE(is_active, 1) = 1 ORDER BY name COLLATE NOCASE")
        .all() as Array<Record<string, unknown>>
    }

    if (!products.length) {
      throw new Error("По выбранному охвату нет товаров.")
    }

    const number = generateStockDocumentNumberInTransaction(client, "count")
    const inserted = client
      .prepare(
        `INSERT INTO stock_documents (
          number, type, status, comment, operation_at, count_started_at, created_by_user_id, created_by_name
        ) VALUES (
          @number, 'count', 'draft', @comment, @operationAt, CURRENT_TIMESTAMP, @createdByUserId, @createdByName
        )`
      )
      .run({
        number,
        comment,
        operationAt,
        createdByUserId: currentUser.id,
        createdByName: currentUser.name,
      })
    const documentId = Number(inserted.lastInsertRowid)

    const insertItem = client.prepare(
      `INSERT INTO stock_document_items (
        document_id, product_code, product_name, qty, expected_qty, counted_qty, counted_at, applied
      ) VALUES (
        @documentId, @productCode, @productName, 0, @expectedQty, NULL, NULL, 0
      )`
    )
    for (const product of products) {
      insertItem.run({
        documentId,
        productCode: String(product.code),
        productName: String(product.name ?? ""),
        expectedQty: numberFromRow(product.stock),
      })
    }

    return documentId
  })

  return run()
}

// Добавить товар в черновик инвентаризации «по надобности» — например, позицию из категории, не
// попавшей в исходный охват. Снимок expected_qty = текущий products.stock (как при создании). Защита
// от дубля: код уже в документе → ошибка. Только активный товар. Реселект статуса под локом.
export function addInventoryItem(documentId: number, productCode: string) {
  const client = db()
  const code = clean(productCode)
  if (!code) {
    throw new Error("Не указан товар.")
  }

  const run = client.transaction(() => {
    loadDraftInventory(client, documentId)

    const existing = client
      .prepare("SELECT 1 FROM stock_document_items WHERE document_id = ? AND product_code = ?")
      .get(documentId, code)
    if (existing) {
      throw new Error("Этот товар уже есть в списке инвентаризации.")
    }

    const product = client
      .prepare("SELECT code, name, stock FROM products WHERE code = ? AND COALESCE(is_active, 1) = 1")
      .get(code) as { code: string; name: string; stock: unknown } | undefined
    if (!product) {
      throw new Error("Товар не найден или находится в архиве.")
    }

    client
      .prepare(
        `INSERT INTO stock_document_items (
          document_id, product_code, product_name, qty, expected_qty, counted_qty, counted_at, applied
        ) VALUES (
          @documentId, @productCode, @productName, 0, @expectedQty, NULL, NULL, 0
        )`
      )
      .run({
        documentId,
        productCode: String(product.code),
        productName: String(product.name ?? ""),
        expectedQty: numberFromRow(product.stock),
      })
  })

  run()
}

// Сохранение факта: counted_qty (пусто → «не считали», NULL), counted_at, variance_reason по строкам.
export function saveInventoryDraft(formData: FormData) {
  const client = db()
  const documentId = Number(clean(formData.get("documentId")))
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new Error("Акт инвентаризации не найден.")
  }

  const run = client.transaction(() => {
    loadDraftInventory(client, documentId)

    // Комментарий и дату операции обновляем ТОЛЬКО если форма их прислала: лист подсчёта шлёт
    // одни строки, и безусловный UPDATE стирал комментарий и сдвигал operation_at на «сейчас».
    if (formData.has("comment")) {
      client.prepare("UPDATE stock_documents SET comment = ? WHERE id = ?").run(clean(formData.get("comment")), documentId)
    }
    if (formData.has("operationAt")) {
      client
        .prepare("UPDATE stock_documents SET operation_at = ? WHERE id = ?")
        .run(fromDatetimeLocalValue(formData.get("operationAt")), documentId)
    }

    const itemIds = formData.getAll("itemId").map((value) => clean(value))
    const countedValues = formData.getAll("countedQty")
    const reasonValues = formData.getAll("varianceReason")

    // Имена строк — для адресной ошибки валидации (иначе виновную строку среди сотен не найти).
    const itemRows = client
      .prepare("SELECT id, product_name, product_code FROM stock_document_items WHERE document_id = ?")
      .all(documentId) as Array<{ id: number; product_name: string | null; product_code: string }>
    const nameById = new Map(itemRows.map((row) => [Number(row.id), String(row.product_name || row.product_code)]))

    const updateItem = client.prepare(
      `UPDATE stock_document_items
       SET counted_qty = @countedQty, counted_at = @countedAt, variance_reason = @varianceReason
       WHERE id = @id AND document_id = @documentId`
    )

    itemIds.forEach((rawId, index) => {
      const id = Number(rawId)
      if (!Number.isInteger(id) || id <= 0) {
        return
      }
      const rawCounted = countedValues[index]
      const isBlank = rawCounted == null || String(rawCounted).trim() === ""
      let countedQty: number | null = null
      let countedAt: string | null = null
      if (!isBlank) {
        const value = toNumber(rawCounted)
        if (!Number.isFinite(value) || value < 0) {
          const name = nameById.get(id)
          throw new Error(
            `Фактическое количество не может быть отрицательным${name ? `: «${name}»` : ""}.`
          )
        }
        countedQty = value
        countedAt = new Date().toISOString()
      }
      updateItem.run({
        id,
        documentId,
        countedQty,
        countedAt,
        varianceReason: countedQty == null ? null : normalizeVarianceReason(reasonValues[index]),
      })
    })

    return documentId
  })

  return run()
}

// Пересчитать расчётный остаток (expected_qty) к текущему products.stock — если остатки правили после
// старта инвентаризации. Только для черновика, и ТОЛЬКО для ещё не сосчитанных строк: факт сосчитанной
// строки снят против её снимка, и проведение считает дельту от него (counted − expected). Перенос базы
// сосчитанной строки на «сейчас» превратил бы все движения между снимком и пересчётом (продажи, приходы)
// в ложную дельту с обратным знаком — проведение «воскрешало» бы проданное. Обновляет и count_started_at.
export function recalcInventoryExpected(documentId: number) {
  const client = db()
  const run = client.transaction(() => {
    loadDraftInventory(client, documentId)
    client
      .prepare(
        `UPDATE stock_document_items
         SET expected_qty = COALESCE((SELECT stock FROM products WHERE products.code = stock_document_items.product_code), expected_qty)
         WHERE document_id = ? AND counted_qty IS NULL`
      )
      .run(documentId)
    client.prepare("UPDATE stock_documents SET count_started_at = CURRENT_TIMESTAMP WHERE id = ?").run(documentId)
  })
  run()
}

// Проведение инвентаризации: для каждой сосчитанной строки дельта = counted_qty − expected_qty
// (расхождение факта со СНИМКОМ), применяется к ЖИВОМУ остатку: stock += delta. Так параллельные
// продажи/приходы между снимком и проведением не затираются (прежняя схема stock := counted
// откатывала их). Движение — 'adjustment', ПРИВЯЗАННОЕ к документу (не через applyProductDelta).
// reserved не трогаем. Себестоимость излишков — по текущей средней (cost_price не меняется).
// Затем FEFO-сверка партий по затронутым кодам.
function postInventoryInTransaction(client: Database.Database, documentId: number, currentUser: CurrentUser) {
  const document = loadDraftInventory(client, documentId)
  const number = String(document.number)

  const items = client
    .prepare("SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY id")
    .all(documentId) as Array<Record<string, unknown>>

  const affected = new Set<string>()

  for (const item of items) {
    // Несосчитанная строка (факт не введён) — остаток не трогаем.
    if (item.counted_qty == null) {
      continue
    }
    const productCode = String(item.product_code)
    const counted = numberFromRow(item.counted_qty)
    const product = getProduct(client, productCode)

    // Товар удалён между стартом и проведением — пропускаем строку с пометкой, остальное проводим.
    if (!product) {
      const note = String(item.comment ?? "").trim()
      client
        .prepare("UPDATE stock_document_items SET applied = 0, comment = ? WHERE id = ?")
        .run(note ? `${note}; товар удалён — строка не применена` : "товар удалён — строка не применена", item.id)
      continue
    }

    const beforeStock = numberFromRow(product.stock)
    const beforeReserved = numberFromRow(product.reserved)
    const expected = item.expected_qty == null ? beforeStock : numberFromRow(item.expected_qty)
    const delta = roundMoney(counted - expected)
    const afterStock = roundMoney(beforeStock + delta)

    client
      .prepare("UPDATE stock_document_items SET before_stock = ?, after_stock = ?, qty = ?, applied = 1 WHERE id = ?")
      .run(beforeStock, afterStock, delta, item.id)

    if (delta !== 0) {
      client
        .prepare("UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?")
        .run(afterStock, productCode)
      recordStockMovement(client, {
        productCode,
        type: "adjustment",
        qty: delta,
        beforeStock,
        afterStock,
        beforeReserved,
        afterReserved: beforeReserved,
        documentId,
        userId: currentUser.id,
        comment: `Инвентаризация ${number}`,
      })
      affected.add(productCode)
    }
  }

  // Партии — только по кодам с реально применённой ненулевой дельтой (пересчёт без расхождений их не трогает).
  if (getTrackLotsEnabled(client)) {
    for (const productCode of affected) {
      reconcileProductLots(client, productCode, currentUser)
    }
  }

  client
    .prepare(
      `UPDATE stock_documents
       SET status = 'posted', posted_by_user_id = ?, posted_by_name = ?,
           operation_at = COALESCE(NULLIF(operation_at, ''), CURRENT_TIMESTAMP), posted_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(currentUser.id, currentUser.name, documentId)
}

export function postInventory(documentId: number, currentUser: CurrentUser) {
  const client = db()
  const run = client.transaction(() => postInventoryInTransaction(client, documentId, currentUser))
  run()
}

// ──────────────────────────────────────────────────────────────────────────────
// Шаблоны категорий: именованный набор категорий, который владелец выбирает одним
// кликом при создании инвентаризации вместо повторной отметки тех же категорий.
// categories хранится JSON-массивом строк-путей (таблица из миграции v20).
// ──────────────────────────────────────────────────────────────────────────────

export type InventoryCategoryTemplate = {
  id: number
  name: string
  categories: string[]
}

function parseTemplateCategories(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.map((item) => String(item).trim()).filter(Boolean)
  } catch {
    return []
  }
}

export function listInventoryCategoryTemplates(
  client: Database.Database = db()
): InventoryCategoryTemplate[] {
  const rows = client
    .prepare("SELECT id, name, categories FROM inventory_category_templates ORDER BY name COLLATE NOCASE")
    .all() as Array<{ id: number; name: string; categories: string }>
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    categories: parseTemplateCategories(row.categories),
  }))
}

export function createInventoryCategoryTemplate(formData: FormData): InventoryCategoryTemplate {
  const client = db()
  const name = clean(formData.get("name"))
  if (!name) {
    throw new Error("Введите название шаблона.")
  }
  // Дедуп категорий с сохранением порядка выбора.
  const categories = Array.from(
    new Set(formData.getAll("category").map((value) => clean(value)).filter(Boolean))
  )
  if (!categories.length) {
    throw new Error("Выберите хотя бы одну категорию.")
  }

  const run = client.transaction(() => {
    // Имя уникально без учёта регистра: перезапись существующего шаблона вместо дубля-«призрака».
    const existing = client
      .prepare("SELECT id FROM inventory_category_templates WHERE name = ? COLLATE NOCASE")
      .get(name) as { id: number } | undefined
    const serialized = JSON.stringify(categories)
    if (existing) {
      client
        .prepare(
          "UPDATE inventory_category_templates SET name = ?, categories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .run(name, serialized, existing.id)
      return Number(existing.id)
    }
    const inserted = client
      .prepare("INSERT INTO inventory_category_templates (name, categories) VALUES (?, ?)")
      .run(name, serialized)
    return Number(inserted.lastInsertRowid)
  })

  const id = run()
  return { id, name, categories }
}

export function deleteInventoryCategoryTemplate(id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Шаблон не найден.")
  }
  db().prepare("DELETE FROM inventory_category_templates WHERE id = ?").run(id)
}

// Отмена — только черновик (как cancelStockDocument). Проведённую не откатываем (журнал append-only;
// исправление = новая инвентаризация).
export function cancelInventory(documentId: number) {
  const client = db()
  const run = client.transaction(() => {
    const document = client.prepare("SELECT type, status FROM stock_documents WHERE id = ?").get(documentId) as
      | { type: string; status: string }
      | undefined
    if (!document) {
      throw new Error("Акт инвентаризации не найден.")
    }
    if (document.type !== "count") {
      throw new Error("Это не инвентаризация.")
    }
    if (document.status === "posted") {
      throw new Error("Проведённую инвентаризацию нельзя отменить. Создайте новую.")
    }
    if (document.status === "cancelled") {
      return
    }
    client
      .prepare("UPDATE stock_documents SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(documentId)
  })
  run()
}
