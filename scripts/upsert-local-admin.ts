import Database from "better-sqlite3"
import { initDb } from "../src/lib/db"
import { hashPassword } from "../src/lib/password"

const dbPath = "app.db"

const login = process.env.TEST_ADMIN_LOGIN ?? "admin.test"
const password = process.env.TEST_ADMIN_PASSWORD ?? "Flowerburo123"
const name = process.env.TEST_ADMIN_NAME ?? "Test Admin"

function main() {
  initDb()

  const db = new Database(dbPath)
  const existing = db.prepare("SELECT id FROM users WHERE login = ?").get(login) as { id: number } | undefined

  if (existing) {
    db.prepare(
      `UPDATE users
       SET name = ?, role = 'owner', password_hash = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(name, hashPassword(password), existing.id)
  } else {
    db.prepare(
      `INSERT INTO users (login, name, role, password_hash, is_active, updated_at)
       VALUES (?, ?, 'owner', ?, 1, CURRENT_TIMESTAMP)`,
    ).run(login, name, hashPassword(password))
  }

  db.close()

  console.log("Local test admin ready:")
  console.log(`login=${login}`)
  console.log(`password=${password}`)
  console.log("role=owner")
}

main()
