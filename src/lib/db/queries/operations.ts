import { numberFromRow } from "@/lib/db-row"
import { SHOP_UTC_OFFSET_SQL } from "@/lib/datetime"
import { db } from "../connection"
import { resolveAnalyticsRange, type AnalyticsRange, type AnalyticsRangeInput } from "./analytics"

// Журнал операций за период (/analytics?tab=operations): чеки кассы, выданные заказы, проведённые
// приходы, списания и инвентаризации — одним списком с фильтрами из URL (тип, категория, товар,
// причина списания, поставщик, поиск) и постраничной выдачей. Сюда ведут клики по категориям,
// причинам, поставщикам и товарам с других вкладок — список «относящихся» операций.

const TZ = SHOP_UTC_OFFSET_SQL

export type OperationKind = "sale" | "order" | "receipt" | "writeoff" | "inventory"
export type OperationTypeFilter = "all" | "sales" | OperationKind

export const OPERATION_TYPES: OperationTypeFilter[] = ["all", "sales", "sale", "order", "receipt", "writeoff", "inventory"]

export type OperationFilters = {
  type?: string
  category?: string
  product?: string
  reason?: string
  supplier?: string
  query?: string
  page?: string | number
  pageSize?: number
}

export type OperationItem = {
  productCode: string
  productName: string
  category: string
  qty: number
  unitPrice: number
  total: number
  comment: string
}

export type OperationRow = {
  key: string
  kind: OperationKind
  id: number
  number: string
  label: string
  at: string
  // Пояснение: клиент / поставщик / причина списания.
  title: string
  // Дополнение к пояснению: способ оплаты, доставка, статус.
  meta: string
  userName: string
  comment: string
  amount: number
  qty: number
  itemsCount: number
  supplierId: number | null
  reversed: boolean
  href: string | null
  items: OperationItem[]
}

export type AnalyticsOperations = {
  range: AnalyticsRange
  filters: {
    type: OperationTypeFilter
    category: string
    product: string
    productName: string
    reason: string
    supplier: string
    supplierName: string
    query: string
  }
  page: number
  pageSize: number
  total: number
  rows: OperationRow[]
  // Итоги по видам операций по всей отфильтрованной выборке (не только по странице).
  totals: Array<{ kind: OperationKind; count: number; amount: number; qty: number }>
  categories: string[]
  suppliers: Array<{ id: number; name: string }>
  reasons: string[]
}

const TOP_CATEGORY_SQL = (column: string) => `CASE
    WHEN instr(COALESCE(${column}, ''), '/') > 0 THEN substr(${column}, 1, instr(${column}, '/') - 1)
    ELSE COALESCE(NULLIF(${column}, ''), 'Без категории')
  END`

// Условие «категория товара = @category» для строк документа (верхний уровень или подкатегория).
function categoryCondition(alias: string): string {
  return `(${alias}.category_path = @category OR ${alias}.category_path LIKE @categoryPrefix
    OR (@category = 'Без категории' AND COALESCE(${alias}.category_path, '') = ''))`
}

function normalizeType(value: string | undefined): OperationTypeFilter {
  return OPERATION_TYPES.includes(value as OperationTypeFilter) ? (value as OperationTypeFilter) : "all"
}

export function getAnalyticsOperations(rangeInput: AnalyticsRangeInput | undefined, filters?: OperationFilters): AnalyticsOperations {
  const client = db()
  const range = resolveAnalyticsRange(rangeInput, client)
  const type = normalizeType(filters?.type)
  const category = String(filters?.category ?? "").trim()
  const product = String(filters?.product ?? "").trim()
  const reason = String(filters?.reason ?? "").trim()
  const supplierRaw = Number(filters?.supplier ?? "")
  const supplier = Number.isInteger(supplierRaw) && supplierRaw > 0 ? supplierRaw : 0
  const query = String(filters?.query ?? "").trim()
  const pageSize = Math.min(200, Math.max(10, Number(filters?.pageSize ?? 50) || 50))
  const requestedPage = Math.max(1, Number(filters?.page ?? 1) || 1)

  // Причина списания есть только у списаний; поставщик — только у приходов.
  const effectiveType: OperationTypeFilter = reason ? "writeoff" : supplier ? "receipt" : type
  const listKinds = new Set<OperationKind>(
    effectiveType === "all"
      ? ["sale", "order", "receipt", "writeoff", "inventory"]
      : effectiveType === "sales"
        ? ["sale", "order"]
        : [effectiveType]
  )
  // Итоги по видам считаем по всем видам (с теми же товарными фильтрами), чтобы плитки видов
  // работали переключателем; фильтр по типу режет только список.
  const kinds = new Set<OperationKind>(reason ? ["writeoff"] : supplier ? ["receipt"] : ["sale", "order", "receipt", "writeoff", "inventory"])

  const params: Record<string, string | number> = { from: range.from, to: range.to }
  if (category) {
    params.category = category
    params.categoryPrefix = `${category}/%`
  }
  if (product) params.product = product
  if (query) params.query = `%${query}%`
  if (supplier) params.supplier = supplier

  // Каждый источник — свой SELECT с одинаковым набором колонок; товарные фильтры — через EXISTS по строкам.
  const parts: string[] = []
  if (kinds.has("sale")) {
    const conditions = [`DATE(s.created_at, '${TZ}') BETWEEN @from AND @to`]
    if (product) conditions.push("EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.product_code = @product)")
    if (category)
      conditions.push(
        `EXISTS (SELECT 1 FROM sale_items i LEFT JOIN products p ON p.code = i.product_code WHERE i.sale_id = s.id AND ${categoryCondition("p")})`
      )
    if (query) conditions.push("(CAST(s.id AS TEXT) LIKE @query OR COALESCE(s.customer_name, '') LIKE @query OR COALESCE(s.note, '') LIKE @query)")
    parts.push(`SELECT 'sale' as kind, s.id as id, '' as number, s.created_at as at,
        COALESCE(s.customer_name, '') as title, COALESCE(s.payment_method, 'cash') as meta,
        COALESCE(u.name, '') as userName, COALESCE(s.note, '') as comment,
        CASE WHEN s.reversed_at IS NULL THEN s.total ELSE 0 END as amount,
        (SELECT COALESCE(SUM(qty), 0) FROM sale_items WHERE sale_id = s.id) as qty,
        (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as itemsCount,
        NULL as supplierId, CASE WHEN s.reversed_at IS NULL THEN 0 ELSE 1 END as reversed
      FROM sales s LEFT JOIN users u ON u.id = s.user_id
      WHERE ${conditions.join(" AND ")}`)
  }
  if (kinds.has("order")) {
    const conditions = [
      "o.completed_at IS NOT NULL",
      "o.status IN ('Выдан', 'Передан курьеру')",
      `DATE(o.completed_at, '${TZ}') BETWEEN @from AND @to`,
    ]
    if (product) conditions.push("EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.product_code = @product)")
    if (category)
      conditions.push(
        `EXISTS (SELECT 1 FROM order_items i LEFT JOIN products p ON p.code = i.product_code WHERE i.order_id = o.id AND ${categoryCondition("p")})`
      )
    if (query) conditions.push("(COALESCE(o.number, '') LIKE @query OR CAST(o.id AS TEXT) LIKE @query OR COALESCE(o.customer, '') LIKE @query OR COALESCE(o.note, '') LIKE @query)")
    parts.push(`SELECT 'order' as kind, o.id as id, COALESCE(NULLIF(o.number, ''), CAST(o.id AS TEXT)) as number, o.completed_at as at,
        COALESCE(o.customer, '') as title, COALESCE(o.delivery_type, '') as meta,
        COALESCE(u.name, '') as userName, COALESCE(o.note, '') as comment,
        o.total - COALESCE(o.delivery_price, 0) as amount,
        (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = o.id) as qty,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as itemsCount,
        NULL as supplierId, 0 as reversed
      FROM orders o LEFT JOIN users u ON u.id = o.created_by_user_id
      WHERE ${conditions.join(" AND ")}`)
  }
  const docItemConditions = (extra: string[]) => {
    const conditions = [...extra]
    if (product) conditions.push("EXISTS (SELECT 1 FROM stock_document_items i WHERE i.document_id = d.id AND i.product_code = @product)")
    if (category)
      conditions.push(
        `EXISTS (SELECT 1 FROM stock_document_items i LEFT JOIN products p ON p.code = i.product_code WHERE i.document_id = d.id AND ${categoryCondition("p")})`
      )
    if (query) conditions.push("(COALESCE(d.number, '') LIKE @query OR COALESCE(d.supplier_name, '') LIKE @query OR COALESCE(d.comment, '') LIKE @query)")
    return conditions
  }
  if (kinds.has("receipt")) {
    const conditions = docItemConditions([
      "d.type = 'stock_in'",
      "d.status = 'posted'",
      `DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to`,
      ...(supplier ? ["d.supplier_id = @supplier"] : []),
    ])
    parts.push(`SELECT 'receipt' as kind, d.id as id, COALESCE(d.number, '') as number, COALESCE(d.operation_at, d.created_at) as at,
        COALESCE(NULLIF(TRIM(d.supplier_name), ''), 'Без поставщика') as title,
        CASE WHEN d.corrects_document_id IS NOT NULL THEN 'корректировка' ELSE '' END as meta,
        COALESCE(d.posted_by_name, d.created_by_name, '') as userName, COALESCE(d.comment, '') as comment,
        d.goods_total as amount,
        (SELECT COALESCE(SUM(qty), 0) FROM stock_document_items WHERE document_id = d.id) as qty,
        (SELECT COUNT(*) FROM stock_document_items WHERE document_id = d.id) as itemsCount,
        d.supplier_id as supplierId, 0 as reversed
      FROM stock_documents d
      WHERE ${conditions.join(" AND ")}`)
  }
  if (kinds.has("writeoff")) {
    const conditions = docItemConditions([
      "d.type = 'stock_out'",
      "d.status = 'posted'",
      `DATE(COALESCE(d.operation_at, d.created_at), '${TZ}') BETWEEN @from AND @to`,
    ])
    parts.push(`SELECT 'writeoff' as kind, d.id as id, COALESCE(d.number, '') as number, COALESCE(d.operation_at, d.created_at) as at,
        COALESCE(NULLIF(TRIM(d.comment), ''), 'Без причины') as title,
        CASE WHEN d.corrects_document_id IS NOT NULL THEN 'корректировка' ELSE '' END as meta,
        COALESCE(d.posted_by_name, d.created_by_name, '') as userName, '' as comment,
        (SELECT COALESCE(SUM(i.qty * COALESCE(NULLIF(i.unit_cost, 0), p.cost_price, 0)), 0)
          FROM stock_document_items i LEFT JOIN products p ON p.code = i.product_code WHERE i.document_id = d.id) as amount,
        (SELECT COALESCE(SUM(qty), 0) FROM stock_document_items WHERE document_id = d.id) as qty,
        (SELECT COUNT(*) FROM stock_document_items WHERE document_id = d.id) as itemsCount,
        NULL as supplierId, 0 as reversed
      FROM stock_documents d
      WHERE ${conditions.join(" AND ")}`)
  }
  if (kinds.has("inventory")) {
    const conditions = docItemConditions([
      "d.type = 'count'",
      "d.status = 'posted'",
      `DATE(COALESCE(d.posted_at, d.created_at), '${TZ}') BETWEEN @from AND @to`,
    ])
    parts.push(`SELECT 'inventory' as kind, d.id as id, COALESCE(d.number, '') as number, COALESCE(d.posted_at, d.created_at) as at,
        '' as title, '' as meta,
        COALESCE(d.posted_by_name, d.created_by_name, '') as userName, COALESCE(d.comment, '') as comment,
        (SELECT COALESCE(SUM((COALESCE(i.counted_qty, i.expected_qty) - COALESCE(i.expected_qty, 0)) * COALESCE(p.cost_price, 0)), 0)
          FROM stock_document_items i LEFT JOIN products p ON p.code = i.product_code
          WHERE i.document_id = d.id AND i.counted_qty IS NOT NULL) as amount,
        (SELECT COALESCE(SUM(COALESCE(i.counted_qty, i.expected_qty) - COALESCE(i.expected_qty, 0)), 0)
          FROM stock_document_items i WHERE i.document_id = d.id AND i.counted_qty IS NOT NULL) as qty,
        (SELECT COUNT(*) FROM stock_document_items WHERE document_id = d.id AND counted_qty IS NOT NULL) as itemsCount,
        NULL as supplierId, 0 as reversed
      FROM stock_documents d
      WHERE ${conditions.join(" AND ")}`)
  }

  const union = parts.length ? parts.join("\n UNION ALL \n") : "SELECT NULL as kind, NULL as id, NULL as number, NULL as at, NULL as title, NULL as meta, NULL as userName, NULL as comment, NULL as amount, NULL as qty, NULL as itemsCount, NULL as supplierId, NULL as reversed WHERE 0"

  // Причина списания сравнивается без учёта регистра на клиенте БД (LOWER() не знает кириллицы),
  // поэтому при фильтре по причине читаем все списания периода и режем страницу в JS.
  let allRows = client.prepare(`SELECT * FROM (${union}) ORDER BY at DESC, id DESC`).all(params) as Array<Record<string, unknown>>
  if (reason) {
    const wanted = reason.toLocaleLowerCase("ru")
    allRows = allRows.filter((row) => String(row.title ?? "").toLocaleLowerCase("ru") === wanted)
  }

  const totalsMap = new Map<OperationKind, { kind: OperationKind; count: number; amount: number; qty: number }>()
  for (const row of allRows) {
    const kind = String(row.kind) as OperationKind
    const entry = totalsMap.get(kind) ?? { kind, count: 0, amount: 0, qty: 0 }
    entry.count += 1
    entry.amount += numberFromRow(row.amount)
    entry.qty += numberFromRow(row.qty)
    totalsMap.set(kind, entry)
  }
  const listRows = allRows.filter((row) => listKinds.has(String(row.kind) as OperationKind))
  const total = listRows.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, pageCount)
  const pageRows = listRows.slice((page - 1) * pageSize, page * pageSize)

  // Позиции документов страницы — три запроса по спискам id.
  const saleIds = pageRows.filter((row) => row.kind === "sale").map((row) => numberFromRow(row.id))
  const orderIds = pageRows.filter((row) => row.kind === "order").map((row) => numberFromRow(row.id))
  const docIds = pageRows.filter((row) => row.kind === "receipt" || row.kind === "writeoff" || row.kind === "inventory").map((row) => numberFromRow(row.id))
  const itemsByKey = new Map<string, OperationItem[]>()
  const pushItem = (key: string, item: OperationItem) => {
    itemsByKey.set(key, [...(itemsByKey.get(key) ?? []), item])
  }
  if (saleIds.length) {
    const rows = client
      .prepare(
        `SELECT i.sale_id as parentId, COALESCE(i.product_code, '') as productCode,
          COALESCE(p.name, i.product_code, '—') as productName, ${TOP_CATEGORY_SQL("p.category_path")} as category,
          i.qty, i.unit_price as unitPrice, i.total, '' as comment
         FROM sale_items i LEFT JOIN products p ON p.code = i.product_code
         WHERE i.sale_id IN (${saleIds.join(",")}) ORDER BY i.id`
      )
      .all() as Array<Record<string, unknown>>
    for (const row of rows) pushItem(`sale:${numberFromRow(row.parentId)}`, mapItem(row))
  }
  if (orderIds.length) {
    const rows = client
      .prepare(
        `SELECT i.order_id as parentId, COALESCE(i.product_code, '') as productCode,
          COALESCE(p.name, NULLIF(i.name, ''), i.product_code, '—') as productName, ${TOP_CATEGORY_SQL("p.category_path")} as category,
          i.qty, i.price as unitPrice, i.total, '' as comment
         FROM order_items i LEFT JOIN products p ON p.code = i.product_code
         WHERE i.order_id IN (${orderIds.join(",")}) ORDER BY i.id`
      )
      .all() as Array<Record<string, unknown>>
    for (const row of rows) pushItem(`order:${numberFromRow(row.parentId)}`, mapItem(row))
  }
  if (docIds.length) {
    const rows = client
      .prepare(
        `SELECT i.document_id as parentId, d.type as docType, COALESCE(i.product_code, '') as productCode,
          COALESCE(p.name, NULLIF(i.product_name, ''), i.product_code, '—') as productName, ${TOP_CATEGORY_SQL("p.category_path")} as category,
          CASE WHEN d.type = 'count' THEN COALESCE(i.counted_qty, i.expected_qty) - COALESCE(i.expected_qty, 0) ELSE i.qty END as qty,
          CASE WHEN d.type = 'stock_in' THEN i.unit_cost ELSE COALESCE(NULLIF(i.unit_cost, 0), p.cost_price, 0) END as unitPrice,
          CASE WHEN d.type = 'count'
            THEN (COALESCE(i.counted_qty, i.expected_qty) - COALESCE(i.expected_qty, 0)) * COALESCE(p.cost_price, 0)
            ELSE i.qty * CASE WHEN d.type = 'stock_in' THEN i.unit_cost ELSE COALESCE(NULLIF(i.unit_cost, 0), p.cost_price, 0) END
          END as total,
          COALESCE(i.comment, '') as comment
         FROM stock_document_items i
         JOIN stock_documents d ON d.id = i.document_id
         LEFT JOIN products p ON p.code = i.product_code
         WHERE i.document_id IN (${docIds.join(",")}) AND (d.type != 'count' OR i.counted_qty IS NOT NULL)
         ORDER BY i.id`
      )
      .all() as Array<Record<string, unknown>>
    for (const row of rows) {
      const docType = String(row.docType)
      const kind: OperationKind = docType === "stock_in" ? "receipt" : docType === "stock_out" ? "writeoff" : "inventory"
      pushItem(`${kind}:${numberFromRow(row.parentId)}`, mapItem(row))
    }
  }

  const rows: OperationRow[] = pageRows.map((row) => {
    const kind = String(row.kind) as OperationKind
    const id = numberFromRow(row.id)
    const number = String(row.number ?? "")
    const key = `${kind}:${id}`
    return {
      key,
      kind,
      id,
      number,
      label:
        kind === "sale"
          ? `Чек #${id}`
          : kind === "order"
            ? `Заказ №${number}`
            : kind === "receipt"
              ? `Приход ${number}`
              : kind === "writeoff"
                ? `Списание ${number}`
                : `Инвентаризация ${number}`,
      at: String(row.at ?? ""),
      title: String(row.title ?? ""),
      meta: String(row.meta ?? ""),
      userName: String(row.userName ?? ""),
      comment: String(row.comment ?? ""),
      amount: round2(numberFromRow(row.amount)),
      qty: round2(numberFromRow(row.qty)),
      itemsCount: numberFromRow(row.itemsCount),
      supplierId: row.supplierId === null || row.supplierId === undefined ? null : numberFromRow(row.supplierId),
      reversed: numberFromRow(row.reversed) === 1,
      href: kind === "sale" || kind === "order" ? null : kind === "inventory" ? `/stock/inventory/${id}` : `/stock/acts/${id}`,
      items: itemsByKey.get(key) ?? [],
    }
  })

  // Справочники для выпадающего фильтра.
  const categories = (
    client
      .prepare(`SELECT DISTINCT ${TOP_CATEGORY_SQL("category_path")} as category FROM products WHERE COALESCE(is_active, 1) = 1 ORDER BY category COLLATE NOCASE`)
      .all() as Array<{ category: string }>
  ).map((row) => String(row.category))
  const suppliers = (
    client.prepare("SELECT id, name FROM suppliers ORDER BY is_active DESC, name COLLATE NOCASE").all() as Array<{ id: number; name: string }>
  ).map((row) => ({ id: numberFromRow(row.id), name: String(row.name) }))
  const reasonRows = client
    .prepare(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(comment), ''), 'Без причины') as reason FROM stock_documents
       WHERE type = 'stock_out' AND status = 'posted' AND DATE(COALESCE(operation_at, created_at), '${TZ}') BETWEEN @from AND @to
       ORDER BY reason COLLATE NOCASE`
    )
    .all({ from: range.from, to: range.to }) as Array<{ reason: string }>
  const reasonSet = new Map<string, string>()
  for (const row of reasonRows) {
    const label = String(row.reason)
    const key = label.toLocaleLowerCase("ru")
    if (!reasonSet.has(key)) reasonSet.set(key, label)
  }
  const productName = product
    ? String((client.prepare("SELECT name FROM products WHERE code = ?").get(product) as { name: string } | undefined)?.name ?? product)
    : ""
  const supplierName = supplier ? (suppliers.find((row) => row.id === supplier)?.name ?? "") : ""

  return {
    range,
    filters: { type: effectiveType, category, product, productName, reason, supplier: supplier ? String(supplier) : "", supplierName, query },
    page,
    pageSize,
    total,
    rows,
    totals: [...totalsMap.values()].map((entry) => ({ ...entry, amount: round2(entry.amount), qty: round2(entry.qty) })),
    categories,
    suppliers,
    reasons: [...reasonSet.values()],
  }
}

function mapItem(row: Record<string, unknown>): OperationItem {
  return {
    productCode: String(row.productCode ?? ""),
    productName: String(row.productName ?? "—"),
    category: String(row.category ?? ""),
    qty: round2(numberFromRow(row.qty)),
    unitPrice: round2(numberFromRow(row.unitPrice)),
    total: round2(numberFromRow(row.total)),
    comment: String(row.comment ?? ""),
  }
}

function round2(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
