"use client"

import type React from "react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { MinusIcon, PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Круговой выбор времени одной ручкой (как таймер/будильник): кольцо делений по 15 минут,
// деления от начала суток до выбранного времени подсвечены, ручка тянется пальцем/мышью по
// кольцу, в центре — крупное время. Магазин работает круглосуточно, поэтому по умолчанию кольцо —
// полные сутки (00:00 вверху, 12:00 внизу, подписи каждые 3 часа); при узком диапазоне
// (min/max) — дуга 270° с разрывом внизу. Стрелки с клавиатуры и ± меняют на шаг.

export type TimeDialProps = {
  value: string
  onChange: (value: string) => void
  // Шаг, на который «приземляется» ручка.
  snap?: 5 | 10 | 15 | 30
  // Границы рабочего дня, минуты от полуночи.
  min?: number
  max?: number
  // Диаметр ручки, px (28–44).
  reach?: number
  // Быстрые значения под кольцом.
  presets?: string[]
  disabled?: boolean
  className?: string
}

const defaultPresets = ["10:00", "12:00", "15:00", "18:00", "20:00"]

// Геометрия кольца в единицах viewBox 0 0 240 240.
const SIZE = 240
const CENTER = SIZE / 2
const RING_RADIUS = 82
const DAY = 24 * 60

export function parseTimeValue(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) {
    return null
  }
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number.isFinite(minutes) ? minutes : null
}

export function formatTimeValue(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function polar(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CENTER + radius * Math.sin(rad), y: CENTER - radius * Math.cos(rad) }
}

export function TimeDial({
  value,
  onChange,
  snap = 15,
  min = 0,
  max = DAY - 15,
  reach = 34,
  presets = defaultPresets,
  disabled = false,
  className,
}: TimeDialProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const labelId = useId()
  const span = Math.max(snap, max - min)
  // Полные сутки — замкнутое кольцо (0° вверху, шаг угла = доля суток); иначе дуга 270° с разрывом внизу.
  const fullDay = span >= DAY - snap
  const startAngle = fullDay ? 0 : -135
  const sweep = fullDay ? (360 * span) / DAY : 270
  const knobRadius = clamp(reach, 28, 44) / 2
  const current = parseTimeValue(value)
  const minutes = current === null ? null : clamp(current, min, max)
  const angleFor = useCallback((m: number) => startAngle + ((m - min) / span) * sweep, [min, span, startAngle, sweep])
  const handleAngle = angleFor(minutes ?? min)
  const knob = polar(handleAngle, RING_RADIUS)

  const snapTo = useCallback((raw: number) => clamp(Math.round(raw / snap) * snap, min, max), [snap, min, max])

  const commit = useCallback(
    (next: number) => {
      const formatted = formatTimeValue(snapTo(next))
      if (formatted !== value) {
        onChange(formatted)
      }
    },
    [snapTo, onChange, value]
  )

  // Точка на экране → угол от вершины по часовой → минуты. В разрыве внизу — ближайший край.
  const fromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) {
        return
      }
      const rect = svg.getBoundingClientRect()
      const dx = clientX - (rect.left + rect.width / 2)
      const dy = clientY - (rect.top + rect.height / 2)
      // atan2 даёт (-180, 180] от вершины по часовой. На полном кольце нормализуем в [0, 360);
      // на дуге разрыв внизу симметричен, поэтому ближайший край — просто clamp.
      const raw = (Math.atan2(dx, -dy) * 180) / Math.PI
      const angle = fullDay ? (raw + 360) % 360 : clamp(raw, startAngle, startAngle + sweep)
      const fraction = clamp((angle - startAngle) / sweep, 0, 1)
      commit(min + fraction * span)
    },
    [commit, min, span, fullDay, startAngle, sweep]
  )

  useEffect(() => {
    if (!dragging) {
      return
    }
    function onMove(event: PointerEvent) {
      fromPointer(event.clientX, event.clientY)
    }
    function onUp() {
      setDragging(false)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [dragging, fromPointer])

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    if (disabled) {
      return
    }
    const base = minutes ?? snapTo(min + span / 2)
    const map: Record<string, number> = {
      ArrowLeft: -snap,
      ArrowDown: -snap,
      ArrowRight: snap,
      ArrowUp: snap,
      PageDown: -60,
      PageUp: 60,
    }
    if (event.key in map) {
      event.preventDefault()
      commit(base + map[event.key])
    } else if (event.key === "Home") {
      event.preventDefault()
      commit(min)
    } else if (event.key === "End") {
      event.preventDefault()
      commit(max)
    }
  }

  // Деления: каждый шаг snap; часовые — длиннее; подписи снаружи кольца — каждые 3 часа на
  // полных сутках, каждые 2 — на дуге.
  const labelEvery = fullDay ? 3 : 2
  const ticks = useMemo(() => {
    const list: Array<{ minutes: number; angle: number; hour: boolean; label: string }> = []
    for (let m = min; m <= max; m += snap) {
      const hour = m % 60 === 0
      list.push({ minutes: m, angle: angleFor(m), hour, label: hour && (m / 60) % labelEvery === 0 ? String(m / 60) : "" })
    }
    return list
  }, [min, max, snap, angleFor, labelEvery])

  const label = minutes === null ? "—:—" : formatTimeValue(minutes)
  const [hours, mins] = label.split(":")

  return (
    <div className={cn("flex flex-col items-center gap-2", disabled && "opacity-60", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={labelId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={minutes ?? undefined}
        aria-valuetext={minutes === null ? "не выбрано" : label}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          if (disabled) {
            return
          }
          event.preventDefault()
          event.currentTarget.focus()
          setDragging(true)
          fromPointer(event.clientX, event.clientY)
        }}
        className="w-full max-w-64 touch-none select-none rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        style={{ cursor: disabled ? "default" : dragging ? "grabbing" : "grab" }}
      >
        <title id={labelId}>Время</title>
        {/* Кольцо делений */}
        {ticks.map((tick) => {
          const selected = minutes !== null && tick.minutes <= minutes
          const inner = polar(tick.angle, RING_RADIUS - (tick.hour ? 9 : 5))
          const outer = polar(tick.angle, RING_RADIUS + (tick.hour ? 9 : 5))
          return (
            <line
              key={tick.minutes}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              strokeWidth={tick.hour ? 2.5 : 1.5}
              strokeLinecap="round"
              className={cn(
                "transition-colors duration-100",
                selected ? "stroke-brand" : tick.hour ? "stroke-zinc-400" : "stroke-zinc-300"
              )}
            />
          )
        })}
        {/* Подписи часов */}
        {ticks
          .filter((tick) => tick.label)
          .map((tick) => {
            const point = polar(tick.angle, RING_RADIUS + 26)
            return (
              <text
                key={`label-${tick.minutes}`}
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-zinc-500 text-[11px] tabular-nums"
              >
                {tick.label}
              </text>
            )
          })}
        {/* Ручка */}
        <g style={{ filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.18))" }}>
          <circle
            cx={knob.x}
            cy={knob.y}
            r={knobRadius}
            className={cn(
              "fill-white stroke-zinc-200 transition-[r] duration-100",
              minutes === null && "fill-white/80 stroke-zinc-300",
              dragging && "stroke-brand"
            )}
            strokeWidth={1.5}
          />
          <circle cx={knob.x} cy={knob.y} r={4} className={cn(minutes === null ? "fill-zinc-300" : "fill-brand")} />
        </g>
        {/* Центр: время */}
        <text
          x={CENTER}
          y={CENTER - 2}
          textAnchor="middle"
          dominantBaseline="central"
          className={cn("font-heading text-[40px] font-semibold tabular-nums", minutes === null ? "fill-zinc-300" : "fill-foreground")}
        >
          {hours}
          <tspan className="fill-zinc-400" dy="-4">:</tspan>
          {mins}
        </text>
        <text x={CENTER} y={CENTER + 26} textAnchor="middle" dominantBaseline="central" className="fill-zinc-500 text-[11px]">
          {minutes === null ? "потяните ручку" : `шаг ${snap} мин`}
        </text>
      </svg>

      <div className="flex w-full max-w-64 flex-wrap items-center justify-center gap-1.5">
        <StepButton icon={MinusIcon} label={`Минус ${snap} минут`} disabled={disabled || (minutes !== null && minutes <= min)} onClick={() => commit((minutes ?? snapTo(min + span / 2)) - snap)} />
        {presets.map((preset) => {
          const presetMinutes = parseTimeValue(preset)
          if (presetMinutes === null || presetMinutes < min || presetMinutes > max) {
            return null
          }
          const active = minutes === presetMinutes
          return (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => commit(presetMinutes)}
              className={cn(
                "h-8 rounded-md px-2 text-sm font-medium tabular-nums transition-colors pointer-coarse:h-9",
                active ? "bg-brand text-brand-foreground" : "bg-background text-muted-foreground shadow-xs hover:text-foreground"
              )}
            >
              {preset}
            </button>
          )
        })}
        <StepButton icon={PlusIcon} label={`Плюс ${snap} минут`} disabled={disabled || (minutes !== null && minutes >= max)} onClick={() => commit((minutes ?? snapTo(min + span / 2)) + snap)} />
      </div>
    </div>
  )
}

function StepButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md bg-background text-muted-foreground shadow-xs transition-colors hover:text-foreground disabled:opacity-40 pointer-coarse:size-9"
    >
      <Icon className="size-4" />
    </button>
  )
}
