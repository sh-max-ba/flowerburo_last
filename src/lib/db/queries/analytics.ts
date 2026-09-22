import { numberFromRow } from "@/lib/db-row"
import { SHOP_UTC_OFFSET_SQL } from "@/lib/datetime"
import { db } from "../connection"
import { getSalesReport, type SalesReport } from "./sales-report"
import { getOpenShift } from "./shifts"
import type { SupplierDebtDocument } from "./supplier-payments"

// BI-аналитика склада и продаж (/analytics). Только чтение, все агрегаты — SQL с границами
// суток в поясе магазина (Бишкек, UTC+6): метки в БД лежат в UTC.
//
// Что считается чем (единые определения для всех вкладок):
//  • Выручка — фактические суммы чеков кассы (sales.total, сторно исключено) и выданных заказов
//    (orders.total − доставка, статусы «Выдан»/«Передан курьеру», по дате выдачи) — как в отчёте
//    «История склада → Продажи».
//  • Себестоимость продаж — количество × ТЕКУЩАЯ себестоимость карточки товара (история цен
//    не хранится), наценка = выручка − себестоимость.
//  • Закупки — ПРОВЕДЁННЫЕ приходные акты (stock_in, status = posted) по дате операции; акты со
//    статусом corrected заменены корректировкой и не считаются дважды. Сумма товаров = goods_total,
//    итого с накладными = landed_total.
//  • Списания — проведённые расходные акты (stock_out, posted) по дате операции; сумма = количество ×
//    закупочная цена строки акта (при её отсутствии — текущая себестоимость товара).

const TZ = SHOP_UTC_OFFSET_SQL
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type DbClient = ReturnType<typeof db>

export type AnalyticsPreset = "today" | "yesterday" | "7d" | "30d" | "month" | "prev_month" | "90d" | "custom"

export type AnalyticsRange = {
  from: string
  to: string
  preset: AnalyticsPreset
  // Число дней в периоде (включительно) и предыдущий период той же длины — для дельт.
  days: number
  prevFrom: string
  prevTo: string
  today: string
}

export type AnalyticsRangeInput = { preset?: string; from?: string; to?: string }

const PRESETS = new Set<AnalyticsPreset>(["today", "yesterday", "7d", "30d", "month", "prev_month", "90d"])

// Разбирает пресет или произвольный диапазон из URL в конкретные даты в поясе магазина.
// Будущее отрезается (данных там нет), перепутанные границы меняются местами.
export function resolveAnalyticsRange(opts?: AnalyticsRangeInput, client: DbClient = db()): AnalyticsRange {
  const dates = client
    .prepare(
      `SELECT DATE('now', '${TZ}') as today,
        DATE('now', '${TZ}', '-1 day') as yesterday,
        DATE('now', '${TZ}', '-6 days') as d7,
        DATE('now', '${TZ}', '-29 days') as d30,
        DATE('now', '${TZ}', '-89 days') as d90,
        DATE('now', '${TZ}', 'start of month') as monthStart,
        DATE('now', '${TZ}', 'start of month', '-1 month') as prevMonthStart,
        DATE('now', '${TZ}', 'start of month', '-1 day') as prevMonthEnd`
    )
    .get() as {
    today: string
    yesterday: string
    d7: string
    d30: string
    d90: string
    monthStart: string
    prevMonthStart: string
    prevMonthEnd: string
  }

  let from = dates.d30
  let to = dates.today
  let preset: AnalyticsPreset = "30d"

  if (opts?.from && opts?.to && ISO_DATE.test(opts.from) && ISO_DATE.test(opts.to)) {
    preset = "custom"
    from = opts.from
    to = opts.to
    if (from > to) {
      ;[from, to] = [to, from]
    }
    if (to > dates.today) {
      to = dates.today
    }
    if (from > to) {
      from = to
    }
  } else if (opts?.preset && PRESETS.has(opts.preset as AnalyticsPreset)) {
    preset = opts.preset as AnalyticsPreset
    switch (preset) {
      case "today":
        from = dates.today
        break
      case "yesterday":
        from = dates.yesterday
        to = dates.yesterday
        break
      case "7d":
        from = dates.d7
        break
      case "30d":
        from = dates.d30
        break
      case "90d":
        from = dates.d90
        break
      case "month":
        from = dates.monthStart
        break
      case "prev_month":
        from = dates.prevMonthStart
        to = dates.prevMonthEnd
        break
    }
  }

  const span = client
    .prepare(
      `SELECT CAST(julianday(?) - julianday(?) AS INTEGER) + 1 as days,
        DATE(?, '-' || (CAST(julianday(?) - julianday(?) AS INTEGER) + 1) || ' days') as prevFrom,
        DATE(?, '-1 day') as prevTo`
    )
    .get(to, from, from, to, from, from) as { days: number; prevFrom: string; prevTo: string }

  return {
    from,
    to,
    preset,
    days: Math.max(1, numberFromRow(span.days)),
    prevFrom: String(span.prevFrom),
    prevTo: String(span.prevTo),
    today: dates.today,
  }
}

// ── Ряд по дням ────────────────────────────────────────────────────────────

export type AnalyticsDayPoint = {
  day: string
  revenue: number
  cost: number
  soldQty: number
  salesCount: number
  ordersCount: number
  purchases: number
  purchasesLanded: number
  purchaseDocs: number
  writeOffs: number
  writeOffQty: number
}

// Зерофилл по дням через рекурсивный CTE: каждому дню — выручка/себестоимость продаж, закупки и
// списания. Один запрос на период; вызывается для текущего и предыдущего периода.
function getDailySeries(client: DbClient, from: string, to: string): AnalyticsDayPoint[] {
  const rows = client
    .prepare(
      `WITH RECURSIVE days(d) AS (
        SELECT ?
        UNION ALL
        SELECT DATE(d, '+1 day') FROM days WHERE d < ?
       ),
       sale_days AS (
        SELECT DATE(created_at, '${TZ}') as d, SUM(total) as revenue, COUNT(*) as cnt
        FROM sales WHERE reversed_at IS NULL AND DATE(created_at, '${TZ}') BETWEEN ? AND ?
        GROUP BY d
       ),
       sale_item_days AS (
        SELECT DATE(sales.created_at, '${TZ}') as d,
          SUM(items.qty * COALESCE(products.cost_price, 0)) as cost, SUM(items.qty) as qty
        FROM sale_items items
        JOIN sales ON sales.id = items.sale_id
        LEFT JOIN products ON products.code = items.product_code
        WHERE sales.reversed_at IS NULL AND DATE(sales.created_at, '${TZ}') BETWEEN ? AND ?
        GROUP BY d
       ),
       order_days AS (
        SELECT DATE(completed_at, '${TZ}') as d,
          SUM(total - COALESCE(delivery_price, 0)) as revenue, COUNT(*) as cnt
        FROM orders
        WHERE completed_at IS NOT NULL AND status IN ('Выдан', 'Передан курьеру')
         AND DATE(completed_at, '${TZ}') BETWEEN ? AND ?
        GROUP BY d
       ),
       order_item_days AS (
        SELECT DATE(orders.completed_at, '${TZ}') as d,
          SUM(items.qty * COALESCE(products.cost_price, 0)) as cost, SUM(items.qty) as qty
        FROM order_items items
        JOIN orders ON orders.id = items.order_id
        LEFT JOIN products ON products.code = items.product_code
        WHERE orders.completed_at IS NOT NULL AND orders.status IN ('Выдан', 'Передан курьеру')
         AND DATE(orders.completed_at, '${TZ}') BETWEEN ? AND ?
        GROUP BY d
       ),
       purchase_days AS (
        SELECT DATE(COALESCE(operation_at, created_at), '${TZ}') as d,
          SUM(goods_total) as goods, SUM(COALESCE(NULLIF(landed_total, 0), goods_total)) as landed, COUNT(*) as cnt
        FROM stock_documents
        WHERE type = 'stock_in' AND status = 'posted'
         AND DATE(COALESCE(operation_at, created_at), '${TZ}') BETWEEN ? AND ?
        GROUP BY d
       ),
       writeoff_days AS (
        SELECT DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') as d,
          SUM(i.qty * COALESCE(NULLIF(i.unit_cost, 0), products.cost_price, 0)) as cost, SUM(i.qty) as qty
        FROM stock_document_items i
        JOIN stock_documents d ON d.id = i.document_id
        LEFT JOIN products ON products.code = i.product_code
        WHERE d.type = 'stock_out' AND d.status = 'posted'
         AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN ? AND ?
        GROUP BY d
       )
       SELECT days.d as day,
        COALESCE(sale_days.revenue, 0) + COALESCE(order_days.revenue, 0) as revenue,
        COALESCE(sale_item_days.cost, 0) + COALESCE(order_item_days.cost, 0) as cost,
        COALESCE(sale_item_days.qty, 0) + COALESCE(order_item_days.qty, 0) as soldQty,
        COALESCE(sale_days.cnt, 0) as salesCount,
        COALESCE(order_days.cnt, 0) as ordersCount,
        COALESCE(purchase_days.goods, 0) as purchases,
        COALESCE(purchase_days.landed, 0) as purchasesLanded,
        COALESCE(purchase_days.cnt, 0) as purchaseDocs,
        COALESCE(writeoff_days.cost, 0) as writeOffs,
        COALESCE(writeoff_days.qty, 0) as writeOffQty
       FROM days
       LEFT JOIN sale_days ON sale_days.d = days.d
       LEFT JOIN sale_item_days ON sale_item_days.d = days.d
       LEFT JOIN order_days ON order_days.d = days.d
       LEFT JOIN order_item_days ON order_item_days.d = days.d
       LEFT JOIN purchase_days ON purchase_days.d = days.d
       LEFT JOIN writeoff_days ON writeoff_days.d = days.d
       ORDER BY days.d`
    )
    .all(from, to, from, to, from, to, from, to, from, to, from, to, from, to) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    day: String(row.day),
    revenue: round2(numberFromRow(row.revenue)),
    cost: round2(numberFromRow(row.cost)),
    soldQty: round2(numberFromRow(row.soldQty)),
    salesCount: numberFromRow(row.salesCount),
    ordersCount: numberFromRow(row.ordersCount),
    purchases: round2(numberFromRow(row.purchases)),
    purchasesLanded: round2(numberFromRow(row.purchasesLanded)),
    purchaseDocs: numberFromRow(row.purchaseDocs),
    writeOffs: round2(numberFromRow(row.writeOffs)),
    writeOffQty: round2(numberFromRow(row.writeOffQty)),
  }))
}

export type AnalyticsPeriodTotals = {
  revenue: number
  cost: number
  margin: number
  soldQty: number
  salesCount: number
  ordersCount: number
  purchases: number
  purchasesLanded: number
  purchaseDocs: number
  writeOffs: number
  writeOffQty: number
}

function sumSeries(series: AnalyticsDayPoint[]): AnalyticsPeriodTotals {
  const totals = {
    revenue: 0,
    cost: 0,
    soldQty: 0,
    salesCount: 0,
    ordersCount: 0,
    purchases: 0,
    purchasesLanded: 0,
    purchaseDocs: 0,
    writeOffs: 0,
    writeOffQty: 0,
  }
  for (const point of series) {
    totals.revenue += point.revenue
    totals.cost += point.cost
    totals.soldQty += point.soldQty
    totals.salesCount += point.salesCount
    totals.ordersCount += point.ordersCount
    totals.purchases += point.purchases
    totals.purchasesLanded += point.purchasesLanded
    totals.purchaseDocs += point.purchaseDocs
    totals.writeOffs += point.writeOffs
    totals.writeOffQty += point.writeOffQty
  }
  return {
    revenue: round2(totals.revenue),
    cost: round2(totals.cost),
    margin: round2(totals.revenue - totals.cost),
    soldQty: round2(totals.soldQty),
    salesCount: totals.salesCount,
    ordersCount: totals.ordersCount,
    purchases: round2(totals.purchases),
    purchasesLanded: round2(totals.purchasesLanded),
    purchaseDocs: totals.purchaseDocs,
    writeOffs: round2(totals.writeOffs),
    writeOffQty: round2(totals.writeOffQty),
  }
}

// ── Обзор ──────────────────────────────────────────────────────────────────

export type AnalyticsShare = { key: string; label: string; value: number; count: number }

export type AnalyticsStockSnapshot = {
  positions: number
  stockQty: number
  costValue: number
  saleValue: number
  lowCount: number
  negativeCount: number
  // Короткий список проблемных позиций (в минусе — первыми) для панели «Склад сейчас».
  attention: Array<{ code: string; name: string; available: number }>
}

export type AnalyticsOverview = {
  range: AnalyticsRange
  totals: AnalyticsPeriodTotals
  previous: AnalyticsPeriodTotals
  series: AnalyticsDayPoint[]
  topProducts: Array<{ productCode: string; productName: string; category: string; qty: number; revenue: number; margin: number }>
  byCategory: AnalyticsShare[]
  bySupplier: AnalyticsShare[]
  byWriteOffReason: AnalyticsShare[]
  stock: AnalyticsStockSnapshot
}

export function getAnalyticsOverview(opts?: AnalyticsRangeInput): AnalyticsOverview {
  const client = db()
  const range = resolveAnalyticsRange(opts, client)
  const series = getDailySeries(client, range.from, range.to)
  const previous = sumSeries(getDailySeries(client, range.prevFrom, range.prevTo))
  const totals = sumSeries(series)

  const sales = getSalesReport({ dateFrom: range.from, dateTo: range.to })
  const topProducts = sales.byProduct.slice(0, 8).map((row) => ({
    productCode: row.productCode,
    productName: row.productName,
    category: row.category,
    qty: row.qty,
    revenue: row.revenue,
    margin: row.margin,
  }))
  const byCategory = sales.byCategory.map((row) => ({
    key: row.category,
    label: row.category,
    value: row.revenue,
    count: row.qty,
  }))

  return {
    range,
    totals,
    previous,
    series,
    topProducts,
    byCategory,
    bySupplier: foldTail(
      getSupplierShares(client, range).map((row) => ({
        key: row.supplierId === null ? "none" : String(row.supplierId),
        label: row.supplierName,
        value: row.goodsTotal,
        count: row.docsCount,
      })),
      6
    ),
    byWriteOffReason: foldTail(getWriteOffReasons(client, range), 6),
    stock: getStockSnapshot(client),
  }
}

// Хвост списка долей сворачивается в «Прочие»: больше 6–8 категорий на одной диаграмме не читаются.
function foldTail(rows: AnalyticsShare[], keep: number): AnalyticsShare[] {
  if (rows.length <= keep + 1) {
    return rows
  }
  const head = rows.slice(0, keep)
  const tail = rows.slice(keep)
  head.push({
    key: "__other__",
    label: `Прочие · ${tail.length}`,
    value: round2(tail.reduce((sum, row) => sum + row.value, 0)),
    count: tail.reduce((sum, row) => sum + row.count, 0),
  })
  return head
}

function getStockSnapshot(client: DbClient): AnalyticsStockSnapshot {
  const row = client
    .prepare(
      `SELECT COUNT(*) as positions,
        COALESCE(SUM(stock), 0) as stockQty,
        COALESCE(SUM(CASE WHEN stock > 0 THEN stock * cost_price ELSE 0 END), 0) as costValue,
        COALESCE(SUM(CASE WHEN stock > 0 THEN stock * sale_price ELSE 0 END), 0) as saleValue,
        COALESCE(SUM(CASE WHEN (stock - reserved) > 0 AND (stock - reserved) <= 3 THEN 1 ELSE 0 END), 0) as lowCount,
        COALESCE(SUM(CASE WHEN (stock - reserved) < 0 THEN 1 ELSE 0 END), 0) as negativeCount
       FROM products WHERE COALESCE(is_active, 1) = 1`
    )
    .get() as Record<string, unknown>
  const attention = client
    .prepare(
      `SELECT code, name, (stock - reserved) as available
       FROM products
       WHERE COALESCE(is_active, 1) = 1
        AND ((stock - reserved) < 0 OR ((stock - reserved) > 0 AND (stock - reserved) <= 3))
       ORDER BY CASE WHEN (stock - reserved) < 0 THEN 0 ELSE 1 END, (stock - reserved) ASC, name COLLATE NOCASE
       LIMIT 6`
    )
    .all() as Array<{ code: string; name: string; available: number }>
  return {
    positions: numberFromRow(row.positions),
    stockQty: round2(numberFromRow(row.stockQty)),
    costValue: round2(numberFromRow(row.costValue)),
    saleValue: round2(numberFromRow(row.saleValue)),
    lowCount: numberFromRow(row.lowCount),
    negativeCount: numberFromRow(row.negativeCount),
    attention: attention.map((item) => ({
      code: String(item.code),
      name: String(item.name ?? ""),
      available: round2(numberFromRow(item.available)),
    })),
  }
}

// ── Продажи ────────────────────────────────────────────────────────────────

export type AnalyticsSales = {
  range: AnalyticsRange
  totals: AnalyticsPeriodTotals
  previous: AnalyticsPeriodTotals
  series: AnalyticsDayPoint[]
  // Отчёт без строк (lines = []): построчный список — на вкладке «Операции».
  report: SalesReport
}

export function getAnalyticsSales(opts?: AnalyticsRangeInput): AnalyticsSales {
  const client = db()
  const range = resolveAnalyticsRange(opts, client)
  const series = getDailySeries(client, range.from, range.to)
  const report = getSalesReport({ dateFrom: range.from, dateTo: range.to })
  return {
    range,
    totals: sumSeries(series),
    previous: sumSeries(getDailySeries(client, range.prevFrom, range.prevTo)),
    series,
    report: { ...report, lines: [] },
  }
}

// ── Поставщики ─────────────────────────────────────────────────────────────

export type SupplierAnalyticsRow = {
  supplierId: number | null
  supplierName: string
  docsCount: number
  positionsCount: number
  qty: number
  goodsTotal: number
  overheadTotal: number
  landedTotal: number
  paidAmount: number
  // Долг по проведённым приходам ПЕРИОДА (товары − оплачено).
  debt: number
  // Долг по всем проведённым приходам на сегодня — текущее состояние, не зависит от периода.
  debtNow: number
  lastReceiptAt: string | null
  // Списания товаров этого поставщика за период — ОЦЕНКА: списание товара делится между поставщиками
  // пропорционально их поставкам этого товара за период (партии не ведутся).
  writeOffQty: number
  writeOffCost: number
}

export type SupplierPositionRow = {
  supplierId: number | null
  supplierName: string
  productCode: string
  productName: string
  categoryPath: string
  docsCount: number
  qty: number
  goodsSum: number
  landedSum: number
  minCost: number
  maxCost: number
  lastCost: number
  lastAt: string | null
  // Доля списаний товара, отнесённая на этого поставщика (см. SupplierAnalyticsRow).
  writeOffQty: number
  writeOffCost: number
}

export type AnalyticsSuppliers = {
  range: AnalyticsRange
  totals: {
    docsCount: number
    suppliersCount: number
    positionsCount: number
    goodsTotal: number
    overheadTotal: number
    landedTotal: number
    paidAmount: number
    debt: number
    debtNow: number
    writeOffQty: number
    writeOffCost: number
    // Списания товаров, у которых в периоде не было приходов — поставщика не определить.
    writeOffUnattributedCost: number
  }
  previousGoodsTotal: number
  series: AnalyticsDayPoint[]
  suppliers: SupplierAnalyticsRow[]
  positions: SupplierPositionRow[]
  // Акты с долгом по каждому поставщику (на сегодня) — для диалога погашения прямо из таблицы.
  debtDocuments: Array<SupplierDebtDocument & { supplierId: number }>
  hasOpenShift: boolean
}

const PURCHASE_DATE_SQL = `DATE(COALESCE(stock_documents.operation_at, stock_documents.created_at), '${TZ}')`

function getSupplierShares(client: DbClient, range: AnalyticsRange): SupplierAnalyticsRow[] {
  const rows = client
    .prepare(
      `SELECT
        stock_documents.supplier_id as supplierId,
        COALESCE(NULLIF(TRIM(stock_documents.supplier_name), ''), suppliers.name, 'Без поставщика') as supplierName,
        COUNT(DISTINCT stock_documents.id) as docsCount,
        COUNT(DISTINCT items.product_code) as positionsCount,
        COALESCE(SUM(items.qty), 0) as qty,
        (SELECT COALESCE(SUM(d.goods_total), 0) FROM stock_documents d
          WHERE d.type = 'stock_in' AND d.status = 'posted' AND d.supplier_id IS stock_documents.supplier_id
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as goodsTotal,
        (SELECT COALESCE(SUM(d.overhead_total), 0) FROM stock_documents d
          WHERE d.type = 'stock_in' AND d.status = 'posted' AND d.supplier_id IS stock_documents.supplier_id
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as overheadTotal,
        (SELECT COALESCE(SUM(COALESCE(NULLIF(d.landed_total, 0), d.goods_total)), 0) FROM stock_documents d
          WHERE d.type = 'stock_in' AND d.status = 'posted' AND d.supplier_id IS stock_documents.supplier_id
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as landedTotal,
        (SELECT COALESCE(SUM(d.paid_amount), 0) FROM stock_documents d
          WHERE d.type = 'stock_in' AND d.status = 'posted' AND d.supplier_id IS stock_documents.supplier_id
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as paidAmount,
        (SELECT COALESCE(SUM(MAX(0, d.goods_total - d.paid_amount)), 0) FROM stock_documents d
          WHERE d.type = 'stock_in' AND d.status = 'posted' AND d.supplier_id IS stock_documents.supplier_id
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as debt,
        (SELECT COALESCE(SUM(MAX(0, d.goods_total - d.paid_amount)), 0) FROM stock_documents d
          WHERE d.type = 'stock_in' AND d.status = 'posted' AND d.supplier_id IS stock_documents.supplier_id) as debtNow,
        MAX(COALESCE(stock_documents.operation_at, stock_documents.created_at)) as lastReceiptAt
       FROM stock_documents
       LEFT JOIN suppliers ON suppliers.id = stock_documents.supplier_id
       LEFT JOIN stock_document_items items ON items.document_id = stock_documents.id
       WHERE stock_documents.type = 'stock_in' AND stock_documents.status = 'posted'
        AND ${PURCHASE_DATE_SQL} BETWEEN @from AND @to
       GROUP BY stock_documents.supplier_id
       ORDER BY goodsTotal DESC, supplierName COLLATE NOCASE`
    )
    .all({ from: range.from, to: range.to }) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    supplierId: row.supplierId === null || row.supplierId === undefined ? null : numberFromRow(row.supplierId),
    supplierName: String(row.supplierName ?? "Без поставщика"),
    docsCount: numberFromRow(row.docsCount),
    positionsCount: numberFromRow(row.positionsCount),
    qty: round2(numberFromRow(row.qty)),
    goodsTotal: round2(numberFromRow(row.goodsTotal)),
    overheadTotal: round2(numberFromRow(row.overheadTotal)),
    landedTotal: round2(numberFromRow(row.landedTotal)),
    paidAmount: round2(numberFromRow(row.paidAmount)),
    debt: round2(numberFromRow(row.debt)),
    debtNow: round2(numberFromRow(row.debtNow)),
    lastReceiptAt: row.lastReceiptAt ? String(row.lastReceiptAt) : null,
    writeOffQty: 0,
    writeOffCost: 0,
  }))
}

// Позиции по поставщикам: каждая пара «поставщик × товар» за период — сколько раз, сколько штук,
// на какую сумму, разброс закупочной цены и последняя цена. Группировка в обе стороны (по
// поставщику или по товару) делается на клиенте из одной выборки.
function getSupplierPositions(client: DbClient, range: AnalyticsRange): SupplierPositionRow[] {
  const rows = client
    .prepare(
      `SELECT
        stock_documents.supplier_id as supplierId,
        COALESCE(NULLIF(TRIM(stock_documents.supplier_name), ''), suppliers.name, 'Без поставщика') as supplierName,
        items.product_code as productCode,
        COALESCE(products.name, NULLIF(items.product_name, ''), items.product_code) as productName,
        COALESCE(products.category_path, '') as categoryPath,
        COUNT(DISTINCT stock_documents.id) as docsCount,
        COALESCE(SUM(items.qty), 0) as qty,
        COALESCE(SUM(items.qty * items.unit_cost), 0) as goodsSum,
        COALESCE(SUM(items.qty * COALESCE(items.landed_unit_cost, items.unit_cost)), 0) as landedSum,
        MIN(items.unit_cost) as minCost,
        MAX(items.unit_cost) as maxCost,
        (SELECT i2.unit_cost FROM stock_document_items i2
          JOIN stock_documents d2 ON d2.id = i2.document_id
          WHERE i2.product_code = items.product_code AND d2.type = 'stock_in' AND d2.status = 'posted'
           AND d2.supplier_id IS stock_documents.supplier_id
           AND DATE(COALESCE(d2.operation_at, d2.created_at), '${TZ}') BETWEEN @from AND @to
          ORDER BY COALESCE(d2.operation_at, d2.created_at) DESC, i2.id DESC LIMIT 1) as lastCost,
        MAX(COALESCE(stock_documents.operation_at, stock_documents.created_at)) as lastAt
       FROM stock_document_items items
       JOIN stock_documents ON stock_documents.id = items.document_id
       LEFT JOIN suppliers ON suppliers.id = stock_documents.supplier_id
       LEFT JOIN products ON products.code = items.product_code
       WHERE stock_documents.type = 'stock_in' AND stock_documents.status = 'posted'
        AND ${PURCHASE_DATE_SQL} BETWEEN @from AND @to
       GROUP BY stock_documents.supplier_id, items.product_code
       ORDER BY goodsSum DESC, productName COLLATE NOCASE`
    )
    .all({ from: range.from, to: range.to }) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    supplierId: row.supplierId === null || row.supplierId === undefined ? null : numberFromRow(row.supplierId),
    supplierName: String(row.supplierName ?? "Без поставщика"),
    productCode: String(row.productCode ?? ""),
    productName: String(row.productName ?? "—"),
    categoryPath: String(row.categoryPath ?? ""),
    docsCount: numberFromRow(row.docsCount),
    qty: round2(numberFromRow(row.qty)),
    goodsSum: round2(numberFromRow(row.goodsSum)),
    landedSum: round2(numberFromRow(row.landedSum)),
    minCost: round2(numberFromRow(row.minCost)),
    maxCost: round2(numberFromRow(row.maxCost)),
    lastCost: round2(numberFromRow(row.lastCost)),
    lastAt: row.lastAt ? String(row.lastAt) : null,
    writeOffQty: 0,
    writeOffCost: 0,
  }))
}

// Списания за период по товарам (кол-во и сумма по закупочной цене строк) — для атрибуции
// списаний поставщикам.
function getWriteOffsByProduct(client: DbClient, range: AnalyticsRange): Map<string, { qty: number; cost: number }> {
  const rows = client
    .prepare(
      `SELECT i.product_code as productCode, COALESCE(SUM(i.qty), 0) as qty,
        COALESCE(SUM(${WRITEOFF_COST_SQL}), 0) as cost
       FROM stock_document_items i
       JOIN stock_documents d ON d.id = i.document_id
       LEFT JOIN products ON products.code = i.product_code
       WHERE d.type = 'stock_out' AND d.status = 'posted' AND ${WRITEOFF_DATE_SQL} BETWEEN @from AND @to
       GROUP BY i.product_code`
    )
    .all({ from: range.from, to: range.to }) as Array<Record<string, unknown>>
  const map = new Map<string, { qty: number; cost: number }>()
  for (const row of rows) {
    map.set(String(row.productCode ?? ""), { qty: numberFromRow(row.qty), cost: numberFromRow(row.cost) })
  }
  return map
}

// Раскладывает списания товара по поставщикам пропорционально их поставкам за период (оценка —
// партии не ведутся). Возвращает сумму списаний, которые не удалось отнести (приходов в периоде не было).
function attributeWriteOffs(
  positions: SupplierPositionRow[],
  suppliers: SupplierAnalyticsRow[],
  writeOffs: Map<string, { qty: number; cost: number }>
): number {
  const receivedByProduct = new Map<string, number>()
  for (const row of positions) {
    receivedByProduct.set(row.productCode, (receivedByProduct.get(row.productCode) ?? 0) + row.qty)
  }
  const bySupplier = new Map<string, { qty: number; cost: number }>()
  for (const row of positions) {
    const writeOff = writeOffs.get(row.productCode)
    const received = receivedByProduct.get(row.productCode) ?? 0
    if (!writeOff || received <= 0) continue
    const share = row.qty / received
    row.writeOffQty = round2(writeOff.qty * share)
    row.writeOffCost = round2(writeOff.cost * share)
    const key = row.supplierId === null ? "none" : String(row.supplierId)
    const acc = bySupplier.get(key) ?? { qty: 0, cost: 0 }
    acc.qty += row.writeOffQty
    acc.cost += row.writeOffCost
    bySupplier.set(key, acc)
  }
  for (const supplier of suppliers) {
    const acc = bySupplier.get(supplier.supplierId === null ? "none" : String(supplier.supplierId))
    supplier.writeOffQty = round2(acc?.qty ?? 0)
    supplier.writeOffCost = round2(acc?.cost ?? 0)
  }
  let unattributed = 0
  for (const [productCode, writeOff] of writeOffs) {
    if ((receivedByProduct.get(productCode) ?? 0) <= 0) unattributed += writeOff.cost
  }
  return round2(unattributed)
}

export function getAnalyticsSuppliers(opts?: AnalyticsRangeInput): AnalyticsSuppliers {
  const client = db()
  const range = resolveAnalyticsRange(opts, client)
  const suppliers = getSupplierShares(client, range)
  const positions = getSupplierPositions(client, range)
  const series = getDailySeries(client, range.from, range.to)
  const previous = sumSeries(getDailySeries(client, range.prevFrom, range.prevTo))
  const writeOffUnattributedCost = attributeWriteOffs(positions, suppliers, getWriteOffsByProduct(client, range))

  // Акты с долгом на сегодня — по всем поставщикам с долгом (не только с приходами в периоде).
  const debtDocuments = (
    client
      .prepare(
        `SELECT id, supplier_id as supplierId, number, COALESCE(operation_at, created_at) as operationAt,
          goods_total as goodsTotal, paid_amount as paidAmount
         FROM stock_documents
         WHERE type = 'stock_in' AND status = 'posted' AND supplier_id IS NOT NULL AND goods_total - paid_amount > 0.005
         ORDER BY COALESCE(operation_at, created_at) ASC, id ASC`
      )
      .all() as Array<Record<string, unknown>>
  ).map((row) => {
    const goodsTotal = round2(numberFromRow(row.goodsTotal))
    const paidAmount = round2(numberFromRow(row.paidAmount))
    return {
      id: numberFromRow(row.id),
      supplierId: numberFromRow(row.supplierId),
      number: String(row.number ?? ""),
      operationAt: String(row.operationAt ?? ""),
      goodsTotal,
      paidAmount,
      debt: round2(Math.max(0, goodsTotal - paidAmount)),
    }
  })

  const totals = suppliers.reduce(
    (acc, row) => {
      acc.docsCount += row.docsCount
      acc.goodsTotal += row.goodsTotal
      acc.overheadTotal += row.overheadTotal
      acc.landedTotal += row.landedTotal
      acc.paidAmount += row.paidAmount
      acc.debt += row.debt
      return acc
    },
    { docsCount: 0, goodsTotal: 0, overheadTotal: 0, landedTotal: 0, paidAmount: 0, debt: 0 }
  )
  const debtNow = client
    .prepare(
      `SELECT COALESCE(SUM(MAX(0, goods_total - paid_amount)), 0) as debt
       FROM stock_documents WHERE type = 'stock_in' AND status = 'posted'`
    )
    .get() as { debt: number }

  return {
    range,
    totals: {
      docsCount: totals.docsCount,
      suppliersCount: suppliers.filter((row) => row.supplierId !== null).length,
      positionsCount: new Set(positions.map((row) => row.productCode)).size,
      goodsTotal: round2(totals.goodsTotal),
      overheadTotal: round2(totals.overheadTotal),
      landedTotal: round2(totals.landedTotal),
      paidAmount: round2(totals.paidAmount),
      debt: round2(totals.debt),
      debtNow: round2(numberFromRow(debtNow.debt)),
      writeOffQty: round2(suppliers.reduce((sum, row) => sum + row.writeOffQty, 0)),
      writeOffCost: round2(suppliers.reduce((sum, row) => sum + row.writeOffCost, 0)),
      writeOffUnattributedCost,
    },
    previousGoodsTotal: previous.purchases,
    series,
    suppliers,
    positions,
    debtDocuments,
    hasOpenShift: Boolean(getOpenShift(client)),
  }
}

// ── Списания ───────────────────────────────────────────────────────────────

export type WriteOffDocRow = {
  id: number
  number: string
  operationAt: string
  reason: string
  postedByName: string
  itemsCount: number
  qty: number
  cost: number
}

export type WriteOffProductRow = {
  productCode: string
  productName: string
  categoryPath: string
  docsCount: number
  qty: number
  cost: number
}

export type AnalyticsWriteOffs = {
  range: AnalyticsRange
  totals: { docsCount: number; qty: number; cost: number; positionsCount: number; purchases: number }
  previous: { qty: number; cost: number }
  series: AnalyticsDayPoint[]
  byReason: AnalyticsShare[]
  byCategory: AnalyticsShare[]
  byProduct: WriteOffProductRow[]
  documents: WriteOffDocRow[]
  // Недостача/излишки по инвентаризациям периода (в штуках и по себестоимости) — отдельная строка,
  // в «списания» не входит.
  inventory: { docsCount: number; shortageQty: number; shortageCost: number; surplusQty: number; surplusCost: number }
}

const WRITEOFF_DATE_SQL = `DATE(COALESCE(d.operation_at, d.created_at), '${TZ}')`
const WRITEOFF_COST_SQL = "i.qty * COALESCE(NULLIF(i.unit_cost, 0), products.cost_price, 0)"
const WRITEOFF_REASON_SQL = "COALESCE(NULLIF(TRIM(d.comment), ''), 'Без причины')"

// Причина списания — свободный комментарий акта («Порча», «Маркетинг»…). Регистр сводим на
// клиенте: LOWER() в SQLite не знает кириллицы, а «Порча» и «порча» — одна причина.
function getWriteOffReasons(client: DbClient, range: AnalyticsRange): AnalyticsShare[] {
  const rows = client
    .prepare(
      `SELECT ${WRITEOFF_REASON_SQL} as label,
        COALESCE(SUM(${WRITEOFF_COST_SQL}), 0) as value, COUNT(DISTINCT d.id) as count
       FROM stock_document_items i
       JOIN stock_documents d ON d.id = i.document_id
       LEFT JOIN products ON products.code = i.product_code
       WHERE d.type = 'stock_out' AND d.status = 'posted' AND ${WRITEOFF_DATE_SQL} BETWEEN @from AND @to
       GROUP BY label
       ORDER BY value DESC, label COLLATE NOCASE`
    )
    .all({ from: range.from, to: range.to }) as Array<Record<string, unknown>>

  const merged = new Map<string, AnalyticsShare>()
  for (const row of rows) {
    const label = String(row.label)
    const key = label.toLocaleLowerCase("ru")
    const entry = merged.get(key) ?? { key, label, value: 0, count: 0 }
    entry.value += numberFromRow(row.value)
    entry.count += numberFromRow(row.count)
    merged.set(key, entry)
  }
  return [...merged.values()]
    .map((entry) => ({ ...entry, value: round2(entry.value) }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "ru"))
}

export function getAnalyticsWriteOffs(opts?: AnalyticsRangeInput): AnalyticsWriteOffs {
  const client = db()
  const range = resolveAnalyticsRange(opts, client)
  const params = { from: range.from, to: range.to }
  const series = getDailySeries(client, range.from, range.to)
  const totals = sumSeries(series)
  const previous = sumSeries(getDailySeries(client, range.prevFrom, range.prevTo))

  const byCategory = (
    client
      .prepare(
        `SELECT
          CASE
            WHEN instr(COALESCE(products.category_path, ''), '/') > 0
            THEN substr(products.category_path, 1, instr(products.category_path, '/') - 1)
            ELSE COALESCE(NULLIF(products.category_path, ''), 'Без категории')
          END as label,
          COALESCE(SUM(${WRITEOFF_COST_SQL}), 0) as value, COALESCE(SUM(i.qty), 0) as count
         FROM stock_document_items i
         JOIN stock_documents d ON d.id = i.document_id
         LEFT JOIN products ON products.code = i.product_code
         WHERE d.type = 'stock_out' AND d.status = 'posted' AND ${WRITEOFF_DATE_SQL} BETWEEN @from AND @to
         GROUP BY label
         ORDER BY value DESC, label COLLATE NOCASE`
      )
      .all(params) as Array<Record<string, unknown>>
  ).map((row) => ({
    key: String(row.label),
    label: String(row.label),
    value: round2(numberFromRow(row.value)),
    count: round2(numberFromRow(row.count)),
  }))

  const byProduct = (
    client
      .prepare(
        `SELECT i.product_code as productCode,
          COALESCE(products.name, NULLIF(i.product_name, ''), i.product_code) as productName,
          COALESCE(products.category_path, '') as categoryPath,
          COUNT(DISTINCT d.id) as docsCount,
          COALESCE(SUM(i.qty), 0) as qty,
          COALESCE(SUM(${WRITEOFF_COST_SQL}), 0) as cost
         FROM stock_document_items i
         JOIN stock_documents d ON d.id = i.document_id
         LEFT JOIN products ON products.code = i.product_code
         WHERE d.type = 'stock_out' AND d.status = 'posted' AND ${WRITEOFF_DATE_SQL} BETWEEN @from AND @to
         GROUP BY i.product_code
         ORDER BY cost DESC, qty DESC, productName COLLATE NOCASE`
      )
      .all(params) as Array<Record<string, unknown>>
  ).map((row) => ({
    productCode: String(row.productCode ?? ""),
    productName: String(row.productName ?? "—"),
    categoryPath: String(row.categoryPath ?? ""),
    docsCount: numberFromRow(row.docsCount),
    qty: round2(numberFromRow(row.qty)),
    cost: round2(numberFromRow(row.cost)),
  }))

  const documents = (
    client
      .prepare(
        `SELECT d.id, d.number, COALESCE(d.operation_at, d.created_at) as operationAt,
          ${WRITEOFF_REASON_SQL} as reason, COALESCE(d.posted_by_name, d.created_by_name, '') as postedByName,
          COUNT(i.id) as itemsCount, COALESCE(SUM(i.qty), 0) as qty,
          COALESCE(SUM(${WRITEOFF_COST_SQL}), 0) as cost
         FROM stock_documents d
         LEFT JOIN stock_document_items i ON i.document_id = d.id
         LEFT JOIN products ON products.code = i.product_code
         WHERE d.type = 'stock_out' AND d.status = 'posted' AND ${WRITEOFF_DATE_SQL} BETWEEN @from AND @to
         GROUP BY d.id
         ORDER BY operationAt DESC, d.id DESC`
      )
      .all(params) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: numberFromRow(row.id),
    number: String(row.number ?? ""),
    operationAt: String(row.operationAt ?? ""),
    reason: String(row.reason ?? ""),
    postedByName: String(row.postedByName ?? ""),
    itemsCount: numberFromRow(row.itemsCount),
    qty: round2(numberFromRow(row.qty)),
    cost: round2(numberFromRow(row.cost)),
  }))

  // Инвентаризация: дельта = counted − expected по проведённым актам пересчёта периода.
  const inventory = client
    .prepare(
      `SELECT COUNT(DISTINCT d.id) as docsCount,
        COALESCE(SUM(CASE WHEN i.counted_qty < i.expected_qty THEN i.expected_qty - i.counted_qty ELSE 0 END), 0) as shortageQty,
        COALESCE(SUM(CASE WHEN i.counted_qty < i.expected_qty THEN (i.expected_qty - i.counted_qty) * COALESCE(products.cost_price, 0) ELSE 0 END), 0) as shortageCost,
        COALESCE(SUM(CASE WHEN i.counted_qty > i.expected_qty THEN i.counted_qty - i.expected_qty ELSE 0 END), 0) as surplusQty,
        COALESCE(SUM(CASE WHEN i.counted_qty > i.expected_qty THEN (i.counted_qty - i.expected_qty) * COALESCE(products.cost_price, 0) ELSE 0 END), 0) as surplusCost
       FROM stock_documents d
       LEFT JOIN stock_document_items i ON i.document_id = d.id AND i.counted_qty IS NOT NULL AND i.expected_qty IS NOT NULL
       LEFT JOIN products ON products.code = i.product_code
       WHERE d.type = 'count' AND d.status = 'posted' AND DATE(COALESCE(d.posted_at, d.created_at), '${TZ}') BETWEEN @from AND @to`
    )
    .get(params) as Record<string, unknown>

  return {
    range,
    totals: {
      docsCount: documents.length,
      qty: totals.writeOffQty,
      cost: totals.writeOffs,
      positionsCount: byProduct.length,
      purchases: totals.purchases,
    },
    previous: { qty: previous.writeOffQty, cost: previous.writeOffs },
    series,
    byReason: getWriteOffReasons(client, range),
    byCategory,
    byProduct,
    documents,
    inventory: {
      docsCount: numberFromRow(inventory.docsCount),
      shortageQty: round2(numberFromRow(inventory.shortageQty)),
      shortageCost: round2(numberFromRow(inventory.shortageCost)),
      surplusQty: round2(numberFromRow(inventory.surplusQty)),
      surplusCost: round2(numberFromRow(inventory.surplusCost)),
    },
  }
}

// ── Карточка товара ────────────────────────────────────────────────────────

export type ProductCardMovement = {
  id: number
  createdAt: string
  type: string
  // Человеческий вид движения для фильтра/бейджа: sale | receipt | write_off | adjustment | inventory | import.
  kind: "sale" | "receipt" | "write_off" | "adjustment" | "inventory" | "import"
  qty: number
  beforeStock: number | null
  afterStock: number | null
  saleId: number | null
  orderId: number | null
  documentId: number | null
  documentNumber: string | null
  documentType: string | null
  supplierName: string | null
  userName: string
  note: string
}

export type ProductCardSupplier = {
  supplierId: number | null
  supplierName: string
  docsCount: number
  qty: number
  goodsSum: number
  avgCost: number
  lastCost: number
  lastAt: string | null
  // Доля в поступлениях товара за период.
  share: number
}

export type ProductCardData = {
  range: AnalyticsRange
  product: {
    code: string
    name: string
    article: string
    categoryPath: string
    unit: string
    imagePath: string
    stock: number
    reserved: number
    expected: number
    available: number
    costPrice: number
    salePrice: number
    isActive: boolean
    trackLots: boolean
    vaseLifeDays: number | null
  }
  period: {
    soldQty: number
    revenue: number
    cost: number
    salesCount: number
    ordersCount: number
    receivedQty: number
    receivedSum: number
    receiptDocs: number
    writtenOffQty: number
    writtenOffCost: number
    adjustmentQty: number
    openingStock: number
    closingStock: number
  }
  previous: { soldQty: number; revenue: number; receivedQty: number; writtenOffQty: number }
  // Остаток на конец каждого дня периода (перенос значения в дни без движений) и продажи по дням.
  series: Array<{ day: string; stock: number; soldQty: number; revenue: number; receivedQty: number; writtenOffQty: number }>
  suppliers: ProductCardSupplier[]
  movements: ProductCardMovement[]
  movementsTruncated: boolean
  // Полная история цен закупки (последние приходы) — для блока «Закупочная цена».
  recentCosts: Array<{ at: string; unitCost: number; supplierName: string; documentId: number; documentNumber: string }>
  // Средняя закупочная цена за всё время (по проведённым приходам) — рядом с текущей себестоимостью.
  avgCostAllTime: number
}

const MOVEMENTS_LIMIT = 500

// Сколько продано/поступило/списано по товару за [from, to] — одним запросом со скалярными
// подзапросами (объём по одному товару мал).
function getProductPeriodTotals(client: DbClient, code: string, from: string, to: string) {
  const row = client
    .prepare(
      `SELECT
        (SELECT COALESCE(SUM(items.qty), 0) FROM sale_items items JOIN sales ON sales.id = items.sale_id
          WHERE items.product_code = @code AND sales.reversed_at IS NULL
           AND DATE(sales.created_at, '${TZ}') BETWEEN @from AND @to)
        + (SELECT COALESCE(SUM(items.qty), 0) FROM order_items items JOIN orders ON orders.id = items.order_id
          WHERE items.product_code = @code AND orders.completed_at IS NOT NULL
           AND orders.status IN ('Выдан', 'Передан курьеру')
           AND DATE(orders.completed_at, '${TZ}') BETWEEN @from AND @to) as soldQty,
        (SELECT COALESCE(SUM(items.total), 0) FROM sale_items items JOIN sales ON sales.id = items.sale_id
          WHERE items.product_code = @code AND sales.reversed_at IS NULL
           AND DATE(sales.created_at, '${TZ}') BETWEEN @from AND @to)
        + (SELECT COALESCE(SUM(items.total), 0) FROM order_items items JOIN orders ON orders.id = items.order_id
          WHERE items.product_code = @code AND orders.completed_at IS NOT NULL
           AND orders.status IN ('Выдан', 'Передан курьеру')
           AND DATE(orders.completed_at, '${TZ}') BETWEEN @from AND @to) as revenue,
        (SELECT COUNT(DISTINCT sales.id) FROM sale_items items JOIN sales ON sales.id = items.sale_id
          WHERE items.product_code = @code AND sales.reversed_at IS NULL
           AND DATE(sales.created_at, '${TZ}') BETWEEN @from AND @to) as salesCount,
        (SELECT COUNT(DISTINCT orders.id) FROM order_items items JOIN orders ON orders.id = items.order_id
          WHERE items.product_code = @code AND orders.completed_at IS NOT NULL
           AND orders.status IN ('Выдан', 'Передан курьеру')
           AND DATE(orders.completed_at, '${TZ}') BETWEEN @from AND @to) as ordersCount,
        (SELECT COALESCE(SUM(i.qty), 0) FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
          WHERE i.product_code = @code AND d.type = 'stock_in' AND d.status = 'posted'
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as receivedQty,
        (SELECT COALESCE(SUM(i.qty * i.unit_cost), 0) FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
          WHERE i.product_code = @code AND d.type = 'stock_in' AND d.status = 'posted'
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as receivedSum,
        (SELECT COUNT(DISTINCT d.id) FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
          WHERE i.product_code = @code AND d.type = 'stock_in' AND d.status = 'posted'
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as receiptDocs,
        (SELECT COALESCE(SUM(i.qty), 0) FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
          WHERE i.product_code = @code AND d.type = 'stock_out' AND d.status = 'posted'
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as writtenOffQty,
        (SELECT COALESCE(SUM(i.qty * COALESCE(NULLIF(i.unit_cost, 0), products.cost_price, 0)), 0)
          FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
          LEFT JOIN products ON products.code = i.product_code
          WHERE i.product_code = @code AND d.type = 'stock_out' AND d.status = 'posted'
           AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to) as writtenOffCost,
        (SELECT COALESCE(SUM(qty), 0) FROM stock_movements
          WHERE product_code = @code AND type IN ('adjustment', 'import')
           AND DATE(created_at, '${TZ}') BETWEEN @from AND @to) as adjustmentQty`
    )
    .get({ code, from, to }) as Record<string, unknown>
  return {
    soldQty: round2(numberFromRow(row.soldQty)),
    revenue: round2(numberFromRow(row.revenue)),
    salesCount: numberFromRow(row.salesCount),
    ordersCount: numberFromRow(row.ordersCount),
    receivedQty: round2(numberFromRow(row.receivedQty)),
    receivedSum: round2(numberFromRow(row.receivedSum)),
    receiptDocs: numberFromRow(row.receiptDocs),
    writtenOffQty: round2(numberFromRow(row.writtenOffQty)),
    writtenOffCost: round2(numberFromRow(row.writtenOffCost)),
    adjustmentQty: round2(numberFromRow(row.adjustmentQty)),
  }
}

function movementKind(type: string, documentType: string | null): ProductCardMovement["kind"] {
  if (type === "sale" || type === "order_fulfill") return "sale"
  if (type === "stock_in") return "receipt"
  if (type === "stock_out") return "write_off"
  if (type === "import") return "import"
  if (documentType === "count") return "inventory"
  // Корректировка/откат акта — относим к его типу, чтобы фильтр «Приходы» показывал и корректировки прихода.
  if (documentType === "stock_in") return "receipt"
  if (documentType === "stock_out") return "write_off"
  return "adjustment"
}

export function getProductCardData(code: string, opts?: AnalyticsRangeInput): ProductCardData | null {
  const client = db()
  const productRow = client.prepare("SELECT * FROM products WHERE code = ?").get(code) as Record<string, unknown> | undefined
  if (!productRow) {
    return null
  }
  const range = resolveAnalyticsRange(opts, client)
  const params = { code, from: range.from, to: range.to }

  const current = getProductPeriodTotals(client, code, range.from, range.to)
  const prev = getProductPeriodTotals(client, code, range.prevFrom, range.prevTo)

  // Остаток на конец дня: последняя проводка дня даёт after_stock; дни без движений наследуют
  // предыдущее значение; стартовая точка — остаток до начала периода.
  const opening = client
    .prepare(
      `SELECT after_stock as stock FROM stock_movements
       WHERE product_code = @code AND DATE(created_at, '${TZ}') < @from AND after_stock IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get(params) as { stock: number } | undefined
  const firstInRange = client
    .prepare(
      `SELECT before_stock as stock FROM stock_movements
       WHERE product_code = @code AND DATE(created_at, '${TZ}') BETWEEN @from AND @to AND before_stock IS NOT NULL
       ORDER BY created_at ASC, id ASC LIMIT 1`
    )
    .get(params) as { stock: number } | undefined
  const hasAnyMovementAfter = client
    .prepare(
      `SELECT 1 as x FROM stock_movements WHERE product_code = @code AND DATE(created_at, '${TZ}') > @to LIMIT 1`
    )
    .get(params) as { x: number } | undefined
  const currentStock = numberFromRow(productRow.stock)
  const openingStock =
    opening !== undefined
      ? numberFromRow(opening.stock)
      : firstInRange !== undefined
        ? numberFromRow(firstInRange.stock)
        : hasAnyMovementAfter
          ? 0
          : currentStock

  const dayRows = client
    .prepare(
      `WITH RECURSIVE days(d) AS (
        SELECT @from UNION ALL SELECT DATE(d, '+1 day') FROM days WHERE d < @to
       ),
       closing AS (
        SELECT DATE(created_at, '${TZ}') as d, after_stock as stock,
          ROW_NUMBER() OVER (PARTITION BY DATE(created_at, '${TZ}') ORDER BY created_at DESC, id DESC) as rn
        FROM stock_movements
        WHERE product_code = @code AND after_stock IS NOT NULL AND DATE(created_at, '${TZ}') BETWEEN @from AND @to
       ),
       sold AS (
        SELECT d, SUM(qty) as qty, SUM(total) as revenue FROM (
          SELECT DATE(sales.created_at, '${TZ}') as d, items.qty as qty, items.total as total
          FROM sale_items items JOIN sales ON sales.id = items.sale_id
          WHERE items.product_code = @code AND sales.reversed_at IS NULL
           AND DATE(sales.created_at, '${TZ}') BETWEEN @from AND @to
          UNION ALL
          SELECT DATE(orders.completed_at, '${TZ}') as d, items.qty as qty, items.total as total
          FROM order_items items JOIN orders ON orders.id = items.order_id
          WHERE items.product_code = @code AND orders.completed_at IS NOT NULL
           AND orders.status IN ('Выдан', 'Передан курьеру')
           AND DATE(orders.completed_at, '${TZ}') BETWEEN @from AND @to
        ) GROUP BY d
       ),
       received AS (
        SELECT DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') as d, SUM(i.qty) as qty
        FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
        WHERE i.product_code = @code AND d.type = 'stock_in' AND d.status = 'posted'
         AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to
        GROUP BY DATE(COALESCE(d.operation_at, d.created_at), '${TZ}')
       ),
       written AS (
        SELECT DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') as d, SUM(i.qty) as qty
        FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
        WHERE i.product_code = @code AND d.type = 'stock_out' AND d.status = 'posted'
         AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to
        GROUP BY DATE(COALESCE(d.operation_at, d.created_at), '${TZ}')
       )
       SELECT days.d as day, closing.stock as stock,
        COALESCE(sold.qty, 0) as soldQty, COALESCE(sold.revenue, 0) as revenue,
        COALESCE(received.qty, 0) as receivedQty, COALESCE(written.qty, 0) as writtenOffQty
       FROM days
       LEFT JOIN closing ON closing.d = days.d AND closing.rn = 1
       LEFT JOIN sold ON sold.d = days.d
       LEFT JOIN received ON received.d = days.d
       LEFT JOIN written ON written.d = days.d
       ORDER BY days.d`
    )
    .all(params) as Array<Record<string, unknown>>

  let carry = openingStock
  const series = dayRows.map((row) => {
    if (row.stock !== null && row.stock !== undefined) {
      carry = numberFromRow(row.stock)
    }
    return {
      day: String(row.day),
      stock: round2(carry),
      soldQty: round2(numberFromRow(row.soldQty)),
      revenue: round2(numberFromRow(row.revenue)),
      receivedQty: round2(numberFromRow(row.receivedQty)),
      writtenOffQty: round2(numberFromRow(row.writtenOffQty)),
    }
  })
  const closingStock = series.length ? series[series.length - 1].stock : openingStock

  const supplierRows = client
    .prepare(
      `SELECT d.supplier_id as supplierId,
        COALESCE(NULLIF(TRIM(d.supplier_name), ''), suppliers.name, 'Без поставщика') as supplierName,
        COUNT(DISTINCT d.id) as docsCount,
        COALESCE(SUM(i.qty), 0) as qty,
        COALESCE(SUM(i.qty * i.unit_cost), 0) as goodsSum,
        (SELECT i2.unit_cost FROM stock_document_items i2 JOIN stock_documents d2 ON d2.id = i2.document_id
          WHERE i2.product_code = @code AND d2.type = 'stock_in' AND d2.status = 'posted'
           AND d2.supplier_id IS d.supplier_id
          ORDER BY COALESCE(d2.operation_at, d2.created_at) DESC, i2.id DESC LIMIT 1) as lastCost,
        MAX(COALESCE(d.operation_at, d.created_at)) as lastAt
       FROM stock_document_items i
       JOIN stock_documents d ON d.id = i.document_id
       LEFT JOIN suppliers ON suppliers.id = d.supplier_id
       WHERE i.product_code = @code AND d.type = 'stock_in' AND d.status = 'posted'
        AND DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to
       GROUP BY d.supplier_id
       ORDER BY qty DESC, supplierName COLLATE NOCASE`
    )
    .all(params) as Array<Record<string, unknown>>
  const receivedTotal = supplierRows.reduce((sum, row) => sum + numberFromRow(row.qty), 0)
  const suppliers: ProductCardSupplier[] = supplierRows.map((row) => {
    const qty = round2(numberFromRow(row.qty))
    const goodsSum = round2(numberFromRow(row.goodsSum))
    return {
      supplierId: row.supplierId === null || row.supplierId === undefined ? null : numberFromRow(row.supplierId),
      supplierName: String(row.supplierName ?? "Без поставщика"),
      docsCount: numberFromRow(row.docsCount),
      qty,
      goodsSum,
      avgCost: qty > 0 ? round2(goodsSum / qty) : 0,
      lastCost: round2(numberFromRow(row.lastCost)),
      lastAt: row.lastAt ? String(row.lastAt) : null,
      share: receivedTotal > 0 ? round2((numberFromRow(row.qty) / receivedTotal) * 100) : 0,
    }
  })

  const movementRows = client
    .prepare(
      `SELECT sm.id, sm.created_at as createdAt, sm.type, sm.qty,
        sm.before_stock as beforeStock, sm.after_stock as afterStock,
        sm.sale_id as saleId, sm.order_id as orderId, sm.document_id as documentId,
        sd.number as documentNumber, sd.type as documentType,
        NULLIF(TRIM(COALESCE(sd.supplier_name, '')), '') as supplierName,
        COALESCE(users.name, '') as userName, COALESCE(sm.comment, '') as note
       FROM stock_movements sm
       LEFT JOIN stock_documents sd ON sd.id = sm.document_id
       LEFT JOIN users ON users.id = sm.user_id
       WHERE sm.product_code = @code AND sm.type NOT IN ('reserve', 'reserve_cancel')
        AND DATE(sm.created_at, '${TZ}') BETWEEN @from AND @to
       ORDER BY sm.created_at DESC, sm.id DESC
       LIMIT @limit`
    )
    .all({ ...params, limit: MOVEMENTS_LIMIT + 1 }) as Array<Record<string, unknown>>
  const movementsTruncated = movementRows.length > MOVEMENTS_LIMIT
  const movements: ProductCardMovement[] = movementRows.slice(0, MOVEMENTS_LIMIT).map((row) => {
    const type = String(row.type ?? "")
    const documentType = row.documentType ? String(row.documentType) : null
    const qty = numberFromRow(row.qty)
    return {
      id: numberFromRow(row.id),
      createdAt: String(row.createdAt ?? ""),
      type,
      kind: movementKind(type, documentType),
      qty,
      beforeStock: row.beforeStock === null || row.beforeStock === undefined ? null : numberFromRow(row.beforeStock),
      afterStock: row.afterStock === null || row.afterStock === undefined ? null : numberFromRow(row.afterStock),
      saleId: row.saleId === null || row.saleId === undefined ? null : numberFromRow(row.saleId),
      orderId: row.orderId === null || row.orderId === undefined ? null : numberFromRow(row.orderId),
      documentId: row.documentId === null || row.documentId === undefined ? null : numberFromRow(row.documentId),
      documentNumber: row.documentNumber ? String(row.documentNumber) : null,
      documentType,
      supplierName: row.supplierName ? String(row.supplierName) : null,
      userName: String(row.userName ?? ""),
      note: String(row.note ?? ""),
    }
  })

  const recentCosts = (
    client
      .prepare(
        `SELECT COALESCE(d.operation_at, d.created_at) as at, i.unit_cost as unitCost,
          COALESCE(NULLIF(TRIM(d.supplier_name), ''), 'Без поставщика') as supplierName,
          d.id as documentId, d.number as documentNumber
         FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
         WHERE i.product_code = @code AND d.type = 'stock_in' AND d.status = 'posted'
         ORDER BY COALESCE(d.operation_at, d.created_at) DESC, i.id DESC
         LIMIT 8`
      )
      .all({ code }) as Array<Record<string, unknown>>
  ).map((row) => ({
    at: String(row.at ?? ""),
    unitCost: round2(numberFromRow(row.unitCost)),
    supplierName: String(row.supplierName ?? ""),
    documentId: numberFromRow(row.documentId),
    documentNumber: String(row.documentNumber ?? ""),
  }))

  const avgCostRow = client
    .prepare(
      `SELECT CASE WHEN COALESCE(SUM(i.qty), 0) > 0 THEN SUM(i.qty * i.unit_cost) / SUM(i.qty) ELSE 0 END as avgCost
       FROM stock_document_items i JOIN stock_documents d ON d.id = i.document_id
       WHERE i.product_code = @code AND d.type = 'stock_in' AND d.status = 'posted' AND i.unit_cost > 0`
    )
    .get({ code }) as { avgCost: number }

  const stock = numberFromRow(productRow.stock)
  const reserved = numberFromRow(productRow.reserved)

  return {
    range,
    product: {
      code: String(productRow.code),
      name: String(productRow.name ?? ""),
      article: String(productRow.article ?? ""),
      categoryPath: String(productRow.category_path ?? ""),
      unit: String(productRow.unit ?? "шт"),
      imagePath: String(productRow.image_path ?? ""),
      stock,
      reserved,
      expected: numberFromRow(productRow.expected),
      available: stock - reserved,
      costPrice: numberFromRow(productRow.cost_price),
      salePrice: numberFromRow(productRow.sale_price),
      isActive: numberFromRow(productRow.is_active ?? 1) === 1,
      trackLots: numberFromRow(productRow.track_lots ?? 0) === 1,
      vaseLifeDays:
        productRow.vase_life_days === null || productRow.vase_life_days === undefined
          ? null
          : numberFromRow(productRow.vase_life_days),
    },
    period: {
      ...current,
      cost: round2(current.soldQty * numberFromRow(productRow.cost_price)),
      openingStock: round2(openingStock),
      closingStock: round2(closingStock),
    },
    previous: {
      soldQty: prev.soldQty,
      revenue: prev.revenue,
      receivedQty: prev.receivedQty,
      writtenOffQty: prev.writtenOffQty,
    },
    series,
    suppliers,
    movements,
    movementsTruncated,
    recentCosts,
    avgCostAllTime: round2(numberFromRow(avgCostRow.avgCost)),
  }
}

function round2(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
