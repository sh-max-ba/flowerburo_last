"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { SearchIcon } from "lucide-react"
import { toast } from "sonner"
import type { BouquetTemplate, Product } from "@/lib/db"
import { getBouquetAvailability } from "@/lib/bouquet-availability"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ProductThumbnail } from "@/components/products/product-thumbnail"

type ProductComboboxProps = {
  products: Product[]
  bouquets?: BouquetTemplate[]
  includeBouquets?: boolean
  disabled?: boolean
  placeholder?: string
  portalDropdown?: boolean
  maxResults?: number
  onSelect: (product: Product) => void
  onSelectBouquet?: (bouquet: BouquetTemplate) => void
}

const defaultMaxResults = 10
type ProductComboboxResult =
  | { type: "product"; product: Product }
  | { type: "bouquet"; bouquet: BouquetTemplate }

export function ProductCombobox({
  products,
  bouquets = [],
  includeBouquets = false,
  disabled,
  placeholder = "Найти товар по названию, коду или артикулу",
  portalDropdown = false,
  maxResults = defaultMaxResults,
  onSelect,
  onSelectBouquet,
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

    const productResults: ProductComboboxResult[] = products
      .filter((product) =>
        [product.name, product.code, product.article, product.categoryPath]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
      .map((product) => ({ type: "product", product }))
    const bouquetResults: ProductComboboxResult[] =
      includeBouquets && onSelectBouquet
        ? bouquets
            .filter((bouquet) => bouquet.isActive)
            .filter((bouquet) =>
              [bouquet.name, bouquet.description]
                .join(" ")
                .toLowerCase()
                .includes(normalizedQuery)
            )
            .map((bouquet) => ({ type: "bouquet", bouquet }))
        : []

    return [...productResults, ...bouquetResults].slice(0, maxResults)
  }, [bouquets, includeBouquets, maxResults, normalizedQuery, onSelectBouquet, products])

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

  function selectBouquet(bouquet: BouquetTemplate) {
    if (!onSelectBouquet) {
      return
    }

    clearBlurTimeout()
    if (!getBouquetAvailability(bouquet).available) {
      toast.warning("По букету не хватает позиций на складе")
    }
    onSelectBouquet(bouquet)
    setQuery("")
    setOpen(false)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  function selectResult(result: ProductComboboxResult) {
    if (result.type === "product") {
      selectProduct(result.product)
    } else {
      selectBouquet(result.bouquet)
    }
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
    const firstResult = results[0]
    if (firstResult) {
      selectResult(firstResult)
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
                showTypeBadge={includeBouquets && Boolean(onSelectBouquet)}
                onSelect={selectResult}
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
              showTypeBadge={includeBouquets && Boolean(onSelectBouquet)}
              onSelect={selectResult}
              className="absolute left-0 right-0 top-11 z-50"
            />
          ))}
    </div>
  )
}

function ProductComboboxDropdown({
  results,
  showTypeBadge,
  onSelect,
  className,
  style,
}: {
  results: ProductComboboxResult[]
  showTypeBadge: boolean
  onSelect: (result: ProductComboboxResult) => void
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`rounded-lg bg-white p-1 text-popover-foreground shadow-xl ring-1 ring-zinc-300 ${className ?? ""}`}
      style={style}
    >
      {results.length > 0 ? (
        <ScrollArea style={{ height: Math.min(results.length * 72, 336) }}>
          <div className="flex flex-col gap-1">
            {results.map((result) => (
              result.type === "product" ? (
                <ProductComboboxRow
                  key={`product-${result.product.code}`}
                  product={result.product}
                  showTypeBadge={showTypeBadge}
                  onSelect={() => onSelect(result)}
                />
              ) : (
                <BouquetComboboxRow
                  key={`bouquet-${result.bouquet.id}`}
                  bouquet={result.bouquet}
                  onSelect={() => onSelect(result)}
                />
              )
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
  showTypeBadge,
  onSelect,
}: {
  product: Product
  showTypeBadge: boolean
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
          {showTypeBadge && <Badge variant="secondary" className="px-1.5 py-0 text-xs">Товар</Badge>}
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

function BouquetComboboxRow({
  bouquet,
  onSelect,
}: {
  bouquet: BouquetTemplate
  onSelect: () => void
}) {
  const availability = getBouquetAvailability(bouquet)

  return (
    <button
      type="button"
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={onSelect}
    >
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-xs">Букет</Badge>
          {!availability.available && (
            <Badge className="border-amber-200 bg-amber-50 px-1.5 py-0 text-xs text-amber-800">
              Не хватает
            </Badge>
          )}
          <span className="truncate font-medium">{bouquet.name}</span>
        </span>
        {bouquet.description && (
          <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {bouquet.description}
          </span>
        )}
        <span className="mt-1 text-xs text-muted-foreground">
          {bouquet.itemsCount} компонентов
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium">{formatMoney(bouquet.price)}</span>
    </button>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}
