import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { db } from "../connection"
import type { CurrentUser } from "../types"

// Быстрые ответы чатов: общие для команды заготовки. Список отдаём целиком (их десятки, не тысячи) —
// фильтрация по «/» и поиску идёт на клиенте без запросов. Частые — выше, дальше по алфавиту.

export type QuickReply = {
  id: number
  title: string
  text: string
  usageCount: number
  createdByName: string
  updatedAt: string
}

export type QuickReplyInput = {
  title: string
  text: string
}

export const quickReplyTitleMax = 60
export const quickReplyTextMax = 4000

export function listQuickReplies(client: Database.Database = db()): QuickReply[] {
  const rows = client
    .prepare(
      `SELECT id, title, text, usage_count as usageCount, created_by_name as createdByName, updated_at as updatedAt
       FROM quick_replies
       ORDER BY usage_count DESC, lower_u(CASE WHEN title <> '' THEN title ELSE text END), id`
    )
    .all() as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: numberFromRow(row.id),
    title: String(row.title ?? ""),
    text: String(row.text ?? ""),
    usageCount: numberFromRow(row.usageCount),
    createdByName: String(row.createdByName ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  }))
}

function normalizeInput(input: QuickReplyInput) {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim()
  // Текст храним как есть (переносы строк важны), срезаем только пустые края.
  const text = String(input.text ?? "").replace(/\r\n/g, "\n").trim()
  if (!text) {
    throw new Error("Введите текст ответа.")
  }
  if (text.length > quickReplyTextMax) {
    throw new Error(`Текст длиннее ${quickReplyTextMax} символов.`)
  }
  if (title.length > quickReplyTitleMax) {
    throw new Error(`Название длиннее ${quickReplyTitleMax} символов.`)
  }
  return { title, text }
}

export function createQuickReply(input: QuickReplyInput, user: CurrentUser, client: Database.Database = db()) {
  const { title, text } = normalizeInput(input)
  const duplicate = client.prepare("SELECT id FROM quick_replies WHERE text = ?").get(text)
  if (duplicate) {
    throw new Error("Такой быстрый ответ уже есть.")
  }
  const result = client
    .prepare(
      `INSERT INTO quick_replies (title, text, created_by_user_id, created_by_name)
       VALUES (@title, @text, @userId, @userName)`
    )
    .run({ title, text, userId: user.id, userName: user.name })
  return Number(result.lastInsertRowid)
}

export function updateQuickReply(id: number, input: QuickReplyInput, client: Database.Database = db()) {
  const { title, text } = normalizeInput(input)
  const result = client
    .prepare("UPDATE quick_replies SET title = @title, text = @text, updated_at = CURRENT_TIMESTAMP WHERE id = @id")
    .run({ id: Math.trunc(id), title, text })
  if (result.changes === 0) {
    throw new Error("Быстрый ответ не найден — возможно, его уже удалили.")
  }
}

export function deleteQuickReply(id: number, client: Database.Database = db()) {
  client.prepare("DELETE FROM quick_replies WHERE id = ?").run(Math.trunc(id))
}

export function markQuickReplyUsed(id: number, client: Database.Database = db()) {
  client
    .prepare("UPDATE quick_replies SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(Math.trunc(id))
}
