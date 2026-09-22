import { cn } from "@/lib/utils"
import { formatDay, formatShortDate } from "./format"

// Графики аналитики: чистый SVG + CSS-hover, серверный рендер, без JS-библиотек.
// Правила: одна ось Y, тонкие линии (2px), хайрлайн-сетка, легенда при ≥ 2 рядах, тултип по
// наведению/тапу на невидимые колонки-ловушки, подписи оси X прорежены.

export type ChartSeries = {
  key: string
  label: string
  color: string
  values: number[]
}

const VIEW_W = 720
const VIEW_H = 220
const PAD_TOP = 12
const PAD_BOTTOM = 4
const PAD_X = 6

type Pt = { x: number; y: number }

const round = (v: number) => Math.round(v * 100) / 100

// Монотонный кубический сплайн (Fritsch–Carlson): мягкая кривая без выбросов ниже нуля.
function smoothPath(pts: Pt[]): string {
  const n = pts.length
  if (n === 0) return ""
  if (n === 1) return `M ${round(pts[0].x)} ${round(pts[0].y)}`
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x
    delta.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx)
  }
  const m: number[] = new Array(n)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2
  }
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
    d += ` C ${round(pts[i].x + dx)} ${round(pts[i].y + m[i] * dx)}, ${round(pts[i + 1].x - dx)} ${round(pts[i + 1].y - m[i + 1] * dx)}, ${round(pts[i + 1].x)} ${round(pts[i + 1].y)}`
  }
  return d
}

// «Красивый» максимум оси: 1 / 2 / 2.5 / 5 × 10^k, не меньше фактического максимума.
function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const base = Math.pow(10, exp)
  const fraction = value / base
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * base
}

function xLabelStep(n: number): number {
  return Math.max(1, Math.ceil((n - 1) / 6))
}

// Позиция тултипа: у краёв прижимаем к краю, чтобы не вылетал за карточку.
function tooltipAlign(i: number, n: number): string {
  if (n <= 2) return "left-1/2 -translate-x-1/2"
  if (i < Math.max(1, Math.floor(n * 0.18))) return "left-0"
  if (i > n - 1 - Math.max(1, Math.floor(n * 0.18))) return "right-0"
  return "left-1/2 -translate-x-1/2"
}

type TrendChartProps = {
  days: string[]
  series: ChartSeries[]
  // Форматтеры: значения в тултипе/легенде и компактные деления оси Y.
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  // Заливка под линией (только для одиночного ряда — «площадь» двух рядов нечитаема).
  area?: boolean
  className?: string
  heightClassName?: string
}

/**
 * Линии по дням: 1–3 ряда на одной оси. Легенда с итогом за период, сетка из трёх хайрлайнов
 * с делениями слева, тултип со всеми рядами за день.
 */
export function TrendChart({
  days,
  series,
  formatValue,
  formatTick,
  area = false,
  className,
  heightClassName = "h-44 sm:h-52",
}: TrendChartProps) {
  const n = days.length
  if (n === 0 || series.length === 0) {
    return <ChartEmpty className={className} />
  }
  const allValues = series.flatMap((s) => s.values)
  const rawMax = Math.max(0, ...allValues)
  const rawMin = Math.min(0, ...allValues)
  const max = niceMax(rawMax)
  // Отрицательные значения (остаток в минусе) — ось продолжается вниз, ноль остаётся линией.
  const min = rawMin < 0 ? -niceMax(-rawMin) : 0
  const span = max - min || 1
  const innerW = VIEW_W - PAD_X * 2
  const innerH = VIEW_H - PAD_TOP - PAD_BOTTOM
  const xOf = (i: number) => (n === 1 ? VIEW_W / 2 : PAD_X + (i / (n - 1)) * innerW)
  const yOf = (v: number) => PAD_TOP + innerH - ((v - min) / span) * innerH
  const baseline = yOf(0)
  const tickValues = min < 0 ? [min, 0, max / 2, max] : [0, max / 3, (max * 2) / 3, max]
  const ticks = tickValues.map((value) => ({ y: yOf(value), value }))
  const step = xLabelStep(n)
  const useWeekday = n <= 8
  const hasData = rawMax > 0 || rawMin < 0

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {series.length > 1 ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Легенда">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium tabular-nums text-foreground">
                {formatValue(s.values.reduce((sum, v) => sum + v, 0))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex min-w-0 gap-2">
        {/* Деления оси Y — снаружи SVG, чтобы текст не растягивался вместе с графиком. */}
        <div className={cn("relative w-9 shrink-0 text-[10px] text-muted-foreground/80 tabular-nums", heightClassName)}>
          {ticks.map((tick) => (
            <span
              key={tick.value}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
              style={{ top: `${(tick.y / VIEW_H) * 100}%` }}
            >
              {formatTick(tick.value)}
            </span>
          ))}
        </div>

        <div className={cn("relative min-w-0 flex-1", heightClassName)}>
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden>
            {ticks.map((tick) => (
              <line
                key={tick.value}
                x1={0}
                x2={VIEW_W}
                y1={tick.y}
                y2={tick.y}
                stroke="currentColor"
                className={tick.value === 0 ? "text-border/70" : "text-border/40"}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {series.map((s) => {
              const pts = s.values.map((v, i) => ({ x: xOf(i), y: yOf(v) }))
              const line = smoothPath(pts)
              return (
                <g key={s.key}>
                  {area && series.length === 1 ? (
                    <path d={`${line} L ${round(pts[n - 1].x)} ${baseline} L ${round(pts[0].x)} ${baseline} Z`} fill={s.color} fillOpacity={0.08} />
                  ) : null}
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
              )
            })}
          </svg>

          {/* Колонки-ловушки: hover/tap показывает направляющую, точки и тултип за день. */}
          <div className="absolute inset-0">
            {days.map((day, i) => {
              const leftPct = (xOf(i) / VIEW_W) * 100
              // Колонка не выходит за края графика (крайние — половинной ширины), точка — на своём x.
              const half = 50 / Math.max(n, 1)
              const colLeft = Math.max(0, leftPct - half)
              const colWidth = Math.min(100, leftPct + half) - colLeft
              const inner = colWidth > 0 ? ((leftPct - colLeft) / colWidth) * 100 : 50
              return (
                <div key={day} className="group/col absolute inset-y-0" style={{ left: `${colLeft}%`, width: `${colWidth}%` }}>
                  <div
                    className="absolute inset-y-1 w-px -translate-x-1/2 bg-foreground/15 opacity-0 transition-opacity group-hover/col:opacity-100"
                    style={{ left: `${inner}%` }}
                  />
                  {series.map((s) => (
                    <span
                      key={s.key}
                      className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 ring-2 ring-background transition-opacity group-hover/col:opacity-100"
                      style={{ top: `${(yOf(s.values[i] ?? 0) / VIEW_H) * 100}%`, left: `${inner}%`, background: s.color }}
                    />
                  ))}
                  {/* display:none вне hover — невидимый тултип у края не должен раздвигать прокрутку. */}
                  <div
                    className={cn(
                      "pointer-events-none absolute top-0 z-20 hidden min-w-32 rounded-lg bg-background px-2.5 py-2 text-xs whitespace-nowrap shadow-md ring-1 ring-border/40 group-hover/col:block",
                      tooltipAlign(i, n)
                    )}
                  >
                    <div className="mb-1 text-[11px] text-muted-foreground">{formatDay(day, { weekday: true })}</div>
                    {series.map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                          {s.label}
                        </span>
                        <span className="font-medium tabular-nums text-foreground">{formatValue(s.values[i] ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {!hasData ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              За период данных нет
            </div>
          ) : null}
        </div>
      </div>

      <XAxis days={days} xOf={(i) => (xOf(i) / VIEW_W) * 100} step={step} useWeekday={useWeekday} />
    </div>
  )
}

function XAxis({
  days,
  xOf,
  step,
  useWeekday,
  band = false,
}: {
  days: string[]
  xOf: (i: number) => number
  step: number
  useWeekday: boolean
  // band — подписи центрируются под столбиками (позиции всегда внутри области).
  band?: boolean
}) {
  const n = days.length
  return (
    <div className="relative ml-11 h-4 text-[11px] text-muted-foreground/80">
      {days.map((day, i) => {
        const labeled = i % step === 0 || i === n - 1
        if (!labeled) return null
        // Подпись последней точки может «слипнуться» с предпоследней регулярной — прячем ту.
        if (i !== n - 1 && n - 1 - i < step / 2) return null
        const isFirst = i === 0
        const isLast = i === n - 1
        const transform = band ? "translateX(-50%)" : isFirst ? "translateX(0)" : isLast ? "translateX(-100%)" : "translateX(-50%)"
        return (
          <span
            key={day}
            className={cn("absolute top-0 whitespace-nowrap tabular-nums", isLast && "font-medium text-foreground/80")}
            style={{ left: `${xOf(i)}%`, transform }}
          >
            {useWeekday ? formatDay(day, { weekday: true }).split(",")[0] : formatShortDate(day)}
          </span>
        )
      })}
    </div>
  )
}

type ColumnChartProps = {
  days: string[]
  values: number[]
  label: string
  color: string
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  className?: string
  heightClassName?: string
}

/**
 * Столбики по дням для одного ряда (списания, продажи товара): ≤ 24px толщиной, скруглённый
 * верх, зазор между соседями, hover — затемнение и тултип.
 */
export function ColumnChart({ days, values, label, color, formatValue, formatTick, className, heightClassName = "h-40 sm:h-48" }: ColumnChartProps) {
  const n = days.length
  if (n === 0) {
    return <ChartEmpty className={className} />
  }
  const rawMax = Math.max(0, ...values)
  const max = niceMax(rawMax)
  const ticks = [0, 1 / 2, 1].map((f) => ({ pct: (1 - f) * 100, value: max * f }))
  const step = xLabelStep(n)
  const useWeekday = n <= 8

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 gap-2">
        <div className={cn("relative w-9 shrink-0 text-[10px] text-muted-foreground/80 tabular-nums", heightClassName)}>
          {ticks.map((tick) => (
            <span key={tick.value} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${tick.pct}%` }}>
              {formatTick(tick.value)}
            </span>
          ))}
        </div>
        <div className={cn("relative min-w-0 flex-1", heightClassName)}>
          {ticks.map((tick) => (
            <div
              key={tick.value}
              className={cn("absolute inset-x-0 h-px", tick.value === 0 ? "bg-border/70" : "bg-border/40")}
              style={{ top: `${tick.pct}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end">
            {days.map((day, i) => {
              const value = values[i] ?? 0
              const heightPct = max > 0 ? (Math.max(0, value) / max) * 100 : 0
              return (
                <div key={day} className="group/col relative flex h-full flex-1 items-end justify-center px-px">
                  <div
                    className="w-[70%] max-w-6 rounded-t-[4px] transition-opacity group-hover/col:opacity-80"
                    style={{ height: `${heightPct}%`, background: color, minHeight: value > 0 ? 2 : 0 }}
                    role="img"
                    aria-label={`${formatDay(day)}: ${formatValue(value)}`}
                  />
                  <div
                    className={cn(
                      "pointer-events-none absolute top-0 z-20 hidden rounded-lg bg-background px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md ring-1 ring-border/40 group-hover/col:block",
                      tooltipAlign(i, n)
                    )}
                  >
                    <div className="text-[11px] text-muted-foreground">{formatDay(day, { weekday: true })}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
                      <span className="text-muted-foreground">{label}</span>
                      <span className="ml-auto font-medium tabular-nums text-foreground">{formatValue(value)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {rawMax === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              За период данных нет
            </div>
          ) : null}
        </div>
      </div>
      <XAxis days={days} xOf={(i) => ((i + 0.5) / n) * 100} step={step} useWeekday={useWeekday} band />
    </div>
  )
}

function ChartEmpty({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-40 items-center justify-center text-sm text-muted-foreground", className)}>
      За период данных нет
    </div>
  )
}
