import { SHOP_TIME_ZONE } from "@/lib/datetime"
import type { OrderStatus, PaymentMethod, StockDocumentType, UserRole } from "./types"
import { paymentMethods } from "./types"

export function toNumber(value: FormDataEntryValue | string | number | null | undefined) {
  const raw = String(value ?? "").replace(",", ".").trim()
  const number = Number(raw)
  return Number.isFinite(number) ? number : 0
}

export function toOptionalNumber(value: FormDataEntryValue | string | number | null | undefined) {
  const raw = String(value ?? "").replace(",", ".").trim()
  if (!raw) {
    return null
  }

  const number = Number(raw)
  return Number.isFinite(number) ? number : null
}

export function clean(value: FormDataEntryValue | string | null | undefined) {
  return String(value ?? "").trim()
}

export function normalizeDeliveryType(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase()
  return normalized === "delivery" || normalized === "доставка" ? "delivery" : "pickup"
}

export function orderStatusSort(status: OrderStatus) {
  const order: Record<OrderStatus, number> = {
    "Черновик": -1,
    "Новый": 0,
    "В работе": 1,
    "Готов": 2,
    "Передан курьеру": 3,
    "Выдан": 4,
    "Отменен": 5,
  }

  return order[status]
}

export function parsePaymentMethod(value: FormDataEntryValue | string | null | undefined): PaymentMethod {
  const method = (typeof value === "string" ? value.trim() : "") || "cash"
  if (!paymentMethods.has(method as PaymentMethod)) {
    throw new Error("Некорректный способ оплаты.")
  }

  return method as PaymentMethod
}

export type PaymentPart = { method: PaymentMethod; amount: number }

// Разбор оплаты, возможно смешанной (до двух способов). target — полная сумма платёжного
// события (итог продажи / сумма доплаты / предоплата). Без поля paymentMethod2 — одна часть
// на весь target (прежнее поведение, формы старых сборок не ломаются). Со второй частью:
// обе суммы > 0, способы различны, сумма частей сходится с target до копейки.
export function parsePaymentParts(formData: FormData, target: number): PaymentPart[] {
  const method = parsePaymentMethod(formData.get("paymentMethod"))
  const method2Raw = typeof formData.get("paymentMethod2") === "string" ? String(formData.get("paymentMethod2")).trim() : ""
  if (!method2Raw) {
    return [{ method, amount: roundMoney(target) }]
  }

  const method2 = parsePaymentMethod(method2Raw)
  if (method2 === method) {
    throw new Error("В смешанной оплате способы должны различаться.")
  }
  const amount2 = roundMoney(toNumber(formData.get("paymentAmount2")))
  // Первая часть может не передаваться — тогда это «остальное» (target − вторая часть).
  const rawAmount1 = formData.get("paymentAmount1")
  const amount1 =
    rawAmount1 == null || String(rawAmount1).trim() === ""
      ? roundMoney(target - amount2)
      : roundMoney(toNumber(rawAmount1))
  if (amount1 <= 0 || amount2 <= 0) {
    throw new Error("Обе части смешанной оплаты должны быть больше нуля.")
  }
  if (Math.abs(amount1 + amount2 - target) > 0.009) {
    throw new Error(
      `Части смешанной оплаты (${amount1} + ${amount2}) не сходятся с суммой ${roundMoney(target)}.`
    )
  }
  return [
    { method, amount: amount1 },
    { method: method2, amount: amount2 },
  ]
}

export function normalizeRole(value: FormDataEntryValue | string | null): UserRole {
  const role = String(value ?? "").trim()
  if (role === "owner" || role === "manager" || role === "florist") {
    return role
  }

  throw new Error("Выберите роль пользователя.")
}

export function formatOrderNumber(orderId: number, date = new Date()) {
  // Дата в номере — день МАГАЗИНА (Бишкек): по UTC ночные заказы 00:00–06:00 получали вчерашнюю дату.
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("-", "")
  return `ORD-${day}-${String(orderId).padStart(4, "0")}`
}

export function generateOrderNumber(orderId: number, date = new Date()) {
  return formatOrderNumber(orderId, date)
}

export function parsePositiveInteger(value: FormDataEntryValue | string | null | undefined, fieldName: string) {
  const raw = String(value ?? "").trim()
  const number = Number(raw)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${fieldName} должно быть целым числом от 1.`)
  }

  return number
}

export function parseStockDocumentType(value: string): StockDocumentType {
  if (value !== "stock_in" && value !== "stock_out" && value !== "count") {
    throw new Error("Некорректный тип акта склада.")
  }

  return value
}

export function cleanCell(value: unknown) {
  return String(value ?? "").trim()
}

export function parseImportNumber(value: string) {
  if (!value.trim()) {
    return null
  }

  const normalized = value.replace(/\s/g, "").replace(",", ".")
  const number = Number(normalized)

  return Number.isFinite(number) ? number : null
}

export function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
