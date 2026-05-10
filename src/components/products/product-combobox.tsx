"use client"

import { useMemo, useRef, useState } from "react"
import { SearchIcon } from "lucide-react"
import type { Product } from "@/lib/db"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

type ProductComboboxProps = {
  products: Product[]
  disabled?: boolean
  placeholder?: string
  onSelect: (product: Product) => void
}

const maxResults = 10

export function ProductCombobox({
  products,
  disabled,
  placeholder = "Найти товар по названию, коду или артикулу",
  onSelect,
}: ProductComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(false)

  const normalizedQuery = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!normalizedQuery) {
      return []
    }

    return products
      .filter((product) =>
        [product.name, product.code, product.article, product.categoryPath]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
      .slice(0, maxResults)
  }, [normalizedQuery, products])

  const dropdownOpen = focused && normalizedQuery.length > 0

  function selectProduct(product: Product) {
    onSelect(product)
    setQuery("")
    setFocused(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return
    }

    event.preventDefault()
    const firstProduct = results[0]
    if (firstProduct) {
      selectProduct(firstProduct)
    }
  }

  return (
    <div className="relative min-w-0">
      <SearchIcon className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        className="h-10 pl-9"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={handleKeyDown}
      />

      {dropdownOpen && (
        <div className="absolute left-0 right-0 top-11 z-50 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {results.length > 0 ? (
            <ScrollArea style={{ height: Math.min(results.length * 66, 320) }}>
              <div className="flex flex-col gap-1">
                {results.map((product) => (
                  <ProductComboboxRow
                    key={product.code}
                    product={product}
                    onSelect={() => selectProduct(product)}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <Empty className="py-4">
              <EmptyHeader>
                <EmptyTitle>Ничего не найдено</EmptyTitle>
                <EmptyDescription>Попробуйте название, код или артикул.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      )}
    </div>
  )
}

function ProductComboboxRow({
  product,
  onSelect,
}: {
  product: Product
  onSelect: () => void
}) {
  const hasStockProblem = product.available < 0 || product.stock < 0

  return (
    <button
      type="button"
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onMouseDown={(event) => {
        event.preventDefault()
        onSelect()
      }}
      onClick={onSelect}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{product.name}</span>
        <span className="mt-0.5 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span>{product.code}</span>
          {product.article && <span className="truncate">арт. {product.article}</span>}
          {product.categoryPath && <span className="max-w-64 truncate">{product.categoryPath}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs font-medium">{formatMoney(product.salePrice)}</span>
        <span className="flex gap-1">
          <Badge variant={hasStockProblem ? "destructive" : "outline"} className="px-1.5 py-0 text-xs">
            {formatNumber(product.available)}
          </Badge>
          {product.salePrice === 0 && (
            <Badge className="border-amber-200 bg-amber-50 px-1.5 py-0 text-xs text-amber-800">
              Цена 0
            </Badge>
          )}
        </span>
      </span>
    </button>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}
