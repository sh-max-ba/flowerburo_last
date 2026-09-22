import { numberFromRow } from "@/lib/db-row"
import { SHOP_UTC_OFFSET_SQL } from "@/lib/datetime"
import { db } from "../connection"

// Документ продажи для раскрытия из аналитики и карточки товара: чек кассы (sales) или выданный
// заказ (orders) со всеми позициями. Только чтение.

export type SalesDocumentSource = "sale" | "order"

export type SalesDocumentItem = {
  id: number
  productCode: string
  productName: string
  qty: number
  unitPrice: number
  total: number
  bouquetName: string
}

export type SalesDocument = {
  source: SalesDocumentSource
  id: number
  label: string
  soldAt: string
  customer: string
  phone: string
  // Чек: способ оплаты; заказ: статус + тип доставки.
  paymentMethod: string
  status: string
  userName: string
  note: string
  itemsTotal: number
  discountTotal: number
  deliveryPrice: number
  total: number
  reversedAt: string | null
  items: SalesDocumentItem[]
}

export function getSalesDocument(source: SalesDocumentSource, id: number): SalesDocument | null {
  const client = db()
  if (!Number.isInteger(id) || id <= 0) {
    return null
  }

  if (source === "sale") {
    const row = client
      .prepare(
        `SELECT sales.id, sales.created_at as soldAt, COALESCE(sales.customer_name, '') as customer,
          COALESCE(sales.customer_phone, '') as phone, COALESCE(sales.payment_method, 'cash') as paymentMethod,
          COALESCE(users.name, '') as userName, COALESCE(sales.note, '') as note,
          COALESCE(NULLIF(sales.total_before_discount, 0), sales.total + COALESCE(sales.items_discount_total, 0) + COALESCE(sales.sale_discount_amount, 0)) as itemsTotal,
          COALESCE(sales.items_discount_total, 0) + COALESCE(sales.sale_discount_amount, 0) as discountTotal,
          sales.total, sales.reversed_at as reversedAt
         FROM sales LEFT JOIN users ON users.id = sales.user_id WHERE sales.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    if (!row) return null
    const items = client
      .prepare(
        `SELECT items.id, COALESCE(items.product_code, '') as productCode,
          COALESCE(products.name, items.product_code, '—') as productName,
          items.qty, items.unit_price as unitPrice, items.total, COALESCE(items.bouquet_name, '') as bouquetName
         FROM sale_items items LEFT JOIN products ON products.code = items.product_code
         WHERE items.sale_id = ? ORDER BY items.id`
      )
      .all(id) as Array<Record<string, unknown>>
    return {
      source: "sale",
      id,
      label: `Чек #${id}`,
      soldAt: String(row.soldAt ?? ""),
      customer: String(row.customer ?? ""),
      phone: String(row.phone ?? ""),
      paymentMethod: String(row.paymentMethod ?? "cash"),
      status: row.reversedAt ? "Сторнирован" : "Продан",
      userName: String(row.userName ?? ""),
      note: String(row.note ?? ""),
      itemsTotal: round2(numberFromRow(row.itemsTotal)),
      discountTotal: round2(numberFromRow(row.discountTotal)),
      deliveryPrice: 0,
      total: round2(numberFromRow(row.total)),
      reversedAt: row.reversedAt ? String(row.reversedAt) : null,
      items: items.map(mapItem),
    }
  }

  const row = client
    .prepare(
      `SELECT orders.id, COALESCE(NULLIF(orders.number, ''), orders.id) as number,
        COALESCE(orders.completed_at, orders.created_at) as soldAt, COALESCE(orders.customer, '') as customer,
        COALESCE(orders.phone, '') as phone, orders.status, COALESCE(orders.delivery_type, '') as deliveryType,
        COALESCE(users.name, '') as userName, COALESCE(orders.note, '') as note,
        COALESCE(NULLIF(orders.total_before_discount, 0), orders.total + COALESCE(orders.items_discount_total, 0) + COALESCE(orders.order_discount_amount, 0)) as itemsTotal,
        COALESCE(orders.items_discount_total, 0) + COALESCE(orders.order_discount_amount, 0) as discountTotal,
        COALESCE(orders.delivery_price, 0) as deliveryPrice, orders.total
       FROM orders LEFT JOIN users ON users.id = orders.created_by_user_id WHERE orders.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  const items = client
    .prepare(
      `SELECT items.id, COALESCE(items.product_code, '') as productCode,
        COALESCE(products.name, NULLIF(items.name, ''), items.product_code, '—') as productName,
        items.qty, items.price as unitPrice, items.total, COALESCE(items.bouquet_name, '') as bouquetName
       FROM order_items items LEFT JOIN products ON products.code = items.product_code
       WHERE items.order_id = ? ORDER BY items.id`
    )
    .all(id) as Array<Record<string, unknown>>
  return {
    source: "order",
    id,
    label: `Заказ №${String(row.number)}`,
    soldAt: String(row.soldAt ?? ""),
    customer: String(row.customer ?? ""),
    phone: String(row.phone ?? ""),
    paymentMethod: String(row.deliveryType ?? ""),
    status: String(row.status ?? ""),
    userName: String(row.userName ?? ""),
    note: String(row.note ?? ""),
    itemsTotal: round2(numberFromRow(row.itemsTotal)),
    discountTotal: round2(numberFromRow(row.discountTotal)),
    deliveryPrice: round2(numberFromRow(row.deliveryPrice)),
    total: round2(numberFromRow(row.total)),
    reversedAt: null,
    items: items.map(mapItem),
  }
}

// Продажи одного товара за период — строки чеков и выданных заказов с клиентом (карточка товара).
export type ProductSaleLine = {
  source: SalesDocumentSource
  sourceId: number
  label: string
  soldAt: string
  customer: string
  qty: number
  unitPrice: number
  total: number
  bouquetName: string
}

export function listProductSales(productCode: string, from: string, to: string, limit = 500): ProductSaleLine[] {
  const client = db()
  const rows = client
    .prepare(
      `SELECT * FROM (
        SELECT 'sale' as source, sales.id as sourceId, 'Чек #' || sales.id as label, sales.created_at as soldAt,
          COALESCE(sales.customer_name, '') as customer, items.qty, items.unit_price as unitPrice, items.total,
          COALESCE(items.bouquet_name, '') as bouquetName
        FROM sale_items items JOIN sales ON sales.id = items.sale_id
        WHERE items.product_code = @code AND sales.reversed_at IS NULL
         AND DATE(sales.created_at, '${SHOP_UTC_OFFSET_SQL}') BETWEEN @from AND @to
        UNION ALL
        SELECT 'order' as source, orders.id as sourceId, 'Заказ №' || COALESCE(NULLIF(orders.number, ''), orders.id) as label,
          orders.completed_at as soldAt, COALESCE(orders.customer, '') as customer, items.qty, items.price as unitPrice,
          items.total, COALESCE(items.bouquet_name, '') as bouquetName
        FROM order_items items JOIN orders ON orders.id = items.order_id
        WHERE items.product_code = @code AND orders.completed_at IS NOT NULL
         AND orders.status IN ('Выдан', 'Передан курьеру')
         AND DATE(orders.completed_at, '${SHOP_UTC_OFFSET_SQL}') BETWEEN @from AND @to
       )
       ORDER BY soldAt DESC, sourceId DESC
       LIMIT @limit`
    )
    .all({ code: productCode, from, to, limit }) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    source: String(row.source) as SalesDocumentSource,
    sourceId: numberFromRow(row.sourceId),
    label: String(row.label ?? ""),
    soldAt: String(row.soldAt ?? ""),
    customer: String(row.customer ?? ""),
    qty: round2(numberFromRow(row.qty)),
    unitPrice: round2(numberFromRow(row.unitPrice)),
    total: round2(numberFromRow(row.total)),
    bouquetName: String(row.bouquetName ?? ""),
  }))
}

function mapItem(row: Record<string, unknown>): SalesDocumentItem {
  return {
    id: numberFromRow(row.id),
    productCode: String(row.productCode ?? ""),
    productName: String(row.productName ?? "—"),
    qty: round2(numberFromRow(row.qty)),
    unitPrice: round2(numberFromRow(row.unitPrice)),
    total: round2(numberFromRow(row.total)),
    bouquetName: String(row.bouquetName ?? ""),
  }
}

function round2(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
