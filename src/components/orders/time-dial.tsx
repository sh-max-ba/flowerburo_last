"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MinusIcon, PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Выбор времени одним ползунком: дорожка рабочего дня с делениями (крупные — часы, мелкие — шаг
// snap), ручка «стеклом» показывает выбранное время, тянется пальцем/мышью, стрелками с клавиатуры
// и кнопками ± по шагу. Значение — «HH:MM» или пустая строка (время не выбрано → ручка призрачная).

export type TimeDialProps = {
  value: string
  onChange: (value: string) => void
  // Шаг, на который «приземляется» ручка.
  snap?: 5 | 10 | 15 | 30
  // Границы рабочего дня, минуты от полуночи.
  min?: number
  max?: number
  // Плотность мелких делений на дорожке: 24–96 (сколько отрезков между крайними точками).
  density?: number
  // Размер ручки в px: 44–68.
  reach?: number
  // Быстрые значения под дорожкой.
  presets?: string[]
  disabled?: boolean
  className?: string
}

const defaultPresets = ["10:00", "12:00", "15:00", "18:00", "20:00"]

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

export function TimeDial({
  value,
  onChange,
  snap = 15,
  min = 8 * 60,
  max = 22 * 60,
  density,
  reach = 52,
  presets = defaultPresets,
  disabled = false,
  className,
}: TimeDialProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const span = Math.max(snap, max - min)
  const handleSize = clamp(reach, 44, 68)
  const minorCount = clamp(density ?? Math.round(span / snap), 24, 96)
  const current = parseTimeValue(value)
  const minutes = current === null ? null : clamp(current, min, max)
  const ratio = minutes === null ? 0.5 : (minutes - min) / span

  const snapTo = useCallback(
    (raw: number) => clamp(Math.round(raw / snap) * snap, min, max),
    [snap, min, max]
  )

  const commit = useCallback(
    (next: number) => {
      const snapped = snapTo(next)
      const formatted = formatTimeValue(snapped)
      if (formatted !== value) {
        onChange(formatted)
      }
    },
    [snapTo, onChange, value]
  )

  const fromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) {
        return
      }
      const rect = track.getBoundingClientRect()
      const fraction = clamp((clientX - rect.left) / rect.width, 0, 1)
      commit(min + fraction * span)
    },
    [commit, min, span]
  )

  useEffect(() => {
    if (!dragging) {
      return
    }
    function onMove(event: PointerEvent) {
      fromPointer(event.clientX)
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      return
    }
    const base = minutes ?? snapTo(min + span / 2)
    const big = 60
    const map: Record<string, number> = {
      ArrowLeft: -snap,
      ArrowDown: -snap,
      ArrowRight: snap,
      ArrowUp: snap,
      PageDown: -big,
      PageUp: big,
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

  // Подписи часов: каждый час на широкой дорожке, каждые два — на узкой (через контейнер).
  const hourMarks = useMemo(() => {
    const marks: Array<{ minutes: number; label: string; ratio: number }> = []
    for (let m = Math.ceil(min / 60) * 60; m <= max; m += 60) {
      marks.push({ minutes: m, label: String(Math.floor(m / 60)), ratio: (m - min) / span })
    }
    return marks
  }, [min, max, span])

  const label = minutes === null ? "—:—" : formatTimeValue(minutes)

  return (
    <div className={cn("@container/dial flex flex-col gap-3", disabled && "opacity-60", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className={cn("font-heading text-3xl font-semibold tabular-nums", minutes === null && "text-muted-foreground")}>{label}</span>
          {minutes !== null ? <span className="text-xs text-muted-foreground">шаг {snap} мин</span> : <span className="text-xs text-muted-foreground">потяните ручку или выберите время</span>}
        </div>
        <div className="flex items-center gap-1">
          <StepButton icon={MinusIcon} label={`Минус ${snap} минут`} disabled={disabled || minutes !== null && minutes <= min} onClick={() => commit((minutes ?? snapTo(min + span / 2)) - snap)} />
          <StepButton icon={PlusIcon} label={`Плюс ${snap} минут`} disabled={disabled || minutes !== null && minutes >= max} onClick={() => commit((minutes ?? snapTo(min + span / 2)) + snap)} />
        </div>
      </div>

      <div className="relative select-none" style={{ paddingTop: handleSize / 2 + 4, paddingBottom: 22 }}>
        {/* Дорожка */}
        <div
          ref={trackRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label="Время"
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
            fromPointer(event.clientX)
          }}
          className="relative h-3 cursor-pointer rounded-md bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        >
          <div className="absolute inset-y-0 left-0 rounded-md bg-brand/80 transition-[width] duration-75" style={{ width: `${(minutes === null ? 0 : ratio) * 100}%` }} />
          {/* Деления */}
          <div className="pointer-events-none absolute inset-x-0 top-full mt-1 h-3">
            {Array.from({ length: minorCount + 1 }, (_, index) => {
              const fraction = index / minorCount
              const markMinutes = min + fraction * span
              const isHour = Math.abs(markMinutes / 60 - Math.round(markMinutes / 60)) < 0.001
              return (
                <span
                  key={index}
                  className={cn("absolute top-0 w-px -translate-x-1/2 bg-zinc-300", isHour ? "h-3 bg-zinc-400" : "h-1.5")}
                  style={{ left: `${fraction * 100}%` }}
                />
              )
            })}
          </div>
          {/* Подписи часов */}
          <div className="pointer-events-none absolute inset-x-0 top-full mt-4 h-4 text-[10px] leading-none text-muted-foreground tabular-nums">
            {hourMarks.map((mark, index) => (
              <span
                key={mark.minutes}
                className={cn("absolute -translate-x-1/2", index % 2 === 1 && "hidden @lg/dial:inline")}
                style={{ left: `${mark.ratio * 100}%` }}
              >
                {mark.label}
              </span>
            ))}
          </div>
          {/* Ручка */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            disabled={disabled}
            onPointerDown={(event) => {
              if (disabled) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              trackRef.current?.focus()
              setDragging(true)
            }}
            className={cn(
              "absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-sm font-semibold text-foreground shadow-lg ring-1 ring-black/10 backdrop-blur-md transition-[left,transform,box-shadow] duration-75 tabular-nums",
              "before:pointer-events-none before:absolute before:inset-px before:rounded-full before:bg-gradient-to-b before:from-white/90 before:to-white/20",
              dragging ? "scale-105 shadow-xl ring-brand/40" : "hover:shadow-xl",
              minutes === null && "border border-dashed border-zinc-300 bg-white/60 text-muted-foreground"
            )}
            style={{ left: `${ratio * 100}%`, width: handleSize, height: handleSize, touchAction: "none" }}
          >
            <span className="relative">{minutes === null ? "…" : label}</span>
          </button>
        </div>
      </div>

      {presets.length ? (
        <div className="flex flex-wrap gap-1.5">
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
                  "h-8 rounded-md px-2.5 text-sm font-medium tabular-nums transition-colors pointer-coarse:h-9",
                  active ? "bg-brand text-brand-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {preset}
              </button>
            )
          })}
        </div>
      ) : null}
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
      className="flex size-9 items-center justify-center rounded-md bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 pointer-coarse:size-10"
    >
      <Icon className="size-4" />
    </button>
  )
}
