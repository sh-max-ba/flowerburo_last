"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { SearchIcon } from "lucide-react"
import type { Product } from "@/lib/db"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ProductThumbnail } from "@/components/products/product-thumbnail"

type ProductComboboxProps = {
  products: Product[]
  disabled?: boolean
  placeholder?: string
  portalDropdown?: boolean
  maxResults?: number
  onSelect: (product: Product) => void
}

const defaultMaxResults = 10

export function ProductCombobox({
  products,
  disabled,
  placeholder = "Найти товар по названию, коду или артикулу",
  portalDropdown = false,
  maxResults = defaultMaxResults,
  onSelect,
}: ProductComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimeoutRef = useRef<number | null>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null)

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
  }, [maxResults, normalizedQuery, products])

  const dropdownOpen = open && normalizedQuery.length > 0

  const updateDropdownRect = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect()
    setDropdownRect(rect ?? null)
  }, [])

  const clearBlurTimeout = useCallback(() => {
    if (blurTimeoutRef.current === null) {
      return
    }

    window.clearTimeout(blurTimeoutRef.current)
    blurTimeoutRef.current = null
  }, [])

  const closeDropdownSoon = useCallback(() => {
    clearBlurTimeout()
    blurTimeoutRef.current = window.setTimeout(() => {
      setOpen(false)
      blurTimeoutRef.current = null
    }, 120)
  }, [clearBlurTimeout])

  useEffect(() => {
    return () => {
      clearBlurTimeout()
    }
  }, [clearBlurTimeout])

  useEffect(() => {
    if (!portalDropdown || !dropdownOpen) {
      return
    }

    updateDropdownRect()
    window.addEventListener("resize", updateDropdownRect)
    window.addEventListener("scroll", updateDropdownRect, true)

    return () => {
      window.removeEventListener("resize", updateDropdownRect)
      window.removeEventListener("scroll", updateDropdownRect, true)
    }
  }, [dropdownOpen, portalDropdown, updateDropdownRect])

  function selectProduct(product: Product) {
    clearBlurTimeout()
    onSelect(product)
    setQuery("")
    setOpen(false)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
      return
    }

    if (event.key !== "Enter" || !dropdownOpen) {
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
        value={query ?? ""}
        disabled={disabled}
        onBlur={closeDropdownSoon}
        onChange={(event) => {
          const nextQuery = event.target.value
          setQuery(nextQuery)
          setOpen(nextQuery.trim().length > 0)
          updateDropdownRect()
        }}
        onFocus={() => {
          clearBlurTimeout()
          setOpen(query.trim().length > 0)
          updateDropdownRect()
        }}
        onKeyDown={handleKeyDown}
      />

      {dropdownOpen &&
        (portalDropdown && dropdownRect && typeof document !== "undefined"
          ? createPortal(
              <ProductComboboxDropdown
                results={results}
                onSelect={selectProduct}
                className="fixed z-[9999]"
                style={{
                  left: dropdownRect.left,
                  top: dropdownRect.bottom + 6,
                  width: dropdownRect.width,
                }}
              />,
              document.body
            )
          : (
            <ProductComboboxDropdown
              results={results}
              onSelect={selectProduct}
              className="absolute left-0 right-0 top-11 z-50"
            />
          ))}
    </div>
  )
}

function ProductComboboxDropdown({
  results,
  onSelect,
  className,
  style,
}: {
  results: Product[]
  onSelect: (product: Product) => void
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 ${className ?? ""}`}
      style={style}
    >
      {results.length > 0 ? (
        <ScrollArea style={{ height: Math.min(results.length * 72, 336) }}>
          <div className="flex flex-col gap-1">
            {results.map((product) => (
              <ProductComboboxRow
                key={product.code}
                product={product}
                onSelect={() => onSelect(product)}
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
  )
}

function ProductComboboxRow({
  product,
  onSelect,
}: {
  product: Product
  onSelect: () => void
}) {
  const hasStockProblem = product.stock < 0

  return (
    <button
      type="button"
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={onSelect}
    >
      <ProductThumbnail name={product.name} imagePath={product.imagePath} size="md" />
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
            Остаток {formatNumber(product.stock)}
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
