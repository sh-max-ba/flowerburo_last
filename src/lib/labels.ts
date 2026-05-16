import type { CashTransactionType, PaymentMethod } from "@/lib/db"

export const paymentMethodOptions: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "terminal", label: "Терминал" },
  { value: "mbank", label: "Mbank" },
  { value: "optima", label: "Optima" },
  { value: "elsom", label: "ЭлСом" },
  { value: "transfer", label: "Перевод" },
]

export function getPaymentMethodLabel(method: PaymentMethod | string) {
  const labels: Record<PaymentMethod, string> = {
    cash: "Наличные",
    card: "Карта",
    terminal: "Терминал",
    mbank: "Mbank",
    optima: "Optima",
    elsom: "ЭлСом",
    transfer: "Перевод",
  }

  return labels[method as PaymentMethod] ?? method
}

export const paymentMethodLabel = getPaymentMethodLabel

export function cashTransactionTypeLabel(type: CashTransactionType | string) {
  const labels: Record<CashTransactionType, string> = {
    sale: "Продажа",
    prepayment: "Предоплата",
    order_payment: "Доплата по заказу",
    deal_payment: "Оплата по сделке",
    cash_in: "Внесение",
    cash_out: "Изъятие / выплата",
    cash_refund: "Возврат",
  }

  return labels[type as CashTransactionType] ?? type
}

export function deliveryTypeLabel(type: string) {
  return type === "delivery" ? "Доставка" : "Самовывоз"
}

export const sourceOptions = [
  { value: "manual", label: "Ручная" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
  { value: "site", label: "Сайт" },
  { value: "phone", label: "Телефон" },
] as const

export function sourceLabel(value: string) {
  return sourceOptions.find((option) => option.value === value)?.label ?? (value || "-")
}

export function wazzupChatTypeLabel(value: string) {
  const labels: Record<string, string> = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    telegram: "Telegram",
  }

  return labels[value] ?? (value || "-")
}

export function stockDocumentTypeLabel(value: string) {
  const labels: Record<string, string> = {
    stock_in: "Пополнение",
    stock_out: "Списание",
  }

  return labels[value] ?? value
}

export function stockDocumentStatusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "Черновик",
    posted: "Проведен",
    cancelled: "Отменен",
  }

  return labels[value] ?? value
}

export function discountTypeLabel(value: string) {
  const labels: Record<string, string> = {
    none: "Без скидки",
    percent: "%",
    amount: "Сумма",
  }

  return labels[value] ?? value
}
