import { numberFromRow } from "@/lib/db-row"
import type { OrderStatus, OwnerDashboardData, OwnerDashboardRange } from "../types"
import { db } from "../connection"
import { getShiftDetails } from "./shifts"

type DbClient = ReturnType<typeof db>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type OwnerDashboardRangeInput = {
  preset?: string
  from?: string
  to?: string
}

// Разрешаем выбранный период в конкретные локальные даты [from, to].
// Пресеты считаем в SQLite localtime, чтобы совпадать с остальными запросами.
function resolveRange(client: DbClient, opts?: OwnerDashboardRangeInput): OwnerDashboardRange {
  const dates = client
    .prepare(
      `SELECT DATE('now', 'localtime') as today,
        DATE('now', 'localtime', '-6 days') as d7,
        DATE('now', 'localtime', '-29 days') as d30,
        DATE('now', 'localtime', 'start of month') as monthStart`
    )
    .get() as { today: string; d7: string; d30: string; monthStart: string }

  const to = dates.today

  // Произвольный диапазон из URL — только валидные YYYY-MM-DD.
  if (opts?.from && opts?.to && ISO_DATE.test(opts.from) && ISO_DATE.test(opts.to)) {
    let from = opts.from
    let end = opts.to
    if (from > end) {
      ;[from, end] = [end, from]
    }
    if (end > to) {
      end = to // не заглядываем в будущее
    }
    if (from > end) {
      from = end
    }
    return { from, to: end, preset: "custom" }
  }

  const preset =
    opts?.preset === "7d" || opts?.preset === "30d" || opts?.preset === "month"
      ? opts.preset
      : "today"
  const from =
    preset === "7d"
      ? dates.d7
      : preset === "30d"
        ? dates.d30
        : preset === "month"
          ? dates.monthStart
          : to
  return { from, to, preset }
}

// Лёгкий обзор для дашборда управляющего (/dashboard).
// СОЗНАТЕЛЬНО НЕ зовём тяжёлый getDashboardData(). Здесь только маленькие
// агрегаты: открытая смена + getShiftDetails ТОЛЬКО для неё, и несколько
// COUNT/SUM с фильтром по выбранному периоду.
export function getOwnerDashboardData(opts?: OwnerDashboardRangeInput): OwnerDashboardData {
  const client = db()
  const range = resolveRange(client, opts)

  // Окно графика: минимум 7 дней (заканчивается на range.to), но не более 92.
  const bounds = client
    .prepare(`SELECT DATE(?, '-6 days') as week, DATE(?, '-91 days') as cap`)
    .get(range.to, range.to) as { week: string; cap: string }
  let chartFrom = range.from < bounds.week ? range.from : bounds.week
  if (chartFrom < bounds.cap) {
    chartFrom = bounds.cap
  }

  // (a) Смена — текущая открытая (не зависит от периода) ---------------------
  const openShiftRow = client
    .prepare(
      `SELECT id, opening_cash as openingCash, COALESCE(cashier_name, '') as cashierName,
        opened_at as openedAt, COALESCE(type, 'day') as type
       FROM shifts
       WHERE status = 'open'
       ORDER BY opened_at DESC
       LIMIT 1`
    )
    .get() as
    | { id: number; openingCash: number; cashierName: string; openedAt: string; type: string }
    | undefined

  const expectedCash = openShiftRow
    ? getShiftDetails(openShiftRow.id, client).summary.expectedCash
    : 0

  // Выручка и продажи за выбранный период --------------------------------------
  const periodSalesRow = client
    .prepare(
      `SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?`
    )
    .get(range.from, range.to) as { total: number; count: number }

  // Выручка признаётся по моменту ЗАВЕРШЕНИЯ заказа (кассовый принцип): продажи кассы (по дате
  // продажи) + ВСЕ деньги, полученные по заказам, завершённым в периоде (по дате завершения).
  const periodCompletedRow = client
    .prepare(
      `SELECT
        COALESCE((
          SELECT SUM(ct.amount) FROM cash_transactions ct
          JOIN orders o ON o.id = ct.order_id
          WHERE ct.type IN ('prepayment', 'order_payment', 'deal_payment')
           AND DATE(o.completed_at) BETWEEN ? AND ?
        ), 0) as received,
        (SELECT COUNT(*) FROM orders WHERE DATE(completed_at) BETWEEN ? AND ?) as count`
    )
    .get(range.from, range.to, range.from, range.to) as { received: number; count: number }

  // Разбивка выручки по методам оплаты за период (для donut) — продажи + полученное по
  // заказам, завершённым в периоде, сгруппированное по способу оплаты.
  const paymentRows = client
    .prepare(
      `SELECT method, COALESCE(SUM(total), 0) as total, COALESCE(SUM(cnt), 0) as count
       FROM (
         SELECT COALESCE(NULLIF(payment_method, ''), 'cash') as method, total, 1 as cnt
         FROM sales
         WHERE DATE(created_at) BETWEEN ? AND ?
         UNION ALL
         SELECT COALESCE(NULLIF(ct.payment_method, ''), 'cash') as method, ct.amount as total, 1 as cnt
         FROM cash_transactions ct
         JOIN orders o ON o.id = ct.order_id
         WHERE ct.type IN ('prepayment', 'order_payment', 'deal_payment')
          AND DATE(o.completed_at) BETWEEN ? AND ?
       )
       GROUP BY method
       ORDER BY total DESC`
    )
    .all(range.from, range.to, range.from, range.to) as Array<{
    method: string
    total: number
    count: number
  }>

  // Ряд выручки по дням окна графика (zero-filled через рекурсивный CTE), признание по завершению.
  const revenueSeriesRows = client
    .prepare(
      `WITH RECURSIVE days(d) AS (
        SELECT ?
        UNION ALL
        SELECT DATE(d, '+1 day') FROM days WHERE d < ?
       )
       SELECT days.d as day,
        COALESCE((SELECT SUM(total) FROM sales WHERE DATE(created_at) = days.d), 0)
        + COALESCE((
            SELECT SUM(ct.amount) FROM cash_transactions ct
            JOIN orders o ON o.id = ct.order_id
            WHERE ct.type IN ('prepayment', 'order_payment', 'deal_payment')
             AND DATE(o.completed_at) = days.d
          ), 0) as total,
        COALESCE((SELECT COUNT(*) FROM sales WHERE DATE(created_at) = days.d), 0)
        + COALESCE((SELECT COUNT(*) FROM orders WHERE DATE(completed_at) = days.d), 0) as count
       FROM days
       ORDER BY days.d ASC`
    )
    .all(chartFrom, range.to) as Array<{ day: string; total: number; count: number }>

  const windowOrdersRow = client
    .prepare(
      `SELECT COUNT(*) as count FROM orders WHERE DATE(completed_at) BETWEEN ? AND ?`
    )
    .get(chartFrom, range.to) as { count: number }

  // (b) Склад — текущее состояние --------------------------------------------
  const stockRow = client
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN (stock - reserved) > 0 AND (stock - reserved) <= 3 THEN 1 ELSE 0 END), 0) as lowStockCount,
        COALESCE(SUM(CASE WHEN (stock - reserved) < 0 THEN 1 ELSE 0 END), 0) as negativeStockCount
       FROM products
       WHERE COALESCE(is_active, 1) = 1`
    )
    .get() as { lowStockCount: number; negativeStockCount: number }

  // Короткий список проблемных позиций для мини-таблицы. Те же условия, что и
  // в агрегатах выше; «в минусе» (самые отрицательные) идут первыми.
  const stockItemRows = client
    .prepare(
      `SELECT name, (stock - reserved) as available
       FROM products
       WHERE COALESCE(is_active, 1) = 1
        AND ((stock - reserved) < 0
          OR ((stock - reserved) > 0 AND (stock - reserved) <= 3))
       ORDER BY
        CASE WHEN (stock - reserved) < 0 THEN 0 ELSE 1 END,
        (stock - reserved) ASC,
        name COLLATE NOCASE
       LIMIT 7`
    )
    .all() as Array<{ name: string; available: number }>

  // (c) Сделки и заказы — что горит (текущее) --------------------------------
  const incomingDealsRow = client
    .prepare(
      `WITH default_pipeline AS (
        SELECT id
        FROM deal_pipelines
        ORDER BY is_default DESC, id ASC
        LIMIT 1
       ),
       first_stage AS (
        SELECT deal_stages.id
        FROM deal_stages
        WHERE deal_stages.pipeline_id = (SELECT id FROM default_pipeline)
        ORDER BY deal_stages.position ASC, deal_stages.id ASC
        LIMIT 1
       )
       SELECT COUNT(*) as count
       FROM deals
       LEFT JOIN deal_stages ON deal_stages.id = deals.stage_id
       WHERE deals.source = 'whatsapp'
        AND deals.status = 'open'
        AND deals.order_id IS NULL
        AND COALESCE(deal_stages.is_closed, 0) != 1
        AND COALESCE(deal_stages.is_won, 0) != 1
        AND (
          deals.stage_id = (SELECT id FROM first_stage)
          OR LOWER(COALESCE(deal_stages.name, '')) = 'новая'
        )`
    )
    .get() as { count: number } | undefined

  const readyOrdersRow = client
    .prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'Готов'")
    .get() as { count: number } | undefined

  const overdueOrdersRow = client
    .prepare(
      `SELECT COUNT(*) as count
       FROM orders
       WHERE status NOT IN ('Черновик', 'Выдан', 'Отменен', 'Передан курьеру')
        AND COALESCE(due_at, '') != ''
        AND due_at < strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')`
    )
    .get() as { count: number } | undefined

  // Активные заказы для таблицы внизу дашборда. Тот же набор, что стоит за
  // счётчиками (не выдан/не отменён/не передан курьеру — «Передан курьеру»
  // завершающий); сортировка по сроку — просрочка наверх.
  const activeOrdersRow = client
    .prepare("SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('Черновик', 'Выдан', 'Отменен', 'Передан курьеру')")
    .get() as { count: number } | undefined

  const orderListRows = client
    .prepare(
      `SELECT id, number, COALESCE(customer, '') as customer, due_at as dueAt, status,
        COALESCE(total, 0) as total
       FROM orders
       WHERE status NOT IN ('Черновик', 'Выдан', 'Отменен', 'Передан курьеру')
       ORDER BY
        CASE WHEN COALESCE(due_at, '') = '' THEN 1 ELSE 0 END,
        due_at ASC,
        created_at DESC
       LIMIT 10`
    )
    .all() as Array<{
    id: number
    number: string | null
    customer: string
    dueAt: string | null
    status: string
    total: number
  }>

  // (d) Долги клиентов (текущее) ---------------------------------------------
  const debtTotalsRow = client
    .prepare(
      `SELECT
        COALESCE(SUM(total - COALESCE(paid, 0)), 0) as totalOutstanding,
        COUNT(*) as debtorOrdersCount
       FROM orders
       WHERE status NOT IN ('Черновик', 'Выдан', 'Отменен', 'Передан курьеру')
        AND (total - COALESCE(paid, 0)) > 0`
    )
    .get() as { totalOutstanding: number; debtorOrdersCount: number }

  const topDebtorRows = client
    .prepare(
      `SELECT
        orders.customer_id as customerId,
        CASE WHEN TRIM(COALESCE(orders.customer, '')) = '' THEN 'Без имени' ELSE orders.customer END as customerName,
        COALESCE(SUM(orders.total - COALESCE(orders.paid, 0)), 0) as amount,
        COUNT(*) as ordersCount
       FROM orders
       WHERE orders.status NOT IN ('Черновик', 'Выдан', 'Отменен', 'Передан курьеру')
        AND (orders.total - COALESCE(orders.paid, 0)) > 0
       GROUP BY orders.customer_id, customerName
       ORDER BY amount DESC
       LIMIT 5`
    )
    .all() as Array<{
    customerId: number | null
    customerName: string
    amount: number
    ordersCount: number
  }>

  // (e) Показатели менеджеров — продажи за выбранный период --------------------
  const managerRows = client
    .prepare(
      `SELECT u.id as id, u.name as name, u.role as role,
        COALESCE(d.openDeals, 0) as openDeals,
        COALESCE(s.salesCount, 0) + COALESCE(co.ordersCount, 0) as salesCount,
        COALESCE(s.salesTotal, 0) + COALESCE(co.ordersTotal, 0) as salesTotal
       FROM users u
       LEFT JOIN (
         SELECT responsible_user_id as uid, COUNT(*) as openDeals
         FROM deals
         WHERE status = 'open' AND responsible_user_id IS NOT NULL
         GROUP BY responsible_user_id
       ) d ON d.uid = u.id
       LEFT JOIN (
         SELECT user_id as uid, COUNT(*) as salesCount, COALESCE(SUM(total), 0) as salesTotal
         FROM sales
         WHERE DATE(created_at) BETWEEN ? AND ? AND user_id IS NOT NULL
         GROUP BY user_id
       ) s ON s.uid = u.id
       LEFT JOIN (
         SELECT o.created_by_user_id as uid, COUNT(DISTINCT o.id) as ordersCount,
           COALESCE(SUM(ct.amount), 0) as ordersTotal
         FROM orders o
         JOIN cash_transactions ct ON ct.order_id = o.id
         WHERE ct.type IN ('prepayment', 'order_payment', 'deal_payment')
          AND DATE(o.completed_at) BETWEEN ? AND ? AND o.created_by_user_id IS NOT NULL
         GROUP BY o.created_by_user_id
       ) co ON co.uid = u.id
       WHERE COALESCE(u.is_active, 1) = 1 AND u.role IN ('owner', 'manager')
       ORDER BY salesTotal DESC, openDeals DESC, u.name COLLATE NOCASE`
    )
    .all(range.from, range.to, range.from, range.to) as Array<{
    id: number
    name: string
    role: string
    openDeals: number
    salesCount: number
    salesTotal: number
  }>

  const revenueSeries = revenueSeriesRows.map((row) => ({
    day: String(row.day),
    total: numberFromRow(row.total),
    count: numberFromRow(row.count),
  }))

  return {
    range,
    shift: {
      isOpen: Boolean(openShiftRow),
      openingCash: openShiftRow ? numberFromRow(openShiftRow.openingCash) : 0,
      cashierName: openShiftRow?.cashierName ?? "",
      openedAt: openShiftRow?.openedAt ?? null,
      type: openShiftRow?.type === "night" ? "night" : "day",
      expectedCash: numberFromRow(expectedCash),
    },
    period: {
      salesTotal: numberFromRow(periodSalesRow.total) + numberFromRow(periodCompletedRow.received),
      salesCount: numberFromRow(periodSalesRow.count),
      ordersCount: numberFromRow(periodCompletedRow.count),
    },
    revenueSeries,
    revenueWindow: {
      total: revenueSeries.reduce((sum, p) => sum + p.total, 0),
      salesCount: revenueSeries.reduce((sum, p) => sum + p.count, 0),
      ordersCount: numberFromRow(windowOrdersRow.count),
      days: revenueSeries.length,
    },
    paymentBreakdown: paymentRows.map((row) => ({
      method: String(row.method ?? "cash"),
      total: numberFromRow(row.total),
      count: numberFromRow(row.count),
    })),
    stock: {
      lowStockCount: numberFromRow(stockRow.lowStockCount),
      negativeStockCount: numberFromRow(stockRow.negativeStockCount),
      items: stockItemRows.map((row) => {
        const available = numberFromRow(row.available)
        return {
          name: String(row.name ?? ""),
          available,
          status: (available < 0 ? "negative" : "low") as "negative" | "low",
        }
      }),
    },
    work: {
      incomingDealsCount: numberFromRow(incomingDealsRow?.count ?? 0),
      readyOrdersCount: numberFromRow(readyOrdersRow?.count ?? 0),
      overdueOrdersCount: numberFromRow(overdueOrdersRow?.count ?? 0),
      activeOrdersCount: numberFromRow(activeOrdersRow?.count ?? 0),
      orders: orderListRows.map((row) => ({
        id: numberFromRow(row.id),
        number: row.number === null || row.number === undefined ? null : String(row.number),
        customer: String(row.customer ?? ""),
        dueAt: row.dueAt ? String(row.dueAt) : null,
        status: String(row.status ?? "") as OrderStatus,
        total: numberFromRow(row.total),
      })),
    },
    debts: {
      totalOutstanding: numberFromRow(debtTotalsRow.totalOutstanding),
      debtorOrdersCount: numberFromRow(debtTotalsRow.debtorOrdersCount),
      topDebtors: topDebtorRows.map((row) => ({
        customerId:
          row.customerId === null || row.customerId === undefined
            ? null
            : numberFromRow(row.customerId),
        customerName: String(row.customerName ?? "Без имени"),
        amount: numberFromRow(row.amount),
        ordersCount: numberFromRow(row.ordersCount),
      })),
    },
    managers: managerRows.map((row) => ({
      id: numberFromRow(row.id),
      name: String(row.name ?? ""),
      role: String(row.role ?? ""),
      openDeals: numberFromRow(row.openDeals),
      salesCount: numberFromRow(row.salesCount),
      salesTotal: numberFromRow(row.salesTotal),
    })),
  }
}
