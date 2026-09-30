import type Database from "better-sqlite3"
import { numberFromRow, userRoleFromRow } from "@/lib/db-row"
import {
  describeRecipient,
  recipientAddressMax,
  recipientNameMax,
  recipientNoteMax,
  recipientRelationMax,
  type CustomerRecipient,
} from "@/lib/recipients"
import { db } from "../connection"
import type { CurrentUser } from "../types"

// Получатели клиента (v33). Список короткий (единицы на клиента): недавно использованные — выше.

export type CustomerRecipientInput = {
  customerId: number
  name: string
  relation: string
  phone: string
  address: string
  note: string
}

type Actor = Pick<CurrentUser, "id" | "name">

function mapRecipient(row: Record<string, unknown>): CustomerRecipient {
  return {
    id: numberFromRow(row.id),
    customerId: numberFromRow(row.customer_id),
    name: String(row.name ?? ""),
    relation: String(row.relation ?? ""),
    phone: String(row.phone ?? ""),
    address: String(row.address ?? ""),
    note: String(row.note ?? ""),
    createdByName: row.created_by_name == null ? null : String(row.created_by_name),
    createdByRole: userRoleFromRow(row.created_by_role),
    lastUsedAt: row.last_used_at == null ? null : String(row.last_used_at),
    ordersCount: numberFromRow(row.orders_count),
  }
}

export function listCustomerRecipients(customerId: number, client: Database.Database = db()): CustomerRecipient[] {
  const rows = client
    .prepare(
      `SELECT r.*,
        (SELECT name FROM users WHERE users.id = r.created_by_user_id) AS created_by_name,
        (SELECT role FROM users WHERE users.id = r.created_by_user_id) AS created_by_role,
        (SELECT COUNT(*) FROM orders o WHERE o.recipient_id = r.id AND o.status NOT IN ('Отменен', 'Черновик')) AS orders_count
       FROM customer_recipients r
       WHERE r.customer_id = ?
       ORDER BY COALESCE(r.last_used_at, r.created_at) DESC, r.id DESC`
    )
    .all(customerId) as Array<Record<string, unknown>>
  return rows.map(mapRecipient)
}

function oneLine(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

// «+996» без номера (префикс поля ввода) — пустой телефон.
function cleanPhone(value: unknown) {
  const phone = oneLine(value)
  return phone.replace(/\D/g, "").length <= 3 ? "" : phone
}

function normalizeInput(input: CustomerRecipientInput) {
  const value = {
    customerId: Math.trunc(Number(input.customerId)),
    name: oneLine(input.name),
    relation: oneLine(input.relation).toLowerCase(),
    phone: cleanPhone(input.phone),
    address: oneLine(input.address),
    note: oneLine(input.note),
  }
  if (!Number.isInteger(value.customerId) || value.customerId <= 0) {
    throw new Error("Клиент не найден.")
  }
  if (!value.name) {
    throw new Error("Укажите имя получателя.")
  }
  if (value.name.length > recipientNameMax) {
    throw new Error(`Имя длиннее ${recipientNameMax} символов.`)
  }
  if (value.relation.length > recipientRelationMax) {
    throw new Error(`«Кем приходится» длиннее ${recipientRelationMax} символов.`)
  }
  if (value.address.length > recipientAddressMax) {
    throw new Error(`Адрес длиннее ${recipientAddressMax} символов.`)
  }
  if (value.note.length > recipientNoteMax) {
    throw new Error(`Заметка длиннее ${recipientNoteMax} символов.`)
  }
  return value
}

function logChange(client: Database.Database, customerId: number, user: Actor, oldValue: string, newValue: string) {
  client
    .prepare(
      `INSERT INTO customer_changes (customer_id, user_id, user_name, field, old_value, new_value)
       VALUES (?, ?, ?, 'recipient', ?, ?)`
    )
    .run(customerId, user.id, user.name, oldValue, newValue)
}

type StoredRecipient = {
  id: number
  customer_id: number
  name: string
  relation: string
  phone: string
  address: string
  note: string
}

function insertRecipient(client: Database.Database, value: ReturnType<typeof normalizeInput>, user: Actor) {
  const result = client
    .prepare(
      `INSERT INTO customer_recipients (customer_id, name, relation, phone, address, note, created_by_user_id)
       VALUES (@customerId, @name, @relation, @phone, @address, @note, @userId)`
    )
    .run({ ...value, userId: user.id })
  logChange(client, value.customerId, user, "", describeRecipient(value))
  return Number(result.lastInsertRowid)
}

// Новый получатель (id не задан) или правка. Правки — в историю клиента.
export function saveCustomerRecipient(
  id: number | null,
  input: CustomerRecipientInput,
  user: Actor,
  client: Database.Database = db()
): number {
  const value = normalizeInput(input)
  return client.transaction(() => {
    if (!client.prepare("SELECT id FROM customers WHERE id = ?").get(value.customerId)) {
      throw new Error("Клиент не найден.")
    }
    if (!id) {
      return insertRecipient(client, value, user)
    }
    const existing = client.prepare("SELECT * FROM customer_recipients WHERE id = ?").get(id) as StoredRecipient | undefined
    if (!existing || existing.customer_id !== value.customerId) {
      throw new Error("Получатель не найден — обновите страницу.")
    }
    client
      .prepare(
        `UPDATE customer_recipients
         SET name = @name, relation = @relation, phone = @phone, address = @address, note = @note,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`
      )
      .run({ ...value, id })
    const before = describeRecipient(existing)
    const after = describeRecipient(value)
    if (before !== after) {
      logChange(client, value.customerId, user, before, after)
    }
    return id
  })()
}

// Удаление: даты получателя остаются у клиента (без привязки), заказы сохраняют имя получателя.
export function deleteCustomerRecipient(id: number, user: Actor, client: Database.Database = db()): number {
  return client.transaction(() => {
    const existing = client.prepare("SELECT * FROM customer_recipients WHERE id = ?").get(id) as StoredRecipient | undefined
    if (!existing) {
      throw new Error("Получатель уже удалён.")
    }
    client.prepare("UPDATE customer_dates SET recipient_id = NULL WHERE recipient_id = ?").run(id)
    client.prepare("UPDATE orders SET recipient_id = NULL WHERE recipient_id = ?").run(id)
    client.prepare("DELETE FROM customer_recipients WHERE id = ?").run(id)
    logChange(client, existing.customer_id, user, describeRecipient(existing), "")
    return existing.customer_id
  })()
}

// Получатель заказа из формы заказа (новый заказ, черновик, правка). Поля формы:
// recipientName, recipientRelation, recipientId (выбран из списка), saveRecipient=1 («Запомнить»).
// Телефон — recipientPhone, адрес — address (уже записаны в заказ вызывающим).
// Форма без поля recipientName (старая вкладка) — получателя заказа не трогаем.
export function applyOrderRecipient(
  client: Database.Database,
  orderId: number,
  formData: FormData,
  user: Actor
) {
  if (!formData.has("recipientName")) {
    return
  }
  const order = client
    .prepare("SELECT customer_id, recipient_phone, recipient_name, recipient_id, delivery_type, address FROM orders WHERE id = ?")
    .get(orderId) as
    | {
        customer_id: number | null
        recipient_phone: string | null
        recipient_name: string | null
        recipient_id: number | null
        delivery_type: string | null
        address: string | null
      }
    | undefined
  if (!order) {
    return
  }
  const customerId = order.customer_id ? Number(order.customer_id) : null
  const name = oneLine(formData.get("recipientName")).slice(0, recipientNameMax)
  const phone = cleanPhone(order.recipient_phone)
  const address = order.delivery_type === "delivery" ? oneLine(order.address) : ""

  let recipientId: number | null = null
  if (formData.has("recipientId")) {
    recipientId = Math.trunc(Number(formData.get("recipientId"))) || null
  } else if (order.recipient_id && oneLine(order.recipient_name) === name) {
    // Правка заказа без выбора из списка: привязка сохраняется, пока имя получателя то же.
    recipientId = Number(order.recipient_id)
  }

  if (!name && !phone) {
    recipientId = null
  }

  if (recipientId) {
    const saved = client.prepare("SELECT * FROM customer_recipients WHERE id = ?").get(recipientId) as StoredRecipient | undefined
    if (!saved || !customerId || saved.customer_id !== customerId) {
      recipientId = null
    } else if (formData.has("recipientId")) {
      // Выбран из списка в окне заказа: актуализируем телефон и адрес, если в заказе их поменяли.
      const next = {
        ...saved,
        phone: phone || saved.phone,
        address: address || saved.address,
      }
      if (next.phone !== saved.phone || next.address !== saved.address) {
        client
          .prepare("UPDATE customer_recipients SET phone = ?, address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(next.phone, next.address, recipientId)
        logChange(client, saved.customer_id, user, describeRecipient(saved), describeRecipient(next))
      }
      client.prepare("UPDATE customer_recipients SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(recipientId)
    }
  }

  if (!recipientId && name && customerId && oneLine(formData.get("saveRecipient")) === "1") {
    recipientId = insertRecipient(
      client,
      normalizeInput({
        customerId,
        name,
        relation: String(formData.get("recipientRelation") ?? ""),
        phone,
        address,
        note: "",
      }),
      user
    )
    client.prepare("UPDATE customer_recipients SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(recipientId)
  }

  client.prepare("UPDATE orders SET recipient_name = ?, recipient_id = ? WHERE id = ?").run(name, recipientId, orderId)
}
