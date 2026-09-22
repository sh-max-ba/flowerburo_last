"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  FilterIcon,
  FileSpreadsheetIcon,
  HistoryIcon,
  MinusCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusCircleIcon,
  PlusIcon,
  TagsIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"
import { uploadImageFile } from "@/lib/image-upload"
import {
  applyWarehouseImportAction,
  clearProductCategoryAction,
  createStockDocumentAction,
  deleteProductAction,
  setProductArchivedAction,
  previewWarehouseImportAction,
  renameProductCategoryAction,
  saveStockDocumentDraftAction,
  saveProductAction,
} from "@/app/actions"
import type {
  AllocationMethod,
  Product,
  Supplier,
  StockDocumentType,
  WarehouseImportAction,
  WarehouseImportPreview,
} from "@/lib/db"
import { toDatetimeLocalValue } from "@/lib/datetime"
import { cn, formatMoney } from "@/lib/utils"
import { ScreenBody } from "@/components/screen-body"
import { HeaderAction, HeaderFilter, HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"
import { LineTabs } from "@/components/ui/line-tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ProductThumbnail } from "@/components/products/product-thumbnail"
import { StockActProductPicker } from "@/components/stock/stock-act-product-picker"
import {
  addProductToLines,
  StockDocumentItemsTable,
  type DocumentLine,
} from "@/components/stock/stock-document-items-editor"
import { OverheadEditor } from "@/components/stock/overhead-editor"
import { SupplierSelect } from "@/components/stock/supplier-select"

type Result = Awaited<ReturnType<typeof saveProductAction>>
type StockDocumentDialogType = StockDocumentType | null
type CategorySummary = { path: string; label: string; count: number }

const allCategoriesValue = "__all__"
const uncategorizedValue = "__uncategorized__"
const uncategorizedLabel = "Без категории"

const lowStockThreshold = 3

type StockLevel = "negative" | "zero" | "low" | "normal"
type StockLevelFilter = "all" | "low" | "zero" | "negative"

function stockLevel(product: Product): StockLevel {
  if (product.available < 0) {
    return "negative"
  }
  if (product.available === 0) {
    return "zero"
  }
  if (product.available <= lowStockThreshold) {
    return "low"
  }

  return "normal"
}

function matchesStockLevelFilter(product: Product, filter: StockLevelFilter) {
  if (filter === "all") {
    return true
  }

  const level = stockLevel(product)
  if (filter === "low") {
    return level === "low"
  }
  if (filter === "zero") {
    return level === "zero"
  }

  return level === "negative"
}

type SortField = "name" | "category" | "available" | "price"
type SortState = { field: SortField; dir: "asc" | "desc" } | null

function compareProducts(a: Product, b: Product, field: SortField): number {
  switch (field) {
    case "name":
      return a.name.localeCompare(b.name, "ru")
    case "category":
      return getCategoryLabel(a.categoryPath).localeCompare(getCategoryLabel(b.categoryPath), "ru")
    case "available":
      return a.available - b.available
    case "price":
      return a.salePrice - b.salePrice
  }
}

function normalizeCategoryPath(value: string | null | undefined) {
  return String(value ?? "").trim()
}

function getCategoryLabel(value: string | null | undefined) {
  return normalizeCategoryPath(value) || uncategorizedLabel
}

function getCategoryValue(value: string | null | undefined) {
  return normalizeCategoryPath(value) || uncategorizedValue
}

function buildCategorySummaries(products: Product[]) {
  const counts = new Map<string, number>()

  for (const product of products) {
    const value = getCategoryValue(product.categoryPath)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([path, count]) => ({
      path,
      label: path === uncategorizedValue ? uncategorizedLabel : path,
      count,
    }))
    .sort((a, b) => {
      if (a.path === uncategorizedValue) {
        return 1
      }
      if (b.path === uncategorizedValue) {
        return -1
      }

      return a.label.localeCompare(b.label, "ru")
    })
}

export function StockPage({
  products,
  archivedProducts,
  suppliers,
  defaultAllocationMethod,
}: {
  products: Product[]
  archivedProducts: Product[]
  suppliers: Supplier[]
  defaultAllocationMethod: AllocationMethod
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedDocType = searchParams.get("new")
  const [view, setView] = useState<"active" | "archived">("active")
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState(allCategoriesValue)
  const [levelFilter, setLevelFilter] = useState<StockLevelFilter>("all")
  const [sort, setSort] = useState<SortState>(null)
  const [productSheet, setProductSheet] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [clearingCategory, setClearingCategory] = useState<CategorySummary | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [archivingProduct, setArchivingProduct] = useState<Product | null>(null)
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null)
  // Диалог акта живёт в URL (?new=stock_in|stock_out): ссылки «Пополнить/Списать» из полосы
  // вкладок и меню «Создать» открывают его навигацией, закрытие стирает параметр.
  const stockDocumentType: StockDocumentDialogType =
    requestedDocType === "stock_in" || requestedDocType === "stock_out" ? requestedDocType : null
  const closeStockDocument = () => router.replace("/stock", { scroll: false })
  const [warehouseImportOpen, setWarehouseImportOpen] = useState(false)
  const [warehouseImportPreview, setWarehouseImportPreview] = useState<WarehouseImportPreview | null>(null)
  const [isPending, startTransition] = useTransition()

  // Набор данных зависит от вкладки: активные товары или архив. Поиск/категория/остаток
  // фильтруют в пределах выбранной вкладки.
  const sourceProducts = view === "active" ? products : archivedProducts
  // Категории всего активного каталога — для формы товара и управления категориями
  // (не должны схлопываться до категорий текущей вкладки).
  const activeCategories = useMemo(() => buildCategorySummaries(products), [products])
  const categories = useMemo(() => buildCategorySummaries(sourceProducts), [sourceProducts])
  const activeCategoryFilter =
    categoryFilter === allCategoriesValue || categories.some((category) => category.path === categoryFilter)
      ? categoryFilter
      : allCategoriesValue

  const levelCounts = useMemo(() => {
    const counts = { all: sourceProducts.length, low: 0, zero: 0, negative: 0 }
    for (const product of sourceProducts) {
      const level = stockLevel(product)
      if (level === "low") {
        counts.low += 1
      } else if (level === "zero") {
        counts.zero += 1
      } else if (level === "negative") {
        counts.negative += 1
      }
    }

    return counts
  }, [sourceProducts])

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    return sourceProducts.filter((product) => {
      const matchesQuery =
        !normalized ||
        `${product.code} ${product.article} ${product.name}`.toLowerCase().includes(normalized)
      const matchesCategory =
        activeCategoryFilter === allCategoriesValue || getCategoryValue(product.categoryPath) === activeCategoryFilter
      const matchesLevel = matchesStockLevelFilter(product, levelFilter)

      return matchesQuery && matchesCategory && matchesLevel
    })
  }, [activeCategoryFilter, levelFilter, sourceProducts, query])

  // Сортировка по клику на заголовок: третий клик по той же колонке возвращает исходный порядок.
  const sortedProducts = useMemo(() => {
    if (!sort) return filteredProducts
    const { field, dir } = sort
    const sorted = [...filteredProducts].sort((a, b) => compareProducts(a, b, field))
    return dir === "desc" ? sorted.reverse() : sorted
  }, [filteredProducts, sort])

  function toggleSort(field: SortField) {
    setSort((current) => {
      if (!current || current.field !== field) return { field, dir: "asc" }
      if (current.dir === "asc") return { field, dir: "desc" }
      return null
    })
  }

  const hasActiveFilters =
    query.trim().length > 0 || activeCategoryFilter !== allCategoriesValue || levelFilter !== "all"

  function run(action: () => Promise<Result>, after?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        for (const message of result.messages ?? [result.message]) {
          toast.success(message)
        }
        after?.()
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function submitForm(
    event: React.FormEvent<HTMLFormElement>,
    action: (formData: FormData) => Promise<Result>,
    after?: () => void
  ) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    run(() => action(formData), after)
  }

  return (
    <>
      <StockSection
        products={sortedProducts}
        categories={categories}
        sort={sort}
        onToggleSort={toggleSort}
        view={view}
        onViewChange={(next) => {
          setView(next)
          setLevelFilter("all")
        }}
        activeCount={products.length}
        archivedCount={archivedProducts.length}
        levelFilter={levelFilter}
        setLevelFilter={setLevelFilter}
        levelCounts={levelCounts}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={() => {
          setQuery("")
          setCategoryFilter(allCategoriesValue)
          setLevelFilter("all")
        }}
        query={query}
        setQuery={setQuery}
        categoryFilter={activeCategoryFilter}
        setCategoryFilter={setCategoryFilter}
        onCreate={() => {
          setEditingProduct(null)
          setProductSheet(true)
        }}
        onEdit={(product) => {
          setEditingProduct(product)
          setProductSheet(true)
        }}
        onImport={() => setWarehouseImportOpen(true)}
        onOpenCategories={() => setCategoriesOpen(true)}
        pending={isPending}
        onArchive={setArchivingProduct}
        onRestore={(product) => run(() => setProductArchivedAction(product.code, false))}
        onDelete={setDeletingProduct}
      />

      <ProductSheet
        key={productSheet ? editingProduct?.code ?? "create-product" : "product-sheet-closed"}
        open={productSheet}
        product={editingProduct}
        categories={activeCategories}
        pending={isPending}
        onOpenChange={setProductSheet}
        onSubmit={(event) =>
          submitForm(event, saveProductAction, () => {
            setProductSheet(false)
            setEditingProduct(null)
          })
        }
      />
      <CategoriesDialog
        open={categoriesOpen}
        categories={activeCategories.filter((category) => category.path !== uncategorizedValue)}
        pending={isPending}
        onOpenChange={setCategoriesOpen}
        onRename={(event) => submitForm(event, renameProductCategoryAction)}
        onClear={setClearingCategory}
      />
      <StockDocumentDialog
        key={stockDocumentType ?? "stock-document-closed"}
        type={stockDocumentType}
        products={products}
        suppliers={suppliers.filter((supplier) => supplier.isActive)}
        pending={isPending}
        defaultAllocationMethod={defaultAllocationMethod}
        onOpenChange={(open) => !open && closeStockDocument()}
        onSubmit={(event, type) =>
          submitForm(event, (formData) => createStockDocumentAction(type, formData), closeStockDocument)
        }
        onSaveDraft={(event, type) =>
          submitForm(event, (formData) => saveStockDocumentDraftAction(type, formData), closeStockDocument)
        }
      />
      <WarehouseImportDialog
        open={warehouseImportOpen}
        pending={isPending}
        preview={warehouseImportPreview}
        onOpenChange={(open) => {
          setWarehouseImportOpen(open)
          if (!open) {
            setWarehouseImportPreview(null)
          }
        }}
        onPreview={(event) => {
          event.preventDefault()
          const formData = new FormData(event.currentTarget)
          startTransition(async () => {
            const result = await previewWarehouseImportAction(formData)
            if (result.ok && "data" in result && result.data) {
              setWarehouseImportPreview(result.data)
              toast.success(result.message)
            } else {
              toast.error(result.message)
            }
          })
        }}
        onApply={(importId) => {
          startTransition(async () => {
            const result = await applyWarehouseImportAction(importId)
            if (result.ok && "data" in result && result.data) {
              setWarehouseImportPreview(result.data)
              toast.success(result.message)
              router.refresh()
            } else {
              toast.error(result.message)
            }
          })
        }}
      />

      <AlertDialog open={Boolean(archivingProduct)} onOpenChange={() => setArchivingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отправить в архив?</AlertDialogTitle>
            <AlertDialogDescription>
              {archivingProduct && archivingProduct.stock > 0
                ? `На складе ещё ${archivingProduct.stock} ${archivingProduct.unit} — товар скроется из продаж, заказов и подборов, но останется в истории и отчётах. Можно восстановить в любой момент.`
                : "Товар скроется из продаж, заказов и подборов. Останется в истории; можно восстановить в любой момент."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button disabled={isPending} />}
              onClick={() => {
                if (!archivingProduct) {
                  return
                }
                run(() => setProductArchivedAction(archivingProduct.code, true), () => setArchivingProduct(null))
              }}
            >
              В архив
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deletingProduct)} onOpenChange={() => setDeletingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить навсегда?</AlertDialogTitle>
            <AlertDialogDescription>
              Позиция будет удалена со склада безвозвратно. Если товар встречается в продажах,
              заказах или сделках — удаление не выполнится; используйте архив. История движений останется.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" disabled={isPending} />}
              onClick={() => {
                if (!deletingProduct) {
                  return
                }
                run(() => deleteProductAction(deletingProduct.code), () => setDeletingProduct(null))
              }}
            >
              Удалить навсегда
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(clearingCategory)} onOpenChange={() => setClearingCategory(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить категорию?</AlertDialogTitle>
            <AlertDialogDescription>
              Товары останутся на складе, но категория {clearingCategory?.label ? `«${clearingCategory.label}»` : ""}
              будет заменена на «{uncategorizedLabel}».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" disabled={isPending} />}
              onClick={() => {
                if (!clearingCategory) {
                  return
                }
                run(() => clearProductCategoryAction(clearingCategory.path), () => setClearingCategory(null))
              }}
            >
              Очистить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function StockSection({
  products,
  categories,
  sort,
  onToggleSort,
  view,
  onViewChange,
  activeCount,
  archivedCount,
  levelFilter,
  setLevelFilter,
  levelCounts,
  hasActiveFilters,
  onResetFilters,
  query,
  setQuery,
  categoryFilter,
  setCategoryFilter,
  onCreate,
  onEdit,
  onImport,
  onOpenCategories,
  onArchive,
  onRestore,
  onDelete,
  pending,
}: {
  products: Product[]
  categories: CategorySummary[]
  sort: SortState
  onToggleSort: (field: SortField) => void
  view: "active" | "archived"
  onViewChange: (next: "active" | "archived") => void
  activeCount: number
  archivedCount: number
  levelFilter: StockLevelFilter
  setLevelFilter: (value: StockLevelFilter) => void
  levelCounts: { all: number; low: number; zero: number; negative: number }
  hasActiveFilters: boolean
  onResetFilters: () => void
  query: string
  setQuery: (value: string) => void
  categoryFilter: string
  setCategoryFilter: (value: string) => void
  onCreate: () => void
  onEdit: (product: Product) => void
  onImport: () => void
  onOpenCategories: () => void
  onArchive: (product: Product) => void
  onRestore: (product: Product) => void
  onDelete: (product: Product) => void
  pending: boolean
}) {
  const isArchiveView = view === "archived"
  // Сегменты остатков с цветовыми точками (по макету): мало — янтарная, нет — серая, минус — красная.
  const levelChips: { value: StockLevelFilter; label: string; count: number; dot?: string }[] = [
    { value: "all", label: "Все", count: levelCounts.all },
    { value: "low", label: "Мало ≤3", count: levelCounts.low, dot: "bg-amber-500" },
    { value: "zero", label: "Нет в наличии", count: levelCounts.zero, dot: "bg-zinc-400" },
    { value: "negative", label: "В минусе", count: levelCounts.negative, dot: "bg-red-500" },
  ]

  return (
    <>
      <ScreenHeader
        title="Склад"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Найти товар по названию, коду или артикулу",
          inputProps: { "aria-label": "Поиск товаров" },
        }}
        actions={
          <>
            <HeaderFilter
              icon={TagsIcon}
              label="Категория"
              value={categoryFilter}
              allValue={allCategoriesValue}
              options={[
                { value: allCategoriesValue, label: "Все категории" },
                ...categories.map((category) => ({ value: category.path, label: `${category.label} — ${category.count}` })),
              ]}
              onValueChange={setCategoryFilter}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-10 text-muted-foreground hover:text-foreground"
                    disabled={pending}
                    title="Ещё действия"
                    aria-label="Ещё действия"
                  />
                }
              >
                <MoreHorizontalIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={onCreate}>
                  <PlusIcon />
                  Новый товар
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenCategories}>
                  <TagsIcon />
                  Категории
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onImport}>
                  <UploadIcon />
                  Импорт XLSX
                </DropdownMenuItem>
                <DropdownMenuItem render={<a href="/warehouse/export" />}>
                  <FileSpreadsheetIcon />
                  Экспорт XLSX
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/warehouse/imports" />}>
                  <HistoryIcon />
                  История импортов
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <HeaderAction icon={PlusIcon} label="Новый товар" onClick={onCreate} disabled={pending} />
            <HeaderAction icon={MinusCircleIcon} label="Списать" href="/stock?new=stock_out" />
          </>
        }
        primaryAction={<HeaderPrimaryAction icon={PlusCircleIcon} label="Пополнить" href="/stock?new=stock_in" />}
      />

      {/* Второй уровень: активные/архив подчёркиванием, остатки — чипами с цветовыми точками. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <LineTabs
          aria-label="Товары"
          value={view}
          onValueChange={onViewChange}
          items={[
            { value: "active", label: "Активные", count: activeCount },
            { value: "archived", label: "В архиве", count: archivedCount },
          ]}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Остаток">
          {levelChips.map((chip) => {
            const isActive = levelFilter === chip.value
            const isDisabled = chip.value !== "all" && chip.count === 0
            return (
              <button
                key={chip.value}
                type="button"
                disabled={isDisabled}
                aria-pressed={isActive}
                onClick={() => setLevelFilter(chip.value)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/35 pointer-coarse:h-9",
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  isDisabled && "cursor-not-allowed opacity-50"
                )}
              >
                {chip.dot && <span className={cn("size-1.5 rounded-full", chip.dot)} aria-hidden />}
                {chip.label}
                {chip.count ? <span className="text-xs text-muted-foreground tabular-nums">{chip.count}</span> : null}
              </button>
            )
          })}
          {hasActiveFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={onResetFilters}>
              <FilterIcon data-icon="inline-start" />
              Сбросить
            </Button>
          )}
        </div>
      </div>

      <ScreenBody>
        <ProductsTable
          products={products}
          sort={sort}
          onToggleSort={onToggleSort}
          isArchiveView={isArchiveView}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={onResetFilters}
          onEdit={onEdit}
          onArchive={onArchive}
          onRestore={onRestore}
          onDelete={onDelete}
          pending={pending}
        />
      </ScreenBody>
    </>
  )
}

// Таблица товаров по макету: letter-аватар + артикул, пилюля остатка, цена tabular-nums,
// иконки действий вместо текстовых кнопок. Заголовки капсом, строка целиком — зона hover.
function ProductsTable({
  products,
  sort,
  onToggleSort,
  isArchiveView,
  hasActiveFilters,
  onResetFilters,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  pending,
}: {
  products: Product[]
  sort: SortState
  onToggleSort: (field: SortField) => void
  isArchiveView: boolean
  hasActiveFilters: boolean
  onResetFilters: () => void
  onEdit: (product: Product) => void
  onArchive: (product: Product) => void
  onRestore: (product: Product) => void
  onDelete: (product: Product) => void
  pending: boolean
}) {
  if (!products.length) {
    if (hasActiveFilters) {
      return (
        <Empty className="min-h-56">
          <EmptyHeader>
            <EmptyTitle>Ничего не найдено</EmptyTitle>
            <EmptyDescription>По выбранным фильтрам нет товаров. Сбросьте фильтры, чтобы увидеть весь список.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" variant="ghost" size="sm" onClick={onResetFilters}>
              <FilterIcon data-icon="inline-start" />
              Сбросить фильтры
            </Button>
          </EmptyContent>
        </Empty>
      )
    }

    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{isArchiveView ? "В архиве пусто" : "Склад пуст"}</EmptyTitle>
          <EmptyDescription>Данные появятся после первой операции.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="@container/products min-w-0 max-w-full">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <SortableHead label="Товар" field="name" sort={sort} onToggleSort={onToggleSort} />
            <SortableHead label="Категория" field="category" sort={sort} onToggleSort={onToggleSort} className="hidden @3xl/products:table-cell" />
            <SortableHead label="Доступно" field="available" sort={sort} onToggleSort={onToggleSort} align="right" />
            <SortableHead label="Цена" field="price" sort={sort} onToggleSort={onToggleSort} align="right" />
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.code} className="group">
              <TableCell>
                <div className="flex min-w-40 items-center gap-2.5">
                  <ProductThumbnail name={product.name} imagePath={product.imagePath} size="md" />
                  <div className="min-w-0 max-w-72">
                    <div className="truncate font-medium" title={product.name}>{product.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {product.article || "Артикул не указан"}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden @3xl/products:table-cell">
                <CategoryCell categoryPath={product.categoryPath} />
              </TableCell>
              <TableCell className="text-right">
                <StockBadge product={product} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(product.salePrice)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-0.5 text-muted-foreground">
                  {isArchiveView ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onRestore(product)}
                        disabled={pending}
                        title="Восстановить из архива"
                        aria-label="Восстановить из архива"
                      >
                        <ArchiveRestoreIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onDelete(product)}
                        title="Удалить навсегда"
                        aria-label="Удалить навсегда"
                      >
                        <Trash2Icon />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onEdit(product)}
                        title="Редактировать"
                        aria-label="Редактировать"
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onArchive(product)}
                        title="В архив"
                        aria-label="В архив"
                      >
                        <ArchiveIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onDelete(product)}
                        title="Удалить"
                        aria-label="Удалить"
                      >
                        <Trash2Icon />
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// Кликабельный заголовок колонки: 1-й клик — по возрастанию, 2-й — по убыванию, 3-й — исходный порядок.
function SortableHead({
  label,
  field,
  sort,
  onToggleSort,
  align,
  className,
}: {
  label: string
  field: SortField
  sort: SortState
  onToggleSort: (field: SortField) => void
  align?: "right"
  className?: string
}) {
  const active = sort?.field === field
  return (
    <TableHead className={cn("p-0", align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onToggleSort(field)}
        title="Сортировать"
        className={cn(
          "flex h-full w-full items-center gap-1 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-foreground",
          align === "right" && "justify-end",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUpIcon className="size-3.5 shrink-0" />
          ) : (
            <ArrowDownIcon className="size-3.5 shrink-0" />
          )
        ) : (
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}

function CategoryCell({ categoryPath }: { categoryPath: string }) {
  const label = getCategoryLabel(categoryPath)
  const isEmpty = !normalizeCategoryPath(categoryPath)

  return (
    <span
      title={label}
      className={isEmpty ? "block max-w-56 truncate text-muted-foreground" : "block max-w-56 truncate"}
    >
      {label}
    </span>
  )
}

function ProductSheet({
  open,
  product,
  categories,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  product: Product | null
  categories: CategorySummary[]
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const router = useRouter()
  const [categoryPath, setCategoryPath] = useState(product?.categoryPath ?? "")
  const [imagePath, setImagePath] = useState(product?.imagePath ?? "")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageVersion, setImageVersion] = useState(0)
  const selectableCategories = categories.filter((category) => category.path !== uncategorizedValue)

  async function uploadProductImage() {
    if (!product || !imageFile) {
      return
    }

    setUploadingImage(true)

    try {
      const imagePath = await uploadImageFile(`/api/products/${encodeURIComponent(product.code)}/image`, imageFile)

      setImagePath(imagePath)
      setImageFile(null)
      setImageVersion(Date.now())
      toast.success("Фото товара обновлено")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Фото товара не загружено.")
    } finally {
      setUploadingImage(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{product ? "Редактировать товар" : "Новый товар"}</SheetTitle>
          <SheetDescription>Код уникален. Название не используется как ключ.</SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex flex-1 flex-col">
          <div className="px-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="code">Код</FieldLabel>
                {/* autoComplete=off: Chrome подставлял ранее введённый код (вектор обоих
                    инцидентов с перезаписью товара — 09.06 и 11.06). */}
                <Input
                  id="code"
                  name="code"
                  defaultValue={product?.code}
                  readOnly={Boolean(product)}
                  autoComplete="off"
                  required
                />
              </Field>
              {/* Маркер режима: при «create» сервер отклоняет занятый код вместо молчаливой перезаписи. */}
              <input type="hidden" name="formMode" value={product ? "edit" : "create"} />
              <Field>
                <FieldLabel htmlFor="name">Название</FieldLabel>
                <Input id="name" name="name" defaultValue={product?.name} required />
              </Field>
              <input type="hidden" name="stock" value={product?.stock ?? 0} />
              <input type="hidden" name="reserved" value={product?.reserved ?? 0} />
              <input type="hidden" name="expected" value={product?.expected ?? 0} />
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="costPrice">Закупка</FieldLabel>
                  <Input
                    id="costPrice"
                    name="costPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={product?.costPrice ?? 0}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="salePrice">Цена</FieldLabel>
                  <Input
                    id="salePrice"
                    name="salePrice"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={product?.salePrice ?? 0}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="categoryPath">Категория</FieldLabel>
                <CategoryCombobox
                  id="categoryPath"
                  name="categoryPath"
                  value={categoryPath}
                  categories={selectableCategories}
                  disabled={pending}
                  onChange={setCategoryPath}
                />
                <FieldDescription>
                  {categoryPath ? `Текущая категория: ${categoryPath}` : uncategorizedLabel}
                </FieldDescription>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="article">Артикул</FieldLabel>
                  <Input id="article" name="article" defaultValue={product?.article} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="unit">Ед.</FieldLabel>
                  <Input id="unit" name="unit" defaultValue={product?.unit ?? "шт"} />
                </Field>
              </div>
              <FieldSet>
                <FieldLegend>Учёт по партиям (сроки годности)</FieldLegend>
                {/* Маркер: форма содержит настройки партий — иначе upsertProduct сохранит прежние. */}
                <input type="hidden" name="lotSettingsPresent" value="on" />
                <div className="grid gap-4 md:grid-cols-2">
                  <Field orientation="horizontal">
                    <input
                      id="track-lots"
                      name="trackLots"
                      type="checkbox"
                      defaultChecked={Boolean(product?.trackLots)}
                      className="size-4 rounded border-input accent-primary"
                    />
                    <FieldLabel htmlFor="track-lots" className="font-normal">
                      Вести по партиям
                    </FieldLabel>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="vaseLifeDays">Стойкость, дней</FieldLabel>
                    <Input
                      id="vaseLifeDays"
                      name="vaseLifeDays"
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={product?.vaseLifeDays ?? ""}
                      placeholder="напр. 7"
                    />
                    <FieldDescription>Срок годности партии = дата прихода + стойкость</FieldDescription>
                  </Field>
                </div>
              </FieldSet>
              <FieldSet>
                <FieldLegend>Фото товара</FieldLegend>
                <div className="flex items-start gap-3">
                  <ProductThumbnail
                    name={product?.name ?? "Товар"}
                    imagePath={imagePath}
                    size="xl"
                    cacheKey={imageVersion}
                  />
                  <Field className="min-w-0 flex-1">
                    <FieldLabel htmlFor="product-image">Файл</FieldLabel>
                    <Input
                      id="product-image"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={!product || pending || uploadingImage}
                      onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                    />
                    <FieldDescription>
                      {product ? "JPG, PNG или WEBP до 5 MB." : "Сначала сохраните товар, затем загрузите фото."}
                    </FieldDescription>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-fit"
                      disabled={!product || !imageFile || pending || uploadingImage}
                      onClick={uploadProductImage}
                    >
                      <UploadIcon data-icon="inline-start" />
                      Загрузить фото
                    </Button>
                  </Field>
                </div>
              </FieldSet>
            </FieldGroup>
          </div>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              Сохранить
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function CategoryCombobox({
  id,
  name,
  value,
  categories,
  disabled,
  onChange,
}: {
  id: string
  name: string
  value: string
  categories: CategorySummary[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const normalized = normalizeCategoryPath(value)

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" id={id} name={name} value={normalized} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
              disabled={disabled}
            />
          }
        >
          <span className={normalized ? "truncate" : "truncate text-muted-foreground"}>
            {normalized || uncategorizedLabel}
          </span>
          <ChevronsUpDownIcon className="size-4 opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) p-0">
          <Command>
            <CommandInput
              placeholder="Выберите или введите категорию"
              value={value}
              onValueChange={onChange}
            />
            <CommandList>
              <CommandEmpty>Новая категория будет сохранена при отправке формы.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={uncategorizedLabel}
                  data-checked={!normalized}
                  onSelect={() => {
                    onChange("")
                    setOpen(false)
                  }}
                >
                  <span className="text-muted-foreground">{uncategorizedLabel}</span>
                </CommandItem>
                {categories.map((category) => (
                  <CommandItem
                    key={category.path}
                    value={category.path}
                    data-checked={normalized === category.path}
                    onSelect={() => {
                      onChange(category.path)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{category.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{category.count}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function CategoriesDialog({
  open,
  categories,
  pending,
  onOpenChange,
  onRename,
  onClear,
}: {
  open: boolean
  categories: CategorySummary[]
  pending: boolean
  onOpenChange: (open: boolean) => void
  onRename: (event: React.FormEvent<HTMLFormElement>) => void
  onClear: (category: CategorySummary) => void
}) {
  const [editing, setEditing] = useState<CategorySummary | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) {
          setEditing(null)
        }
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Категории склада</DialogTitle>
          <DialogDescription>
            Переименование объединит товары, если новая категория уже существует.
          </DialogDescription>
        </DialogHeader>
        {categories.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Категорий пока нет</EmptyTitle>
              <EmptyDescription>Товары без категории отображаются как «{uncategorizedLabel}».</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Категория</TableHead>
                  <TableHead>Товаров</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category.path}>
                    <TableCell className="max-w-96">
                      <span title={category.label} className="block truncate font-medium">
                        {category.label}
                      </span>
                    </TableCell>
                    <TableCell>{category.count}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditing(category)} disabled={pending}>
                          Переименовать
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onClear(category)} disabled={pending}>
                          Очистить
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {editing && (
          <form
            key={editing.path}
            onSubmit={(event) => {
              onRename(event)
              setEditing(null)
            }}
            className="rounded-2xl border bg-muted/30 p-3"
          >
            <FieldGroup>
              <input type="hidden" name="oldName" value={editing.path} />
              <Field>
                <FieldLabel htmlFor="new-category-name">Новое имя</FieldLabel>
                <Input
                  id="new-category-name"
                  name="newName"
                  defaultValue={editing.label}
                  disabled={pending}
                  required
                />
                <FieldDescription>
                  Если такая категория уже есть, товары будут объединены в одну категорию.
                </FieldDescription>
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
                  Отмена
                </Button>
                <Button type="submit" disabled={pending}>
                  Сохранить
                </Button>
              </div>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function WarehouseImportDialog({
  open,
  pending,
  preview,
  onOpenChange,
  onPreview,
  onApply,
}: {
  open: boolean
  pending: boolean
  preview: WarehouseImportPreview | null
  onOpenChange: (open: boolean) => void
  onPreview: (event: React.FormEvent<HTMLFormElement>) => void
  onApply: (importId: number) => void
}) {
  const hasErrors = Boolean(preview && preview.errorCount > 0)
  const [showOnlyErrors, setShowOnlyErrors] = useState(false)
  const previewId = preview?.id ?? null

  // При появлении нового предпросмотра с ошибками сразу показываем только ошибки.
  // Подстройка во время рендера вместо эффекта (null-sentinel воспроизводит и поведение на маунте).
  const previewErrorKey = `${previewId}:${hasErrors}`
  const [lastPreviewErrorKey, setLastPreviewErrorKey] = useState<string | null>(null)
  if (lastPreviewErrorKey !== previewErrorKey) {
    setLastPreviewErrorKey(previewErrorKey)
    setShowOnlyErrors(hasErrors)
  }

  const visibleItems = useMemo(() => {
    if (!preview) {
      return []
    }
    return showOnlyErrors ? preview.items.filter((item) => item.action === "error") : preview.items
  }, [preview, showOnlyErrors])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-[1400px] flex-col overflow-hidden sm:max-w-[1400px]">
        <DialogHeader>
          <DialogTitle>Импорт склада XLSX</DialogTitle>
          <DialogDescription>Загрузите файл, проверьте предпросмотр и примените изменения.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <a href="/warehouse/template" className={buttonVariants({ variant: "outline" })}>
              <DownloadIcon data-icon="inline-start" />
              Скачать шаблон
            </a>
            <Link href="/warehouse/imports" className={buttonVariants({ variant: "outline" })}>
              <HistoryIcon data-icon="inline-start" />
              История импортов
            </Link>
          </div>

          <form onSubmit={onPreview} className="flex flex-col gap-3 rounded-2xl border bg-muted/30 p-3 sm:flex-row sm:items-end">
            <Field className="flex-1">
              <FieldLabel htmlFor="warehouse-import-file">Файл XLSX</FieldLabel>
              <Input id="warehouse-import-file" name="file" type="file" accept=".xlsx" required disabled={pending} />
            </Field>
            <Button type="submit" disabled={pending}>
              <UploadIcon data-icon="inline-start" />
              Предпросмотр
            </Button>
          </form>

          {hasErrors && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>В файле {preview?.errorCount} строк с ошибками</AlertTitle>
              <AlertDescription>Импорт нельзя применить. Исправьте отмеченные строки в XLSX и загрузите его снова.</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <ImportStat label="Строк" value={preview.totalRows} />
                <ImportStat label="Новых" value={preview.createdCount} />
                <ImportStat label="Обновлений" value={preview.updatedCount} />
                <ImportStat label="Без изменений" value={preview.unchangedCount} />
                <ImportStat
                  label="Ошибок"
                  value={preview.errorCount}
                  highlight={preview.errorCount > 0}
                  active={showOnlyErrors}
                  onClick={preview.errorCount > 0 ? () => setShowOnlyErrors((value) => !value) : undefined}
                />
              </div>

              {preview.errorCount > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={showOnlyErrors ? "default" : "outline"}
                    onClick={() => setShowOnlyErrors(true)}
                  >
                    <AlertTriangleIcon data-icon="inline-start" />
                    Только ошибки ({preview.errorCount})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={showOnlyErrors ? "outline" : "default"}
                    onClick={() => setShowOnlyErrors(false)}
                  >
                    Все строки ({preview.items.length})
                  </Button>
                </div>
              )}

              <div className="max-w-full overflow-x-auto rounded-lg border">
                <Table className="min-w-[1120px] text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Строка</TableHead>
                      <TableHead className="w-32">Код</TableHead>
                      <TableHead className="w-64">Название</TableHead>
                      <TableHead className="w-64">Категория</TableHead>
                      <TableHead className="w-36">Действие</TableHead>
                      <TableHead className="w-24">Было</TableHead>
                      <TableHead className="w-24">Будет</TableHead>
                      <TableHead className="w-28">Изменение</TableHead>
                      <TableHead className="min-w-72">Ошибка</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((item) => {
                      const isError = item.action === "error"
                      return (
                        <TableRow
                          key={item.id}
                          className={isError ? "border-l-2 border-l-destructive bg-destructive/5" : undefined}
                        >
                          <TableCell>{item.rowNumber ?? "-"}</TableCell>
                          <TableCell className="font-medium">{item.code || "-"}</TableCell>
                          <TableCell className="max-w-64 truncate" title={item.name || "-"}>
                            {item.name || "-"}
                          </TableCell>
                          <TableCell>
                            <CategoryCell categoryPath={item.categoryPath} />
                          </TableCell>
                          <TableCell>
                            <WarehouseImportActionBadge action={item.action} />
                          </TableCell>
                          <TableCell>{nullableNumber(item.oldStock)}</TableCell>
                          <TableCell>{nullableNumber(item.newStock)}</TableCell>
                          <TableCell>
                            <WarehouseImportDelta value={item.stockDelta} />
                          </TableCell>
                          <TableCell className="min-w-72 break-words font-medium text-destructive">{item.error}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t pt-4">
          <Button
            type="button"
            disabled={pending || !preview || hasErrors || preview.status === "applied"}
            onClick={() => preview && onApply(preview.id)}
          >
            Применить импорт
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportStat({
  label,
  value,
  highlight = false,
  active = false,
  onClick,
}: {
  label: string
  value: number
  highlight?: boolean
  active?: boolean
  onClick?: () => void
}) {
  const baseClass = "rounded-lg border p-3 text-left transition-colors"
  const toneClass = highlight ? "border-red-300 bg-destructive/5" : "border bg-background"
  const activeClass = active ? "ring-2 ring-destructive/40" : ""
  const interactiveClass = onClick ? "cursor-pointer hover:bg-destructive/10" : ""

  const content = (
    <>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {onClick && <FilterIcon className="size-3" />}
      </div>
      <div className={highlight ? "text-xl font-semibold text-destructive" : "text-xl font-semibold"}>{value}</div>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${baseClass} ${toneClass} ${activeClass} ${interactiveClass}`}>
        {content}
      </button>
    )
  }

  return <div className={`${baseClass} ${toneClass}`}>{content}</div>
}

function WarehouseImportActionBadge({ action }: { action: WarehouseImportAction }) {
  const labels: Record<WarehouseImportAction, string> = {
    create: "Новый товар",
    update: "Обновлен",
    unchanged: "Без изменений",
    error: "Ошибка",
  }
  const variant = action === "error" ? "destructive" : action === "unchanged" ? "outline" : "secondary"

  return <Badge variant={variant}>{labels[action]}</Badge>
}

function WarehouseImportDelta({ value }: { value: number | null }) {
  if (!value) {
    return <span className="text-muted-foreground">0</span>
  }

  return (
    <span className={value > 0 ? "font-medium text-emerald-700" : "font-medium text-destructive"}>
      {value > 0 ? `+${nullableNumber(value)}` : nullableNumber(value)}
    </span>
  )
}

function nullableNumber(value: number | null) {
  if (value === null) {
    return "-"
  }

  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function StockDocumentDialog({
  type,
  products,
  suppliers,
  pending,
  defaultAllocationMethod,
  onOpenChange,
  onSubmit,
  onSaveDraft,
}: {
  type: StockDocumentDialogType
  products: Product[]
  suppliers: Supplier[]
  pending: boolean
  defaultAllocationMethod: AllocationMethod
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, type: StockDocumentType) => void
  onSaveDraft: (event: React.FormEvent<HTMLFormElement>, type: StockDocumentType) => void
}) {
  const [items, setItems] = useState<DocumentLine[]>([])
  const [supplierId, setSupplierId] = useState("none")
  const [operationAt, setOperationAt] = useState(() => toDatetimeLocalValue())
  // Сумма и метод накладных — для живого предпросмотра себестоимости в таблице позиций.
  const [overheadState, setOverheadState] = useState<{ total: number; method: AllocationMethod }>({
    total: 0,
    method: defaultAllocationMethod,
  })
  const isWriteOff = type === "stock_out"
  const title = isWriteOff ? "Акт списания" : "Акт пополнения"
  const description = "Добавьте товары, проверьте количество и сохраните или проведите акт"
  const operationAtLabel = isWriteOff ? "Дата и время списания" : "Дата и время приемки"

  function addProduct(product: Product) {
    const freshProduct = products.find((item) => item.code === product.code) ?? product
    setItems((current) => addProductToLines(current, freshProduct, isWriteOff))
  }

  function updateLine(productCode: string, patch: Partial<DocumentLine>) {
    setItems((current) =>
      current.map((item) => (item.product.code === productCode ? { ...item, ...patch } : item))
    )
  }

  function removeProduct(productCode: string) {
    setItems((current) => current.filter((item) => item.product.code !== productCode))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!type) {
      event.preventDefault()
      return
    }

    if (items.length === 0) {
      event.preventDefault()
      toast.error("Добавьте в акт хотя бы один товар.")
      return
    }

    for (const item of items) {
      const parsedQty = Number(item.qty)
      if (!Number.isInteger(parsedQty) || parsedQty < 1) {
        event.preventDefault()
        toast.error("Количество должно быть целым числом от 1.")
        return
      }
    }

    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const intent = submitter instanceof HTMLButtonElement ? submitter.value : "post"
    if (intent === "draft") {
      onSaveDraft(event, type)
      return
    }

    onSubmit(event, type)
  }

  return (
    <Sheet
      open={Boolean(type)}
      onOpenChange={(open) => {
        if (!open) {
          setItems([])
          setSupplierId("none")
          setOperationAt(toDatetimeLocalValue())
          setOverheadState({ total: 0, method: defaultAllocationMethod })
        }
        onOpenChange(open)
      }}
    >
      <SheetContent
        side="right"
        className="!w-screen !max-w-none p-0 sm:!max-w-none md:!max-w-none lg:!max-w-none xl:!max-w-none data-[side=right]:!w-screen data-[side=right]:sm:!w-[90vw] data-[side=right]:md:!w-[860px] data-[side=right]:lg:!w-[1040px] data-[side=right]:xl:!w-[1200px] data-[side=right]:sm:!max-w-none"
      >
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
        {type && (
          <form key={type} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
              {/* Главное действие попапа — набить позиции, поэтому поиск и таблица сверху,
                  а поиск — вплотную над таблицей (как корзина на кассе): добавленная строка
                  появляется сразу под полем. Реквизиты и накладные — ниже; на ноутбучных
                  экранах иначе таблица целиком уходит за сгиб и добавление «не видно». */}
              <StockActProductPicker
                products={products}
                disabled={pending}
                placeholder="Найти товар и добавить в акт"
                onSelect={addProduct}
              />

              <StockDocumentItemsTable
                items={items}
                products={products}
                isWriteOff={isWriteOff}
                pending={pending}
                overheadTotal={overheadState.total}
                allocationMethod={overheadState.method}
                emptyState={
                  <div className="rounded-lg border bg-background py-10 text-center text-sm text-muted-foreground">
                    Позиции акта пока не добавлены
                  </div>
                }
                onUpdate={updateLine}
                onRemove={removeProduct}
              />

              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle className="text-base">Основная информация</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="stock-document-operation-at">{operationAtLabel}</FieldLabel>
                      <Input
                        id="stock-document-operation-at"
                        name="operationAt"
                        type="datetime-local"
                        value={operationAt}
                        disabled={pending}
                        onChange={(event) => setOperationAt(event.target.value)}
                      />
                    </Field>
                    {!isWriteOff && (
                      <Field className="md:col-span-2">
                        <FieldLabel htmlFor="stock-document-supplier">Поставщик</FieldLabel>
                        <SupplierSelect
                          suppliers={suppliers}
                          value={supplierId}
                          onValueChange={setSupplierId}
                          disabled={pending}
                          triggerId="stock-document-supplier"
                        />
                        {supplierId === "none" && (
                          <FieldDescription>Поставщик не указан, акт все равно можно сохранить или провести.</FieldDescription>
                        )}
                      </Field>
                    )}
                    {!isWriteOff && (
                      <Field className="md:col-span-2">
                        <FieldLabel htmlFor="stock-document-paid">Оплачено поставщику</FieldLabel>
                        <Input
                          id="stock-document-paid"
                          name="paidAmount"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0"
                          disabled={pending}
                          className="tabular-nums"
                        />
                        <FieldDescription>
                          Оставьте пустым, если оплаты ещё не было — в списке актов появится долг поставщику.
                        </FieldDescription>
                      </Field>
                    )}
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="stock-document-comment">
                        {isWriteOff ? "Причина списания / комментарий" : "Комментарий / основание"}
                      </FieldLabel>
                      <Textarea id="stock-document-comment" name="comment" disabled={pending} />
                    </Field>
                  </CardContent>
                </Card>

                {!isWriteOff && (
                  <OverheadEditor
                    disabled={pending}
                    initialMethod={defaultAllocationMethod}
                    onStateChange={setOverheadState}
                  />
                )}
              </div>
            </div>
            <SheetFooter className="sticky bottom-0 flex-row justify-end border-t bg-background px-6 py-4">
              <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" name="intent" value="draft" variant="outline" disabled={pending}>
                Сохранить черновик
              </Button>
              <Button
                type="submit"
                name="intent"
                value="post"
                variant={isWriteOff ? "destructive" : "default"}
                disabled={pending}
              >
                Провести акт
              </Button>
            </SheetFooter>
          </form>
        )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Пилюля остатка по макету: минус — красная, ноль — серая, мало (≤3) — янтарная,
// норма — просто число без пилюли.
function StockBadge({ product }: { product: Product }) {
  const level = stockLevel(product)
  const qty = `${number(product.available)} шт`

  if (level === "negative") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-red-600">
        {qty}
      </span>
    )
  }

  if (level === "zero") {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-zinc-500">
        {qty}
      </span>
    )
  }

  if (level === "low") {
    return (
      <span
        className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-amber-700"
        title="Мало на складе (≤3)"
      >
        {qty}
      </span>
    )
  }

  return <span className="text-sm font-medium tabular-nums">{qty}</span>
}

function number(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}
