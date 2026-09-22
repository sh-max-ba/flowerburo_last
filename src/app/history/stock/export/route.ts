import ExcelJS from "exceljs"
import { requireRole } from "@/lib/auth"
import {
  getSalesReport,
  listStockMovements,
  summarizeStockMovements,
  summarizeStockMovementsByProduct,
  NO_CATEGORY_FILTER,
  type StockHistoryMovement,
  type StockMovementFilters,
} from "@/lib/db"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"

export const dynamic = "force-dynamic"

// Потолок листа «Движения» журнальной выгрузки: защита от бесконечного файла; при превышении
// лист помечается. Сводные листы считаются SQL-агрегатами по всей выборке без лимита.
const EXPORT_MOVEMENTS_LIMIT = 50_000

export async function GET(request: Request) {
  await requireRole(["owner"])

  const url = new URL(request.url)
  const view = url.searchParams.get("view") === "moves" ? "moves" : "sales"
  const dateFrom = url.searchParams.get("dateFrom") ?? ""
  const dateTo = url.searchParams.get("dateTo") ?? ""
  const category = url.searchParams.get("category") ?? "all"
  const query = url.searchParams.get("query") ?? ""

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "FlowerBuro | sellz"
  workbook.created = new Date()

  if (view === "sales") {
    buildSalesWorkbook(workbook, { dateFrom, dateTo, category, query })
  } else {
    buildMovementsWorkbook(workbook, {
      dateFrom,
      dateTo,
      category,
      query,
      direction: url.searchParams.get("direction") ?? "all",
      type: url.searchParams.get("type") ?? "all",
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const body = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(body).set(new Uint8Array(buffer))
  const prefix = view === "sales" ? "sales-report" : "stock-journal"
  const fileName = `${prefix}-${new Date().toISOString().slice(0, 10)}.xlsx`

  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}

// ── Отчёт «Продажи» — фактические чеки кассы и выданные заказы ───────────────

function buildSalesWorkbook(
  workbook: ExcelJS.Workbook,
  filters: { dateFrom: string; dateTo: string; category: string; query: string }
) {
  const report = getSalesReport(filters)

  appendKeyValueSheet(workbook, "Сводка", [
    ["Отчёт", "Продажи (чеки кассы + выданные заказы)"],
    ["Период", [filters.dateFrom || "…", filters.dateTo || "…"].join(" — ")],
    ["Категория", categoryLabel(filters.category)],
    ["Поиск", filters.query || "—"],
    ["", ""],
    ["Продано, шт", report.totals.qty],
    ["Выручка", report.totals.revenue],
    ["Себестоимость", report.totals.cost],
    ["Наценка", report.totals.margin],
    ["", ""],
    ["Чеков кассы", report.totals.salesCount],
    ["Выручка чеков", report.totals.salesRevenue],
    ["Выданных заказов", report.totals.ordersCount],
    ["Выручка заказов (без доставки)", report.totals.ordersRevenue],
    ["Возвратов за период", report.totals.refundedCount],
    ["Сумма возвратов (не входит в выручку)", report.totals.refundedAmount],
    ["", ""],
    [
      "Примечание",
      "Выручка — фактические суммы со всеми скидками, как в кассе. Себестоимость — по текущей себестоимости карточек товаров.",
    ],
  ])

  appendTableSheet(
    workbook,
    "По товарам",
    report.byProduct.map((row) => ({
      Товар: row.productName,
      Код: row.productCode || "—",
      Категория: row.category,
      "Кол-во": row.qty,
      Выручка: row.revenue,
      Себестоимость: row.cost,
      Наценка: row.margin,
    }))
  )

  appendTableSheet(
    workbook,
    "По категориям",
    report.byCategory.map((row) => ({
      Категория: row.category,
      "Кол-во": row.qty,
      Выручка: row.revenue,
      Себестоимость: row.cost,
      Наценка: row.margin,
    }))
  )

  appendTableSheet(
    workbook,
    "Строки продаж",
    report.lines.map((line) => ({
      Дата: formatDateTime(line.soldAt),
      Источник: line.sourceLabel,
      Товар: line.productName,
      Код: line.productCode || "—",
      Категория: line.categoryPath || "Без категории",
      "Кол-во": line.qty,
      Выручка: line.revenue,
      Себестоимость: line.cost,
    }))
  )
}

// ── Журнал движений склада ───────────────────────────────────────────────────

function buildMovementsWorkbook(workbook: ExcelJS.Workbook, filters: StockMovementFilters) {
  const summary = summarizeStockMovements(filters)
  const byProduct = summarizeStockMovementsByProduct(filters)
  const { movements, truncated } = listStockMovements(filters, EXPORT_MOVEMENTS_LIMIT)

  const typeLabels: Record<string, string> = {
    sale: "Реализация",
    order_fulfill: "Реализация заказа",
    stock_in: "Пополнение по акту",
    stock_out: "Списание по акту",
    adjustment: "Корректировка",
    import: "Импорт",
  }
  const directionLabels: Record<string, string> = { in: "Поступления", out: "Списания" }

  const rows: Array<[string, string | number]> = [
    ["Отчёт", "Журнал движений склада"],
    ["Период", [filters.dateFrom || "…", filters.dateTo || "…"].join(" — ")],
    ["Тип движения", typeLabels[filters.type ?? ""] ?? "Все типы"],
    ["Направление", directionLabels[filters.direction ?? ""] ?? "Все движения"],
    ["Категория", categoryLabel(filters.category ?? "all")],
    ["Поиск", filters.query || "—"],
    ["", ""],
    ["Движений в выборке", summary.movementsCount],
    ["Реализовано, шт", summary.soldQty],
    ["Поступило, шт", summary.inQty],
    ["Списания и корректировки, шт", summary.outQty],
    ["", ""],
  ]
  for (const row of summary.byType) {
    rows.push([
      `${typeLabels[row.type] ?? row.type}: движений`,
      `${row.count}${row.inQty > 0 ? ` · +${row.inQty} шт` : ""}${row.outQty > 0 ? ` · −${row.outQty} шт` : ""}`,
    ])
  }
  rows.push(["", ""])
  rows.push(["Примечание", "Суммы продаж смотрите в отчёте «Продажи» — он считает фактические чеки и заказы."])
  if (truncated) {
    rows.push(["Внимание", `Лист «Движения» усечён до ${EXPORT_MOVEMENTS_LIMIT} строк — сузьте период.`])
  }
  appendKeyValueSheet(workbook, "Сводка", rows)

  appendTableSheet(
    workbook,
    "По товарам",
    byProduct.map((row) => ({
      Товар: row.productName,
      Код: row.productCode,
      Категория: row.categoryPath || "Без категории",
      "Реализовано, шт": row.soldQty,
      "Поступило, шт": row.inQty,
      "Списания и корректировки, шт": row.outQty,
      Движений: row.movementsCount,
    }))
  )

  appendTableSheet(workbook, "Движения", movements.map(movementRow))
}

function movementRow(movement: StockHistoryMovement) {
  const qty = movement.qty ?? 0
  return {
    Дата: formatDateTime(movement.createdAt),
    Тип: movementLabel(movement),
    Товар: movement.productName || movement.productCode || "",
    Код: movement.productCode ?? "",
    Категория: movement.categoryPath || "Без категории",
    Количество: qty,
    "Остаток до": movement.beforeStock,
    "Остаток после": movement.afterStock,
    "Себестоимость за ед. (текущая)": movement.unitCost,
    "Сумма по себестоимости": movement.unitCost === null ? null : round2(Math.abs(qty) * movement.unitCost),
    Связь: movementSource(movement),
    "Провёл": movement.userName || "не зафиксирован",
    Комментарий: movement.note || "",
  }
}

// ── Общие помощники ──────────────────────────────────────────────────────────

function categoryLabel(category: string) {
  if (category === NO_CATEGORY_FILTER) {
    return "Без категории"
  }
  return category && category !== "all" ? category : "Все категории"
}

function appendKeyValueSheet(workbook: ExcelJS.Workbook, name: string, rows: Array<[string, string | number]>) {
  const worksheet = workbook.addWorksheet(name)
  worksheet.columns = [
    { header: "Показатель", key: "label", width: 44 },
    { header: "Значение", key: "value", width: 34 },
  ]
  worksheet.getRow(1).font = { bold: true }
  for (const [label, value] of rows) {
    worksheet.addRow({ label, value })
  }
}

function appendTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: Array<Record<string, string | number | null>>
) {
  const worksheet = workbook.addWorksheet(name)
  const keys = Object.keys(rows[0] ?? { Пусто: "" })

  worksheet.columns = keys.map((key) => ({
    header: key,
    key,
    width: Math.max(key.length + 4, 16),
  }))
  worksheet.addRows(rows.length ? rows : [{ Пусто: "Нет данных" }])
  worksheet.getRow(1).font = { bold: true }
  worksheet.views = [{ state: "frozen", ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: keys.length },
  }
}

function movementLabel(movement: StockHistoryMovement) {
  if (movement.type === "adjustment" && typeof movement.qty === "number") {
    if (movement.qty > 0) {
      return "Поступление"
    }
    if (movement.qty < 0) {
      return "Списание"
    }
    return "Корректировка"
  }

  const labels: Record<string, string> = {
    import: "Импорт",
    stock_in: "Пополнение по акту",
    stock_out: "Списание по акту",
    sale: "Реализация",
    order_fulfill: "Реализация заказа",
  }

  return labels[movement.type] ?? movement.type
}

function movementSource(movement: StockHistoryMovement) {
  if (movement.saleId !== null) {
    return `Продажа #${movement.saleId}`
  }
  if (movement.orderId !== null) {
    return `Заказ #${movement.orderId}`
  }
  if (movement.shiftId !== null) {
    return `Смена #${movement.shiftId}`
  }
  if (movement.documentId !== null) {
    return movement.documentNumber ? `Акт ${movement.documentNumber}` : `Акт #${movement.documentId}`
  }
  return ""
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function formatDateTime(value: string) {
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}
