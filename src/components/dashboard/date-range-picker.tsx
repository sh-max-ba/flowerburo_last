"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { DateRange } from "react-day-picker"
import { ru } from "date-fns/locale"
import { CalendarIcon, ChevronDownIcon } from "lucide-react"
import type { OwnerDashboardRange } from "@/lib/db"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const PRESETS = [
  { key: "today", label: "Сегодня" },
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "month", label: "Месяц" },
] as const

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

function formatDay(value: string) {
  const date = fromISO(value)
  return date
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date)
    : value
}

function rangeLabel(range: OwnerDashboardRange) {
  const preset = PRESETS.find((p) => p.key === range.preset)
  if (preset) return preset.label
  if (range.from === range.to) return formatDay(range.from)
  return `${formatDay(range.from)} – ${formatDay(range.to)}`
}

/**
 * Селектор периода дашборда: пресеты (Сегодня / 7 дней / 30 дней / Месяц) +
 * произвольный диапазон через календарь. Меняет URL (?preset= или ?from=&to=),
 * страница перечитывает данные на сервере.
 */
export function DateRangePicker({ range }: { range: OwnerDashboardRange }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>({
    from: fromISO(range.from),
    to: fromISO(range.to),
  })

  function applyPreset(key: string) {
    setOpen(false)
    router.push(`/dashboard?preset=${key}`)
  }

  function handleSelect(selected: DateRange | undefined) {
    setDraft(selected)
    if (selected?.from && selected?.to) {
      setOpen(false)
      router.push(`/dashboard?from=${toISO(selected.from)}&to=${toISO(selected.to)}`)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none">
      <CalendarIcon className="size-4 text-muted-foreground" />
        {rangeLabel(range)}
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row gap-1 border-b border-zinc-100 p-2 sm:flex-col sm:border-r sm:border-b-0">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors hover:bg-zinc-50",
                  range.preset === preset.key
                    ? "bg-brand-subtle font-medium text-brand-strong"
                    : "text-zinc-700"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Calendar
            mode="range"
            selected={draft}
            onSelect={handleSelect}
            numberOfMonths={1}
            locale={ru}
            className="p-2"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
