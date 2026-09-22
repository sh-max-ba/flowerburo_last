import type { ReactNode } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { SERIES_COLORS } from "./format"

export type BarListItem = {
  key: string
  label: string
  value: number
  // Подпись справа от значения (количество, доля) — приглушённая.
  meta?: string
  href?: string
}

type BarListProps = {
  items: BarListItem[]
  formatValue: (value: number) => string
  color?: string
  // Доля считается от максимума (длина = сравнение) или от суммы (длина = доля целого).
  scale?: "max" | "total"
  showShare?: boolean
  empty?: ReactNode
  className?: string
}

// Горизонтальные полоски-рейтинг: подпись, значение и тонкая полоса длиной по доле. Один цвет
// на все строки — категории без порядка не красим градиентом. Заменяет круговую диаграмму:
// близкие значения по длине сравниваются точнее, чем по секторам.
export function BarList({ items, formatValue, color = SERIES_COLORS.revenue, scale = "max", showShare = true, empty, className }: BarListProps) {
  if (!items.length) {
    return <div className={cn("py-6 text-center text-sm text-muted-foreground", className)}>{empty ?? "За период данных нет"}</div>
  }
  const max = Math.max(...items.map((item) => item.value), 0)
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  const denominator = scale === "total" ? total : max

  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {items.map((item) => {
        const width = denominator > 0 ? (Math.max(0, item.value) / denominator) * 100 : 0
        const share = total > 0 ? (Math.max(0, item.value) / total) * 100 : 0
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={cn("min-w-0 truncate", item.href ? "text-foreground group-hover/bar:underline" : "text-foreground/90")}>
                {item.label}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                <span className="font-medium text-foreground">{formatValue(item.value)}</span>
                {showShare ? <span className="w-9 text-right text-xs text-muted-foreground">{share.toFixed(0)} %</span> : null}
                {item.meta ? <span className="hidden text-xs text-muted-foreground sm:inline">{item.meta}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
            </div>
          </>
        )
        return (
          <li key={item.key} className="group/bar min-w-0">
            {item.href ? (
              <Link href={item.href} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        )
      })}
    </ul>
  )
}

// Карточка-блок аналитики: заголовок мелким капсом, необязательная подпись/действие справа.
export function Panel({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-2xl bg-background p-4 shadow-xs", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</h2>
          {subtitle ? <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
