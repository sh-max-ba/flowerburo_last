import { cn } from "@/lib/utils"

export type DonutSegment = {
  label: string
  value: number
  color: string
}

const round = (v: number) => Math.round(v * 100) / 100

const R = 42
const SW = 12
const CIRC = 2 * Math.PI * R

/**
 * Минималистичный donut: тонкая подложка-кольцо, сегменты со скруглённой
 * палитрой (задаётся вызывающим — спокойные сине-серые тона), крупное число
 * в центре. Чистый SVG, серверный рендер.
 */
export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  className,
}: {
  segments: DonutSegment[]
  centerValue: number | string
  centerLabel?: string
  className?: string
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  // Небольшой зазор между сегментами (если их больше одного) — «дышащий» вид.
  const gap = segments.length > 1 ? (4 / 360) * CIRC : 0

  // Дуги считаем функционально (без мутации аккумулятора в render):
  // dashOffset = смещение на сумму предыдущих долей.
  const fractions = segments.map((s) => (total > 0 ? s.value / total : 0))
  const arcs = segments.map((segment, i) => {
    const before = fractions.slice(0, i).reduce((sum, f) => sum + f, 0)
    return {
      label: segment.label,
      color: segment.color,
      len: Math.max(fractions[i] * CIRC - gap, 0),
      dashOffset: -before * CIRC,
    }
  })

  return (
    <div className={cn("relative shrink-0", className)}>
      <svg viewBox="0 0 100 100" className="size-32 -rotate-90">
        <circle
          cx={50}
          cy={50}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={SW}
          className="text-zinc-100"
        />
        {arcs.map((arc) => (
          <circle
            key={arc.label}
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke={arc.color}
            strokeWidth={SW}
            strokeDasharray={`${round(arc.len)} ${round(CIRC)}`}
            strokeDashoffset={round(arc.dashOffset)}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-normal tabular-nums text-zinc-900">{centerValue}</span>
        {centerLabel ? (
          <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
        ) : null}
      </div>
    </div>
  )
}
