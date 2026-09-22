"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MinusCircleIcon, PlusCircleIcon, RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react"
import { StockActsSupplierFilter } from "@/components/stock/stock-acts-supplier-filter"
import { FilterChips, HeaderAction, HeaderPopover, HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"
import { Field, FieldLabel } from "@/components/ui/field"
import { SHOP_TIME_ZONE } from "@/lib/datetime"
import type { Supplier } from "@/lib/db"

const STATUS_CHIPS = [
  { value: "all", label: "Все статусы" },
  { value: "draft", label: "Черновики" },
  { value: "posted", label: "Проведенные" },
  { value: "corrected", label: "Скорректированные" },
  { value: "cancelled", label: "Отмененные" },
]
const TYPE_CHIPS = [
  { value: "all", label: "Все типы" },
  { value: "stock_in", label: "Пополнение" },
  { value: "stock_out", label: "Списание" },
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

// Пока в <input type="date"> набирают ГОД, браузер шлёт change на каждой цифре: «2» приходит как
// 0002-…, «20» как 0020-… . Если применять такое значение сразу, страница уходит на новый URL и
// возвращает в поле обрезанную дату — ввод «сбивается». Поэтому применяем только завершённое
// значение: пустое (снять фильтр) или дату с четырёхзначным годом.
function isCommittableDate(value: string): boolean {
  if (value === "") {
    return true
  }
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(value)
  return match ? Number(match[1]) >= 1000 : false
}

type ToolbarProps = {
  suppliers: Supplier[]
  query: string
  status: string
  type: string
  supplier: string
  dateFrom: string
  dateTo: string
  sumFrom: string
  sumTo: string
}

export function StockActsToolbar({
  suppliers,
  query,
  status,
  type,
  supplier,
  dateFrom,
  dateTo,
  sumFrom,
  sumTo,
}: ToolbarProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [q, setQ] = useState(query)
  const [sFrom, setSFrom] = useState(sumFrom)
  const [sTo, setSTo] = useState(sumTo)
  // Даты тоже локальные: незавершённый ввод года не должен уезжать в URL (см. isCommittableDate).
  const [dFrom, setDFrom] = useState(dateFrom)
  const [dTo, setDTo] = useState(dateTo)
  // Синхронизируем локальный ввод с URL при внешней смене значений (Сброс, назад/вперёд) —
  // без эффекта, по рекомендованному React-паттерну «правка состояния во время рендера».
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setQ(query)
  }
  const [prevSumFrom, setPrevSumFrom] = useState(sumFrom)
  if (prevSumFrom !== sumFrom) {
    setPrevSumFrom(sumFrom)
    setSFrom(sumFrom)
  }
  const [prevSumTo, setPrevSumTo] = useState(sumTo)
  if (prevSumTo !== sumTo) {
    setPrevSumTo(sumTo)
    setSTo(sumTo)
  }
  // Даты ресинхроним ТОЛЬКО на внешнее изменение URL (Сброс, назад/вперёд). Приход в пропсах
  // того, что мы сами только что отправили, — эхо нашей же навигации: если перетереть им локальный
  // ввод, дата собьётся у того, кто начал править её, не дождавшись ответа сервера.
  const [sentDateFrom, setSentDateFrom] = useState(dateFrom)
  const [sentDateTo, setSentDateTo] = useState(dateTo)
  const [prevDateFrom, setPrevDateFrom] = useState(dateFrom)
  if (prevDateFrom !== dateFrom) {
    setPrevDateFrom(dateFrom)
    if (dateFrom !== sentDateFrom) {
      setSentDateFrom(dateFrom)
      setDFrom(dateFrom)
    }
  }
  const [prevDateTo, setPrevDateTo] = useState(dateTo)
  if (prevDateTo !== dateTo) {
    setPrevDateTo(dateTo)
    if (dateTo !== sentDateTo) {
      setSentDateTo(dateTo)
      setDTo(dateTo)
    }
  }

  // Поиск применяется сам, когда пользователь перестал печатать (URL-фильтр, как и остальные).
  useEffect(() => {
    if (q.trim() === query.trim()) {
      return
    }
    const handle = setTimeout(() => push({ query: q.trim() }), 350)
    return () => clearTimeout(handle)
    // push пересоздаётся каждый рендер; зависимость только от ввода и серверного значения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query])

  function push(overrides: Partial<Omit<ToolbarProps, "suppliers">>) {
    const cur = { query: q, status, type, supplier, dateFrom: dFrom, dateTo: dTo, sumFrom: sFrom, sumTo: sTo, ...overrides }
    // Любой push фиксирует даты и локально, и как «отправленные» — чтобы пресеты периода сразу
    // попадали в поля, а эхо навигации не считалось внешним изменением.
    setDFrom(cur.dateFrom)
    setSentDateFrom(cur.dateFrom)
    setDTo(cur.dateTo)
    setSentDateTo(cur.dateTo)
    const params = new URLSearchParams()
    if (cur.query) params.set("query", cur.query)
    if (cur.status && cur.status !== "all") params.set("status", cur.status)
    if (cur.type && cur.type !== "all") params.set("type", cur.type)
    if (cur.supplier && cur.supplier !== "all") params.set("supplier", cur.supplier)
    if (cur.dateFrom) params.set("dateFrom", cur.dateFrom)
    if (cur.dateTo) params.set("dateTo", cur.dateTo)
    if (cur.sumFrom) params.set("sumFrom", cur.sumFrom)
    if (cur.sumTo) params.set("sumTo", cur.sumTo)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `/stock/acts?${qs}` : "/stock/acts"))
  }

  const hasFilters =
    Boolean(q) ||
    status !== "all" ||
    type !== "all" ||
    supplier !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(sumFrom) ||
    Boolean(sumTo)

  const today = shopTodayISO()
  const activePreset = PERIOD_PRESETS.find(
    (preset) => dateTo === today && dateFrom === addDaysISO(today, -preset.days)
  )

  const advancedCount = [supplier !== "all", Boolean(dateFrom) || Boolean(dateTo), Boolean(sumFrom) || Boolean(sumTo)].filter(Boolean).length

  function reset() {
    setQ("")
    setSFrom("")
    setSTo("")
    setDFrom("")
    setSentDateFrom("")
    setDTo("")
    setSentDateTo("")
    startTransition(() => router.push("/stock/acts"))
  }

  return (
    <>
      <ScreenHeader
        title="Акты склада"
        search={{
          value: q,
          onChange: setQ,
          placeholder: "Поиск по номеру или комментарию",
          inputProps: { "aria-label": "Поиск актов" },
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
                      aria-label="Дата операции: с"
                      value={dFrom}
                      onChange={(event) => {
                        const next = event.target.value
                        setDFrom(next)
                        // Применяем только завершённую дату — иначе набор года перебивает ввод.
                        if (isCommittableDate(next)) push({ dateFrom: next })
                      }}
                      onBlur={() => {
                        // Ушли с недобранной даты — возвращаем то, что реально в фильтре (последнее
                        // отправленное значение: навигация могла ещё не долететь).
                        if (!isCommittableDate(dFrom)) setDFrom(sentDateFrom)
                      }}
                      className="h-10 min-w-0 flex-1 rounded-lg bg-muted/55 px-2.5 text-sm text-foreground tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
                    />
                    <span className="text-muted-foreground">—</span>
                    <input
                      type="date"
                      aria-label="Дата операции: по"
                      value={dTo}
                      onChange={(event) => {
                        const next = event.target.value
                        setDTo(next)
                        if (isCommittableDate(next)) push({ dateTo: next })
                      }}
                      onBlur={() => {
                        if (!isCommittableDate(dTo)) setDTo(sentDateTo)
                      }}
                      className="h-10 min-w-0 flex-1 rounded-lg bg-muted/55 px-2.5 text-sm text-foreground tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
                    />
                  </div>
                  <FilterChips
                    value={activePreset ? String(activePreset.days) : ""}
                    options={PERIOD_PRESETS.map((preset) => ({ value: String(preset.days), label: preset.label }))}
                    onValueChange={(value) => push({ dateFrom: addDaysISO(today, -Number(value)), dateTo: today })}
                  />
                </Field>
                <Field>
                  <FieldLabel>Сумма</FieldLabel>
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault()
                      push({})
                    }}
                  >
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="от"
                      aria-label="Сумма от"
                      value={sFrom}
                      onChange={(event) => setSFrom(event.target.value)}
                      onBlur={() => {
                        if (sFrom !== sumFrom) push({})
                      }}
                      className="h-10 min-w-0 flex-1 rounded-lg bg-muted/55 px-2.5 text-sm text-foreground tabular-nums outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
                    />
                    <span className="text-muted-foreground">—</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="до"
                      aria-label="Сумма до"
                      value={sTo}
                      onChange={(event) => setSTo(event.target.value)}
                      onBlur={() => {
                        if (sTo !== sumTo) push({})
                      }}
                      className="h-10 min-w-0 flex-1 rounded-lg bg-muted/55 px-2.5 text-sm text-foreground tabular-nums outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
                    />
                    <button type="submit" className="sr-only">
                      Применить
                    </button>
                  </form>
                </Field>
                <Field>
                  <FieldLabel>Поставщик</FieldLabel>
                  <StockActsSupplierFilter
                    suppliers={suppliers}
                    value={supplier}
                    onChange={(next) => push({ supplier: next })}
                  />
                </Field>
              </div>
            </HeaderPopover>
            {hasFilters ? <HeaderAction icon={RotateCcwIcon} label="Сброс" onClick={reset} /> : null}
            <HeaderAction icon={MinusCircleIcon} label="Списать" href="/stock?new=stock_out" />
          </>
        }
        primaryAction={<HeaderPrimaryAction icon={PlusCircleIcon} label="Пополнить" href="/stock?new=stock_in" />}
      />

      {/* Второй уровень: статус и тип — чипы внутри контента. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
        <FilterChips label="Статус" value={status} options={STATUS_CHIPS} onValueChange={(value) => push({ status: value })} />
        <FilterChips label="Тип" value={type} options={TYPE_CHIPS} onValueChange={(value) => push({ type: value })} />
      </div>
    </>
  )
}
