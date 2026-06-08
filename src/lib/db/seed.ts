import fs from "node:fs"
import type Database from "better-sqlite3"
import { hashPassword } from "@/lib/password"
import { csvPath } from "./types"
import type { CsvProduct } from "./types"
import { toNumber } from "./form-parsers"
import { addMovement, recordStockMovement } from "./ledger"

export function seedDefaultDealPipeline(client: Database.Database) {
  const row = client.prepare("SELECT COUNT(*) as count FROM deal_pipelines").get() as { count: number }
  if (row.count > 0) {
    return
  }

  const createPipeline = client.transaction(() => {
    const pipeline = client
      .prepare("INSERT INTO deal_pipelines (name, is_default) VALUES (?, 1)")
      .run("Основная воронка")
    const pipelineId = Number(pipeline.lastInsertRowid)
    const insertStage = client.prepare(
      `INSERT INTO deal_stages (pipeline_id, name, position, color, is_closed, is_won)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const stages = [
      ["Новая", "#2563eb", 0, 0],
      ["В работе", "#7c3aed", 0, 0],
      ["Ожидает оплату", "#d97706", 0, 0],
      ["Оформлен заказ", "#0891b2", 0, 0],
      ["Готов", "#16a34a", 0, 0],
      ["Закрыта", "#15803d", 1, 1],
      ["Отменена", "#dc2626", 1, 0],
    ] as const

    stages.forEach(([name, color, isClosed, isWon], index) => {
      insertStage.run(pipelineId, name, index + 1, color, isClosed, isWon)
    })
  })

  createPipeline()
}

export function seedDefaultUsers(client: Database.Database) {
  const count = client.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }

  if (count.count > 0) {
    return
  }

  client
    .prepare(
      `INSERT INTO users (login, name, role, password_hash)
       VALUES (?, ?, ?, ?)`
    )
    .run("admin", "Управляющий", "owner", hashPassword("fb2026"))
}

export function seedFromCsv(client: Database.Database) {
  const count = client.prepare("SELECT COUNT(*) as count FROM products").get() as {
    count: number
  }

  if (count.count > 0 || !fs.existsSync(csvPath)) {
    return
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf8")) as CsvProduct[]
  const insert = client.prepare(`
    INSERT INTO products (
      code, category_path, article, name, unit, stock, reserved, expected, cost_price, sale_price
    ) VALUES (
      @code, @categoryPath, @article, @name, @unit, @stock, @reserved, @expected, @costPrice, @salePrice
    )
  `)

  const importProducts = client.transaction(() => {
    for (const row of rows) {
      if (!row.code) {
        continue
      }

      insert.run({
        code: row.code,
        categoryPath: row.category_path ?? "",
        article: row.article ?? "",
        name: row.name || row.code,
        unit: row.unit || "шт",
        stock: toNumber(row.stock),
        reserved: toNumber(row.reserved),
        expected: toNumber(row.expected),
        costPrice: toNumber(row.cost_price),
        salePrice: toNumber(row.sale_price),
      })
    }

    recordStockMovement(client, {
      type: "import",
      qty: rows.length,
      comment: `Импорт CSV: ${rows.length} товаров`,
    })
    addMovement(client, {
      type: "import",
      note: `Импорт CSV: ${rows.length} товаров`,
    })
  })

  importProducts()
}

export function parseCsv(input: string) {
  const text = input.replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let cell = ""
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      row.push(cell)
      cell = ""
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1
      }
      row.push(cell)
      if (row.some(Boolean)) {
        rows.push(row)
      }
      row = []
      cell = ""
    } else {
      cell += char
    }
  }

  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }

  const [headers, ...body] = rows
  return body.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  )
}
