import type { Order, OrderItem } from "@/lib/db"
import { formatDeadline } from "@/lib/datetime"
import { orderNumberLabel } from "@/lib/order-labels"

// Текст заказа для отправки клиенту в мессенджер. Разметка WhatsApp/Telegram: *жирный*,
// _курсив_ (references/messages.md). Букеты группируются с составом под ними. Чистая функция —
// используется и на сервере (отправка), и в клиенте (предпросмотр).

function money(amount: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0)} сом`
}

function qty(value: number) {
  return Number.isInteger(value) ? String(value) : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function lineFor(item: OrderItem, indent = "") {
  const discount = item.discountAmount > 0.009 ? ` _(скидка ${money(item.discountAmount)})_` : ""
  return `${indent}• ${item.name} — ${qty(item.qty)} × ${money(item.price)} = ${money(item.total)}${discount}`
}

export function formatOrderForChat(order: Order): string {
  const lines: string[] = []
  lines.push(`*Заказ ${orderNumberLabel(order)}*`)
  if (order.dueAt) {
    lines.push(`Когда: ${formatDeadline(order.dueAt, { longMonth: true })}`)
  }
  lines.push(order.deliveryType === "delivery" ? `Доставка: ${order.address || "адрес уточним"}` : "Самовывоз из магазина")
  if (order.recipientName || order.recipientPhone) {
    lines.push(`Получатель: ${[order.recipientName, order.recipientPhone].filter(Boolean).join(", ")}`)
  }

  lines.push("")
  lines.push("*Состав:*")
  const bouquets = new Map<string, OrderItem[]>()
  for (const item of order.items) {
    if (!item.bouquetGroupId) {
      lines.push(lineFor(item))
      continue
    }
    const group = bouquets.get(item.bouquetGroupId) ?? []
    group.push(item)
    bouquets.set(item.bouquetGroupId, group)
  }
  for (const group of bouquets.values()) {
    const total = group.reduce((sum, item) => sum + item.total, 0)
    lines.push(`• Букет «${group[0]?.bouquetName || "Без названия"}» — ${money(total)}`)
    for (const item of group) {
      lines.push(`   ${item.name} × ${qty(item.qty)}`)
    }
  }
  if (!order.items.length) {
    lines.push("• состав уточняется")
  }

  lines.push("")
  const discount = order.itemsDiscountTotal + order.orderDiscountAmount
  if (discount > 0.009) {
    lines.push(`Скидка: −${money(discount)}`)
  }
  if (order.deliveryType === "delivery" && order.deliveryPrice > 0.009) {
    lines.push(`Доставка: ${money(order.deliveryPrice)}`)
  }
  lines.push(`*Итого: ${money(order.total)}*`)
  if (order.paid > 0.009) {
    lines.push(`Оплачено: ${money(order.paid)}`)
    const balance = order.total - order.paid
    lines.push(balance > 0.009 ? `Остаток к оплате: ${money(balance)}` : "Оплачено полностью ✅")
  } else if (order.total > 0.009) {
    lines.push(`К оплате: ${money(order.total)}`)
  }
  if (order.note) {
    lines.push("")
    lines.push(`Комментарий: ${order.note}`)
  }
  return lines.join("\n")
}
