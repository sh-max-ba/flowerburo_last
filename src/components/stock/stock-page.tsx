"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronsUpDownIcon,
  ClipboardListIcon,
  DownloadIcon,
  FilterIcon,
  FileSpreadsheetIcon,
  HistoryIcon,
  MinusCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PlusCircleIcon,
  SearchIcon,
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
  Product,
  Supplier,
  StockDocumentType,
  WarehouseImportAction,
  WarehouseImportPreview,
} from "@/lib/db"
import { toDatetimeLocalValue } from "@/lib/datetime"
import { formatMoney } from "@/lib/utils"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ProductThumbnail } from "@/components/products/product-thumbnail"
import { StockActProductPicker } from "@/components/stock/stock-act-product-picker"
import { OverheadEditor } from "@/components/stock/overhead-editor"

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
  negativeStockCount,
  suppliers,
}: {
  products: Product[]
  archivedProducts: Product[]
  negativeStockCount: number
  suppliers: Supplier[]
}) {
  const router = useRouter()
  // Ссылка со списка актов (/stock?new=stock_in|stock_out) открывает диалог создания —
  // читаем параметр при монтировании и инициализируем им состояние диалога (без эффекта).
  const searchParams = useSearchParams()
  const requestedDocType = searchParams.get("new")
  const [view, setView] = useState<"active" | "archived">("active")
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState(allCategoriesValue)
  const [levelFilter, setLevelFilter] = useState<StockLevelFilter>("all")
  const [productSheet, setProductSheet] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [clearingCategory, setClearingCategory] = useState<CategorySummary | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [archivingProduct, setArchivingProduct] = useState<Product | null>(null)
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null)
  const [stockDocumentType, setStockDocumentType] = useState<StockDocumentDialogType>(
    requestedDocType === "stock_in" || requestedDocType === "stock_out" ? requestedDocType : null
  )
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
        products={filteredProducts}
        categories={categories}
        view={view}
        onViewChange={(next) => {
          setView(next)
          setLevelFilter("all")
        }}
        activeCount={products.length}
        archivedCount={archivedProducts.length}
        negativeStockCount={negativeStockCount}
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
        onStockDocument={(type) => setStockDocumentType(type)}
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
        onOpenChange={(open) => !open && setStockDocumentType(null)}
        onSubmit={(event, type) =>
          submitForm(event, (formData) => createStockDocumentAction(type, formData), () => setStockDocumentType(null))
        }
        onSaveDraft={(event, type) =>
          submitForm(event, (formData) => saveStockDocumentDraftAction(type, formData), () => setStockDocumentType(null))
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
  view,
  onViewChange,
  activeCount,
  archivedCount,
  negativeStockCount,
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
  onStockDocument,
  onImport,
  onOpenCategories,
  onArchive,
  onRestore,
  onDelete,
  pending,
}: {
  products: Product[]
  categories: CategorySummary[]
  view: "active" | "archived"
  onViewChange: (next: "active" | "archived") => void
  activeCount: number
  archivedCount: number
  negativeStockCount: number
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
  onStockDocument: (type: StockDocumentType) => void
  onImport: () => void
  onOpenCategories: () => void
  onArchive: (product: Product) => void
  onRestore: (product: Product) => void
  onDelete: (product: Product) => void
  pending: boolean
}) {
  const isArchiveView = view === "archived"
  const selectedCategory = categories.find((category) => category.path === categoryFilter)
  const levelChips: { value: StockLevelFilter; label: string; count: number; icon?: React.ReactNode }[] = [
    { value: "all", label: "Все", count: levelCounts.all },
    {
      value: "low",
      label: "Мало ≤3",
      count: levelCounts.low,
      icon: <AlertTriangleIcon data-icon="inline-start" />,
    },
    {
      value: "zero",
      label: "Нет в наличии",
      count: levelCounts.zero,
      icon: <AlertOctagonIcon data-icon="inline-start" />,
    },
    {
      value: "negative",
      label: "В минусе",
      count: levelCounts.negative,
      icon: <AlertOctagonIcon data-icon="inline-start" />,
    },
  ]

  return (
    <Card className="min-w-0 rounded-2xl border bg-white">
      <CardHeader>
        <div className="flex flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
          <div className="relative min-w-64 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 pl-9"
              placeholder="Найти товар по названию, коду или артикулу"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Select
            items={[
              { label: "Все категории", value: allCategoriesValue },
              ...categories.map((category) => ({
                label: `${category.label} — ${category.count}`,
                value: category.path,
              })),
            ]}
            value={categoryFilter}
              onValueChange={(value) => setCategoryFilter(value ?? allCategoriesValue)}
            >
            <SelectTrigger className="h-10 w-full min-w-56 xl:w-72">
              <SelectValue placeholder="Все категории">
                {categoryFilter === allCategoriesValue
                  ? "Все категории"
                  : selectedCategory
                    ? `${selectedCategory.label} — ${selectedCategory.count}`
                    : "Все категории"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                <SelectItem value={allCategoriesValue}>Все категории</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.path} value={category.path}>
                    <span className="max-w-64 truncate">{category.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{category.count}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-2 xl:ml-auto">
            <Button className="h-10" onClick={() => onStockDocument("stock_in")} disabled={pending}>
              <PlusCircleIcon data-icon="inline-start" />
              Пополнить
            </Button>
            <Button className="h-10" variant="outline" onClick={() => onStockDocument("stock_out")} disabled={pending}>
              <MinusCircleIcon data-icon="inline-start" />
              Списать
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button className="h-10" variant="outline" disabled={pending} />}>
                <MoreHorizontalIcon data-icon="inline-start" />
                Ещё
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={onCreate}>
                  <PlusIcon />
                  Новый товар
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/stock/acts" />}>
                  <ClipboardListIcon />
                  Акты склада
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
                <DropdownMenuItem render={<Link href="/history/stock" />}>
                  <HistoryIcon />
                  Движения склада
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 border-b pb-3">
          <Button
            type="button"
            size="sm"
            variant={!isArchiveView ? "default" : "outline"}
            onClick={() => onViewChange("active")}
          >
            Активные
            <span className={!isArchiveView ? "opacity-80" : "text-muted-foreground"}>({activeCount})</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={isArchiveView ? "default" : "outline"}
            onClick={() => onViewChange("archived")}
          >
            <ArchiveIcon data-icon="inline-start" />
            В архиве
            <span className={isArchiveView ? "opacity-80" : "text-muted-foreground"}>({archivedCount})</span>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {levelChips.map((chip) => {
            const isActive = levelFilter === chip.value
            const isDisabled = chip.value !== "all" && chip.count === 0
            return (
              <Button
                key={chip.value}
                type="button"
                size="sm"
                variant={isActive ? "default" : "outline"}
                disabled={isDisabled}
                onClick={() => setLevelFilter(chip.value)}
              >
                {chip.icon}
                {chip.label}
                <span className={isActive ? "opacity-80" : "text-muted-foreground"}>({chip.count})</span>
              </Button>
            )
          })}
        </div>
        <ResponsiveTable
          emptyTitle={isArchiveView ? "В архиве пусто" : "Склад пуст"}
          filtered={hasActiveFilters}
          onResetFilters={onResetFilters}
          headers={["Товар", "Категория", "Доступно", "Цена", ""]}
          rows={products.map((product) => [
            <div key="name" className="flex min-w-56 items-center gap-2">
              <ProductThumbnail name={product.name} imagePath={product.imagePath} size="md" />
              <div className="min-w-0">
                <div className="truncate font-medium">{product.name}</div>
                <div className="truncate text-xs text-muted-foreground">{product.article || "Артикул не указан"}</div>
              </div>
            </div>,
            <CategoryCell key="category" categoryPath={product.categoryPath} />,
            <StockBadge key="stock" product={product} />,
            formatMoney(product.salePrice),
            <div key="actions" className="flex justify-end gap-1">
              {isArchiveView ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => onRestore(product)} disabled={pending}>
                    <ArchiveRestoreIcon data-icon="inline-start" />
                    Восстановить
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDelete(product)}
                    title="Удалить навсегда"
                  >
                    <Trash2Icon />
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => onEdit(product)}>
                    <PencilIcon data-icon="inline-start" />
                    Редактировать
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onArchive(product)} title="В архив">
                    <ArchiveIcon />
                  </Button>
                </>
              )}
            </div>,
          ])}
        />
        {!isArchiveView && negativeStockCount > 0 && (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-red-300 text-destructive hover:bg-destructive/10"
              onClick={() => setLevelFilter("negative")}
            >
              <AlertOctagonIcon data-icon="inline-start" />
              В минусе: {negativeStockCount}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
                <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={pending}>
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

type StockDocumentLine = {
  product: Product
  qty: string
  unitCost: string
}

function computeStockDocumentTotals(items: StockDocumentLine[], products: Product[], isWriteOff: boolean) {
  let totalQty = 0
  let totalValue = 0

  for (const item of items) {
    const qty = Number(item.qty || 0)
    if (!Number.isFinite(qty) || qty <= 0) {
      continue
    }
    const product = products.find((candidate) => candidate.code === item.product.code) ?? item.product
    totalQty += qty
    // Приход — по введённой цене закупки; списание — по текущей себестоимости товара.
    const unit = isWriteOff ? product.costPrice || 0 : Number(item.unitCost) || 0
    totalValue += qty * unit
  }

  return { positions: items.length, totalQty, totalValue }
}

function StockDocumentDialog({
  type,
  products,
  suppliers,
  pending,
  onOpenChange,
  onSubmit,
  onSaveDraft,
}: {
  type: StockDocumentDialogType
  products: Product[]
  suppliers: Supplier[]
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, type: StockDocumentType) => void
  onSaveDraft: (event: React.FormEvent<HTMLFormElement>, type: StockDocumentType) => void
}) {
  const [items, setItems] = useState<StockDocumentLine[]>([])
  const [supplierId, setSupplierId] = useState("none")
  const [operationAt, setOperationAt] = useState(() => toDatetimeLocalValue())
  const isWriteOff = type === "stock_out"
  const title = isWriteOff ? "Акт списания" : "Акт пополнения"
  const description = "Добавьте товары, проверьте количество и сохраните или проведите акт"
  const operationAtLabel = isWriteOff ? "Дата и время списания" : "Дата и время приемки"
  const totals = computeStockDocumentTotals(items, products, isWriteOff)

  function addProduct(product: Product) {
    const freshProduct = products.find((item) => item.code === product.code) ?? product
    setItems((current) => {
      const existing = current.find((item) => item.product.code === freshProduct.code)
      if (existing) {
        const updated = {
          ...existing,
          product: freshProduct,
          qty: String(incrementWholeQty(existing.qty)),
        }
        return [
          updated,
          ...current.filter((item) => item.product.code !== freshProduct.code),
        ]
      }

      return [{ product: freshProduct, qty: "1", unitCost: "" }, ...current]
    })
  }

  function updateQty(productCode: string, qty: string) {
    setItems((current) =>
      current.map((item) => (item.product.code === productCode ? { ...item, qty } : item))
    )
  }

  function updateUnitCost(productCode: string, unitCost: string) {
    setItems((current) =>
      current.map((item) => (item.product.code === productCode ? { ...item, unitCost } : item))
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
        }
        onOpenChange(open)
      }}
    >
      <SheetContent
        side="right"
        className="!w-screen !max-w-none p-0 sm:!max-w-none md:!max-w-none lg:!max-w-none xl:!max-w-none data-[side=right]:!w-screen data-[side=right]:sm:!w-[90vw] data-[side=right]:md:!w-[860px] data-[side=right]:lg:!w-[1040px] data-[side=right]:xl:!w-[1180px] data-[side=right]:sm:!max-w-none"
      >
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
        {type && (
          <form key={type} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle className="text-base">Основная информация</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <Info label="Тип" value={isWriteOff ? "Списание" : "Пополнение"} />
                    <Info label="Статус" value="Новый акт" />
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
                        <input type="hidden" name="supplierId" value={supplierId === "none" ? "" : supplierId} />
                        <Select value={supplierId} onValueChange={(value) => setSupplierId(value ?? "none")}>
                          <SelectTrigger id="stock-document-supplier" className="w-full" disabled={pending}>
                            <SelectValue placeholder="Без поставщика">{(value) => (!value || value === "none" ? "Без поставщика" : suppliers.find((s) => String(s.id) === String(value))?.name ?? "Без поставщика")}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="none">Без поставщика</SelectItem>
                              {suppliers.map((supplier) => (
                                <SelectItem key={supplier.id} value={String(supplier.id)}>
                                  {supplier.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {supplierId === "none" && (
                          <FieldDescription>Поставщик не указан, акт все равно можно сохранить или провести.</FieldDescription>
                        )}
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

                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle className="text-base">Поиск товара</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <StockActProductPicker
                      products={products}
                      disabled={pending}
                      placeholder="Найти товар и добавить в акт"
                      onSelect={addProduct}
                    />
                  </CardContent>
                </Card>
                </div>

                <div className="min-w-0 rounded-lg border bg-background">
                  {items.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">Позиции акта пока не добавлены</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <ScrollArea style={{ height: Math.min(items.length * 90 + 48, 420) }}>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-64">Товар</TableHead>
                              <TableHead className="w-28">Остаток</TableHead>
                              <TableHead className="w-32">Кол-во</TableHead>
                              {!isWriteOff && <TableHead className="w-32">Цена закупки</TableHead>}
                              <TableHead className="w-36">После</TableHead>
                              <TableHead className="min-w-44">Комментарий</TableHead>
                              <TableHead className="w-12" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((item) => {
                              const product = products.find((candidate) => candidate.code === item.product.code) ?? item.product
                              const qty = Number(item.qty || 0)
                              const nextStock = product.stock + (isWriteOff ? -qty : qty)

                              return (
                                <TableRow key={product.code}>
                                  <TableCell>
                                    <input type="hidden" name="itemProductCode" value={product.code} />
                                    <div className="flex min-w-0 items-center gap-2">
                                      <ProductThumbnail name={product.name} imagePath={product.imagePath} size="sm" />
                                      <div className="min-w-0">
                                        <div className="truncate font-medium">{product.name}</div>
                                        <div className="text-xs text-muted-foreground">{product.code}</div>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>{number(product.stock)}</TableCell>
                                  <TableCell>
                                    <Input
                                      name="itemQty"
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={item.qty}
                                      disabled={pending}
                                      onChange={(event) => updateQty(product.code, event.target.value)}
                                      required
                                    />
                                  </TableCell>
                                  {!isWriteOff && (
                                    <TableCell>
                                      <Input
                                        name="itemUnitCost"
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        placeholder="0"
                                        value={item.unitCost}
                                        disabled={pending}
                                        onChange={(event) => updateUnitCost(product.code, event.target.value)}
                                      />
                                    </TableCell>
                                  )}
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <span>{number(nextStock)}</span>
                                      {isWriteOff && nextStock < 0 && (
                                        <Badge className="border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50">
                                          Будет минус
                                        </Badge>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Input name="itemComment" disabled={pending} placeholder="Комментарий" />
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      disabled={pending}
                                      onClick={() => removeProduct(product.code)}
                                    >
                                      <Trash2Icon />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                          <TableFooter>
                            <TableRow>
                              <TableCell className="font-medium" colSpan={2}>
                                Позиций: {totals.positions}
                              </TableCell>
                              <TableCell className="font-semibold">{number(totals.totalQty)}</TableCell>
                              {!isWriteOff && <TableCell />}
                              <TableCell
                                colSpan={3}
                                className="text-right font-semibold"
                                title={isWriteOff ? "Оценочно по текущей себестоимости" : "По введённым ценам закупки"}
                              >
                                {isWriteOff ? "Стоимость списания" : "Стоимость прихода"}: {formatMoney(totals.totalValue)}
                              </TableCell>
                            </TableRow>
                          </TableFooter>
                        </Table>
                      </ScrollArea>
                    </div>
                  )}
                </div>
                {!isWriteOff && <OverheadEditor disabled={pending} />}
              </div>
            </div>
            <SheetFooter className="sticky bottom-0 flex-row justify-end border-t bg-background px-6 py-4">
              <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
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

function ResponsiveTable({
  headers,
  rows,
  emptyTitle,
  filtered = false,
  onResetFilters,
}: {
  headers: string[]
  rows: React.ReactNode[][]
  emptyTitle: string
  filtered?: boolean
  onResetFilters?: () => void
}) {
  if (!rows.length) {
    if (filtered) {
      return (
        <Empty className="min-h-56">
          <EmptyHeader>
            <EmptyTitle>Ничего не найдено</EmptyTitle>
            <EmptyDescription>По выбранным фильтрам нет товаров. Сбросьте фильтры, чтобы увидеть весь список.</EmptyDescription>
          </EmptyHeader>
          {onResetFilters && (
            <EmptyContent>
              <Button type="button" variant="outline" size="sm" onClick={onResetFilters}>
                <FilterIcon data-icon="inline-start" />
                Сбросить фильтры
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )
    }

    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>Данные появятся после первой операции.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Separator />
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header} className={header ? undefined : "text-right"}>
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex} className={cellIndex === row.length - 1 ? "text-right" : undefined}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function StockBadge({ product }: { product: Product }) {
  const level = stockLevel(product)

  if (level === "negative") {
    return (
      <Badge variant="destructive" className="font-semibold">
        <AlertOctagonIcon data-icon="inline-start" />
        {number(product.available)}
      </Badge>
    )
  }

  if (level === "zero") {
    return (
      <Badge variant="destructive" className="font-semibold">
        <AlertOctagonIcon data-icon="inline-start" />
        Нет в наличии
      </Badge>
    )
  }

  if (level === "low") {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 bg-amber-50 font-semibold text-amber-900 hover:bg-amber-50"
      >
        <AlertTriangleIcon data-icon="inline-start" />
        {number(product.available)} · Мало
      </Badge>
    )
  }

  return (
    <Badge variant="secondary" className="text-muted-foreground">
      {number(product.available)}
    </Badge>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-semibold text-zinc-950">{value}</div>
    </div>
  )
}

function number(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function incrementWholeQty(value: string) {
  const next = Number(value || 0) + 1
  if (!Number.isFinite(next)) {
    return 1
  }

  return Math.max(1, Math.round(next))
}
