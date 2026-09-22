import fs from "node:fs"
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
    // Сид каталога из CSV — только при СОЗДАНИИ нового файла БД. Пустая таблица products в
    // существующей базе (например, после reset-database-for-launch) — осознанное состояние:
    // тихое воскрешение каталога из старого CSV (с его остатками и резервами) недопустимо.
    const isNewDatabase = !fs.existsSync(dbPath)
    database = new Database(dbPath)
    database.pragma("journal_mode = WAL")
    database.pragma("foreign_keys = ON")
    // LIKE/lower() в SQLite без ICU не знают кириллицу — регистрируем Unicode-строчные буквы для
    // поиска по имени/тексту (lower_u(name) LIKE lower_u(@search)).
    database.function("lower_u", { deterministic: true }, (value: unknown) =>
      value === null || value === undefined ? null : String(value).toLowerCase()
    )
    migrate(database)
    seedDefaultUsers(database)
    if (isNewDatabase) {
      seedFromCsv(database)
    }
  }

  return database
}
