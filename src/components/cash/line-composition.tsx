import { Badge } from "@/components/ui/badge"
import { number as formatQty } from "@/components/orders/order-shared"
import { formatMoney } from "@/lib/utils"

// Минимальный набор полей позиции для отображения состава — общий для продаж и заказов.
export type CompositionItem = {
  id: number
  name: string
  qty: number
  total: number
  bouquetGroupId: string
  bouquetName: string
}

// Состав продажи/заказа: одиночные позиции и сгруппированные букеты (имя × кол-во, сумма).
// Общий компонент для кассы (cash-page) и истории кассы (cash-ledger).
export function LineComposition({ items }: { items: CompositionItem[] }) {
  if (!items.length) {
    return <div className="px-3 py-2 text-sm text-muted-foreground">Нет позиций.</div>
  }

  const groups = groupCompositionItems(items)

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {groups.map((group) => {
        if (group.type === "bouquet") {
          const total = group.items.reduce((sum, item) => sum + item.total, 0)
          return (
            <div key={group.key} className="rounded-lg border border-zinc-200 bg-white p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-zinc-800">
                  <Badge variant="secondary">Букет</Badge>
                  <span className="truncate">{group.bouquetName || "Букет"}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-zinc-700">{formatMoney(total)}</span>
              </div>
              <div className="mt-1.5 grid gap-1 pl-1 text-xs text-muted-foreground">
                {group.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 tabular-nums">{formatQty(item.qty)} шт</span>
                  </div>
                ))}
              </div>
            </div>
          )
        }

        const item = group.item
        return (
          <div key={group.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-baseline gap-2 text-zinc-700">
              <span className="truncate">{item.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">× {formatQty(item.qty)}</span>
            </span>
            <span className="shrink-0 tabular-nums text-zinc-700">{formatMoney(item.total)}</span>
          </div>
        )
      })}
    </div>
  )
}

// Группировка позиций: компоненты одного букета сводятся под общий заголовок.
function groupCompositionItems(items: CompositionItem[]) {
  const groups: Array<
    | { type: "single"; key: string; item: CompositionItem }
    | { type: "bouquet"; key: string; bouquetName: string; items: CompositionItem[] }
  > = []
  const bouquetGroups = new Map<string, Extract<(typeof groups)[number], { type: "bouquet" }>>()

  for (const item of items) {
    if (!item.bouquetGroupId) {
      groups.push({ type: "single", key: `item-${item.id}`, item })
      continue
    }

    let group = bouquetGroups.get(item.bouquetGroupId)
    if (!group) {
      group = { type: "bouquet", key: item.bouquetGroupId, bouquetName: item.bouquetName, items: [] }
      bouquetGroups.set(item.bouquetGroupId, group)
      groups.push(group)
    }
    group.items.push(item)
  }

  return groups
}
