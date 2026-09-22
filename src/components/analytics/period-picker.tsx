"use client"

import { useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { DateRange } from "react-day-picker"
import { ru } from "date-fns/locale"
import { CalendarIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type { AnalyticsPreset, AnalyticsRange } from "@/lib/db"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DAYS_FORMS, formatRangeLabel, plural } from "./format"

const PRESETS: Array<{ key: AnalyticsPreset; label: string }> = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "90d", label: "90 дней" },
  { key: "month", label: "Этот месяц" },
  { key: "prev_month", label: "Прошлый месяц" },
]

function pad(n: number) {
  return String(n).padStart(2, "0")
}

function toISO(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fromISO(value: string): Date | undefined {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function shiftISO(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function presetLabel(range: AnalyticsRange): string {
  return PRESETS.find((preset) => preset.key === range.preset)?.label ?? formatRangeLabel(range.from, range.to)
}

/**
 * Единый выбор периода для аналитики: пресеты + произвольный диапазон в календаре + стрелки
 * «предыдущий/следующий период» той же длины. Период живёт в URL (?preset= или ?from=&to=),
 * остальные параметры (вкладка, фильтры) сохраняются; страница перечитывает данные на сервере.
 */
export function PeriodPicker({
  range,
  showDates = false,
  className,
}: {
  range: AnalyticsRange
  // Показывать даты пресета рядом с его названием (в широкой шапке без поиска).
  showDates?: boolean
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [draft, setDraft] = useState<DateRange | undefined>({ from: fromISO(range.from), to: fromISO(range.to) })

  function push(next: { preset?: AnalyticsPreset; from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("preset")
    params.delete("from")
    params.delete("to")
    if (next.preset) {
      params.set("preset", next.preset)
    } else if (next.from && next.to) {
      params.set("from", next.from)
      params.set("to", next.to)
    }
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  function applyPreset(key: AnalyticsPreset) {
    setOpen(false)
    push({ preset: key })
  }

  function handleSelect(selected: DateRange | undefined) {
    setDraft(selected)
    if (selected?.from && selected?.to) {
      setOpen(false)
      push({ from: toISO(selected.from), to: toISO(selected.to) })
    }
  }

  // Шаг на длину периода: «7 дней» → предыдущие 7 дней; календарный месяц → соседний месяц.
  function step(direction: -1 | 1) {
    if (range.preset === "month" || range.preset === "prev_month" || isWholeMonth(range.from, range.to)) {
      const [y, m] = range.from.split("-").map(Number)
      const start = new Date(Date.UTC(y, m - 1 + direction, 1))
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
      push({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) })
      return
    }
    const delta = direction * range.days
    push({ from: shiftISO(range.from, delta), to: shiftISO(range.to, delta) })
  }

  const label = presetLabel(range)
  const isCustom = range.preset === "custom"
  const nextDisabled = range.to >= range.today

  return (
    <div className={cn("flex shrink-0 items-center", className)} data-pending={isPending ? "" : undefined}>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="size-10 text-muted-foreground"
        aria-label="Предыдущий период"
        title="Предыдущий период"
        onClick={() => step(-1)}
      >
        <ChevronLeftIcon />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "inline-flex h-10 min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted aria-expanded:bg-muted focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:outline-none",
            isPending && "opacity-60"
          )}
          aria-label={`Период: ${label}`}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{label}</span>
          {showDates && !isCustom ? (
            <span className="hidden text-xs font-normal text-muted-foreground tabular-nums @4xl/screen:inline">
              {formatRangeLabel(range.from, range.to)}
            </span>
          ) : null}
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-0">
          <div className="flex flex-col sm:flex-row">
            <div className="flex flex-row flex-wrap gap-0.5 border-b border-border/40 p-2 sm:w-44 sm:flex-col sm:border-r sm:border-b-0">
              {PRESETS.map((preset) => {
                const active = range.preset === preset.key
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => applyPreset(preset.key)}
                    className={cn(
                      "flex h-9 items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm whitespace-nowrap transition-colors hover:bg-muted",
                      active ? "font-medium text-foreground" : "text-foreground/80"
                    )}
                  >
                    {preset.label}
                    {active ? <CheckIcon className="size-4 shrink-0" aria-hidden /> : null}
                  </button>
                )
              })}
              <div className="mt-1 hidden px-2.5 text-xs text-muted-foreground sm:block">
                Или выберите даты в календаре — {range.days} {plural(range.days, DAYS_FORMS)} сейчас
              </div>
            </div>
            <Calendar
              mode="range"
              selected={draft}
              onSelect={handleSelect}
              numberOfMonths={2}
              defaultMonth={fromISO(range.from)}
              disabled={{ after: fromISO(range.today) ?? new Date() }}
              locale={ru}
              className="p-2 [--cell-size:2.1rem]"
            />
          </div>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="size-10 text-muted-foreground"
        aria-label="Следующий период"
        title="Следующий период"
        disabled={nextDisabled}
        onClick={() => step(1)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

function isWholeMonth(from: string, to: string): boolean {
  const [fy, fm, fd] = from.split("-").map(Number)
  const [ty, tm, td] = to.split("-").map(Number)
  if (fd !== 1 || fy !== ty || fm !== tm) return false
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  return td === lastDay
}
