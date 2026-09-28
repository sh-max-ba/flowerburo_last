import type { UserRole } from "@/lib/db"

// Получатели клиента — кому он дарит цветы. Чистые типы и подписи без БД: их используют и
// сервер, и формы в браузере (карточка клиента, чат, окно заказа, важные даты).

export type CustomerRecipient = {
  id: number
  customerId: number
  name: string
  // Кем приходится клиенту: «жена», «мама», «коллега» (необязательно).
  relation: string
  phone: string
  address: string
  note: string
  createdByName: string | null
  createdByRole: UserRole | null
  lastUsedAt: string | null
  // Сколько заказов оформлено на этого получателя.
  ordersCount: number
}

export const RECIPIENT_RELATIONS = ["жена", "муж", "мама", "папа", "дочь", "сын", "подруга", "коллега"] as const

export const recipientNameMax = 60
export const recipientRelationMax = 30
export const recipientAddressMax = 200
export const recipientNoteMax = 200

// «Алия, жена» / «Алия».
export function recipientLabel(recipient: { name: string; relation?: string | null }) {
  const relation = (recipient.relation ?? "").trim()
  return relation ? `${recipient.name}, ${relation}` : recipient.name
}

// Одной строкой для истории правок клиента: «Алия, жена · +996… · ул. Киевская, 95».
export function describeRecipient(recipient: { name: string; relation: string; phone: string; address: string; note?: string }) {
  return [recipientLabel(recipient), recipient.phone, recipient.address, recipient.note ?? ""].filter(Boolean).join(" · ")
}
