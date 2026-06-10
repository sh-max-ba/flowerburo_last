import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"

const dbPath = path.join(process.cwd(), "app.db")
const tablesToClear = [
  "sale_items",
  "order_items",
  "deal_items",
  "deal_bouquet_messages",
  "bouquet_template_items",
  "bouquet_templates",
  "stock_document_items",
  "stock_document_overheads",
  "stock_lot_movements",
  "stock_lots",
  "warehouse_import_items",
  "stock_movements",
  "movements",
  "cash_transactions",
  "wazzup_messages",
  "wazzup_webhook_events",
  "wazzup_contact_sync",
  "wazzup_deal_sync",
  "wazzup_pipeline_sync",
  "wazzup_stage_sync",
  "wazzup_user_sync",
  "sales",
  "orders",
  "deals",
  "customers",
  "stock_documents",
  "warehouse_imports",
  "shifts",
  "sessions",
] as const

// Каталог товаров (products) НЕ чистится: его ведёт клиент, и пустая таблица в существующей
// БД больше не пересеивается из CSV (см. connection.ts) — после вайпа склад остался бы пустым.
const tablesToPreserve = [
  "users",
  "integration_settings",
  "suppliers",
  "deal_pipelines",
  "deal_stages",
  "products",
] as const

const summaryTables = [
  "users",
  "products",
  "customers",
  "deals",
  "orders",
  "shifts",
  "wazzup_webhook_events",
  "wazzup_messages",
] as const

type TableName = (typeof tablesToClear)[number]

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function timestamp() {
  const value = new Date()
  const pad = (input: number) => String(input).padStart(2, "0")

  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    pad(value.getHours()),
    pad(value.getMinutes()),
    pad(value.getSeconds()),
  ].join("-")
}

function tableExists(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { 1: number } | undefined

  return Boolean(row)
}

function countRows(db: Database.Database, tableName: string) {
  if (!tableExists(db, tableName)) {
    return 0
  }

  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as { count: number }
  return row.count
}

function main() {
  if (process.env.CONFIRM_RESET !== "YES") {
    console.log("Refusing to reset. Run with CONFIRM_RESET=YES npm run reset-database-for-launch")
    return
  }

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`)
  }

  const backupPath = path.join(process.cwd(), `app.db.backup-before-launch-reset-${timestamp()}`)
  const db = new Database(dbPath)
  const deletedRows: Record<TableName, number> = Object.fromEntries(tablesToClear.map((tableName) => [tableName, 0])) as Record<
    TableName,
    number
  >

  try {
    db.pragma("foreign_keys = ON")
    // VACUUM INTO даёт консистентный снимок независимо от состояния WAL (copyFileSync живой
    // базы без -wal терял незачекпойнченные записи).
    db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`)

    const reset = db.transaction(() => {
      for (const tableName of tablesToClear) {
        if (!tableExists(db, tableName)) {
          continue
        }

        const result = db.prepare(`DELETE FROM ${quoteIdentifier(tableName)}`).run()
        deletedRows[tableName] = result.changes
      }

      if (tableExists(db, "sqlite_sequence")) {
        for (const tableName of tablesToClear) {
          if (tableExists(db, tableName)) {
            db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(tableName)
          }
        }
      }
    })

    reset()

    console.log("Launch reset complete.")
    console.log(`Backup path: ${backupPath}`)
    console.log("Deleted rows:")
    for (const tableName of tablesToClear) {
      console.log(`- ${tableName}: ${deletedRows[tableName]}`)
    }
    console.log("Preserved tables:")
    for (const tableName of tablesToPreserve) {
      console.log(`- ${tableName}: ${countRows(db, tableName)}`)
    }
    console.log("Rows left after reset:")
    for (const tableName of summaryTables) {
      console.log(`- ${tableName}: ${countRows(db, tableName)}`)
    }
  } finally {
    db.close()
  }
}

main()
