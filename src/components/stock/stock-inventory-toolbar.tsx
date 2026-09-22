"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react"
import { FilterChips, HeaderAction, HeaderPopover, ScreenHeader } from "@/components/screen-header"
import { Field, FieldLabel } from "@/components/ui/field"

const STATUS_CHIPS = [
  { value: "all", label: "Все статусы" },
  { value: "draft", label: "Черновики" },
  { value: "posted", label: "Проведённые" },
  { value: "cancelled", label: "Отменённые" },
]

type ToolbarProps = {
  query: string
  status: string
  dateFrom: string
  dateTo: string
  // Главное действие («Новая инвентаризация») — отдельный клиентский компонент, передаёт страница.
  primaryAction?: React.ReactNode
}

// Шапка списка инвентаризаций: поиск по номеру/комментарию, период — в поповере, статус — чипами.
// URL-параметры читает серверная страница и передаёт в listStockDocuments({ type: "count", ... }).
export function StockInventoryToolbar({ query, status, dateFrom, dateTo, primaryAction }: ToolbarProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [q, setQ] = useState(query)
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setQ(query)
  }

  // Поиск применяется сам, когда пользователь перестал печатать.
  useEffect(() => {
    if (q.trim() === query.trim()) {
      return
    }
    const handle = setTimeout(() => push({ query: q.trim() }), 350)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query])

  function push(overrides: Partial<Omit<ToolbarProps, "primaryAction">>) {
    const cur = { query: q, status, dateFrom, dateTo, ...overrides }
    const params = new URLSearchParams()
    if (cur.query) params.set("query", cur.query)
    if (cur.status && cur.status !== "all") params.set("status", cur.status)
    if (cur.dateFrom) params.set("dateFrom", cur.dateFrom)
    if (cur.dateTo) params.set("dateTo", cur.dateTo)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `/stock/inventory?${qs}` : "/stock/inventory"))
  }

  const hasFilters = Boolean(q) || status !== "all" || Boolean(dateFrom) || Boolean(dateTo)
  const periodActive = Boolean(dateFrom) || Boolean(dateTo)
  const dateInputClass =
    "h-10 min-w-0 flex-1 rounded-lg bg-muted/55 px-2.5 text-sm text-foreground tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"

  return (
    <>
      <ScreenHeader
        title="Инвентаризация"
        search={{
          value: q,
          onChange: setQ,
          placeholder: "Поиск по номеру или комментарию",
          inputProps: { "aria-label": "Поиск инвентаризаций" },
        }}
        actions={
          <>
            <HeaderPopover icon={SlidersHorizontalIcon} label="Период" active={periodActive}>
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
              </Field>
            </HeaderPopover>
            {hasFilters ? (
              <HeaderAction
                icon={RotateCcwIcon}
                label="Сброс"
                onClick={() => {
                  setQ("")
                  startTransition(() => router.push("/stock/inventory"))
                }}
              />
            ) : null}
          </>
        }
        primaryAction={primaryAction}
      />

      <FilterChips
        className="shrink-0"
        label="Статус"
        value={status}
        options={STATUS_CHIPS}
        onValueChange={(value) => push({ status: value })}
      />
    </>
  )
}
