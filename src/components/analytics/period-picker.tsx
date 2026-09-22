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
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { DAYS_FORMS, formatDay, formatRangeLabel, plural } from "./format"

const RANGE_PRESETS: Array<{ key: AnalyticsPreset; label: string }> = [
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "90d", label: "90 дней" },
  { key: "month", label: "Этот месяц" },
  { key: "prev_month", label: "Прошлый месяц" },
]

const DAY_PRESETS: Array<{ key: AnalyticsPreset; label: string }> = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
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

function isWholeMonth(from: string, to: string): boolean {
  const [fy, fm, fd] = from.split("-").map(Number)
  const [ty, tm, td] = to.split("-").map(Number)
  if (fd !== 1 || fy !== ty || fm !== tm) return false
  return td === new Date(Date.UTC(ty, tm, 0)).getUTCDate()
}

// Подпись периода в кнопке: пресет + даты, один день — с днём недели, свой диапазон — даты.
export function periodLabel(range: AnalyticsRange): { primary: string; secondary: string } {
  const single = range.from === range.to
  if (single) {
    const preset = DAY_PRESETS.find((entry) => entry.key === range.preset)
    return { primary: formatDay(range.from, { weekday: true }), secondary: preset ? preset.label : "" }
  }
  const preset = RANGE_PRESETS.find((entry) => entry.key === range.preset)
  return { primary: preset ? preset.label : formatRangeLabel(range.from, range.to), secondary: preset ? formatRangeLabel(range.from, range.to) : `${range.days} ${plural(range.days, DAYS_FORMS)}` }
}

/**
 * Единый выбор периода аналитики: «Период» (пресеты, даты «с — по», календарь на два месяца) и
 * «Один день» (сегодня / вчера / любой день из календаря). Стрелки шагают на длину периода
 * (для одного дня — на день). Период живёт в URL (?preset= или ?from=&to=), остальные параметры
 * сохраняются; страница перечитывает данные на сервере.
 */
export function PeriodPicker({ range, className }: { range: AnalyticsRange; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const single = range.from === range.to
  const [mode, setMode] = useState<"range" | "day">(single ? "day" : "range")
  const [draft, setDraft] = useState<DateRange | undefined>({ from: fromISO(range.from), to: fromISO(range.to) })
  const [fromInput, setFromInput] = useState(range.from)
  const [toInput, setToInput] = useState(range.to)

  function push(next: { preset?: AnalyticsPreset; from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("preset")
    params.delete("from")
    params.delete("to")
    params.delete("page")
    if (next.preset) {
      params.set("preset", next.preset)
    } else if (next.from && next.to) {
      params.set("from", next.from)
      params.set("to", next.to)
    }
    const qs = params.toString()
    setOpen(false)
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  function applyRange(from: string, to: string) {
    if (!from || !to) return
    if (from > to) [from, to] = [to, from]
    if (to > range.today) to = range.today
    push({ from, to })
  }

  function handleRangeSelect(selected: DateRange | undefined) {
    setDraft(selected)
    if (selected?.from) setFromInput(toISO(selected.from))
    if (selected?.to) setToInput(toISO(selected.to))
    if (selected?.from && selected?.to) {
      applyRange(toISO(selected.from), toISO(selected.to))
    }
  }

  function handleDaySelect(selected: Date | undefined) {
    if (!selected) return
    const iso = toISO(selected)
    push({ from: iso, to: iso })
  }

  // Шаг на длину периода: день → соседний день; календарный месяц → соседний месяц; иначе на N дней.
  function step(direction: -1 | 1) {
    if (single) {
      const next = shiftISO(range.from, direction)
      push({ from: next, to: next })
      return
    }
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

  const label = periodLabel(range)
  const nextDisabled = range.to >= range.today
  const stepTitle = single ? "день" : range.preset === "month" || range.preset === "prev_month" || isWholeMonth(range.from, range.to) ? "месяц" : `${range.days} ${plural(range.days, DAYS_FORMS)}`

  return (
    <div className={cn("flex shrink-0 items-center", className)} data-pending={isPending ? "" : undefined}>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="size-10 text-muted-foreground"
        aria-label={`Назад на ${stepTitle}`}
        title={`Назад на ${stepTitle}`}
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
          aria-label={`Период: ${label.primary}${label.secondary ? `, ${label.secondary}` : ""}`}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{label.primary}</span>
          {label.secondary ? (
            <span className="hidden truncate text-xs font-normal text-muted-foreground tabular-nums @3xl/screen:inline">{label.secondary}</span>
          ) : null}
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-3">
          <div className="flex flex-col gap-3">
            <SegmentedTabs
              size="sm"
              fill
              value={mode}
              onValueChange={setMode}
              aria-label="Как выбирать даты"
              items={[
                { value: "range", label: "Период" },
                { value: "day", label: "Один день" },
              ]}
            />

            {mode === "day" ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {DAY_PRESETS.map((preset) => {
                    const active = range.preset === preset.key
                    return (
                      <Button key={preset.key} type="button" variant={active ? "secondary" : "ghost"} size="sm" onClick={() => push({ preset: preset.key })}>
                        {active ? <CheckIcon data-icon="inline-start" /> : null}
                        {preset.label}
                      </Button>
                    )
                  })}
                  <input
                    type="date"
                    aria-label="Дата"
                    value={single ? range.from : ""}
                    max={range.today}
                    onChange={(event) => {
                      if (event.target.value) push({ from: event.target.value, to: event.target.value })
                    }}
                    className="ml-auto h-8 rounded-lg bg-muted/55 px-2 text-sm tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
                  />
                </div>
                <Calendar
                  mode="single"
                  selected={single ? fromISO(range.from) : undefined}
                  onSelect={handleDaySelect}
                  defaultMonth={fromISO(range.to)}
                  disabled={{ after: fromISO(range.today) ?? new Date() }}
                  locale={ru}
                  className="p-0 [--cell-size:2.25rem]"
                />
                <p className="text-xs text-muted-foreground">Выберите день в календаре — данные покажутся сразу.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex flex-row flex-wrap gap-0.5 sm:w-40 sm:flex-col">
                  {RANGE_PRESETS.map((preset) => {
                    const active = range.preset === preset.key
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => push({ preset: preset.key })}
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
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <label className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">с</span>
                      <input
                        type="date"
                        aria-label="Начало периода"
                        value={fromInput}
                        max={range.today}
                        onChange={(event) => setFromInput(event.target.value)}
                        className="h-8 rounded-lg bg-muted/55 px-2 text-sm tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">по</span>
                      <input
                        type="date"
                        aria-label="Конец периода"
                        value={toInput}
                        max={range.today}
                        onChange={(event) => setToInput(event.target.value)}
                        className="h-8 rounded-lg bg-muted/55 px-2 text-sm tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
                      />
                    </label>
                    <Button type="button" size="sm" variant="secondary" onClick={() => applyRange(fromInput, toInput)} disabled={!fromInput || !toInput}>
                      Показать
                    </Button>
                  </div>
                  <Calendar
                    mode="range"
                    selected={draft}
                    onSelect={handleRangeSelect}
                    numberOfMonths={2}
                    defaultMonth={fromISO(range.from)}
                    disabled={{ after: fromISO(range.today) ?? new Date() }}
                    locale={ru}
                    className="p-0 [--cell-size:2.1rem]"
                  />
                  <p className="text-xs text-muted-foreground">
                    В календаре — первый клик начало, второй конец. Сейчас: {formatRangeLabel(range.from, range.to)} · {range.days} {plural(range.days, DAYS_FORMS)}.
                  </p>
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="size-10 text-muted-foreground"
        aria-label={`Вперёд на ${stepTitle}`}
        title={`Вперёд на ${stepTitle}`}
        disabled={nextDisabled}
        onClick={() => step(1)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}
