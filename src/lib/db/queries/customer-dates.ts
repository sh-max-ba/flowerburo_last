import type Database from "better-sqlite3"
import { numberFromRow, rowNumOrNull, userRoleFromRow } from "@/lib/db-row"
import {
  customerDateNoteMax,
  customerDateTitleMax,
  daysInMonth,
  describeCustomerDate,
  shopToday,
  withNextOccurrence,
  type CalendarDay,
  type CustomerDate,
  type UpcomingCustomerDate,
} from "@/lib/customer-dates"
import { recipientLabel } from "@/lib/recipients"
import { db } from "../connection"
import type { CurrentUser } from "../types"

// Важные даты клиентов (v32). Дат немного (единицы на клиента), поэтому ближайшие считаем в JS
// поверх всего списка — так проще учесть переход через Новый год и 29 февраля.

export type CustomerDateInput = {
  customerId: number
  title: string
  month: number
  day: number
  year: number | null
  note: string
  // Чья дата — получатель этого клиента (null — сам клиент).
  recipientId?: number | null
}

// Получатель даты — подзапросами: список дат короткий, а JOIN мешал бы общему SELECT *.
const RECIPIENT_COLUMNS = `
  (SELECT name FROM customer_recipients r WHERE r.id = customer_dates.recipient_id) AS recipient_name,
  (SELECT relation FROM customer_recipients r WHERE r.id = customer_dates.recipient_id) AS recipient_relation`

const SELECT_DATE = `SELECT customer_dates.*,
  (SELECT name FROM users WHERE users.id = customer_dates.created_by_user_id) AS created_by_name,
  (SELECT role FROM users WHERE users.id = customer_dates.created_by_user_id) AS created_by_role,
  ${RECIPIENT_COLUMNS}
  FROM customer_dates`

function mapDate(row: Record<string, unknown>, today: CalendarDay): CustomerDate {
  return withNextOccurrence(
    {
      id: numberFromRow(row.id),
      customerId: numberFromRow(row.customer_id),
      title: String(row.title ?? ""),
      month: numberFromRow(row.month),
      day: numberFromRow(row.day),
      year: rowNumOrNull(row.year) || null,
      note: String(row.note ?? ""),
      recipientId: row.recipient_name == null ? null : rowNumOrNull(row.recipient_id),
      recipientName: String(row.recipient_name ?? ""),
      recipientRelation: String(row.recipient_relation ?? ""),
      createdByUserId: rowNumOrNull(row.created_by_user_id),
      createdByName: row.created_by_name == null ? null : String(row.created_by_name),
      createdByRole: userRoleFromRow(row.created_by_role),
      createdAt: String(row.created_at ?? ""),
    },
    today
  )
}

function byNextOccurrence(a: CustomerDate, b: CustomerDate) {
  return a.daysLeft - b.daysLeft || a.title.localeCompare(b.title, "ru") || a.id - b.id
}

// Даты одного клиента — ближайшая первой.
export function listCustomerDates(customerId: number, client: Database.Database = db()): CustomerDate[] {
  const today = shopToday()
  const rows = client
    .prepare(`${SELECT_DATE} WHERE customer_id = ?`)
    .all(customerId) as Array<Record<string, unknown>>
  return rows.map((row) => mapDate(row, today)).sort(byNextOccurrence)
}

// Даты всех клиентов, которые наступят в ближайшие `days` дней (0 — только сегодня). Без
// ограничения (days = null) — все даты по порядку наступления, начиная с сегодняшних.
export function listUpcomingCustomerDates(
  options: { days?: number | null } = {},
  client: Database.Database = db()
): UpcomingCustomerDate[] {
  const today = shopToday()
  const days = options.days === undefined ? 30 : options.days
  const rows = client
    .prepare(
      `SELECT customer_dates.*,
        customers.name AS customer_name,
        COALESCE(customers.phone, '') AS customer_phone,
        EXISTS (SELECT 1 FROM chats WHERE chats.customer_id = customers.id) AS has_chat,
        (SELECT name FROM users WHERE users.id = customer_dates.created_by_user_id) AS created_by_name,
        (SELECT role FROM users WHERE users.id = customer_dates.created_by_user_id) AS created_by_role,
        ${RECIPIENT_COLUMNS}
       FROM customer_dates
       JOIN customers ON customers.id = customer_dates.customer_id`
    )
    .all() as Array<Record<string, unknown>>

  return rows
    .map((row) => ({
      ...mapDate(row, today),
      customerName: String(row.customer_name ?? ""),
      customerPhone: String(row.customer_phone ?? ""),
      hasChat: numberFromRow(row.has_chat) === 1,
    }))
    .filter((row) => days == null || row.daysLeft <= days)
    .sort(byNextOccurrence)
}

function normalizeInput(input: CustomerDateInput) {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim()
  const note = String(input.note ?? "").replace(/\s+/g, " ").trim()
  const month = Math.trunc(Number(input.month))
  const day = Math.trunc(Number(input.day))
  const year = input.year == null || !Number(input.year) ? null : Math.trunc(Number(input.year))
  const recipientId = input.recipientId ? Math.trunc(Number(input.recipientId)) || null : null

  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new Error("Клиент не найден.")
  }
  if (!title) {
    throw new Error("Укажите повод — например, «День рождения».")
  }
  if (title.length > customerDateTitleMax) {
    throw new Error(`Повод длиннее ${customerDateTitleMax} символов.`)
  }
  if (note.length > customerDateNoteMax) {
    throw new Error(`Заметка длиннее ${customerDateNoteMax} символов.`)
  }
  if (!(month >= 1 && month <= 12)) {
    throw new Error("Выберите месяц.")
  }
  if (!(day >= 1 && day <= daysInMonth(month))) {
    throw new Error("Выберите день месяца.")
  }
  const currentYear = shopToday().year
  if (year != null && (year < 1900 || year > currentYear)) {
    throw new Error(`Год — от 1900 до ${currentYear}, или оставьте пустым.`)
  }
  if (year != null && day > daysInMonth(month, year)) {
    throw new Error(`В ${year} году нет ${day} февраля.`)
  }
  return { customerId: input.customerId, title, note, month, day, year, recipientId }
}

function logChange(
  client: Database.Database,
  customerId: number,
  user: Pick<CurrentUser, "id" | "name">,
  oldValue: string,
  newValue: string
) {
  client
    .prepare(
      `INSERT INTO customer_changes (customer_id, user_id, user_name, field, old_value, new_value)
       VALUES (?, ?, ?, 'importantDate', ?, ?)`
    )
    .run(customerId, user.id, user.name, oldValue, newValue)
}

type StoredDate = {
  customer_id: number
  title: string
  month: number
  day: number
  year: number | null
  note: string
  recipient_id: number | null
}

function recipientOf(client: Database.Database, recipientId: number | null | undefined) {
  if (!recipientId) {
    return null
  }
  return (client.prepare("SELECT customer_id, name, relation FROM customer_recipients WHERE id = ?").get(recipientId) ?? null) as
    | { customer_id: number; name: string; relation: string }
    | null
}

function describeStored(client: Database.Database, row: StoredDate) {
  const recipient = recipientOf(client, row.recipient_id)
  return describeCustomerDate({
    title: row.title,
    day: row.day,
    month: row.month,
    year: row.year || null,
    note: row.note,
    recipientLabel: recipient ? recipientLabel(recipient) : "",
  })
}

// Новая дата (id не задан) или правка существующей. Правки пишутся в историю клиента.
export function saveCustomerDate(
  id: number | null,
  input: CustomerDateInput,
  user: Pick<CurrentUser, "id" | "name">,
  client: Database.Database = db()
): number {
  const value = normalizeInput(input)
  return client.transaction(() => {
    const customer = client.prepare("SELECT id FROM customers WHERE id = ?").get(value.customerId)
    if (!customer) {
      throw new Error("Клиент не найден.")
    }
    const recipient = recipientOf(client, value.recipientId)
    if (value.recipientId && (!recipient || recipient.customer_id !== value.customerId)) {
      throw new Error("Получатель не найден — обновите страницу.")
    }
    const described = describeCustomerDate({ ...value, recipientLabel: recipient ? recipientLabel(recipient) : "" })

    if (id) {
      const existing = client.prepare("SELECT * FROM customer_dates WHERE id = ?").get(id) as StoredDate | undefined
      if (!existing || existing.customer_id !== value.customerId) {
        throw new Error("Дата не найдена — обновите страницу.")
      }
      client
        .prepare(
          `UPDATE customer_dates
           SET title = @title, month = @month, day = @day, year = @year, note = @note, recipient_id = @recipientId,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = @id`
        )
        .run({ ...value, id })
      const before = describeStored(client, existing)
      if (before !== described) {
        logChange(client, value.customerId, user, before, described)
      }
      return id
    }

    const result = client
      .prepare(
        `INSERT INTO customer_dates (customer_id, title, month, day, year, note, recipient_id, created_by_user_id)
         VALUES (@customerId, @title, @month, @day, @year, @note, @recipientId, @userId)`
      )
      .run({ ...value, userId: user.id })
    logChange(client, value.customerId, user, "", described)
    return Number(result.lastInsertRowid)
  })()
}

// Удаляет дату и возвращает клиента, которому она принадлежала (для обновления страниц).
export function deleteCustomerDate(
  id: number,
  user: Pick<CurrentUser, "id" | "name">,
  client: Database.Database = db()
): number {
  return client.transaction(() => {
    const existing = client.prepare("SELECT * FROM customer_dates WHERE id = ?").get(id) as StoredDate | undefined
    if (!existing) {
      throw new Error("Дата уже удалена.")
    }
    const before = describeStored(client, existing)
    client.prepare("DELETE FROM customer_dates WHERE id = ?").run(id)
    logChange(client, existing.customer_id, user, before, "")
    return existing.customer_id
  })()
}
