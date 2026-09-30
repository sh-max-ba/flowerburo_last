// Человеческие номера и названия заказов. В базе номер остаётся прежним (ORD-20260927-0583:
// дата создания + порядковый номер) — по нему ищут и ссылаются старые сообщения, — а на экранах
// и в сообщениях клиенту показываем «№583» и название по составу: «Нежность», «Роза 80 см + ещё 2».

type NumberedOrder = { id: number; number: string | null }

type TitledOrder = {
  items: Array<{
    name: string
    qty: number
    price?: number
    total?: number
    bouquetName?: string | null
    bouquetGroupId?: string | null
  }>
}

// «№583» (порядковый номер без даты и нулей); чужой формат — как есть; без номера — «№<id>».
export function orderNumberLabel(order: NumberedOrder) {
  const raw = (order.number ?? "").trim()
  const match = /^ORD-\d{8}-0*(\d+)$/.exec(raw)
  if (match) {
    return `№${match[1]}`
  }
  return raw || `№${order.id}`
}

// Название по составу: букеты — их названия, иначе главная позиция (самая дорогая — розы, а не
// упаковка); остальное — «+ ещё N».
export function orderTitle(order: TitledOrder) {
  const bouquets: string[] = []
  const seenGroups = new Set<string>()
  const looseItems: TitledOrder["items"] = []
  for (const item of order.items) {
    if (item.bouquetGroupId) {
      if (!seenGroups.has(item.bouquetGroupId)) {
        seenGroups.add(item.bouquetGroupId)
        bouquets.push((item.bouquetName ?? "").trim() || "Букет")
      }
      continue
    }
    looseItems.push(item)
  }
  const worth = (item: TitledOrder["items"][number]) => item.total ?? (item.price ?? 0) * item.qty
  const loose = looseItems
    .map((item, index) => ({ item, index }))
    .sort((a, b) => worth(b.item) - worth(a.item) || a.index - b.index)
    .map(({ item }) => item.name)
  const parts = bouquets.length ? bouquets : loose
  const rest = bouquets.length ? loose.length : 0
  if (!parts.length) {
    return "Без состава"
  }
  const shown = parts.slice(0, bouquets.length ? 2 : 1)
  const more = parts.length - shown.length + rest
  return more > 0 ? `${shown.join(", ")} + ещё ${more}` : shown.join(", ")
}

// «№583 · Нежность» — одной строкой для списков и подписей.
export function orderHeading(order: NumberedOrder & TitledOrder) {
  return `${orderNumberLabel(order)} · ${orderTitle(order)}`
}

// Поиск: «583», «№583» и старый «ORD-…» находят один и тот же заказ.
export function orderSearchTokens(order: NumberedOrder) {
  const label = orderNumberLabel(order)
  return [order.number ?? "", label, label.replace(/^№/, "")].filter(Boolean)
}
