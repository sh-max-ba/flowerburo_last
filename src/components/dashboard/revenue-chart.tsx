import type { OwnerDashboardRevenuePoint } from "@/lib/db"
import { cn } from "@/lib/utils"
import { Money } from "./stat-card"

// Геометрия в координатах viewBox. SVG растягивается на всю ширину карточки
// (preserveAspectRatio="none"), поэтому точки/тултипы позиционируем поверх в %.
const VIEW_W = 720
const VIEW_H = 200
const PAD_X = 8
const PAD_TOP = 18
const PAD_BOTTOM = 10

type Pt = OwnerDashboardRevenuePoint & { x: number; y: number }

const round = (v: number) => Math.round(v * 100) / 100

// Монотонный кубический сплайн (Fritsch–Carlson, как d3 curveMonotoneX /
// recharts type="monotone"): мягкая кривая БЕЗ overshoot — она не «ныряет»
// ниже нуля на плоских участках и не вылетает за пик. Это важно для выручки,
// где отрицательных значений быть не может.
function smoothPath(pts: Pt[]): string {
  const n = pts.length
  if (n === 0) return ""
  if (n === 1) return `M ${round(pts[0].x)} ${round(pts[0].y)}`

  // Наклоны секущих между соседними точками.
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x
    delta.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx)
  }

  // Касательные в точках.
  const m: number[] = new Array(n)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2
  }

  // Ограничение Fritsch–Carlson — гарантирует монотонность сегментов.
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / delta[i]
    const b = m[i + 1] / delta[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * delta[i]
      m[i + 1] = t * b * delta[i]
    }
  }

  let d = `M ${round(pts[0].x)} ${round(pts[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3
    const c1x = pts[i].x + dx
    const c1y = pts[i].y + m[i] * dx
    const c2x = pts[i + 1].x - dx
    const c2y = pts[i + 1].y - m[i + 1] * dx
    d += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(pts[i + 1].x)} ${round(pts[i + 1].y)}`
  }
  return d
}

function fullDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date)
}

function weekdayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date)
}

function shortDate(day: string): string {
  const date = new Date(`${day}T00:00:00`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date)
}

/**
 * Минималистичный area-график выручки за неделю: сглаженная линия, мягкий
 * синий градиент-заливка, тонкие gridlines, аккуратный тултип по наведению.
 * Точки появляются только при hover — в покое лишь линия и заливка.
 */
export function RevenueChart({
  series,
  className,
}: {
  series: OwnerDashboardRevenuePoint[]
  className?: string
}) {
  if (series.length === 0) {
    return null
  }

  const n = series.length
  const max = Math.max(...series.map((p) => p.total), 1)
  const innerW = VIEW_W - PAD_X * 2
  const innerH = VIEW_H - PAD_TOP - PAD_BOTTOM

  const pts: Pt[] = series.map((p, i) => ({
    ...p,
    x: n === 1 ? VIEW_W / 2 : PAD_X + (i / (n - 1)) * innerW,
    y: PAD_TOP + innerH - (p.total / max) * innerH,
  }))

  const linePath = smoothPath(pts)
  const baseline = VIEW_H - PAD_BOTTOM
  const areaPath = `${linePath} L ${round(pts[n - 1].x)} ${baseline} L ${round(pts[0].x)} ${baseline} Z`

  // Тонкие горизонтальные направляющие — без «агрессивной» сетки.
  const gridLines = [0.25, 0.5, 0.75].map((f) => PAD_TOP + innerH * f)

  const last = pts[n - 1]

  // Прореживаем подписи оси X: ~7 максимум, первая и последняя всегда.
  const labelStep = Math.max(1, Math.round((n - 1) / 6))
  const useWeekday = n <= 8

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative h-32 w-full sm:h-36 2xl:h-40">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible text-zinc-200"
          aria-hidden
        >
          <defs>
            <linearGradient id="revenue-area" x1="0" y1="0" x2="0" y2="1">
              {/* var() в presentation-атрибутах SVG не резолвится — задаём через style. */}
              <stop offset="0%" style={{ stopColor: "var(--brand)", stopOpacity: 0.1 }} />
              <stop offset="100%" style={{ stopColor: "var(--brand)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>

          {gridLines.map((y) => (
            <line
              key={y}
              x1={0}
              y1={y}
              x2={VIEW_W}
              y2={y}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 6"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={areaPath} fill="url(#revenue-area)" />
          <path
            d={linePath}
            fill="none"
            style={{ stroke: "var(--brand)" }}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Якорь «сегодня» — статичная точка на последнем значении. */}
        <span
          className="pointer-events-none absolute z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-white"
          style={{ left: `${(last.x / VIEW_W) * 100}%`, top: `${(last.y / VIEW_H) * 100}%` }}
        />

        {/* Невидимые колонки-ловушки: hover показывает направляющую, точку и тултип. */}
        <div className="absolute inset-0">
          {pts.map((p) => {
            const leftPct = (p.x / VIEW_W) * 100
            const topPct = (p.y / VIEW_H) * 100
            return (
              <div
                key={p.day}
                className="group/col absolute inset-y-0"
                style={{ left: `${leftPct}%`, width: `${100 / n}%`, transform: "translateX(-50%)" }}
              >
                <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-brand/20 opacity-0 transition-opacity duration-150 group-hover/col:opacity-100" />
                <span
                  className="absolute left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand opacity-0 ring-4 ring-brand/15 transition-opacity duration-150 group-hover/col:opacity-100"
                  style={{ top: `${topPct}%` }}
                />
                <div className="pointer-events-none absolute top-0 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-background px-2.5 py-1.5 text-center whitespace-nowrap opacity-0 shadow-md transition-opacity duration-150 group-hover/col:opacity-100">
                  <div className="text-[11px] text-muted-foreground">{fullDayLabel(p.day)}</div>
                  <div className="text-xs font-semibold text-zinc-900">
                    <Money value={p.total} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Подписи по оси X — прорежены и спозиционированы под точками. */}
      <div className="relative h-4 text-[11px] text-muted-foreground/70">
        {pts.map((p, i) => {
          const labeled = i % labelStep === 0 || i === n - 1
          if (!labeled) return null
          const leftPct = (p.x / VIEW_W) * 100
          const isFirst = i === 0
          const isLast = i === n - 1
          const transform = isFirst
            ? "translateX(0)"
            : isLast
              ? "translateX(-100%)"
              : "translateX(-50%)"
          return (
            <span
              key={p.day}
              className={cn(
                "absolute top-0 whitespace-nowrap tabular-nums",
                isLast && "font-medium text-zinc-600"
              )}
              style={{ left: `${leftPct}%`, transform }}
            >
              {useWeekday ? weekdayLabel(p.day) : shortDate(p.day)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
