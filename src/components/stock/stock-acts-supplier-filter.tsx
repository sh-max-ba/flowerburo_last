"use client"

import { useMemo, useState } from "react"
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react"
import type { Supplier } from "@/lib/db"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Значение фильтра «без поставщика» (акты, у которых контрагент не указан).
const NO_SUPPLIER = "none"

// Фильтр актов склада по контрагенту: поиск по названию + отметка нескольких поставщиков сразу.
// Значение — то же, что в query-string: "all" | "none" | список id через запятую («1,4,7»);
// разбор на стороне сервера — в listStockDocuments. Навигацию делает родительский тулбар, чтобы
// выбор контрагента не затирал уже набранные, но ещё не применённые фильтры.
export function StockActsSupplierFilter({
  suppliers,
  value,
  disabled,
  onChange,
}: {
  suppliers: Supplier[]
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const selectedIds = useMemo(() => parseSupplierValue(value), [value])
  const noSupplierSelected = value.trim() === NO_SUPPLIER
  const selected = suppliers.filter((supplier) => selectedIds.includes(supplier.id))

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) {
      return suppliers
    }
    return suppliers.filter((supplier) => supplier.name.toLowerCase().includes(needle))
  }, [suppliers, search])

  function toggleSupplier(supplierId: number) {
    // Отметка конкретного контрагента снимает взаимоисключающие «Все» и «Без поставщика».
    const next = selectedIds.includes(supplierId)
      ? selectedIds.filter((id) => id !== supplierId)
      : [...selectedIds, supplierId]
    onChange(next.length ? next.join(",") : "all")
  }

  const label = noSupplierSelected
    ? "Без поставщика"
    : selected.length === 0
      ? "Все контрагенты"
      : selected.length === 1
        ? selected[0].name
        : `Контрагентов: ${selected.length}`

  const hasSelection = noSupplierSelected || selected.length > 0

  return (
    <div className="flex h-10 min-w-0 shrink-0 items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            setSearch("")
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-10 w-full min-w-52 justify-between bg-white font-normal sm:w-64"
            />
          }
        >
          <span className={cn("min-w-0 truncate text-left", !hasSelection && "text-muted-foreground")}>{label}</span>
          <ChevronsUpDownIcon className="opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-(--anchor-width) min-w-[300px] p-0">
          <Command shouldFilter={false} loop>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="Найти контрагента по названию"
              autoFocus
            />
            <CommandList className="max-h-[320px] overflow-y-auto">
              <CommandGroup>
                <CommandItem
                  value="Все контрагенты"
                  onSelect={() => {
                    onChange("all")
                    setOpen(false)
                  }}
                >
                  <CheckMark active={!hasSelection} />
                  <span className="font-medium">Все контрагенты</span>
                </CommandItem>
                <CommandItem
                  value="Без поставщика"
                  onSelect={() => {
                    onChange(noSupplierSelected ? "all" : NO_SUPPLIER)
                    setOpen(false)
                  }}
                >
                  <CheckMark active={noSupplierSelected} />
                  <span>Без поставщика</span>
                </CommandItem>
              </CommandGroup>
              <CommandGroup>
                {results.length ? (
                  results.map((supplier) => {
                    const active = selectedIds.includes(supplier.id)
                    return (
                      <CommandItem
                        key={supplier.id}
                        value={supplier.name}
                        // Список остаётся открытым: контрагентов отмечают пачкой.
                        onSelect={() => toggleSupplier(supplier.id)}
                      >
                        <CheckMark active={active} />
                        <span className="min-w-0 flex-1 truncate">{supplier.name}</span>
                        {!supplier.isActive && (
                          <span className="shrink-0 text-xs text-muted-foreground">в архиве</span>
                        )}
                      </CommandItem>
                    )
                  })
                ) : (
                  <CommandItem value="Контрагент не найден" disabled>
                    Контрагент не найден
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
          {selected.length > 1 && (
            <div className="flex flex-wrap gap-1 border-t p-2">
              {selected.map((supplier) => (
                <Badge key={supplier.id} variant="secondary" className="max-w-48 gap-1">
                  <span className="truncate">{supplier.name}</span>
                  <button
                    type="button"
                    aria-label={`Убрать ${supplier.name}`}
                    onClick={() => toggleSupplier(supplier.id)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {hasSelection && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={() => onChange("all")}
        >
          <XIcon />
          <span className="sr-only">Сбросить контрагентов</span>
        </Button>
      )}
    </div>
  )
}

function CheckMark({ active }: { active: boolean }) {
  return <CheckIcon className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-0")} />
}

// "all" / "none" / "1,4,7" → [1, 4, 7]. Мусор и дубли отбрасываются.
export function parseSupplierValue(value: string): number[] {
  const raw = String(value ?? "").trim()
  if (!raw || raw === "all" || raw === NO_SUPPLIER) {
    return []
  }

  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ]
}
