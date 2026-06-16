"use client"

import { useMemo, useState } from "react"
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-react"
import type { Product } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"

const UNCATEGORIZED = "Без категории"

// «Цветы» для быстрого пресета — по ключевым словам в названии категории (устойчиво к % в названии):
// Базовый цветок, Первостепенный цветок, Зелень, Сухоцветы.
const FLOWER_KEYWORDS = ["цветок", "зелень", "сухоцвет"]

function topCategory(product: Product): string {
  const path = (product.categoryPath ?? "").trim()
  if (!path) return UNCATEGORIZED
  const slash = path.indexOf("/")
  return slash > 0 ? path.slice(0, slash).trim() : path
}

function isFlowerCategory(name: string): boolean {
  const lower = name.toLowerCase()
  return FLOWER_KEYWORDS.some((kw) => lower.includes(kw))
}

function formatQty(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

type Totals = { positions: number; stock: number; costSum: number; saleSum: number }

function emptyTotals(): Totals {
  return { positions: 0, stock: 0, costSum: 0, saleSum: 0 }
}

function addToTotals(totals: Totals, product: Product) {
  totals.positions += 1
  totals.stock += product.stock
  totals.costSum += product.stock * product.costPrice
  totals.saleSum += product.stock * product.salePrice
}

export function StockReportClient({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [hideZero, setHideZero] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Список топ-категорий (для фильтра-пилюль) — по всем активным товарам, независимо от поиска.
  const allCategories = useMemo(() => {
    const set = new Set<string>()
    for (const product of products) set.add(topCategory(product))
    return Array.from(set).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1
      if (b === UNCATEGORIZED) return -1
      return a.localeCompare(b, "ru")
    })
  }, [products])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((product) => {
      if (hideZero && product.stock === 0) return false
      if (q) {
        const haystack = `${product.name} ${product.article} ${product.code}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (categoryFilter === "all") return true
      const cat = topCategory(product)
      if (categoryFilter === "flowers") return isFlowerCategory(cat)
      return cat === categoryFilter
    })
  }, [products, query, categoryFilter, hideZero])

  // Группировка по топ-категории + подытоги; категории отсортированы (Без категории — в конце).
  const groups = useMemo(() => {
    const map = new Map<string, { products: Product[]; totals: Totals }>()
    for (const product of filtered) {
      const cat = topCategory(product)
      let group = map.get(cat)
      if (!group) {
        group = { products: [], totals: emptyTotals() }
        map.set(cat, group)
      }
      group.products.push(product)
      addToTotals(group.totals, product)
    }
    return Array.from(map.entries())
      .map(([category, group]) => ({ category, ...group }))
      .sort((a, b) => {
        if (a.category === UNCATEGORIZED) return 1
        if (b.category === UNCATEGORIZED) return -1
        return a.category.localeCompare(b.category, "ru")
      })
  }, [filtered])

  const grand = useMemo(() => {
    const totals = emptyTotals()
    for (const product of filtered) addToTotals(totals, product)
    return totals
  }, [filtered])

  function toggleCategory(category: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const allExpanded = groups.length > 0 && groups.every((group) => expanded.has(group.category))

  function toggleAll() {
    setExpanded(allExpanded ? new Set() : new Set(groups.map((group) => group.category)))
  }

  const filtersActive = query.trim() !== "" || categoryFilter !== "all" || hideZero

  return (
    <div className="flex flex-col gap-4">
      {/* Карточки-итоги */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Позиций" value={formatQty(grand.positions)} />
        <SummaryCard label="Остаток, всего" value={formatQty(grand.stock)} />
        <SummaryCard label="Σ себестоимости" value={formatMoney(grand.costSum)} />
        <SummaryCard label="Σ продажи" value={formatMoney(grand.saleSum)} />
      </div>

      <Card className="rounded-2xl border bg-white">
        <CardContent className="flex flex-col gap-4">
          {/* Поиск + быстрые фильтры */}
          <div className="flex flex-col gap-3">
            <div className="relative w-full sm:max-w-xs">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по названию, артикулу или коду"
                className="h-9 pl-8"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterPill active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>
                Все категории
              </FilterPill>
              <FilterPill active={categoryFilter === "flowers"} onClick={() => setCategoryFilter("flowers")}>
                Только цветы
              </FilterPill>
              {allCategories.map((category) => (
                <FilterPill
                  key={category}
                  active={categoryFilter === category}
                  onClick={() => setCategoryFilter(category)}
                >
                  {category}
                </FilterPill>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setHideZero((value) => !value)}>
                {hideZero ? "Показать нулевые" : "Скрыть нулевые"}
              </Button>
              {groups.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                  {allExpanded ? "Свернуть всё" : "Развернуть всё"}
                </Button>
              )}
              {filtersActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery("")
                    setCategoryFilter("all")
                    setHideZero(false)
                  }}
                >
                  Сбросить
                </Button>
              )}
            </div>
          </div>

          {groups.length === 0 ? (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>Ничего не найдено</EmptyTitle>
                <EmptyDescription>Измените поиск или фильтры.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-zinc-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-normal">Наименование</th>
                    <th className="px-3 py-2 text-right font-normal">Остаток</th>
                    <th className="px-3 py-2 text-right font-normal">Себест.</th>
                    <th className="px-3 py-2 text-right font-normal">Σ себест.</th>
                    <th className="px-3 py-2 text-right font-normal">Цена</th>
                    <th className="px-3 py-2 text-right font-normal">Σ продажи</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const open = expanded.has(group.category)
                    return (
                      <CategoryBlock
                        key={group.category}
                        category={group.category}
                        products={group.products}
                        totals={group.totals}
                        open={open}
                        onToggle={() => toggleCategory(group.category)}
                      />
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-300 bg-zinc-100 font-medium">
                    <td className="px-3 py-2.5">Итого по складу · {formatQty(grand.positions)} поз.</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatQty(grand.stock)}</td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(grand.costSum)}</td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(grand.saleSum)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CategoryBlock({
  category,
  products,
  totals,
  open,
  onToggle,
}: {
  category: string
  products: Product[]
  totals: Totals
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-zinc-200 bg-zinc-50 font-medium hover:bg-zinc-100"
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <span className="flex items-center gap-1.5">
            {open ? (
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span>{category}</span>
            <span className="text-xs font-normal text-muted-foreground">· {formatQty(totals.positions)} поз.</span>
          </span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{formatQty(totals.stock)}</td>
        <td className="px-3 py-2" />
        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.costSum)}</td>
        <td className="px-3 py-2" />
        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.saleSum)}</td>
      </tr>
      {open &&
        products.map((product) => {
          const costSum = product.stock * product.costPrice
          const saleSum = product.stock * product.salePrice
          const negative = product.stock < 0
          return (
            <tr key={product.code} className="border-b border-zinc-100 last:border-b-0">
              <td className="px-3 py-1.5 pl-8">
                <span className="block truncate">{product.name}</span>
              </td>
              <td className={cn("px-3 py-1.5 text-right tabular-nums", negative && "text-red-600")}>
                {formatQty(product.stock)}
                <span className="ml-1 text-xs text-muted-foreground">{product.unit}</span>
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatMoney(product.costPrice)}</td>
              <td className={cn("px-3 py-1.5 text-right tabular-nums", negative && "text-red-600")}>{formatMoney(costSum)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatMoney(product.salePrice)}</td>
              <td className={cn("px-3 py-1.5 text-right tabular-nums", negative && "text-red-600")}>{formatMoney(saleSum)}</td>
            </tr>
          )
        })}
    </>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-950">{value}</div>
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button type="button" variant={active ? "default" : "outline"} size="sm" onClick={onClick}>
      {children}
    </Button>
  )
}
