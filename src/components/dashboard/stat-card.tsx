import type { ReactNode } from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { ArrowRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type StatCardTone = "default" | "warning" | "danger"

type StatCardProps = {
  /** Заголовок-надпись (мелкая, приглушённая, капсом). */
  title?: string
  icon?: LucideIcon
  /** Если задан — вся карточка кликабельна, при наведении появляется стрелка «→». */
  href?: string
  /** default — нейтральная; warning/danger дают мягкую (не кричащую) заливку для проблемных метрик. */
  tone?: StatCardTone
  className?: string
  /** Произвольный контент в правом верхнем углу (бейдж и т.п.). Игнорируется, если есть href. */
  headerRight?: ReactNode
  /** true (по умолчанию) — карточка тянется на высоту ячейки грида (h-full).
   *  false — высота по контенту (для рядов с items-start). */
  fill?: boolean
  /** Скрыть стрелку в шапке (когда есть явный нижний CTA вроде «Открыть склад →»). */
  hideArrow?: boolean
  children: ReactNode
}

const TONE: Record<StatCardTone, { border: string; bg: string }> = {
  default: { border: "border-zinc-200/80", bg: "bg-card" },
  warning: { border: "border-amber-200/70", bg: "bg-amber-50/30" },
  danger: { border: "border-red-200/70", bg: "bg-red-50/30" },
}

/**
 * Базовый «дорогой» блок дашборда: тонкий бордер, унифицированное скругление,
 * мягкая тень. При наличии href — мягкий hover (подъём + усиление тени) и
 * стрелка, проявляющаяся только при наведении.
 */
export function StatCard({
  title,
  icon: Icon,
  href,
  tone = "default",
  className,
  headerRight,
  fill = true,
  hideArrow = false,
  children,
}: StatCardProps) {
  const t = TONE[tone]

  const body = (
    <div
      className={cn(
        "group/stat relative flex flex-col gap-4 rounded-xl border p-5 shadow-sm transition-all duration-200",
        fill && "h-full",
        t.border,
        t.bg,
        href &&
          "hover:-translate-y-px hover:border-zinc-300 hover:shadow-md motion-reduce:transform-none",
        // Когда карточка — ссылка, grid-элементом является <Link>, поэтому
        // позиционирующий className (col-span и т.п.) вешаем на него, а не сюда.
        !href && className
      )}
    >
      {(title || Icon || headerRight || href) && (
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            {Icon ? <Icon className="size-4 shrink-0" strokeWidth={2} /> : null}
            {title}
          </span>
          {href && !hideArrow ? (
            <ArrowRightIcon className="size-4 shrink-0 -translate-x-1 text-muted-foreground/40 opacity-0 transition-all duration-200 group-hover/stat:translate-x-0 group-hover/stat:text-brand group-hover/stat:opacity-100" />
          ) : (
            headerRight
          )}
        </div>
      )}
      {children}
    </div>
  )

  if (!href) {
    return body
  }

  return (
    <Link
      href={href}
      className={cn(
        "block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        fill && "h-full",
        className
      )}
    >
      {body}
    </Link>
  )
}

/**
 * Денежная сумма с разделителем разрядов (29 900) и приглушённой, более мелкой
 * единицей «сом». Размер единицы задаётся относительно числа (em), поэтому
 * компонент одинаково хорош и для крупного героя, и для компактных метрик.
 */
export function Money({
  value,
  className,
  unitClassName,
}: {
  value: number
  className?: string
  unitClassName?: string
}) {
  const num = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 })
    .format(Number.isFinite(value) ? value : 0)
    .replace(/\s/g, " ")

  return (
    <span className={cn("tabular-nums", className)}>
      {num}
      <span
        className={cn(
          "ml-1 align-baseline text-[0.45em] font-normal tracking-normal text-muted-foreground/70",
          unitClassName
        )}
      >
        сом
      </span>
    </span>
  )
}
