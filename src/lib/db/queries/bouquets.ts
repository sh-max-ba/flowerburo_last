import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import type {
  BouquetTemplate,
  BouquetTemplateInput,
  BouquetTemplateItem,
  CurrentUser,
  DealBouquetMessage,
  DealBouquetMessageStatus,
} from "../types"
import { db } from "../connection"
import { getProduct } from "../ledger"
import { mapBouquetTemplate, mapDealBouquetMessage } from "../mappers"
import { clean } from "../form-parsers"

export function listBouquetTemplates(options: { activeOnly?: boolean } = {}): BouquetTemplate[] {
  const client = db()
  const where = options.activeOnly ? "WHERE COALESCE(bouquet_templates.is_active, 1) = 1" : ""
  const rows = client
    .prepare(
      `SELECT bouquet_templates.id, bouquet_templates.name, COALESCE(bouquet_templates.description, '') as description,
        COALESCE(bouquet_templates.image_path, '') as imagePath,
        COALESCE(bouquet_templates.price, 0) as price, COALESCE(bouquet_templates.is_active, 1) as isActive,
        bouquet_templates.created_by_user_id as createdByUserId,
        COALESCE(bouquet_templates.created_by_name, '') as createdByName,
        bouquet_templates.created_at as createdAt, bouquet_templates.updated_at as updatedAt,
        COUNT(bouquet_template_items.id) as itemsCount
       FROM bouquet_templates
       LEFT JOIN bouquet_template_items ON bouquet_template_items.bouquet_id = bouquet_templates.id
       ${where}
       GROUP BY bouquet_templates.id
       ORDER BY COALESCE(bouquet_templates.is_active, 1) DESC,
        bouquet_templates.updated_at DESC, bouquet_templates.id DESC`
    )
    .all() as Array<Record<string, unknown>>

  return rows.map((row) => mapBouquetTemplate(row, listBouquetTemplateItems(numberFromRow(row.id), client)))
}

export function getBouquetTemplate(id: number) {
  const client = db()
  const row = client
    .prepare(
      `SELECT bouquet_templates.id, bouquet_templates.name, COALESCE(bouquet_templates.description, '') as description,
        COALESCE(bouquet_templates.image_path, '') as imagePath,
        COALESCE(bouquet_templates.price, 0) as price, COALESCE(bouquet_templates.is_active, 1) as isActive,
        bouquet_templates.created_by_user_id as createdByUserId,
        COALESCE(bouquet_templates.created_by_name, '') as createdByName,
        bouquet_templates.created_at as createdAt, bouquet_templates.updated_at as updatedAt,
        COUNT(bouquet_template_items.id) as itemsCount
       FROM bouquet_templates
       LEFT JOIN bouquet_template_items ON bouquet_template_items.bouquet_id = bouquet_templates.id
       WHERE bouquet_templates.id = ?
       GROUP BY bouquet_templates.id`
    )
    .get(id) as Record<string, unknown> | undefined

  return row ? mapBouquetTemplate(row, listBouquetTemplateItems(id, client)) : null
}

export function updateBouquetTemplateImagePath(id: number, imagePath: string) {
  const client = db()
  const bouquetId = Math.trunc(id)
  const existing = getBouquetTemplateRecord(client, bouquetId)
  if (!existing) {
    throw new Error("Букет не найден.")
  }

  client
    .prepare("UPDATE bouquet_templates SET image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(imagePath, bouquetId)

  return getBouquetTemplate(bouquetId)
}

export function createBouquetTemplate(input: BouquetTemplateInput, currentUser?: CurrentUser) {
  const client = db()
  const create = client.transaction(() => {
    const normalized = normalizeBouquetTemplateInput(client, input)
    const result = client
      .prepare(
        `INSERT INTO bouquet_templates (
          name, description, price, is_active, created_by_user_id, created_by_name, updated_at
        ) VALUES (
          @name, @description, @price, @isActive, @createdByUserId, @createdByName, CURRENT_TIMESTAMP
        )`
      )
      .run({
        name: normalized.name,
        description: normalized.description,
        price: normalized.price,
        isActive: normalized.isActive ? 1 : 0,
        createdByUserId: currentUser?.id ?? null,
        createdByName: currentUser?.name ?? "",
      })
    const bouquetId = Number(result.lastInsertRowid)
    replaceBouquetTemplateItems(client, bouquetId, normalized.items)
    return bouquetId
  })

  return create()
}

export function updateBouquetTemplate(id: number, input: BouquetTemplateInput) {
  const client = db()
  const update = client.transaction(() => {
    const bouquetId = Math.trunc(id)
    const existing = getBouquetTemplateRecord(client, bouquetId)
    if (!existing) {
      throw new Error("Букет не найден.")
    }

    const normalized = normalizeBouquetTemplateInput(client, input)
    client
      .prepare(
        `UPDATE bouquet_templates
         SET name = @name, description = @description, price = @price, is_active = @isActive,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`
      )
      .run({
        id: bouquetId,
        name: normalized.name,
        description: normalized.description,
        price: normalized.price,
        isActive: normalized.isActive ? 1 : 0,
      })
    replaceBouquetTemplateItems(client, bouquetId, normalized.items)
  })

  update()
}

export function toggleBouquetTemplateActive(id: number) {
  const client = db()
  const toggle = client.transaction(() => {
    const bouquetId = Math.trunc(id)
    const existing = getBouquetTemplateRecord(client, bouquetId)
    if (!existing) {
      throw new Error("Букет не найден.")
    }

    const nextActive = numberFromRow(existing.is_active) === 1 ? 0 : 1
    client
      .prepare("UPDATE bouquet_templates SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(nextActive, bouquetId)
    return nextActive === 1
  })

  return toggle()
}

export function deleteBouquetTemplate(id: number) {
  const client = db()
  const deactivate = client.transaction(() => {
    const bouquetId = Math.trunc(id)
    const existing = getBouquetTemplateRecord(client, bouquetId)
    if (!existing) {
      throw new Error("Букет не найден.")
    }

    client
      .prepare("UPDATE bouquet_templates SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(bouquetId)
  })

  deactivate()
}

export function listDealBouquetMessages(dealId: number): DealBouquetMessage[] {
  const rows = db()
    .prepare(
      `SELECT id, deal_id as dealId, bouquet_id as bouquetId,
        COALESCE(bouquet_name, '') as bouquetName,
        COALESCE(message_text, '') as messageText,
        COALESCE(image_path, '') as imagePath,
        sent_by_user_id as sentByUserId,
        COALESCE(sent_by_name, '') as sentByName,
        COALESCE(sent_at, '') as sentAt,
        COALESCE(status, '') as status,
        COALESCE(error, '') as error
       FROM deal_bouquet_messages
       WHERE deal_id = ?
       ORDER BY sent_at DESC, id DESC
       LIMIT 30`
    )
    .all(Math.trunc(dealId)) as Array<Record<string, unknown>>

  return rows.map(mapDealBouquetMessage)
}

export function recordDealBouquetMessage(input: {
  dealId: number
  bouquetId: number
  bouquetName: string
  messageText: string
  imagePath?: string | null
  sentByUserId?: number | null
  sentByName?: string | null
  status: DealBouquetMessageStatus
  error?: string | null
}) {
  db()
    .prepare(
      `INSERT INTO deal_bouquet_messages (
        deal_id, bouquet_id, bouquet_name, message_text, image_path, sent_by_user_id, sent_by_name,
        status, error
      ) VALUES (
        @dealId, @bouquetId, @bouquetName, @messageText, @imagePath, @sentByUserId, @sentByName,
        @status, @error
      )`
    )
    .run({
      dealId: Math.trunc(input.dealId),
      bouquetId: Math.trunc(input.bouquetId),
      bouquetName: clean(input.bouquetName),
      messageText: clean(input.messageText),
      imagePath: clean(input.imagePath ?? ""),
      sentByUserId: input.sentByUserId ?? null,
      sentByName: clean(input.sentByName ?? ""),
      status: input.status,
      error: clean(input.error ?? ""),
    })
}

function getBouquetTemplateRecord(client: Database.Database, id: number) {
  return client.prepare("SELECT * FROM bouquet_templates WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined
}

function listBouquetTemplateItems(bouquetId: number, client: Database.Database) {
  const rows = client
    .prepare(
      `SELECT bouquet_template_items.id, bouquet_template_items.bouquet_id as bouquetId,
        bouquet_template_items.product_code as productCode,
        bouquet_template_items.product_name as productName,
        bouquet_template_items.qty, bouquet_template_items.created_at as createdAt,
        COALESCE(products.stock, 0) as stock, COALESCE(products.reserved, 0) as reserved,
        COALESCE(products.image_path, '') as imagePath
       FROM bouquet_template_items
       LEFT JOIN products ON products.code = bouquet_template_items.product_code
       WHERE bouquet_template_items.bouquet_id = ?
       ORDER BY bouquet_template_items.id ASC`
    )
    .all(bouquetId) as Array<Record<string, unknown>>

  return rows.map((row) => {
    const stock = numberFromRow(row.stock)
    const reserved = numberFromRow(row.reserved)
    return {
      id: numberFromRow(row.id),
      bouquetId: numberFromRow(row.bouquetId),
      productCode: String(row.productCode ?? ""),
      productName: String(row.productName ?? ""),
      qty: numberFromRow(row.qty),
      stock,
      reserved,
      available: stock - reserved,
      imagePath: String(row.imagePath ?? ""),
      createdAt: String(row.createdAt ?? ""),
    } satisfies BouquetTemplateItem
  })
}

function normalizeBouquetTemplateInput(client: Database.Database, input: BouquetTemplateInput) {
  const name = clean(input.name)
  if (!name) {
    throw new Error("Укажите название букета.")
  }

  const price = Number(input.price ?? 0)
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Цена букета не может быть отрицательной.")
  }

  if (!input.items.length) {
    throw new Error("Добавьте хотя бы одну позицию в состав букета.")
  }

  const itemsByCode = new Map<string, { productCode: string; productName: string; qty: number }>()
  for (const rawItem of input.items) {
    const productCode = clean(rawItem.productCode)
    const qty = Number(rawItem.qty)
    if (!productCode) {
      throw new Error("У каждой позиции букета должен быть товар склада.")
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("Количество в составе букета должно быть больше нуля.")
    }

    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }

    const existing = itemsByCode.get(productCode)
    itemsByCode.set(productCode, {
      productCode,
      productName: String(product.name ?? productCode),
      qty: (existing?.qty ?? 0) + qty,
    })
  }

  const items = [...itemsByCode.values()]
  if (!items.length) {
    throw new Error("Добавьте хотя бы одну позицию в состав букета.")
  }

  return {
    name,
    description: clean(input.description ?? ""),
    price,
    isActive: input.isActive ?? true,
    items,
  }
}

function replaceBouquetTemplateItems(
  client: Database.Database,
  bouquetId: number,
  items: Array<{ productCode: string; productName: string; qty: number }>
) {
  client.prepare("DELETE FROM bouquet_template_items WHERE bouquet_id = ?").run(bouquetId)
  const insertItem = client.prepare(
    `INSERT INTO bouquet_template_items (bouquet_id, product_code, product_name, qty)
     VALUES (?, ?, ?, ?)`
  )
  for (const item of items) {
    insertItem.run(bouquetId, item.productCode, item.productName, item.qty)
  }
}
