"use client"

import { useMemo, useState } from "react"
import { ChevronsUpDownIcon } from "lucide-react"
import type { Product } from "@/lib/db"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type StockActProductPickerProps = {
  products: Product[]
  disabled?: boolean
  placeholder?: string
  onSelect: (product: Product) => void
}

export function StockActProductPicker({
  products,
  disabled,
  placeholder = "Найти товар и добавить в акт",
  onSelect,
}: StockActProductPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const normalizedSearch = search.trim().toLowerCase()

  const results = useMemo(() => {
    if (!normalizedSearch) {
      return []
    }

    return products
      .filter((product) =>
        [product.name, product.code, product.article, product.categoryPath]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch)
      )
      .slice(0, 20)
  }, [normalizedSearch, products])

  function selectProduct(product: Product) {
    onSelect(product)
    setSearch("")
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
      return
    }

    if (event.key !== "Enter") {
      return
    }

    const firstProduct = results[0]
    if (firstProduct) {
      event.preventDefault()
      selectProduct(firstProduct)
    }
  }

  return (
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
            className="h-10 w-full justify-between font-normal"
            disabled={disabled}
          />
        }
      >
        <span className="truncate text-muted-foreground">{placeholder}</span>
        <ChevronsUpDownIcon className="size-4 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="z-[9999] w-(--anchor-width) min-w-[320px] p-0"
      >
        <Command shouldFilter={false} onKeyDown={handleKeyDown}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={placeholder}
            autoFocus
          />
          <CommandList className="max-h-[320px] overflow-y-auto">
            {normalizedSearch ? (
              <>
                <CommandEmpty>Ничего не найдено</CommandEmpty>
                <CommandGroup>
                  {results.map((product) => (
                    <CommandItem
                      key={product.code}
                      value={`${product.name} ${product.code} ${product.article} ${product.categoryPath}`}
                      onSelect={() => selectProduct(product)}
                      className="items-start py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{product.name}</span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
                          <span>{product.code}</span>
                          {product.article && <span className="truncate">арт. {product.article}</span>}
                          {product.categoryPath && <span className="max-w-64 truncate">{product.categoryPath}</span>}
                        </span>
                      </span>
                      <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                        <span className="text-xs font-medium">{formatMoney(product.salePrice)}</span>
                        <span className="flex gap-1">
                          <Badge variant={product.stock < 0 ? "destructive" : "outline"} className="px-1.5 py-0 text-xs">
                            Остаток {formatNumber(product.stock)}
                          </Badge>
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Введите название, код или артикул.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}
