"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DownloadIcon, MinusCircleIcon, PlusCircleIcon, RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react"
import { FilterChips, HeaderAction, HeaderPopover, HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"
import { Field, FieldLabel } from "@/components/ui/field"
import { LineTabs } from "@/components/ui/line-tabs"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SHOP_TIME_ZONE } from "@/lib/datetime"

const DIRECTION_CHIPS = [
  { value: "all", label: "Все движения" },
  { value: "in", label: "Поступления" },
  { value: "out", label: "Списания" },
]

// Типы движений — совпадают с бейджами в таблице истории.
const TYPE_OPTIONS = [
  { value: "all", label: "Все типы" },
  { value: "sale", label: "Реализация" },
  { value: "order_fulfill", label: "Реализация заказа" },
  { value: "stock_in", label: "Пополнение по акту" },
  { value: "stock_out", label: "Списание по акту" },
  { value: "adjustment", label: "Корректировка" },
  { value: "import", label: "Импорт" },
]

// Быстрые пресеты периода — от N дней назад до сегодня (в таймзоне магазина).
const PERIOD_PRESETS = [
  { days: 0, label: "Сегодня" },
  { days: 6, label: "7 дней" },
  { days: 29, label: "30 дней" },
]

function shopTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

// Значение «Без категории» — товары с пустой категорией (синхронно с NO_CATEGORY_FILTER на сервере).
const NO_CATEGORY = "__none__"

type ToolbarProps = {
  // «Продажи» — отчёт по чекам/заказам: только период, категория и поиск.
  // «Журнал движений» — дополнительно тип движения и направление.
  view: "sales" | "moves"
  query: string
  direction: string
  type: string
  category: string
  categories: string[]
  dateFrom: string
  dateTo: string
  // Ссылка «Скачать отчёт (Excel)» для текущих фильтров — собирает страница.
  exportHref: string
}

export function StockHistoryToolbar({ view, query, direction, type, category, categories, dateFrom, dateTo, exportHref }: ToolbarProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [q, setQ] = useState(query)
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setQ(query)
  }

  const isSales = view === "sales"

  // Поиск применяется сам, когда пользователь перестал печатать.
  useEffect(() => {
    if (q.trim() === query.trim()) {
      return
    }
    const handle = setTimeout(() => push({ query: q.trim() }), 350)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query])

  function push(overrides: Partial<ToolbarProps>) {
    const cur = { query: q, direction, type, category, dateFrom, dateTo, ...overrides }
    const params = new URLSearchParams()
    if (!isSales) params.set("view", "moves")
    if (cur.query) params.set("query", cur.query)
    if (!isSales && cur.direction && cur.direction !== "all") params.set("direction", cur.direction)
    if (!isSales && cur.type && cur.type !== "all") params.set("type", cur.type)
    if (cur.category && cur.category !== "all") params.set("category", cur.category)
    if (cur.dateFrom) params.set("dateFrom", cur.dateFrom)
    if (cur.dateTo) params.set("dateTo", cur.dateTo)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `/history/stock?${qs}` : "/history/stock"))
  }

  const hasFilters =
    Boolean(q) ||
    (!isSales && direction !== "all") ||
    (!isSales && type !== "all") ||
    (category !== "all" && category !== "") ||
    Boolean(dateFrom) ||
    Boolean(dateTo)

  const today = shopTodayISO()
  const activePreset = PERIOD_PRESETS.find(
    (preset) => dateTo === today && dateFrom === addDaysISO(today, -preset.days)
  )
  const selectedType = TYPE_OPTIONS.find((option) => option.value === type) ?? TYPE_OPTIONS[0]
  const categoryOptions = [
    { value: "all", label: "Все категории" },
    ...categories.map((name) => ({ value: name, label: name })),
    { value: NO_CATEGORY, label: "Без категории" },
  ]
  const selectedCategory = categoryOptions.find((option) => option.value === category) ?? categoryOptions[0]

  const advancedCount = [
    Boolean(dateFrom) || Boolean(dateTo),
    !isSales && type !== "all",
    category !== "all" && category !== "",
  ].filter(Boolean).length

  // Общие фильтры (период/категория/поиск) переносим между вкладками; тип/направление — только журналу.
  const shared = new URLSearchParams()
  for (const [key, value] of Object.entries({ query, category, dateFrom, dateTo })) {
    if (value && value !== "all") {
      shared.set(key, value)
    }
  }
  const salesQs = shared.toString()
  shared.set("view", "moves")
  const movesQs = shared.toString()

  const dateInputClass =
    "h-10 min-w-0 flex-1 rounded-lg bg-muted/55 px-2.5 text-sm text-foreground tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"

  return (
    <>
      <ScreenHeader
        title="История склада"
        search={{
          value: q,
          onChange: setQ,
          placeholder: "Поиск по товару или коду",
          inputProps: { "aria-label": "Поиск по истории склада" },
        }}
        actions={
          <>
            <HeaderPopover icon={SlidersHorizontalIcon} label="Фильтры" active={advancedCount > 0} count={advancedCount}>
              <div className="flex flex-col gap-4">
                <Field>
                  <FieldLabel>Период</FieldLabel>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      aria-label="Период: с"
                      value={dateFrom}
                      onChange={(event) => push({ dateFrom: event.target.value })}
                      className={dateInputClass}
                    />
                    <span className="text-muted-foreground">—</span>
                    <input
                      type="date"
                      aria-label="Период: по"
                      value={dateTo}
                      onChange={(event) => push({ dateTo: event.target.value })}
                      className={dateInputClass}
                    />
                  </div>
                  <FilterChips
                    value={activePreset ? String(activePreset.days) : ""}
                    options={PERIOD_PRESETS.map((preset) => ({ value: String(preset.days), label: preset.label }))}
                    onValueChange={(value) => push({ dateFrom: addDaysISO(today, -Number(value)), dateTo: today })}
                  />
                </Field>
                {!isSales && (
                  <Field>
                    <FieldLabel>Тип движения</FieldLabel>
                    <Select
                      items={TYPE_OPTIONS}
                      value={type || "all"}
                      onValueChange={(next) => push({ type: next ?? "all" })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Все типы">{selectedType.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectGroup>
                          {TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <Field>
                  <FieldLabel>Категория</FieldLabel>
                  <Select
                    items={categoryOptions}
                    value={category || "all"}
                    onValueChange={(next) => push({ category: next ?? "all" })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Все категории">
                        <span className="block max-w-48 truncate">{selectedCategory.label}</span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {categoryOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </HeaderPopover>
            {hasFilters ? (
              <HeaderAction
                icon={RotateCcwIcon}
                label="Сброс"
                onClick={() => {
                  setQ("")
                  startTransition(() => router.push(isSales ? "/history/stock" : "/history/stock?view=moves"))
                }}
              />
            ) : null}
            <HeaderAction icon={DownloadIcon} label="Excel" href={exportHref} />
            <HeaderAction icon={MinusCircleIcon} label="Списать" href="/stock?new=stock_out" />
          </>
        }
        primaryAction={<HeaderPrimaryAction icon={PlusCircleIcon} label="Пополнить" href="/stock?new=stock_in" />}
      />

      {/* Второй уровень: вид (Продажи / Журнал) подчёркиванием, направление — чипами. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <LineTabs
          aria-label="Вид истории"
          value={view}
          items={[
            { value: "sales", label: "Продажи", href: salesQs ? `/history/stock?${salesQs}` : "/history/stock" },
            { value: "moves", label: "Журнал движений", href: `/history/stock?${movesQs}` },
          ]}
        />
        {!isSales && (
          <FilterChips
            label="Движение"
            value={direction}
            options={DIRECTION_CHIPS}
            onValueChange={(value) => push({ direction: value })}
          />
        )}
      </div>
    </>
  )
}
