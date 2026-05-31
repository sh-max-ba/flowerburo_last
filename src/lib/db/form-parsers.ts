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

export function normalizeRole(value: FormDataEntryValue | string | null): UserRole {
  const role = String(value ?? "").trim()
  if (role === "owner" || role === "manager" || role === "florist") {
    return role
  }

  throw new Error("Выберите роль пользователя.")
}

export function formatOrderNumber(orderId: number, date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "")
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
  if (value !== "stock_in" && value !== "stock_out") {
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
