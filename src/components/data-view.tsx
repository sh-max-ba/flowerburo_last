"use client"

import type React from "react"
import { useMemo, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type DataViewSortDirection = "asc" | "desc"
export type DataViewSort = { key: string; direction: DataViewSortDirection }

export type DataViewColumn<T> = {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  // Значение для сортировки — колонка сортируется кликом по заголовку, только если задано.
  sortValue?: (row: T) => string | number | null | undefined
  // Направление первой сортировки по клику (для «свежих сверху» — desc).
  defaultDirection?: DataViewSortDirection
  align?: "left" | "right"
  // Второстепенная колонка: скрыта, пока контейнер таблицы уже 896px (@4xl) — планшет в
  // портрете и lg с полным сайдбаром показывают только главные колонки.
  secondary?: boolean
  // Точнее, чем secondary: до какой ширины контейнера колонку прятать (@3xl = 768px, @4xl = 896, @5xl = 1024).
  hideBelow?: "3xl" | "4xl" | "5xl"
  // Колонка-«резина»: забирает остаток ширины, содержимое обрезается (truncate), а не
  // раздвигает таблицу.
  grow?: boolean
  // Классы для th и td (ширина, tabular-nums и т.п.).
  className?: string
  cellClassName?: string
}

type DataViewProps<T> = {
  rows: T[]
  columns: DataViewColumn<T>[]
  getRowKey: (row: T) => string | number
  // Управляемая сортировка (sort + onSortChange) или неуправляемая (defaultSort).
  sort?: DataViewSort | null
  defaultSort?: DataViewSort | null
  onSortChange?: (sort: DataViewSort | null) => void
  // Клик по строке (переход в карточку). Клики по ссылкам/кнопкам внутри строки не перехватываются.
  onRowSelect?: (row: T) => void
  // Действия строки — видны всегда, не только по hover. Крайняя правая колонка.
  rowActions?: (row: T) => React.ReactNode
  rowClassName?: (row: T) => string | undefined
  // Карточка строки до md: 3–4 поля, действия справа.
  renderCard: (row: T) => React.ReactNode
  empty?: React.ReactNode
  // Прилипающий заголовок — относительно ближайшего скроллящегося предка (рабочей области).
  stickyHeader?: boolean
  className?: string
}

// Универсальная таблица списка: сортировка кликом по заголовку, строки 44px (на тач 48),
// hover-фон, действия видны всегда, второстепенные колонки скрыты в узком контейнере,
// в совсем узком (< @2xl, 672px) — карточки. Брейкпоинты — контейнерные, а не viewport:
// ширина рабочей области зависит от сайдбара (рельс/полный), а не только от экрана.
// Таблица занимает всю ширину рабочей области, без внешней рамки — разделители строк border-border/40.
const hideBelowClass: Record<NonNullable<DataViewColumn<unknown>["hideBelow"]>, string> = {
  "3xl": "hidden @3xl/dataview:table-cell",
  "4xl": "hidden @4xl/dataview:table-cell",
  "5xl": "hidden @5xl/dataview:table-cell",
}

function columnVisibility<T>(column: DataViewColumn<T>) {
  const tier = column.hideBelow ?? (column.secondary ? "4xl" : null)
  return tier ? hideBelowClass[tier] : undefined
}

export function DataView<T>({
  rows,
  columns,
  getRowKey,
  sort: controlledSort,
  defaultSort = null,
  onSortChange,
  onRowSelect,
  rowActions,
  rowClassName,
  renderCard,
  empty,
  stickyHeader = true,
  className,
}: DataViewProps<T>) {
  const [internalSort, setInternalSort] = useState<DataViewSort | null>(defaultSort)
  const sort = controlledSort !== undefined ? controlledSort : internalSort

  function updateSort(next: DataViewSort | null) {
    if (controlledSort === undefined) {
      setInternalSort(next)
    }
    onSortChange?.(next)
  }

  function toggleSort(column: DataViewColumn<T>) {
    if (!column.sortValue) {
      return
    }
    const firstDirection = column.defaultDirection ?? "asc"
    if (!sort || sort.key !== column.key) {
      updateSort({ key: column.key, direction: firstDirection })
      return
    }
    // Второй клик — обратное направление, третий — снимает сортировку (исходный порядок).
    if (sort.direction === firstDirection) {
      updateSort({ key: column.key, direction: firstDirection === "asc" ? "desc" : "asc" })
      return
    }
    updateSort(null)
  }

  const sortedRows = useMemo(() => {
    if (!sort) {
      return rows
    }
    const column = columns.find((entry) => entry.key === sort.key)
    if (!column?.sortValue) {
      return rows
    }
    const getValue = column.sortValue
    const factor = sort.direction === "asc" ? 1 : -1
    return rows
      .map((row, index) => ({ row, index, value: getValue(row) }))
      .sort((a, b) => {
        const compared = compareValues(a.value, b.value)
        if (compared !== 0) {
          return compared * factor
        }
        return a.index - b.index
      })
      .map((entry) => entry.row)
  }, [rows, columns, sort])

  if (!rows.length) {
    return <>{empty ?? null}</>
  }

  function handleRowClick(event: React.MouseEvent<HTMLElement>, row: T) {
    if (!onRowSelect) {
      return
    }
    const target = event.target as HTMLElement
    // Ссылки, кнопки и поля внутри строки работают сами — не уводим со строки.
    if (target.closest("a, button, input, select, textarea, [role=menuitem], [role=menu], [data-row-action]")) {
      return
    }
    onRowSelect(row)
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLElement>, row: T) {
    if (!onRowSelect || event.target !== event.currentTarget) {
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onRowSelect(row)
    }
  }

  return (
    <div className={cn("@container/dataview min-w-0", className)}>
      {/* широкий контейнер: таблица на всю ширину */}
      <table className="hidden w-full caption-bottom border-collapse text-sm @2xl/dataview:table">
        <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-background")}>
          <TableRow>
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue)
              const active = sort?.key === column.key
              return (
                <TableHead
                  key={column.key}
                  aria-sort={active ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    column.align === "right" && "text-right",
                    columnVisibility(column),
                    column.grow && "w-full min-w-40 max-w-0",
                    column.className
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className={cn(
                        "inline-flex h-8 items-center gap-1 rounded-md px-1 -mx-1 transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:outline-none",
                        active ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {column.header}
                      {active ? (
                        sort?.direction === "asc" ? (
                          <ArrowUpIcon className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowDownIcon className="size-3.5" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDownIcon className="size-3.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              )
            })}
            {rowActions ? (
              <TableHead className="w-0 text-right">
                <span className="sr-only">Действия</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row) => (
            <TableRow
              key={getRowKey(row)}
              className={cn(onRowSelect && "cursor-pointer", rowClassName?.(row))}
              role={onRowSelect ? "link" : undefined}
              tabIndex={onRowSelect ? 0 : undefined}
              onClick={(event) => handleRowClick(event, row)}
              onKeyDown={(event) => handleRowKeyDown(event, row)}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    column.align === "right" && "text-right",
                    columnVisibility(column),
                    column.grow && "w-full min-w-40 max-w-0 truncate",
                    column.className,
                    column.cellClassName
                  )}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
              {rowActions ? (
                <TableCell className="w-0 text-right">
                  <div className="flex items-center justify-end gap-1" data-row-action>
                    {rowActions(row)}
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </table>

      {/* узкий контейнер: карточки */}
      <ul className="flex flex-col divide-y divide-border/40 @2xl/dataview:hidden">
        {sortedRows.map((row) => (
          <li
            key={getRowKey(row)}
            className={cn(onRowSelect && "cursor-pointer", rowClassName?.(row))}
            role={onRowSelect ? "link" : undefined}
            tabIndex={onRowSelect ? 0 : undefined}
            onClick={(event) => handleRowClick(event, row)}
            onKeyDown={(event) => handleRowKeyDown(event, row)}
          >
            {renderCard(row)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined
) {
  const aEmpty = a === null || a === undefined || a === ""
  const bEmpty = b === null || b === undefined || b === ""
  if (aEmpty && bEmpty) {
    return 0
  }
  // Пустые значения всегда в конце, независимо от направления.
  if (aEmpty) {
    return 1
  }
  if (bEmpty) {
    return -1
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b
  }
  return String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" })
}
