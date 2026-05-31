import type Database from "better-sqlite3"
import { db } from "../connection"
import { mapSupplier } from "../mappers"
import { clean } from "../form-parsers"

export function listSuppliers(options?: { activeOnly?: boolean }, client: Database.Database = db()) {
  const rows = client
    .prepare(
      `SELECT *
       FROM suppliers
       ${options?.activeOnly ? "WHERE is_active = 1" : ""}
       ORDER BY is_active DESC, name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[]

  return rows.map(mapSupplier)
}

export function upsertSupplier(formData: FormData) {
  const client = db()
  const id = Number(clean(formData.get("id")))
  const name = clean(formData.get("name"))
  const phone = clean(formData.get("phone"))
  const contactName = clean(formData.get("contactName"))
  const comment = clean(formData.get("comment"))
  const isActive = clean(formData.get("isActive")) !== "0"

  if (!name) {
    throw new Error("Название поставщика обязательно.")
  }

  const duplicate = client.prepare("SELECT id FROM suppliers WHERE name = ?").get(name) as
    | { id: number }
    | undefined
  if (duplicate && duplicate.id !== id) {
    throw new Error("Поставщик с таким названием уже существует.")
  }

  if (id) {
    const result = client
      .prepare(
        `UPDATE suppliers
         SET name = ?, phone = ?, contact_name = ?, comment = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(name, phone, contactName, comment, isActive ? 1 : 0, id)
    if (!result.changes) {
      throw new Error("Поставщик не найден.")
    }
    return
  }

  client
    .prepare(
      `INSERT INTO suppliers (name, phone, contact_name, comment, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(name, phone, contactName, comment, isActive ? 1 : 0)
}

export function setSupplierActive(supplierId: number, isActive: boolean) {
  const client = db()
  const result = client
    .prepare("UPDATE suppliers SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(isActive ? 1 : 0, supplierId)
  if (!result.changes) {
    throw new Error("Поставщик не найден.")
  }
}
