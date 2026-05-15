import ExcelJS from "exceljs"
import { requireRole } from "@/lib/auth"
import { getHistoryReportData, type Movement } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  await requireRole(["owner"])

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Flowerburo"
  workbook.created = new Date()
  const report = getHistoryReportData()

  appendWorksheet(workbook, "Операции", operationRows(report.operations))
  appendWorksheet(workbook, "Склад", stockRows(report.stockMovements))

  const buffer = await workbook.xlsx.writeBuffer()
  const body = toArrayBuffer(buffer)
  const fileName = `history-report-${new Date().toISOString().slice(0, 10)}.xlsx`

  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}

function appendWorksheet(
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

function toArrayBuffer(buffer: ExcelJS.Buffer) {
  const body = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(body).set(new Uint8Array(buffer))
  return body
}

function operationRows(movements: Movement[]) {
  return movements.map((movement) => ({
    Дата: formatDateTime(movement.createdAt),
    Тип: movementLabel(movement),
    Товар: movement.productName || movement.productCode || "",
    Количество: movement.qty,
    "Цена за ед.": movement.unitPrice,
    Сумма: movement.total,
    "Провёл": movement.userName || "не зафиксирован",
    Комментарий: movement.note || "",
  }))
}

function stockRows(movements: Movement[]) {
  return movements.filter((movement) => !["reserve", "reserve_cancel"].includes(movement.type)).map((movement) => ({
    Дата: formatDateTime(movement.createdAt),
    Тип: movementLabel(movement),
    Товар: movement.productName || movement.productCode || "",
    Количество: movement.qty,
    "Остаток до": movement.beforeStock,
    "Остаток после": movement.afterStock,
    Связь: movementSource(movement),
    "Провёл": movement.userName || "не зафиксирован",
    Комментарий: movement.note || "",
  }))
}

function movementLabel(movement: Movement) {
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
    sale: "Реализация",
    order_fulfill: "Реализация заказа",
    stock_update: "Склад",
    delete_product: "Удаление",
    shift_open: "Открытие смены",
    shift_close: "Закрытие смены",
    order_create: "Заказ",
    order_status: "Статус заказа",
  }

  return labels[movement.type] ?? movement.type
}

function movementSource(movement: Movement) {
  if (movement.saleId !== null) {
    return `Продажа #${movement.saleId}`
  }

  if (movement.orderId !== null) {
    return `Заказ #${movement.orderId}`
  }

  if (movement.shiftId !== null) {
    return `Смена #${movement.shiftId}`
  }

  return ""
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString("ru-RU")
}
