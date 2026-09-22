import { SHOP_UTC_OFFSET_SQL } from "@/lib/datetime"
import { allocateOverheadShares } from "@/lib/stock-costing"
import { db } from "../connection"

// Отчёт по проданным позициям (для «Истории склада» → вкладка «Продажи» и Excel-выгрузки).
//
// Источник — ФАКТИЧЕСКИЕ продажи, а не складские движения:
//  • чеки кассы (sales + sale_items), возвращённые (reversed_at) исключены;
//  • выданные заказы (orders + order_items) — статусы «Выдан»/«Передан курьеру», по дате выдачи.
//
// Скидка чека/заказа не хранится в строках, поэтому итог документа (у заказов — без доставки)
// распределяется по строкам через allocateOverheadShares (стоимостные веса + остаток округления):
// сумма строк отчёта СХОДИТСЯ с кассой до копейки. Товарные фильтры применяются ПОСЛЕ
// распределения — доля строки считается от всех строк документа.
// Себестоимость — ТЕКУЩАЯ из карточки товара (историю себестоимости система не хранит).

export type SalesReportFilters = {
  dateFrom?: string
  dateTo?: string
  category?: string
  query?: string
}

// Значение фильтра «Без категории» — синхронно с NO_CATEGORY_FILTER истории движений.
const NO_CATEGORY = "__none__"

export type SalesReportLine = {
  source: "sale" | "order"
  sourceId: number
  sourceLabel: string
  soldAt: string
  productCode: string
  productName: string
  categoryPath: string
  qty: number
  revenue: number
  cost: number
}

export type SalesReportRow = {
  productCode: string
  productName: string
  category: string
  qty: number
  revenue: number
  cost: number
  margin: number
}

export type SalesReport = {
  totals: {
    qty: number
    revenue: number
    cost: number
    margin: number
    salesCount: number
    salesRevenue: number
    ordersCount: number
    ordersRevenue: number
    refundedCount: number
    refundedAmount: number
  }
  byProduct: SalesReportRow[]
  byCategory: Array<{ category: string; qty: number; revenue: number; cost: number; margin: number }>
  lines: SalesReportLine[]
}

type RawLine = {
  sourceId: number
  soldAt: string
  productCode: string
  productName: string
  categoryPath: string
  qty: number
  itemTotal: number
  docTotal: number
  unitCost: number
  orderNumber?: string | number
}

function topCategoryOf(categoryPath: string): string {
  if (!categoryPath) {
    return "Без категории"
  }
  const slash = categoryPath.indexOf("/")
  return slash > 0 ? categoryPath.slice(0, slash) : categoryPath
}

// Распределяет фактический итог каждого документа по его строкам (стоимостные веса, остаток
// округления к наибольшей строке) и возвращает строки отчёта с копеечно-точной выручкой.
function toReportLines(raw: RawLine[], source: "sale" | "order"): SalesReportLine[] {
  const byDoc = new Map<number, RawLine[]>()
  for (const line of raw) {
    const list = byDoc.get(line.sourceId) ?? []
    list.push(line)
    byDoc.set(line.sourceId, list)
  }

  const result: SalesReportLine[] = []
  for (const docLines of byDoc.values()) {
    const docTotal = docLines[0]?.docTotal ?? 0
    const shares = allocateOverheadShares(
      docLines.map((line) => ({ qty: line.qty, lineValue: line.itemTotal })),
      docTotal,
      "by_value"
    )
    docLines.forEach((line, index) => {
      result.push({
        source,
        sourceId: line.sourceId,
        sourceLabel: source === "sale" ? `Чек #${line.sourceId}` : `Заказ №${line.orderNumber ?? line.sourceId}`,
        soldAt: line.soldAt,
        productCode: line.productCode,
        productName: line.productName,
        categoryPath: line.categoryPath,
        qty: line.qty,
        revenue: shares[index] ?? 0,
        cost: round2(line.qty * line.unitCost),
      })
    })
  }

  return result
}

// Товарные фильтры (верхняя категория + поиск) — после распределения выручки по строкам.
function matchesFilters(line: SalesReportLine, filters: SalesReportFilters): boolean {
  const category = String(filters.category ?? "").trim()
  if (category === NO_CATEGORY) {
    if (line.categoryPath !== "") {
      return false
    }
  } else if (category && category !== "all") {
    if (line.categoryPath !== category && !line.categoryPath.startsWith(`${category}/`)) {
      return false
    }
  }

  const query = String(filters.query ?? "").trim().toLowerCase()
  if (query) {
    const haystack = `${line.productName} ${line.productCode}`.toLowerCase()
    if (!haystack.includes(query)) {
      return false
    }
  }

  return true
}

export function getSalesReport(filters?: SalesReportFilters): SalesReport {
  const client = db()
  const dateFrom = String(filters?.dateFrom ?? "").trim()
  const dateTo = String(filters?.dateTo ?? "").trim()

  // ── Строки чеков кассы за период (все строки документа — фильтры по товару позже) ──
  const saleConditions = ["sales.reversed_at IS NULL"]
  const saleParams: Record<string, string> = {}
  const saleDate = `DATE(sales.created_at, '${SHOP_UTC_OFFSET_SQL}')`
  if (dateFrom) {
    saleConditions.push(`${saleDate} >= @dateFrom`)
    saleParams.dateFrom = dateFrom
  }
  if (dateTo) {
    saleConditions.push(`${saleDate} <= @dateTo`)
    saleParams.dateTo = dateTo
  }

  const saleRaw = client
    .prepare(
      `SELECT
        sales.id as sourceId,
        sales.created_at as soldAt,
        COALESCE(items.product_code, '') as productCode,
        COALESCE(products.name, items.product_code, '—') as productName,
        COALESCE(products.category_path, '') as categoryPath,
        items.qty as qty,
        items.total as itemTotal,
        sales.total as docTotal,
        COALESCE(products.cost_price, 0) as unitCost
       FROM sale_items items
       JOIN sales ON sales.id = items.sale_id
       LEFT JOIN products ON products.code = items.product_code
       WHERE ${saleConditions.join(" AND ")}
       ORDER BY sales.created_at DESC, items.id`
    )
    .all(saleParams) as RawLine[]

  // ── Строки выданных заказов (по дате выдачи; товарная часть = итог − доставка) ──
  const orderConditions = [
    "orders.completed_at IS NOT NULL",
    "orders.status IN ('Выдан', 'Передан курьеру')",
  ]
  const orderParams: Record<string, string> = {}
  const orderDate = `DATE(orders.completed_at, '${SHOP_UTC_OFFSET_SQL}')`
  if (dateFrom) {
    orderConditions.push(`${orderDate} >= @dateFrom`)
    orderParams.dateFrom = dateFrom
  }
  if (dateTo) {
    orderConditions.push(`${orderDate} <= @dateTo`)
    orderParams.dateTo = dateTo
  }

  const orderRaw = client
    .prepare(
      `SELECT
        orders.id as sourceId,
        COALESCE(NULLIF(orders.number, ''), orders.id) as orderNumber,
        orders.completed_at as soldAt,
        COALESCE(items.product_code, '') as productCode,
        COALESCE(products.name, NULLIF(items.name, ''), items.product_code, '—') as productName,
        COALESCE(products.category_path, '') as categoryPath,
        items.qty as qty,
        items.total as itemTotal,
        orders.total - COALESCE(orders.delivery_price, 0) as docTotal,
        COALESCE(products.cost_price, 0) as unitCost
       FROM order_items items
       JOIN orders ON orders.id = items.order_id
       LEFT JOIN products ON products.code = items.product_code
       WHERE ${orderConditions.join(" AND ")}
       ORDER BY orders.completed_at DESC, items.id`
    )
    .all(orderParams) as RawLine[]

  const lines = [...toReportLines(saleRaw, "sale"), ...toReportLines(orderRaw, "order")]
    .filter((line) => matchesFilters(line, filters ?? {}))
    .sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0))

  // ── Агрегаты ──────────────────────────────────────────────────────────────
  const byProductMap = new Map<string, SalesReportRow>()
  const byCategoryMap = new Map<string, { category: string; qty: number; revenue: number; cost: number; margin: number }>()
  let qtyTotal = 0
  let revenueTotal = 0
  let costTotal = 0
  let salesRevenue = 0
  let ordersRevenue = 0
  const saleIds = new Set<number>()
  const orderIds = new Set<number>()

  for (const line of lines) {
    qtyTotal += line.qty
    revenueTotal += line.revenue
    costTotal += line.cost
    if (line.source === "sale") {
      salesRevenue += line.revenue
      saleIds.add(line.sourceId)
    } else {
      ordersRevenue += line.revenue
      orderIds.add(line.sourceId)
    }

    const productKey = line.productCode || `custom:${line.productName}`
    const product = byProductMap.get(productKey) ?? {
      productCode: line.productCode,
      productName: line.productName,
      category: topCategoryOf(line.categoryPath),
      qty: 0,
      revenue: 0,
      cost: 0,
      margin: 0,
    }
    product.qty += line.qty
    product.revenue += line.revenue
    product.cost += line.cost
    byProductMap.set(productKey, product)

    const categoryKey = topCategoryOf(line.categoryPath)
    const category = byCategoryMap.get(categoryKey) ?? { category: categoryKey, qty: 0, revenue: 0, cost: 0, margin: 0 }
    category.qty += line.qty
    category.revenue += line.revenue
    category.cost += line.cost
    byCategoryMap.set(categoryKey, category)
  }

  const byProduct = [...byProductMap.values()]
    .map((row) => ({ ...row, qty: round2(row.qty), revenue: round2(row.revenue), cost: round2(row.cost), margin: round2(row.revenue - row.cost) }))
    .sort((a, b) => b.revenue - a.revenue || a.productName.localeCompare(b.productName, "ru"))
  const byCategory = [...byCategoryMap.values()]
    .map((row) => ({ ...row, qty: round2(row.qty), revenue: round2(row.revenue), cost: round2(row.cost), margin: round2(row.revenue - row.cost) }))
    .sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category, "ru"))

  // Возвраты за период (по дате возврата) — не входят в выручку, показываются для сверки с кассой.
  const refundConditions = ["sales.reversed_at IS NOT NULL"]
  const refundParams: Record<string, string> = {}
  const refundDate = `DATE(sales.reversed_at, '${SHOP_UTC_OFFSET_SQL}')`
  if (dateFrom) {
    refundConditions.push(`${refundDate} >= @dateFrom`)
    refundParams.dateFrom = dateFrom
  }
  if (dateTo) {
    refundConditions.push(`${refundDate} <= @dateTo`)
    refundParams.dateTo = dateTo
  }
  const refunds = client
    .prepare(
      `SELECT COUNT(*) as refundedCount, COALESCE(SUM(total), 0) as refundedAmount
       FROM sales WHERE ${refundConditions.join(" AND ")}`
    )
    .get(refundParams) as { refundedCount: number; refundedAmount: number }

  return {
    totals: {
      qty: round2(qtyTotal),
      revenue: round2(revenueTotal),
      cost: round2(costTotal),
      margin: round2(revenueTotal - costTotal),
      salesCount: saleIds.size,
      salesRevenue: round2(salesRevenue),
      ordersCount: orderIds.size,
      ordersRevenue: round2(ordersRevenue),
      refundedCount: refunds.refundedCount,
      refundedAmount: round2(refunds.refundedAmount),
    },
    byProduct,
    byCategory,
    lines,
  }
}

function round2(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
