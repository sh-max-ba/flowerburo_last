import type { OwnerDashboardData } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"

// Мягкие тинты для аватаров — все приглушённые, из спокойной палитры (без светофора).
const AVATAR_TINTS = [
  "bg-blue-50 text-blue-700",
  "bg-slate-100 text-slate-600",
  "bg-sky-50 text-sky-700",
  "bg-indigo-50 text-indigo-700",
  "bg-zinc-100 text-zinc-600",
]

function tintFor(name: string): string {
  let hash = 0
  for (const char of name) {
    hash = (hash + char.charCodeAt(0)) % AVATAR_TINTS.length
  }
  return AVATAR_TINTS[hash]
}

function initialOf(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed[0].toUpperCase() : "?"
}

/**
 * Таблица показателей менеджеров: аватар-кружок с инициалом (мягкий тинт),
 * подсветка строки лидера, суммы с разделителем разрядов, бледные нули,
 * мягкая подсветка строки при наведении.
 */
export function ManagersTable({
  managers,
}: {
  managers: OwnerDashboardData["managers"]
}) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-2 pb-2 font-medium">Менеджер</th>
            <th className="px-2 pb-2 text-right font-medium">Активные сделки</th>
            <th className="px-2 pb-2 text-right font-medium">Продаж сегодня</th>
            <th className="px-2 pb-2 text-right font-medium">Сумма за сегодня</th>
          </tr>
        </thead>
        <tbody>
          {managers.map((manager, index) => {
            const isLeader = index === 0 && manager.salesTotal > 0
            const name = manager.name || "Без имени"
            return (
              <tr
                key={manager.id}
                className={cn(
                  "border-t border-zinc-100 transition-colors hover:bg-zinc-50/70",
                  isLeader && "bg-brand-subtle/50"
                )}
              >
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        tintFor(name)
                      )}
                    >
                      {initialOf(name)}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5 truncate font-medium text-zinc-900">
                        {name}
                        {isLeader ? (
                          <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-strong">
                            лидер
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {manager.role === "owner" ? "Управляющий" : "Менеджер"}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <Num value={manager.openDeals} />
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <Num value={manager.salesCount} />
                </td>
                <td className="px-2 py-2.5 text-right font-medium tabular-nums">
                  {manager.salesTotal > 0 ? (
                    <span className="text-zinc-900">{formatMoney(manager.salesTotal)}</span>
                  ) : (
                    <span className="text-zinc-300">0 сом</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Бледный ноль (не «тревога»), обычный цвет для значимых чисел.
function Num({ value }: { value: number }) {
  return <span className={value > 0 ? "text-zinc-900" : "text-zinc-300"}>{value}</span>
}
