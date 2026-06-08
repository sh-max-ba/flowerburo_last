import Database from "better-sqlite3"
import { dbPath } from "./types"
import { migrate } from "./migrate"
import { seedDefaultUsers, seedFromCsv } from "./seed"

let database: Database.Database | null = null

export function initDb() {
  return db()
}

export function db() {
  if (!database) {
    database = new Database(dbPath)
    database.pragma("journal_mode = WAL")
    database.pragma("foreign_keys = ON")
    migrate(database)
    seedDefaultUsers(database)
    seedFromCsv(database)
  }

  return database
}
