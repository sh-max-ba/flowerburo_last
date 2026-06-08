import type Database from "better-sqlite3"
import * as XLSX from "xlsx"
import { mapProductRow, numberFromRow } from "@/lib/db-row"
import type { CurrentUser, ProductRow, WarehouseImportAction, WarehouseImportPreview } from "../types"
import { db } from "../connection"
import { getProduct, recordStockMovement } from "../ledger"
import { mapWarehouseImport, mapWarehouseImportItem } from "../mappers"
import { cleanCell, parseImportNumber } from "../form-parsers"

type WarehouseImportRow = {
  rowNumber: number
  code: string
  name: string
  article: string
  categoryPath: string
  unit: string
  stockRaw: string
  reservedRaw: string
  salePriceRaw: string
  costPriceRaw: string
  stock: number | null
  reserved: number | null
  salePrice: number | null
  costPrice: number | null
  reservedProvided: boolean
  salePriceProvided: boolean
  costPriceProvided: boolean
  errors: string[]
}

type WarehouseImportReportItem = WarehouseImportRow & {
  action: WarehouseImportAction
  oldStock: number | null
  newStock: number | null
  stockDelta: number | null
  oldReserved: number | null
  newReserved: number | null
  oldSalePrice: number | null
  newSalePrice: number | null
  oldCostPrice: number | null
  newCostPrice: number | null
  error: string
}

type WarehouseImportReport = {
  filename: string
  items: WarehouseImportReportItem[]
}

const warehouseImportColumns = [
  "code",
  "name",
  "article",
  "category_path",
  "unit",
  "stock",
  "reserved",
  "sale_price",
  "cost_price",
]

export function createWarehouseImportTemplateWorkbook() {
  const worksheet = XLSX.utils.json_to_sheet([
    {
      code: "ROSE-001",
      name: "Роза красная",
      article: "",
      category_path: "Цветы/Розы",
      unit: "шт",
      stock: 10,
      reserved: 0,
      sale_price: 150,
      cost_price: 80,
    },
  ], { header: warehouseImportColumns })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Импорт склада")

  return workbook
}

export function createWarehouseExportWorkbook() {
  const client = db()
  const rows = (client.prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all() as ProductRow[])
    .map(mapProductRow)
    .map((product) => ({
      code: product.code,
      name: product.name,
      article: product.article,
      category_path: product.categoryPath,
      unit: product.unit,
      stock: product.stock,
      reserved: product.reserved,
      available: product.available,
      sale_price: product.salePrice,
      cost_price: product.costPrice,
    }))

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [...warehouseImportColumns.slice(0, 7), "available", "sale_price", "cost_price"],
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Склад")

  return workbook
}

export function writeWorkbookBuffer(workbook: XLSX.WorkBook) {
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer
}

export function previewWarehouseImport(input: {
  filename: string
  buffer: ArrayBuffer
  currentUser: CurrentUser
}): WarehouseImportPreview {
  const client = db()
  const rows = parseWarehouseImportRows(input.buffer)
  const reportItems = buildWarehouseImportReportItems(client, rows)
  const counts = countWarehouseImportItems(reportItems)
  const report: WarehouseImportReport = {
    filename: input.filename,
    items: reportItems,
  }

  const createPreview = client.transaction(() => {
    const result = client
      .prepare(
        `INSERT INTO warehouse_imports (
          filename, status, total_rows, created_count, updated_count, unchanged_count, error_count,
          created_by_user_id, created_by_name, report_json
        ) VALUES (?, 'preview', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.filename,
        reportItems.length,
        counts.created,
        counts.updated,
        counts.unchanged,
        counts.errors,
        input.currentUser.id,
        input.currentUser.name,
        JSON.stringify(report)
      )

    const importId = Number(result.lastInsertRowid)
    insertWarehouseImportItems(client, importId, reportItems)

    return getWarehouseImport(importId, client)
  })

  return createPreview()
}

export function applyWarehouseImport(importId: number, currentUser: CurrentUser): WarehouseImportPreview {
  const client = db()

  const applyImport = client.transaction(() => {
    const record = getWarehouseImportRecord(importId, client)
    if (!record) {
      throw new Error("Импорт не найден.")
    }

    const current = mapWarehouseImport(record)
    if (current.status === "applied") {
      throw new Error("Этот импорт уже применен.")
    }

    const report = parseWarehouseImportReport(current.reportJson)
    if (report.items.some((item) => item.action === "error")) {
      client
        .prepare("UPDATE warehouse_imports SET status = 'failed' WHERE id = ?")
        .run(importId)
      throw new Error("Исправьте ошибки в XLSX и загрузите файл снова.")
    }

    for (const item of report.items) {
      if (item.action === "unchanged") {
        continue
      }

      const existing = getProduct(client, item.code)
      const currentStock = existing ? numberFromRow(existing.stock) : 0
      const currentReserved = existing ? numberFromRow(existing.reserved) : 0
      // Резерв импортом НЕ меняем — он ведётся жизненным циклом заказов.
      // Остаток применяем как ДЕЛЬТУ к текущему значению (не абсолютом из preview),
      // чтобы не затереть продажи/поступления между preview и apply (TOCTOU).
      const intendedStockDelta = numberFromRow(item.stockDelta)
      const appliedStock = currentStock + intendedStockDelta

      if (existing) {
        client
          .prepare(
            `UPDATE products
             SET category_path = ?, article = ?, name = ?, unit = ?, stock = ?,
               cost_price = ?, sale_price = ?, updated_at = CURRENT_TIMESTAMP
             WHERE code = ?`
          )
          .run(
            item.categoryPath || String(existing.category_path ?? ""),
            item.article || String(existing.article ?? ""),
            item.name || String(existing.name ?? ""),
            item.unit || String(existing.unit ?? "шт"),
            appliedStock,
            item.costPriceProvided ? item.costPrice ?? 0 : numberFromRow(existing.cost_price),
            item.salePriceProvided ? item.salePrice ?? 0 : numberFromRow(existing.sale_price),
            item.code
          )
      } else {
        client
          .prepare(
            `INSERT INTO products (
              code, category_path, article, name, unit, stock, reserved, expected, cost_price, sale_price, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, CURRENT_TIMESTAMP)`
          )
          .run(
            item.code,
            item.categoryPath,
            item.article,
            item.name,
            item.unit || "шт",
            appliedStock,
            item.costPriceProvided ? item.costPrice ?? 0 : 0,
            item.salePriceProvided ? item.salePrice ?? 0 : 0
          )
      }

      if (intendedStockDelta !== 0) {
        recordStockMovement(client, {
          productCode: item.code,
          type: "import",
          qty: intendedStockDelta,
          beforeStock: currentStock,
          afterStock: appliedStock,
          beforeReserved: currentReserved,
          afterReserved: currentReserved,
          userId: currentUser.id,
          comment: `Импорт склада XLSX: ${importId}`,
        })
      }
    }

    const counts = countWarehouseImportItems(report.items)
    client
      .prepare(
        `UPDATE warehouse_imports
         SET status = 'applied', total_rows = ?, created_count = ?, updated_count = ?,
           unchanged_count = ?, error_count = 0, applied_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(report.items.length, counts.created, counts.updated, counts.unchanged, importId)

    client.prepare("DELETE FROM warehouse_import_items WHERE import_id = ?").run(importId)
    insertWarehouseImportItems(client, importId, report.items)

    return getWarehouseImport(importId, client)
  })

  return applyImport()
}

export function listWarehouseImports() {
  const rows = db()
    .prepare(
      `SELECT *
       FROM warehouse_imports
       ORDER BY created_at DESC, id DESC`
    )
    .all() as Record<string, unknown>[]

  return rows.map(mapWarehouseImport)
}

export function getWarehouseImport(importId: number, client: Database.Database = db()): WarehouseImportPreview {
  const record = getWarehouseImportRecord(importId, client)
  if (!record) {
    throw new Error("Импорт не найден.")
  }

  const items = client
    .prepare(
      `SELECT *
       FROM warehouse_import_items
       WHERE import_id = ?
       ORDER BY row_number ASC, id ASC`
    )
    .all(importId) as Record<string, unknown>[]

  return {
    ...mapWarehouseImport(record),
    items: items.map(mapWarehouseImportItem),
  }
}

function getWarehouseImportRecord(importId: number, client: Database.Database) {
  return client.prepare("SELECT * FROM warehouse_imports WHERE id = ?").get(importId) as
    | Record<string, unknown>
    | undefined
}

function parseWarehouseImportRows(buffer: ArrayBuffer) {
  const workbook = XLSX.read(Buffer.from(buffer), { type: "buffer" })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error("В XLSX нет листов.")
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: false,
  })

  return rows
    .map((row, index) => normalizeWarehouseImportRow(row, index + 2))
    .filter((row) =>
      [
        row.code,
        row.name,
        row.article,
        row.categoryPath,
        row.unit,
        row.stockRaw,
        row.reservedRaw,
        row.salePriceRaw,
        row.costPriceRaw,
      ].some((value) => value.trim())
    )
}

function normalizeWarehouseImportRow(row: Record<string, unknown>, rowNumber: number): WarehouseImportRow {
  const stockRaw = cleanCell(row.stock)
  const reservedRaw = cleanCell(row.reserved)
  const salePriceRaw = cleanCell(row.sale_price)
  const costPriceRaw = cleanCell(row.cost_price)
  const stock = parseImportNumber(stockRaw)
  const reserved = parseImportNumber(reservedRaw)
  const salePrice = parseImportNumber(salePriceRaw)
  const costPrice = parseImportNumber(costPriceRaw)
  const errors: string[] = []

  if (!cleanCell(row.code)) {
    errors.push("code пустой")
  }
  if (!stockRaw) {
    errors.push("stock пустой")
  } else if (stock === null) {
    errors.push("stock не число")
  }
  if (reservedRaw && reserved === null) {
    errors.push("reserved не число")
  }
  if (salePriceRaw && salePrice === null) {
    errors.push("sale_price не число")
  }
  if (costPriceRaw && costPrice === null) {
    errors.push("cost_price не число")
  }

  return {
    rowNumber,
    code: cleanCell(row.code),
    name: cleanCell(row.name),
    article: cleanCell(row.article),
    categoryPath: cleanCell(row.category_path),
    unit: cleanCell(row.unit),
    stockRaw,
    reservedRaw,
    salePriceRaw,
    costPriceRaw,
    stock,
    reserved,
    salePrice,
    costPrice,
    reservedProvided: Boolean(reservedRaw),
    salePriceProvided: Boolean(salePriceRaw),
    costPriceProvided: Boolean(costPriceRaw),
    errors,
  }
}

function buildWarehouseImportReportItems(client: Database.Database, rows: WarehouseImportRow[]) {
  return rows.map((row): WarehouseImportReportItem => {
    const product = row.code ? getProduct(client, row.code) : undefined
    const errors = [...row.errors]

    if (!product && !row.name) {
      errors.push("name пустой для нового товара")
    }

    if (errors.length) {
      return withWarehouseImportComputedFields(row, product, "error", errors.join("; "))
    }

    const action = product
      ? isWarehouseImportRowChanged(row, product)
        ? "update"
        : "unchanged"
      : "create"

    return withWarehouseImportComputedFields(row, product, action, "")
  })
}

function withWarehouseImportComputedFields(
  row: WarehouseImportRow,
  product: ProductRow | undefined,
  action: WarehouseImportAction,
  error: string
): WarehouseImportReportItem {
  const oldStock = product ? numberFromRow(product.stock) : null
  const oldReserved = product ? numberFromRow(product.reserved) : null
  const oldSalePrice = product ? numberFromRow(product.sale_price) : null
  const oldCostPrice = product ? numberFromRow(product.cost_price) : null
  const newStock = row.stock
  // Резерв импортом не меняется — в preview показываем текущее значение.
  const newReserved = product ? oldReserved : 0
  const newSalePrice = product
    ? row.salePriceProvided
      ? row.salePrice
      : oldSalePrice
    : row.salePriceProvided
      ? row.salePrice
      : 0
  const newCostPrice = product
    ? row.costPriceProvided
      ? row.costPrice
      : oldCostPrice
    : row.costPriceProvided
      ? row.costPrice
      : 0

  return {
    ...row,
    action,
    oldStock,
    newStock,
    stockDelta: oldStock === null || newStock === null ? newStock : newStock - oldStock,
    oldReserved,
    newReserved,
    oldSalePrice,
    newSalePrice,
    oldCostPrice,
    newCostPrice,
    error,
  }
}

function isWarehouseImportRowChanged(row: WarehouseImportRow, product: ProductRow) {
  if ((row.stock ?? 0) !== numberFromRow(product.stock)) {
    return true
  }
  if (row.salePriceProvided && (row.salePrice ?? 0) !== numberFromRow(product.sale_price)) {
    return true
  }
  if (row.costPriceProvided && (row.costPrice ?? 0) !== numberFromRow(product.cost_price)) {
    return true
  }

  return Boolean(
    (row.name && row.name !== String(product.name ?? "")) ||
      (row.article && row.article !== String(product.article ?? "")) ||
      (row.categoryPath && row.categoryPath !== String(product.category_path ?? "")) ||
      (row.unit && row.unit !== String(product.unit ?? ""))
  )
}

function insertWarehouseImportItems(
  client: Database.Database,
  importId: number,
  items: WarehouseImportReportItem[]
) {
  const insert = client.prepare(
    `INSERT INTO warehouse_import_items (
      import_id, row_number, code, name, category_path, action, old_stock, new_stock, stock_delta,
      old_reserved, new_reserved, old_sale_price, new_sale_price, old_cost_price, new_cost_price, error
    ) VALUES (
      @importId, @rowNumber, @code, @name, @categoryPath, @action, @oldStock, @newStock, @stockDelta,
      @oldReserved, @newReserved, @oldSalePrice, @newSalePrice, @oldCostPrice, @newCostPrice, @error
    )`
  )

  for (const item of items) {
    insert.run({
      importId,
      rowNumber: item.rowNumber,
      code: item.code,
      name: item.name,
      categoryPath: item.categoryPath,
      action: item.action,
      oldStock: item.oldStock,
      newStock: item.newStock,
      stockDelta: item.stockDelta,
      oldReserved: item.oldReserved,
      newReserved: item.newReserved,
      oldSalePrice: item.oldSalePrice,
      newSalePrice: item.newSalePrice,
      oldCostPrice: item.oldCostPrice,
      newCostPrice: item.newCostPrice,
      error: item.error,
    })
  }
}

function countWarehouseImportItems(items: WarehouseImportReportItem[]) {
  return {
    created: items.filter((item) => item.action === "create").length,
    updated: items.filter((item) => item.action === "update").length,
    unchanged: items.filter((item) => item.action === "unchanged").length,
    errors: items.filter((item) => item.action === "error").length,
  }
}

function parseWarehouseImportReport(value: string): WarehouseImportReport {
  const parsed = JSON.parse(value) as WarehouseImportReport
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("Отчет импорта поврежден.")
  }

  return parsed
}
