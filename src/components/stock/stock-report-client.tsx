"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CalendarClockIcon, ChevronDownIcon, ChevronRightIcon, DownloadIcon, EyeOffIcon, MinusCircleIcon, PlusCircleIcon, RotateCcwIcon } from "lucide-react"
import type { Product } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { ScreenBody } from "@/components/screen-body"
import { FilterChips, HeaderAction, HeaderPopover, HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"

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

function formatReportDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  return `${d}.${m}.${y}`
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

export function StockReportClient({
  products,
  asOfDate,
  todayISO,
}: {
  products: Product[]
  asOfDate: string
  todayISO: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [hideZero, setHideZero] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Дата отчёта живёт в URL (?date=) — остатки на прошлую дату сервер реконструирует
  // по журналу движений. Пустая дата или сегодня = текущие остатки.
  function pushDate(next: string) {
    const target = next && next < todayISO ? `/stock/report?date=${next}` : "/stock/report"
    startTransition(() => router.push(target))
  }

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

  const filtersActive = query.trim() !== "" || categoryFilter !== "all" || hideZero || Boolean(asOfDate)

  return (
    <>
      <ScreenHeader
        title="Остатки"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Поиск по названию, артикулу или коду",
          inputProps: { "aria-label": "Поиск по остаткам" },
        }}
        actions={
          <>
            <HeaderPopover icon={CalendarClockIcon} label={asOfDate ? `На ${formatReportDate(asOfDate)}` : "На дату"} active={Boolean(asOfDate)}>
              <Field>
                <FieldLabel>Остатки на конец дня</FieldLabel>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    aria-label="Дата отчёта"
                    value={asOfDate || todayISO}
                    max={todayISO}
                    onChange={(event) => pushDate(event.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-lg bg-muted/55 px-2.5 text-sm text-foreground tabular-nums outline-none focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/15"
                  />
                  {asOfDate && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => pushDate("")}>
                      Сегодня
                    </Button>
                  )}
                </div>
                <FieldDescription>
                  Прошлая дата восстанавливается по истории движений; себестоимость и цены — текущие, суммы приблизительны.
                </FieldDescription>
              </Field>
            </HeaderPopover>
            <HeaderAction
              icon={EyeOffIcon}
              label={hideZero ? "Нулевые скрыты" : "Скрыть нулевые"}
              active={hideZero}
              onClick={() => setHideZero((value) => !value)}
            />
            {filtersActive && (
              <HeaderAction
                icon={RotateCcwIcon}
                label="Сброс"
                onClick={() => {
                  setQuery("")
                  setCategoryFilter("all")
                  setHideZero(false)
                  if (asOfDate) pushDate("")
                }}
              />
            )}
            <HeaderAction icon={DownloadIcon} label="Excel" href="/warehouse/export" />
            <HeaderAction icon={MinusCircleIcon} label="Списать" href="/stock?new=stock_out" />
          </>
        }
        primaryAction={<HeaderPrimaryAction icon={PlusCircleIcon} label="Пополнить" href="/stock?new=stock_in" />}
      />

      {/* Второй уровень — категории чипами. */}
      <FilterChips
        className="shrink-0"
        value={categoryFilter}
        options={[
          { value: "all", label: "Все категории" },
          { value: "flowers", label: "Только цветы" },
          ...allCategories.map((category) => ({ value: category, label: category })),
        ]}
        onValueChange={setCategoryFilter}
      />

      <ScreenBody className="gap-4 p-4">
      {/* Карточки-итоги */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Позиций" value={formatQty(grand.positions)} />
        <SummaryCard label="Остаток, всего" value={formatQty(grand.stock)} />
        <SummaryCard label="Σ себестоимости" value={formatMoney(grand.costSum)} />
        <SummaryCard label="Σ продажи" value={formatMoney(grand.saleSum)} />
      </div>

      <div className="flex flex-col gap-4">
        {asOfDate && (
          <div className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
            Показаны остатки на конец дня <span className="font-semibold">{formatReportDate(asOfDate)}</span> —
            восстановлены по истории движений. Себестоимость и цены — текущие, поэтому суммы на прошлую дату
            приблизительны.
          </div>
        )}
        {groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
              {allExpanded ? "Свернуть всё" : "Развернуть всё"}
            </Button>
          </div>
        )}

        {groups.length === 0 ? (
          <Empty className="min-h-40">
            <EmptyHeader>
              <EmptyTitle>Ничего не найдено</EmptyTitle>
              <EmptyDescription>Измените поиск или фильтры.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="min-w-0 max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/40 text-xs text-muted-foreground">
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
                <tr className="border-t border-border/40 bg-muted/30 font-medium">
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
      </div>
      </ScreenBody>
    </>
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
        className="cursor-pointer border-b border-border/40 bg-muted/30 font-medium hover:bg-muted/60"
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
    <div className="rounded-xl bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

