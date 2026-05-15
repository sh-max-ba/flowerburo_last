import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"

const dbPath = path.join(process.cwd(), "app.db")
const tablesToClear = [
  "sale_items",
  "order_items",
  "warehouse_import_items",
  "sales",
  "orders",
  "cash_transactions",
  "stock_movements",
  "shifts",
  "movements",
  "products",
  "warehouse_imports",
  "sessions",
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
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`)
  }

  if (process.env.CONFIRM_RESET !== "YES") {
    console.log("Refusing to reset. Run with CONFIRM_RESET=YES npm run reset-database-for-launch")
    return
  }

  const backupPath = path.join(process.cwd(), `app.db.backup-before-launch-reset-${timestamp()}`)
  const db = new Database(dbPath)
  const deletedRows: Record<TableName, number> = Object.fromEntries(tablesToClear.map((tableName) => [tableName, 0])) as Record<
    TableName,
    number
  >

  try {
    db.pragma("foreign_keys = ON")
    db.pragma("wal_checkpoint(FULL)")
    fs.copyFileSync(dbPath, backupPath)

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
          db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(tableName)
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
    console.log(`Products left: ${countRows(db, "products")}`)
    console.log(`Users left: ${countRows(db, "users")}`)
    console.log(`Sessions left: ${countRows(db, "sessions")}`)
    console.log(`Orders left: ${countRows(db, "orders")}`)
    console.log(`Sales left: ${countRows(db, "sales")}`)
    console.log(`Shifts left: ${countRows(db, "shifts")}`)
  } finally {
    db.close()
  }
}

main()
