import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { parseDbInstant, parseWallClock, SHOP_TIME_ZONE } from "@/lib/datetime"
import { db } from "../connection"
import { applyProductDelta, getProduct } from "../ledger"
import { mapStockLot } from "../mappers"
import { roundMoney } from "../form-parsers"
import type { CurrentUser, StockLot, StockLotMovementType, StockLotWriteOffReason } from "../types"
import { stockLotWriteOffReasons } from "../types"

// Срок годности партии = дата прихода + стойкость (дней). Возвращает дату YYYY-MM-DD в часовом поясе
// магазина (срок — это «день», не момент). Без стойкости/некорректной даты — null (партия без срока).
function computeExpiryDate(receivedAt: string | null, vaseLifeDays: number | null): string | null {
  if (vaseLifeDays == null || !Number.isFinite(vaseLifeDays) || vaseLifeDays <= 0) {
    return null
  }
  const base = (receivedAt ? parseDbInstant(receivedAt) ?? parseWallClock(receivedAt) : null) ?? new Date()
  const target = new Date(base.getTime() + vaseLifeDays * 86_400_000)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target)
}

// Сегодняшняя дата YYYY-MM-DD в поясе магазина — для сравнения со сроком годности.
function shopToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  const target = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target)
}

function recordLotMovement(
  client: Database.Database,
  input: {
    lotId: number
    productCode: string
    type: StockLotMovementType
    qty: number
    reason?: string | null
    documentId?: number | null
    userId?: number | null
    comment?: string | null
  }
) {
  client
    .prepare(
      `INSERT INTO stock_lot_movements (lot_id, product_code, type, qty, reason, document_id, user_id, comment)
       VALUES (@lotId, @productCode, @type, @qty, @reason, @documentId, @userId, @comment)`
    )
    .run({
      lotId: input.lotId,
      productCode: input.productCode,
      type: input.type,
      qty: input.qty,
      reason: input.reason ?? null,
      documentId: input.documentId ?? null,
      userId: input.userId ?? null,
      comment: input.comment ?? null,
    })
}

// Создаёт партию по строке проведённого приходного акта, ЕСЛИ товар учитывается по партиям
// (product.track_lots). Гейт по глобальному флагу track_lots_enabled — на стороне вызывающего.
// landedUnitCost хранится СПРАВОЧНО (себестоимостью партии не управляют). Идемпотентности на уровне
// строки нет — вызывается ровно один раз при проведении.
export function maybeCreateReceiptLot(
  client: Database.Database,
  input: {
    product: Record<string, unknown>
    qty: number
    landedUnitCost: number | null
    documentId: number
    supplierId: number | null
    supplierName: string
    receivedAt: string | null
    userId: number | null
  }
): number | null {
  if (numberFromRow(input.product.track_lots ?? 0) !== 1) {
    return null
  }
  if (input.qty <= 0) {
    return null
  }
  const productCode = String(input.product.code)
  const vaseLifeDays = input.product.vase_life_days == null ? null : numberFromRow(input.product.vase_life_days)
  const expiryDate = computeExpiryDate(input.receivedAt, vaseLifeDays)

  const inserted = client
    .prepare(
      `INSERT INTO stock_lots (
        product_code, document_id, supplier_id, supplier_name, received_at, expiry_date,
        qty_received, qty_remaining, unit_cost, status
      ) VALUES (
        @productCode, @documentId, @supplierId, @supplierName,
        COALESCE(NULLIF(@receivedAt, ''), CURRENT_TIMESTAMP), @expiryDate,
        @qty, @qty, @unitCost, 'active'
      )`
    )
    .run({
      productCode,
      documentId: input.documentId,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      receivedAt: input.receivedAt ?? "",
      expiryDate,
      qty: input.qty,
      unitCost: input.landedUnitCost,
    })
  const lotId = Number(inserted.lastInsertRowid)
  recordLotMovement(client, {
    lotId,
    productCode,
    type: "receipt",
    qty: input.qty,
    documentId: input.documentId,
    userId: input.userId,
    comment: "Приход",
  })
  return lotId
}

// Откат партий исходного приходного акта при корректировке: помечает все его партии 'reverted'
// (остаток → 0) и пишет revert-движение на остаток. Остаток товара здесь НЕ трогаем — это делает
// денежно-количественный путь корректировки (reverse+reapply). По document_id, без проверки track_lots
// (партии могли создаться, когда товар учитывался). Идемпотентно: уже отменённые/выработанные пропускаем.
export function revertLotsForDocument(
  client: Database.Database,
  documentId: number,
  currentUser: CurrentUser,
  comment?: string
) {
  const lots = client
    .prepare("SELECT * FROM stock_lots WHERE document_id = ? AND status = 'active'")
    .all(documentId) as Array<Record<string, unknown>>
  for (const lot of lots) {
    const lotId = numberFromRow(lot.id)
    const remaining = numberFromRow(lot.qty_remaining)
    client
      .prepare("UPDATE stock_lots SET qty_remaining = 0, status = 'reverted', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(lotId)
    if (remaining > 0) {
      recordLotMovement(client, {
        lotId,
        productCode: String(lot.product_code),
        type: "revert",
        qty: -remaining,
        documentId,
        userId: currentUser.id,
        comment: comment ?? "Откат партии при корректировке прихода",
      })
    }
  }
}

// «Сверка от истины»: products.stock — источник правды по количеству. Если суммарный остаток активных
// партий превышает остаток товара (товар расходовался продажами/заказами, минуя партии) — списываем
// разницу по FEFO (раньше истекает — раньше уходит). Если партий меньше остатка — оставляем как есть
// (часть остатка «без партии», фейковые партии не создаём). applyProductDelta НЕ трогаем.
export function reconcileProductLots(client: Database.Database, productCode: string, currentUser?: CurrentUser) {
  const product = getProduct(client, productCode)
  if (!product) {
    return
  }
  const target = Math.max(0, numberFromRow(product.stock))
  const lots = client
    .prepare(
      `SELECT * FROM stock_lots
       WHERE product_code = ? AND status = 'active' AND qty_remaining > 0
       ORDER BY (expiry_date IS NULL), expiry_date ASC, received_at ASC, id ASC`
    )
    .all(productCode) as Array<Record<string, unknown>>

  const sum = lots.reduce((acc, lot) => acc + numberFromRow(lot.qty_remaining), 0)
  let toConsume = roundMoney(sum - target)
  if (toConsume <= 0) {
    return
  }

  for (const lot of lots) {
    if (toConsume <= 0) {
      break
    }
    const lotId = numberFromRow(lot.id)
    const remaining = numberFromRow(lot.qty_remaining)
    const take = Math.min(remaining, toConsume)
    if (take <= 0) {
      continue
    }
    const newRemaining = roundMoney(remaining - take)
    const newStatus = newRemaining <= 0 ? "depleted" : "active"
    client
      .prepare("UPDATE stock_lots SET qty_remaining = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(newRemaining, newStatus, lotId)
    recordLotMovement(client, {
      lotId,
      productCode,
      type: "reconcile",
      qty: -take,
      userId: currentUser?.id ?? null,
      comment: "FEFO-сверка к остатку товара",
    })
    toConsume = roundMoney(toConsume - take)
  }
}

// Сверяет все товары, у которых есть активные партии. Используется перед показом виджета/списков.
export function reconcileAllLots(currentUser?: CurrentUser) {
  const client = db()
  const run = client.transaction(() => {
    const codes = client
      .prepare("SELECT DISTINCT product_code FROM stock_lots WHERE status = 'active' AND qty_remaining > 0")
      .all() as Array<{ product_code: string }>
    for (const { product_code } of codes) {
      reconcileProductLots(client, product_code, currentUser)
    }
  })
  run()
}

// Списание партии с причиной (порча/уценка/недостача). Уменьшает остаток партии И остаток товара
// (реальная потеря) — оба на qty, поэтому сверка остаётся согласованной. Перед списанием сверяем
// партию к остатку, чтобы списывать от актуального остатка партии.
export function writeOffLot(
  input: {
    lotId: number
    qty: number
    reason: string
    comment?: string
  },
  currentUser: CurrentUser
) {
  const client = db()
  const run = client.transaction(() => {
    const existing = client.prepare("SELECT * FROM stock_lots WHERE id = ?").get(input.lotId) as
      | Record<string, unknown>
      | undefined
    if (!existing) {
      throw new Error("Партия не найдена.")
    }
    const productCode = String(existing.product_code)
    // Сверяем к актуальному остатку перед списанием (продажи могли выработать партию).
    reconcileProductLots(client, productCode, currentUser)

    const lot = client.prepare("SELECT * FROM stock_lots WHERE id = ?").get(input.lotId) as Record<string, unknown>
    if (String(lot.status) !== "active") {
      throw new Error("Списывать можно только активную партию (с остатком).")
    }
    const remaining = numberFromRow(lot.qty_remaining)
    const qty = Math.floor(input.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("Количество списания должно быть положительным целым числом.")
    }
    if (qty > remaining) {
      throw new Error(`Нельзя списать больше остатка партии (${remaining}).`)
    }
    const reason = stockLotWriteOffReasons.has(input.reason as StockLotWriteOffReason) ? input.reason : "other"

    const newRemaining = roundMoney(remaining - qty)
    const newStatus = newRemaining <= 0 ? "written_off" : "active"
    client
      .prepare("UPDATE stock_lots SET qty_remaining = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(newRemaining, newStatus, input.lotId)
    recordLotMovement(client, {
      lotId: input.lotId,
      productCode,
      type: "write_off",
      qty: -qty,
      reason,
      userId: currentUser.id,
      comment: input.comment ?? null,
    })

    // Реальная потеря остатка товара.
    applyProductDelta(client, {
      productCode,
      stockDelta: -qty,
      type: "adjustment",
      qty: -qty,
      userId: currentUser.id,
      comment: `Списание партии #${input.lotId}: ${reason}${input.comment ? ` — ${input.comment}` : ""}`,
    })
  })

  run()
}

// Настройки учёта по партиям у товара: включить/выключить track_lots и стойкость (дней).
export function setProductLotSettings(
  productCode: string,
  input: { trackLots: boolean; vaseLifeDays: number | null }
) {
  const client = db()
  const product = client.prepare("SELECT code FROM products WHERE code = ?").get(productCode)
  if (!product) {
    throw new Error("Товар не найден.")
  }
  const vaseLifeDays =
    input.vaseLifeDays != null && Number.isFinite(input.vaseLifeDays) && input.vaseLifeDays > 0
      ? Math.floor(input.vaseLifeDays)
      : null
  client
    .prepare("UPDATE products SET track_lots = ?, vase_life_days = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?")
    .run(input.trackLots ? 1 : 0, vaseLifeDays, productCode)
}

const LOT_SELECT = `SELECT
    stock_lots.*,
    products.name AS product_name,
    stock_documents.number AS document_number
  FROM stock_lots
  LEFT JOIN products ON products.code = stock_lots.product_code
  LEFT JOIN stock_documents ON stock_documents.id = stock_lots.document_id`

// Партии товара (для карточки): сверяем, затем отдаём активные (FEFO) + историю (выработанные/списанные).
export function listProductLots(productCode: string): StockLot[] {
  const client = db()
  client.transaction(() => reconcileProductLots(client, productCode))()
  const rows = client
    .prepare(
      `${LOT_SELECT}
       WHERE stock_lots.product_code = ?
       ORDER BY
         CASE stock_lots.status WHEN 'active' THEN 0 ELSE 1 END,
         (stock_lots.expiry_date IS NULL), stock_lots.expiry_date ASC,
         stock_lots.received_at ASC, stock_lots.id ASC`
    )
    .all(productCode) as Array<Record<string, unknown>>
  return rows.map(mapStockLot)
}

// Все активные партии (с остатком), FEFO-порядок. Перед выборкой — сверка всех партий к остаткам.
export function listActiveLots(): StockLot[] {
  reconcileAllLots()
  const client = db()
  const rows = client
    .prepare(
      `${LOT_SELECT}
       WHERE stock_lots.status = 'active' AND stock_lots.qty_remaining > 0
       ORDER BY (stock_lots.expiry_date IS NULL), stock_lots.expiry_date ASC,
         stock_lots.received_at ASC, stock_lots.id ASC`
    )
    .all() as Array<Record<string, unknown>>
  return rows.map(mapStockLot)
}

export type ExpiringLot = StockLot & { daysLeft: number | null; bucket: "expired" | "soon" | "ok" }

// Виджет свежести: активные партии с остатком и сроком годности, истекающие в пределах withinDays
// (или уже просроченные). Перед выборкой — сверка всех партий к остаткам.
export function listExpiringLots(options?: { withinDays?: number }): ExpiringLot[] {
  const withinDays = options?.withinDays ?? 7
  reconcileAllLots()
  const client = db()
  const today = shopToday()
  const threshold = addDaysISO(today, withinDays)
  const rows = client
    .prepare(
      `${LOT_SELECT}
       WHERE stock_lots.status = 'active'
         AND stock_lots.qty_remaining > 0
         AND stock_lots.expiry_date IS NOT NULL
         AND stock_lots.expiry_date <= ?
       ORDER BY stock_lots.expiry_date ASC, stock_lots.id ASC`
    )
    .all(threshold) as Array<Record<string, unknown>>

  return rows.map((row) => {
    const lot = mapStockLot(row)
    const daysLeft = lot.expiryDate ? daysBetween(today, lot.expiryDate) : null
    const bucket: ExpiringLot["bucket"] =
      daysLeft == null ? "ok" : daysLeft < 0 ? "expired" : "soon"
    return { ...lot, daysLeft, bucket }
  })
}

function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number)
  const [ty, tm, td] = toISO.split("-").map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}
