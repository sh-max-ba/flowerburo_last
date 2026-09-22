import fs from "node:fs"
import path from "node:path"
import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { maxOrderImages, orderImagePublicPathPrefix, orderImageIdsFieldName, parseOrderImageIds } from "@/lib/order-images"
import type { OrderImage } from "../types"
import { db } from "../connection"

// Изображения заказа. Жизненный цикл:
//   1) POST /api/orders/images сохраняет файл и создаёт строку с order_id = NULL (ожидает привязки);
//   2) форма заказа присылает orderImageIds — syncOrderImages привязывает эти строки к заказу и
//      отвязывает (удаляет строки) те, что из формы убрали;
//   3) непривязанные строки и файлы без строки старше суток чистит cleanupOrphanOrderImages.
// Файлы с диска в момент отвязки НЕ удаляем: удаление до commit транзакции оставило бы битую
// ссылку при откате, а после — лишняя async-ветка в синхронном домене. Сироты подберёт чистка.

export const orderImagesDir = path.join(process.cwd(), "public", "uploads", "orders")

const ORDER_IMAGE_COLUMNS = `id, order_id as orderId, image_path as imagePath, COALESCE(thumb_path, '') as thumbPath,
  COALESCE(original_name, '') as originalName, COALESCE(width, 0) as width, COALESCE(height, 0) as height,
  created_at as createdAt`

type OrderImageRow = {
  id: number
  orderId: number | null
  imagePath: string
  thumbPath: string
  originalName: string
  width: number
  height: number
  createdAt: string
}

function mapOrderImageRow(row: OrderImageRow): OrderImage {
  return {
    id: numberFromRow(row.id),
    orderId: row.orderId == null ? null : numberFromRow(row.orderId),
    imagePath: String(row.imagePath ?? ""),
    thumbPath: String(row.thumbPath ?? "") || String(row.imagePath ?? ""),
    originalName: String(row.originalName ?? ""),
    width: numberFromRow(row.width),
    height: numberFromRow(row.height),
    createdAt: String(row.createdAt ?? ""),
  }
}

export type NewOrderImageInput = {
  imagePath: string
  thumbPath: string
  originalName: string
  width: number
  height: number
  userId: number | null
}

// Строка «ожидает привязки» — создаётся сразу после успешной записи файла на диск.
export function createPendingOrderImage(input: NewOrderImageInput): OrderImage {
  const client = db()
  const inserted = client
    .prepare(
      `INSERT INTO order_images (order_id, image_path, thumb_path, original_name, width, height, created_by_user_id)
       VALUES (NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.imagePath, input.thumbPath, input.originalName.slice(0, 200), input.width, input.height, input.userId)
  const row = client
    .prepare(`SELECT ${ORDER_IMAGE_COLUMNS} FROM order_images WHERE id = ?`)
    .get(Number(inserted.lastInsertRowid)) as OrderImageRow
  return mapOrderImageRow(row)
}

export function listOrderImages(orderId: number, client: Database.Database = db()): OrderImage[] {
  return loadOrderImagesByOrder(client, [orderId]).get(orderId) ?? []
}

export function loadOrderImagesByOrder(client: Database.Database, orderIds: number[]): Map<number, OrderImage[]> {
  const imagesByOrder = new Map<number, OrderImage[]>()
  if (!orderIds.length) {
    return imagesByOrder
  }
  const placeholders = orderIds.map(() => "?").join(", ")
  const rows = client
    .prepare(
      `SELECT ${ORDER_IMAGE_COLUMNS} FROM order_images
        WHERE order_id IN (${placeholders})
        ORDER BY position ASC, id ASC`
    )
    .all(...orderIds) as OrderImageRow[]
  for (const row of rows) {
    const orderId = numberFromRow(row.orderId)
    const images = imagesByOrder.get(orderId) ?? []
    images.push(mapOrderImageRow(row))
    imagesByOrder.set(orderId, images)
  }
  return imagesByOrder
}

// Привязка по списку id из формы. Вызывать ВНУТРИ транзакции сохранения заказа.
// Берём только «свои» строки: ожидающие привязки (order_id IS NULL) или уже привязанные к этому
// заказу — чужой заказ через подмену id не тронуть. Порядок id = порядок показа.
export function syncOrderImages(client: Database.Database, orderId: number, imageIds: number[]) {
  const ids = imageIds.slice(0, maxOrderImages)
  client
    .prepare(
      `DELETE FROM order_images
        WHERE order_id = ?${ids.length ? ` AND id NOT IN (${ids.map(() => "?").join(", ")})` : ""}`
    )
    .run(orderId, ...ids)
  const attach = client.prepare(
    `UPDATE order_images SET order_id = ?, position = ?
      WHERE id = ? AND (order_id IS NULL OR order_id = ?)`
  )
  ids.forEach((id, position) => {
    attach.run(orderId, position, id, orderId)
  })
}

// Обёртка для домена: синхронизируем ТОЛЬКО если форма прислала поле (старая вкладка без него не
// должна молча снять картинки с заказа). Возвращает true, если синхронизация выполнена.
export function syncOrderImagesFromForm(client: Database.Database, orderId: number, formData: FormData) {
  if (!formData.has(orderImageIdsFieldName)) {
    return false
  }
  syncOrderImages(client, orderId, parseOrderImageIds(formData.get(orderImageIdsFieldName)))
  return true
}

// Удаление заказа (черновика) — строки изображений уходят вместе с ним, файлы подберёт чистка.
export function deleteOrderImagesForOrder(client: Database.Database, orderId: number) {
  client.prepare("DELETE FROM order_images WHERE order_id = ?").run(orderId)
}

const orphanMaxAgeMs = 24 * 60 * 60 * 1000
const cleanupIntervalMs = 60 * 60 * 1000
let lastCleanupAt = 0

// Чистка сирот: (а) строки без заказа старше суток (загрузили, но заказ не сохранили),
// (б) файлы в каталоге, на которые не ссылается ни одна строка, старше суток (убрали из заказа,
// либо заказ-черновик удалён). Дёргается из POST /api/orders/images не чаще раза в час; сутки
// запаса — чтобы не снести файл, который прямо сейчас лежит в открытой, но ещё не сохранённой форме.
export function cleanupOrphanOrderImages(options: { force?: boolean } = {}) {
  const now = Date.now()
  if (!options.force && now - lastCleanupAt < cleanupIntervalMs) {
    return { deletedRows: 0, deletedFiles: 0 }
  }
  lastCleanupAt = now

  const client = db()
  const deletedRows = client
    .prepare(
      `DELETE FROM order_images
        WHERE order_id IS NULL
          AND created_at < datetime('now', '-1 day')`
    )
    .run().changes

  let deletedFiles = 0
  let entries: string[] = []
  try {
    entries = fs.readdirSync(orderImagesDir)
  } catch {
    return { deletedRows, deletedFiles }
  }
  if (!entries.length) {
    return { deletedRows, deletedFiles }
  }

  const referenced = new Set<string>()
  const rows = client.prepare("SELECT image_path as imagePath, COALESCE(thumb_path, '') as thumbPath FROM order_images").all() as Array<{
    imagePath: string
    thumbPath: string
  }>
  for (const row of rows) {
    for (const value of [row.imagePath, row.thumbPath]) {
      if (value.startsWith(orderImagePublicPathPrefix)) {
        referenced.add(value.slice(orderImagePublicPathPrefix.length))
      }
    }
  }

  for (const filename of entries) {
    if (filename.startsWith(".") || referenced.has(filename)) {
      continue
    }
    const fullPath = path.join(orderImagesDir, filename)
    try {
      const stat = fs.statSync(fullPath)
      if (!stat.isFile() || now - stat.mtimeMs < orphanMaxAgeMs) {
        continue
      }
      fs.unlinkSync(fullPath)
      deletedFiles += 1
    } catch {
      // Файл уже удалён параллельно или недоступен — чистка best-effort.
    }
  }

  return { deletedRows, deletedFiles }
}
