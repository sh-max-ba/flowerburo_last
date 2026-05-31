import { numberFromRow } from "@/lib/db-row"
import type { OwnerDashboardData } from "../types"
import { db } from "../connection"
import { getShiftDetails } from "./shifts"

// Лёгкий обзор для дашборда управляющего (/dashboard).
// СОЗНАТЕЛЬНО НЕ зовём тяжёлый getDashboardData() — тот грузит 234 товара,
// 30 продаж, 20 смен с детализацией и т.д. Здесь только маленькие агрегаты:
// открытая смена + getShiftDetails ТОЛЬКО для неё, и несколько COUNT/SUM.
export function getOwnerDashboardData(): OwnerDashboardData {
  const client = db()

  // (a) Смена и выручка за сегодня ------------------------------------------
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

  // Ожидаемую наличность считаем через getShiftDetails ТОЛЬКО для открытой смены
  // (единственный «тяжёлый» вызов, и то по одной смене).
  const expectedCash = openShiftRow ? getShiftDetails(openShiftRow.id, client).summary.expectedCash : 0

  const todaySalesRow = client
    .prepare(
      `SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
       FROM sales
       WHERE DATE(created_at) = DATE('now', 'localtime')`
    )
    .get() as { total: number; count: number }

  // (b) Склад — требует дозаказа --------------------------------------------
  // available = stock - reserved (как в dashboard.ts).
  const stockRow = client
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN (stock - reserved) > 0 AND (stock - reserved) <= 3 THEN 1 ELSE 0 END), 0) as lowStockCount,
        COALESCE(SUM(CASE WHEN (stock - reserved) < 0 THEN 1 ELSE 0 END), 0) as negativeStockCount
       FROM products`
    )
    .get() as { lowStockCount: number; negativeStockCount: number }

  // (c) Сделки и заказы — что горит ------------------------------------------
  // Входящие сделки: повторяем логику /api/deals/incoming-count.
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

  // Просроченные заказы: срок (due_at) уже прошёл, заказ ещё активен.
  // due_at хранится как локальная строка datetime-local (YYYY-MM-DDTHH:MM),
  // поэтому сравниваем с локальным «сейчас» в том же формате; пустые '' игнорируем.
  const overdueOrdersRow = client
    .prepare(
      `SELECT COUNT(*) as count
       FROM orders
       WHERE status NOT IN ('Выдан', 'Отменен')
        AND COALESCE(due_at, '') != ''
        AND due_at < strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')`
    )
    .get() as { count: number } | undefined

  // (d) Долги клиентов -------------------------------------------------------
  // Остаток к оплате = total - paid по активным заказам, где остаток > 0.
  const debtTotalsRow = client
    .prepare(
      `SELECT
        COALESCE(SUM(total - COALESCE(paid, 0)), 0) as totalOutstanding,
        COUNT(*) as debtorOrdersCount
       FROM orders
       WHERE status NOT IN ('Выдан', 'Отменен')
        AND (total - COALESCE(paid, 0)) > 0`
    )
    .get() as { totalOutstanding: number; debtorOrdersCount: number }

  // Топ должников: группируем по клиенту (по имени; нормализуем пустое имя),
  // суммируем остаток. Берём 5 крупнейших.
  const topDebtorRows = client
    .prepare(
      `SELECT
        orders.customer_id as customerId,
        CASE WHEN TRIM(COALESCE(orders.customer, '')) = '' THEN 'Без имени' ELSE orders.customer END as customerName,
        COALESCE(SUM(orders.total - COALESCE(orders.paid, 0)), 0) as amount,
        COUNT(*) as ordersCount
       FROM orders
       WHERE orders.status NOT IN ('Выдан', 'Отменен')
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

  // (e) Показатели менеджеров ------------------------------------------------
  // По каждому активному owner/manager: активные сделки (ответственный) и
  // продажи за сегодня (кол-во + сумма). Лёгкие сгруппированные подзапросы.
  const managerRows = client
    .prepare(
      `SELECT u.id as id, u.name as name, u.role as role,
        COALESCE(d.openDeals, 0) as openDeals,
        COALESCE(s.salesCount, 0) as salesCount,
        COALESCE(s.salesTotal, 0) as salesTotal
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
         WHERE DATE(created_at) = DATE('now', 'localtime') AND user_id IS NOT NULL
         GROUP BY user_id
       ) s ON s.uid = u.id
       WHERE COALESCE(u.is_active, 1) = 1 AND u.role IN ('owner', 'manager')
       ORDER BY salesTotal DESC, openDeals DESC, u.name COLLATE NOCASE`
    )
    .all() as Array<{
    id: number
    name: string
    role: string
    openDeals: number
    salesCount: number
    salesTotal: number
  }>

  return {
    shift: {
      isOpen: Boolean(openShiftRow),
      openingCash: openShiftRow ? numberFromRow(openShiftRow.openingCash) : 0,
      cashierName: openShiftRow?.cashierName ?? "",
      openedAt: openShiftRow?.openedAt ?? null,
      type: openShiftRow?.type === "night" ? "night" : "day",
      expectedCash: numberFromRow(expectedCash),
    },
    today: {
      salesTotal: numberFromRow(todaySalesRow.total),
      salesCount: numberFromRow(todaySalesRow.count),
    },
    stock: {
      lowStockCount: numberFromRow(stockRow.lowStockCount),
      negativeStockCount: numberFromRow(stockRow.negativeStockCount),
    },
    work: {
      incomingDealsCount: numberFromRow(incomingDealsRow?.count ?? 0),
      readyOrdersCount: numberFromRow(readyOrdersRow?.count ?? 0),
      overdueOrdersCount: numberFromRow(overdueOrdersRow?.count ?? 0),
    },
    debts: {
      totalOutstanding: numberFromRow(debtTotalsRow.totalOutstanding),
      debtorOrdersCount: numberFromRow(debtTotalsRow.debtorOrdersCount),
      topDebtors: topDebtorRows.map((row) => ({
        customerId: row.customerId === null || row.customerId === undefined ? null : numberFromRow(row.customerId),
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
