"use client"

import type React from "react"
import { useMemo, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Общая «обвязка» таблиц аналитики: шапка со счётчиком и действиями, кнопки-фильтры с выпадающим
// списком (с поиском для длинных), чипы активных фильтров, постраничная навигация и ссылка
// «в отдельном окне».

export const PAGE_SIZE = 50

// Локальная постраничная выдача для клиентских таблиц.
export function usePagination<T>(rows: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pageCount)
  const pageRows = useMemo(() => rows.slice((current - 1) * pageSize, current * pageSize), [rows, current, pageSize])
  return { page: current, pageCount, pageRows, setPage, total: rows.length, pageSize }
}

type PaginationProps = {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  className?: string
}

// «1–50 из 320 ‹ ›» — прячется, когда всё помещается на одной странице.
export function Pagination({ page, pageCount, total, pageSize, onPageChange, className }: PaginationProps) {
  if (total <= pageSize) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className={cn("flex items-center justify-between gap-3 border-t border-border/40 px-4 py-2 text-xs text-muted-foreground", className)}>
      <span className="tabular-nums">
        {from}–{to} из {total}
      </span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Предыдущая страница">
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-12 text-center tabular-nums">
          {page} / {pageCount}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="Следующая страница">
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}

export type FilterOption = { value: string; label: string; count?: number }

type FilterComboboxProps = {
  label: string
  value: string
  allValue?: string
  allLabel?: string
  options: FilterOption[]
  onValueChange: (value: string) => void
  // Подпись поля поиска; поиск показывается, когда вариантов больше семи.
  searchPlaceholder?: string
  className?: string
}

// Один фильтр — одна кнопка: «Категория» → «Категория: Декор» с точкой. Список с поиском для
// длинных справочников (поставщики), выбор закрывает список, «Все …» сбрасывает.
export function FilterCombobox({
  label,
  value,
  allValue = "all",
  allLabel,
  options,
  onValueChange,
  searchPlaceholder = "Найти…",
  className,
}: FilterComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const active = value !== allValue && value !== ""
  const current = options.find((option) => option.value === value)
  const searchable = options.length > 7
  const results = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options
  }, [options, search])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch("")
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("h-8 max-w-64 gap-1.5 text-muted-foreground hover:text-foreground pointer-coarse:h-9", active && "bg-muted text-foreground", className)}
            aria-label={active && current ? `${label}: ${current.label}` : label}
          />
        }
      >
        <span className="truncate">{active && current ? `${label}: ${current.label}` : label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-0">
        <Command shouldFilter={false} loop>
          {searchable ? <CommandInput value={search} onValueChange={setSearch} placeholder={searchPlaceholder} autoFocus /> : null}
          <CommandList className="max-h-72 overflow-y-auto">
            <CommandGroup>
              <CommandItem
                value={`__all__${label}`}
                onSelect={() => {
                  onValueChange(allValue)
                  setOpen(false)
                }}
              >
                <CheckIcon className={cn("size-4 shrink-0", active ? "opacity-0" : "opacity-100")} aria-hidden />
                <span className="font-medium">{allLabel ?? `Все ${label.toLowerCase()}`}</span>
              </CommandItem>
              {results.length ? (
                results.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.value}::${option.label}`}
                    onSelect={() => {
                      onValueChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <CheckIcon className={cn("size-4 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.count !== undefined ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{option.count}</span> : null}
                  </CommandItem>
                ))
              ) : (
                <CommandItem value="__empty__" disabled>
                  Ничего не найдено
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export type ActiveFilterChip = { key: string; label: string; onRemove: () => void }

// Чипы активных фильтров с крестиком — рядом с кнопкой «Фильтры».
export function ActiveFilters({ chips }: { chips: ActiveFilterChip[] }) {
  if (!chips.length) return null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          className="inline-flex h-7 max-w-64 items-center gap-1 rounded-md bg-muted px-2 text-xs font-medium text-foreground hover:bg-zinc-200 pointer-coarse:h-8"
          title="Убрать фильтр"
        >
          <span className="truncate">{chip.label}</span>
          <XIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ))}
    </div>
  )
}

// Открыть текущую таблицу в отдельном окне — та же страница без меню и вкладок (?full=1).
export function OpenInWindowLink({ className, label = "В отдельном окне" }: { className?: string; label?: string }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = new URLSearchParams(searchParams.toString())
  params.set("full", "1")
  return (
    <a
      href={`${pathname}?${params.toString()}`}
      target="_blank"
      rel="noopener"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
      title={label}
      aria-label={label}
    >
      <ExternalLinkIcon className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </a>
  )
}

// Шапка блока-таблицы: слева фильтры/чипы, справа счётчик и действия.
export function TableToolbar({ left, right, className }: { left?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 px-3 pt-3 pb-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{left}</div>
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{right}</div>
    </div>
  )
}

// Всплывающий диапазон сумм «от — до» для фильтра по величине.
export function RangeFilter({
  label,
  from,
  to,
  onChange,
  unit = "сом",
}: {
  label: string
  from: string
  to: string
  onChange: (next: { from: string; to: string }) => void
  unit?: string
}) {
  const active = Boolean(from || to)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("h-8 gap-1.5 text-muted-foreground hover:text-foreground pointer-coarse:h-9", active && "bg-muted text-foreground")}
          />
        }
      >
        {label}
        {active ? (
          <span className="text-xs tabular-nums">
            {from || "0"}–{to || "∞"}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          {label}, {unit}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            placeholder="от"
            value={from}
            onChange={(event) => onChange({ from: event.target.value, to })}
            className="h-9 w-full min-w-0 rounded-lg bg-muted/55 px-2.5 text-sm tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
          />
          <span className="text-muted-foreground">—</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="до"
            value={to}
            onChange={(event) => onChange({ from, to: event.target.value })}
            className="h-9 w-full min-w-0 rounded-lg bg-muted/55 px-2.5 text-sm tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
          />
        </div>
        {active ? (
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => onChange({ from: "", to: "" })}>
            Сбросить
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
