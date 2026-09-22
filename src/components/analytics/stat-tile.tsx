import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPercent, SERIES_COLORS } from "./format"

type StatTileProps = {
  label: string
  // Готовое значение (число уже отформатировано вызывающим) и необязательная единица мельче.
  value: string
  unit?: string
  // Дельта к предыдущему периоду: current/previous → проценты; upIsGood задаёт цвет.
  delta?: { current: number; previous: number; upIsGood?: boolean } | null
  hint?: ReactNode
  // Спарклайн — ряд значений за период (де-эмфаза, без осей).
  spark?: number[]
  sparkColor?: string
  href?: string
  // Плитка-кнопка (раскрыть список): вместо ссылки — обработчик клика.
  onClick?: () => void
  className?: string
}

// Плитка метрики: подпись, крупное значение (пропорциональные цифры), дельта к прошлому периоду
// и спарклайн. Без рамок — карточка на bg-background с мягкой тенью, как весь «вектор».
export function StatTile({ label, value, unit, delta, hint, spark, sparkColor, href, onClick, className }: StatTileProps) {
  // Когда плитка — ссылка или кнопка, элементом грида становится обёртка: позиционирующий
  // className (col-span и т.п.) вешаем на неё, а не на внутренний блок.
  const interactive = Boolean(href || onClick)
  const body = (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col gap-2 rounded-2xl bg-background p-4 shadow-xs transition-shadow",
        interactive && "hover:shadow-md",
        !interactive && className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">{label}</span>
        {delta ? <Delta {...delta} /> : null}
      </div>
      <div className="flex min-w-0 items-baseline gap-1">
        <span className="truncate text-[1.65rem] leading-none font-semibold tracking-tight text-foreground">{value}</span>
        {unit ? <span className="shrink-0 text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {spark && spark.length > 1 ? <Sparkline values={spark} color={sparkColor} /> : null}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className={cn("block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40", className)}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn("block h-full w-full rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40", className)}
      >
        {body}
      </button>
    )
  }
  return body
}

// Дельта: «+12 %» к предыдущему периоду той же длины. Цвет — направление × «рост хорош ли».
// Без предыдущих данных дельту не показываем (сравнивать не с чем).
export function Delta({ current, previous, upIsGood = true }: { current: number; previous: number; upIsGood?: boolean }) {
  if (!Number.isFinite(previous) || previous === 0) {
    return null
  }
  const change = ((current - previous) / Math.abs(previous)) * 100
  const flat = Math.abs(change) < 0.5
  const positive = change > 0
  const good = flat ? null : positive === upIsGood
  const Icon = flat ? MinusIcon : positive ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        good === null ? "bg-muted text-muted-foreground" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
      )}
      title="К предыдущему периоду той же длины"
    >
      <Icon className="size-3" aria-hidden />
      {flat ? "0 %" : `${positive ? "+" : "−"}${formatPercent(Math.abs(change))}`}
    </span>
  )
}

const SPARK_W = 120
const SPARK_H = 28

// Спарклайн: тонкая линия + слабая заливка, последняя точка — акцентом. Без сетки и осей.
export function Sparkline({ values, color = SERIES_COLORS.revenue, className }: { values: number[]; color?: string; className?: string }) {
  const n = values.length
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const pts = values.map((v, i) => ({
    x: n === 1 ? SPARK_W / 2 : (i / (n - 1)) * SPARK_W,
    y: SPARK_H - 2 - ((v - min) / span) * (SPARK_H - 4),
  }))
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
  const area = `${line} L ${SPARK_W} ${SPARK_H} L 0 ${SPARK_H} Z`
  const last = pts[n - 1]
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className={cn("h-7 w-full overflow-visible", className)}
      aria-hidden
    >
      <path d={area} fill={color} fillOpacity={0.08} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last.x} cy={last.y} r={2.5} fill={color} stroke="var(--background)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
