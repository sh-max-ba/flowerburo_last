import type Database from "better-sqlite3"
import { db } from "../connection"
import { mapStockDocument, mapSupplier } from "../mappers"
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
  const isActive = clean(formData.get("isActive")) !== "0"

  if (!name) {
    throw new Error("Название поставщика обязательно.")
  }

  // Реквизиты опциональны: пустое значение допустимо, но непустое — валидируем по форме.
  const inn = clean(formData.get("inn"))
  const kpp = clean(formData.get("kpp"))
  const ogrn = clean(formData.get("ogrn"))
  const email = clean(formData.get("email"))
  if (inn && !/^(\d{10}|\d{12})$/.test(inn)) {
    throw new Error("ИНН должен содержать 10 или 12 цифр.")
  }
  if (kpp && !/^\d{9}$/.test(kpp)) {
    throw new Error("КПП должен содержать 9 цифр.")
  }
  if (ogrn && !/^(\d{13}|\d{15})$/.test(ogrn)) {
    throw new Error("ОГРН должен содержать 13 или 15 цифр.")
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Некорректный e-mail.")
  }

  // Отсрочка: пусто = не задано (NULL); иначе целое число дней >= 0.
  const paymentDelayRaw = clean(formData.get("paymentDelayDays"))
  let paymentDelayDays: number | null = null
  if (paymentDelayRaw) {
    const parsed = Number(paymentDelayRaw)
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error("Отсрочка платежа — целое число дней (0 или больше).")
    }
    paymentDelayDays = parsed
  }

  const duplicate = client.prepare("SELECT id FROM suppliers WHERE name = ?").get(name) as
    | { id: number }
    | undefined
  if (duplicate && duplicate.id !== id) {
    throw new Error("Поставщик с таким названием уже существует.")
  }

  const fields = {
    name,
    legal_name: clean(formData.get("legalName")),
    inn,
    kpp,
    ogrn,
    phone: clean(formData.get("phone")),
    phone_2: clean(formData.get("phone2")),
    email,
    contact_name: clean(formData.get("contactName")),
    contact_name_2: clean(formData.get("contactName2")),
    responsible_name: clean(formData.get("responsibleName")),
    address: clean(formData.get("address")),
    bank_name: clean(formData.get("bankName")),
    bank_account: clean(formData.get("bankAccount")),
    bik: clean(formData.get("bik")),
    corr_account: clean(formData.get("corrAccount")),
    payment_terms: clean(formData.get("paymentTerms")),
    payment_delay_days: paymentDelayDays,
    comment: clean(formData.get("comment")),
    is_active: isActive ? 1 : 0,
  }

  if (id) {
    const result = client
      .prepare(
        `UPDATE suppliers SET
           name = @name, legal_name = @legal_name, inn = @inn, kpp = @kpp, ogrn = @ogrn,
           phone = @phone, phone_2 = @phone_2, email = @email,
           contact_name = @contact_name, contact_name_2 = @contact_name_2, responsible_name = @responsible_name,
           address = @address, bank_name = @bank_name, bank_account = @bank_account, bik = @bik, corr_account = @corr_account,
           payment_terms = @payment_terms, payment_delay_days = @payment_delay_days,
           comment = @comment, is_active = @is_active, updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`
      )
      .run({ ...fields, id })
    if (!result.changes) {
      throw new Error("Поставщик не найден.")
    }
    return
  }

  client
    .prepare(
      `INSERT INTO suppliers (
         name, legal_name, inn, kpp, ogrn, phone, phone_2, email,
         contact_name, contact_name_2, responsible_name, address,
         bank_name, bank_account, bik, corr_account, payment_terms, payment_delay_days,
         comment, is_active, updated_at
       ) VALUES (
         @name, @legal_name, @inn, @kpp, @ogrn, @phone, @phone_2, @email,
         @contact_name, @contact_name_2, @responsible_name, @address,
         @bank_name, @bank_account, @bik, @corr_account, @payment_terms, @payment_delay_days,
         @comment, @is_active, CURRENT_TIMESTAMP
       )`
    )
    .run(fields)
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

export function getSupplier(supplierId: number) {
  const row = db().prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId) as
    | Record<string, unknown>
    | undefined
  return row ? mapSupplier(row) : null
}

// История закупок поставщика — его проведённые/черновые приходные акты (stock_in).
// Read-only по существующим таблицам; supplier_id фиксируется только у stock_in.
export function getSupplierPurchaseHistory(supplierId: number) {
  const rows = db()
    .prepare(
      `SELECT stock_documents.*, COUNT(stock_document_items.id) as items_count
       FROM stock_documents
       LEFT JOIN stock_document_items ON stock_document_items.document_id = stock_documents.id
       WHERE stock_documents.supplier_id = ? AND stock_documents.type = 'stock_in'
       GROUP BY stock_documents.id
       ORDER BY stock_documents.created_at DESC, stock_documents.id DESC`
    )
    .all(supplierId) as Array<Record<string, unknown>>

  return rows.map((row) => mapStockDocument(row))
}
