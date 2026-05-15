"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  BanknoteIcon,
  BoxesIcon,
  ChevronsUpDownIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  PackageCheckIcon,
  DownloadIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  HistoryIcon,
  KeyRoundIcon,
  LogOutIcon,
  MenuIcon,
  MinusCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PlusCircleIcon,
  ReceiptTextIcon,
  SearchIcon,
  SettingsIcon,
  TagsIcon,
  Trash2Icon,
  UploadIcon,
  UserCheckIcon,
  UserXIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  cancelOrderAction,
  applyWarehouseImportAction,
  cashInAction,
  cashOutAction,
  changeUserPasswordAction,
  clearProductCategoryAction,
  closeDeliveredOrderAction,
  closeShiftAction,
  completePickupOrderAction,
  createOrderAction,
  createSaleAction,
  createStockDocumentAction,
  createUserAction,
  deleteProductAction,
  handOrderToCourierAction,
  markOrderReadyAction,
  openShiftAction,
  previewWarehouseImportAction,
  renameProductCategoryAction,
  saveStockDocumentDraftAction,
  saveProductAction,
  saveSupplierAction,
  setSupplierActiveAction,
  setUserActiveAction,
  startOrderWorkAction,
  updateUserAction,
} from "@/app/actions"
import { logoutAction } from "@/app/auth-actions"
import type {
  CurrentUser,
  CustomerOption,
  DashboardData,
  Order,
  OrderStatus,
  PaymentMethod,
  Product,
  Supplier,
  StockDocumentType,
  UserRole,
  WarehouseImportAction,
  WarehouseImportPreview,
} from "@/lib/db"
import { toDatetimeLocalValue } from "@/lib/datetime"
import { getPaymentMethodLabel, paymentMethodOptions } from "@/lib/labels"
import { calculateCommercialTotals, normalizeDiscountType, type DiscountType } from "@/lib/pricing"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ShiftCloseSummary } from "@/components/shifts/shift-pages"
import { StockActProductPicker } from "@/components/stock/stock-act-product-picker"
import { ProductCombobox } from "@/components/products/product-combobox"
import {
  addProductToLineItems,
  ProductLineItems,
  type ProductLineItem,
  validateProductLineItems,
} from "@/components/products/product-line-items"

export type Section =
  | "stock"
  | "sales"
  | "ready-orders"
  | "shifts"
  | "orders"
  | "clients"
  | "deals"
  | "history"
  | "settings"
type Result = Awaited<ReturnType<typeof saveProductAction>>
type CashOperation = "cashIn" | "cashOut"
type StockDocumentDialogType = StockDocumentType | null
type CategorySummary = { path: string; label: string; count: number }

const initialOpenShiftForm = {
  openingCash: "",
  openingComment: "",
}

const initialCloseShiftForm = {
  closingCash: "",
  closingComment: "",
}

const orderRealtimeRefreshMs = 5000
const allCategoriesValue = "__all__"
const uncategorizedValue = "__uncategorized__"
const uncategorizedLabel = "Без категории"

const sections: Array<{ id: Section; label: string; icon: typeof BoxesIcon; href: string }> = [
  { id: "stock", label: "Склад", icon: BoxesIcon, href: "/stock" },
  { id: "sales", label: "Касса", icon: ReceiptTextIcon, href: "/cash" },
  { id: "ready-orders", label: "Готовые заказы", icon: PackageCheckIcon, href: "/ready-orders" },
  { id: "shifts", label: "Смены", icon: BanknoteIcon, href: "/shifts" },
  { id: "orders", label: "Стол заказов", icon: ClipboardListIcon, href: "/orders" },
  { id: "clients", label: "Клиенты", icon: UserCheckIcon, href: "/clients" },
  { id: "deals", label: "Сделки", icon: TagsIcon, href: "/deals" },
  { id: "history", label: "История", icon: HistoryIcon, href: "/history" },
  { id: "settings", label: "Настройки", icon: SettingsIcon, href: "/settings" },
]

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

const userRoleOptions: UserRole[] = ["owner", "manager", "florist"]

const roleSectionIds: Record<UserRole, Section[]> = {
  owner: ["stock", "sales", "ready-orders", "shifts", "orders", "clients", "deals", "history", "settings"],
  manager: ["sales", "ready-orders", "orders", "clients", "deals"],
  florist: ["orders"],
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

function padDatePart(value: number) {
  return String(value).padStart(2, "0")
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
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

export function Backoffice({
  data,
  user,
  initialSection,
  canAccessCash,
  activeFlorists,
}: {
  data: DashboardData
  user: CurrentUser
  initialSection: Section
  canAccessCash: boolean
  activeFlorists: CurrentUser[]
}) {
  const router = useRouter()
  const visibleSectionIds = useMemo(() => {
    const ids = roleSectionIds[user.role]
    return canAccessCash && user.role === "florist" ? (["orders", "sales"] satisfies Section[]) : ids
  }, [canAccessCash, user.role])
  const visibleSections = useMemo(
    () => sections.filter((item) => visibleSectionIds.includes(item.id)),
    [visibleSectionIds]
  )
  const [section, setSection] = useState<Section>(
    visibleSectionIds.includes(initialSection) ? initialSection : visibleSectionIds[0]
  )
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState(allCategoriesValue)
  const [productSheet, setProductSheet] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [clearingCategory, setClearingCategory] = useState<CategorySummary | null>(null)
  const [shiftSheet, setShiftSheet] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null)
  const [stockDocumentType, setStockDocumentType] = useState<StockDocumentDialogType>(null)
  const [warehouseImportOpen, setWarehouseImportOpen] = useState(false)
  const [warehouseImportPreview, setWarehouseImportPreview] = useState<WarehouseImportPreview | null>(null)
  const [cashOperation, setCashOperation] = useState<CashOperation | null>(null)
  const [handoverOrder, setHandoverOrder] = useState<Order | null>(null)
  const [readyOrdersCount, setReadyOrdersCount] = useState(
    data.orders.filter((order) => order.status === "Готов").length
  )
  const [userSheet, setUserSheet] = useState(false)
  const [editingUser, setEditingUser] = useState<CurrentUser | null>(null)
  const [passwordUser, setPasswordUser] = useState<CurrentUser | null>(null)
  const [activeToggleUser, setActiveToggleUser] = useState<CurrentUser | null>(null)
  const [supplierSheet, setSupplierSheet] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [activeToggleSupplier, setActiveToggleSupplier] = useState<Supplier | null>(null)
  const [isPending, startTransition] = useTransition()
  const displayedSection = visibleSectionIds.includes(section) ? section : visibleSectionIds[0]
  const activeSection = sections.find((item) => item.id === displayedSection)
  const canManageShift = user.role === "owner" || user.role === "manager" || canAccessCash
  const openShiftDetails = data.stats.openShift
    ? data.shiftDetails.find((detail) => detail.shift.id === data.stats.openShift?.id) ?? null
    : null

  useEffect(() => {
    if (displayedSection !== "orders" && displayedSection !== "sales" && displayedSection !== "ready-orders") {
      return
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh()
      }
    }, orderRealtimeRefreshMs)

    return () => window.clearInterval(interval)
  }, [displayedSection, router])

  useEffect(() => {
    if (!visibleSectionIds.includes("ready-orders")) {
      return
    }

    let mounted = true

    async function loadCount() {
      try {
        const response = await fetch("/api/ready-orders/count", { cache: "no-store" })
        if (!response.ok) {
          return
        }
        const payload = (await response.json()) as { count?: number }
        if (mounted) {
          setReadyOrdersCount(payload.count ?? 0)
        }
      } catch {
        // Polling should never break the sidebar.
      }
    }

    loadCount()
    const interval = window.setInterval(loadCount, orderRealtimeRefreshMs)

    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [visibleSectionIds])

  const categories = useMemo(() => buildCategorySummaries(data.products), [data.products])
  const activeCategoryFilter =
    categoryFilter === allCategoriesValue || categories.some((category) => category.path === categoryFilter)
      ? categoryFilter
      : allCategoriesValue

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    return data.products.filter((product) => {
      const matchesQuery =
        !normalized ||
        `${product.code} ${product.article} ${product.name}`.toLowerCase().includes(normalized)
      const matchesCategory =
        activeCategoryFilter === allCategoriesValue || getCategoryValue(product.categoryPath) === activeCategoryFilter

      return matchesQuery && matchesCategory
    })
  }, [activeCategoryFilter, data.products, query])

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
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-10 items-center px-2">
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-semibold">Flower Buro</div>
            </div>
            <div className="hidden size-8 items-center justify-center text-sm font-semibold group-data-[collapsible=icon]:flex">
              FB
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Разделы</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleSections.map((item) => {
                  const Icon = item.icon

                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={displayedSection === item.id}
                        tooltip={item.label}
                        onClick={() => {
                          setSection(item.id)
                          router.push(item.href)
                        }}
                      >
                        <Icon />
                        <span>{item.label}</span>
                        {item.id === "ready-orders" && readyOrdersCount > 0 && (
                          <Badge className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-xs group-data-[collapsible=icon]:hidden">
                            {readyOrdersCount}
                          </Badge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex flex-col gap-2 rounded-lg border bg-background p-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{roleLabels[user.role]}</div>
            </div>
            <form action={logoutAction} className="w-full group-data-[collapsible=icon]:w-8">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="w-full justify-start group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
              >
                <LogOutIcon data-icon="inline-start" />
                <span className="group-data-[collapsible=icon]:hidden">Выйти</span>
              </Button>
            </form>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border bg-background p-3 text-xs group-data-[collapsible=icon]:hidden">
            <div className="font-medium text-foreground">
              {data.stats.openShift
                ? `Смена #${data.stats.openShift.id} · Ответственный: ${
                    data.stats.openShift.cashierName || "не указан"
                  }`
                : "Смена не открыта"}
            </div>
            {data.stats.openShift && (
              <div className="text-muted-foreground">
                Ожидается: {formatMoney(data.stats.openShift.expectedCash)}
              </div>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-zinc-50">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-background px-4 shadow-sm md:px-5">
          <div className="flex items-center gap-3">
            <SidebarTrigger variant="ghost" size="icon-sm">
              <MenuIcon />
            </SidebarTrigger>
            <div>
              <h1 className="text-lg font-semibold">{activeSection?.label}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={data.stats.openShift ? "secondary" : "outline"}>
              {displayedSection === "sales" && data.stats.openShift
                ? "Смена открыта"
                : data.stats.openShift
                ? `Смена #${data.stats.openShift.id} · ${data.stats.openShift.cashierName || "ответственный не указан"}`
                : "Смена закрыта"}
            </Badge>
            {displayedSection === "sales" && data.stats.openShift?.type === "night" && (
              <Badge variant="outline">Ночная смена</Badge>
            )}
            {canManageShift && (
              <Button
                variant={data.stats.openShift ? "outline" : "default"}
                onClick={() => {
                  setSection(canAccessCash ? "sales" : displayedSection)
                  setShiftSheet(true)
                }}
              >
                <BanknoteIcon data-icon="inline-start" />
                {data.stats.openShift ? "Закрыть смену" : "Открыть смену"}
              </Button>
            )}
          </div>
        </header>

        <main className="flex flex-1 flex-col p-4 md:p-5">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
            {displayedSection === "stock" && <StatsGrid data={data} />}

            {displayedSection === "stock" && (
              <StockSection
                products={filteredProducts}
                categories={categories}
                negativeStockCount={data.stats.negativeStockCount}
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
                onDelete={setDeletingProduct}
              />
            )}
            {displayedSection === "sales" && (
              <SalesSection
                data={data}
                pending={isPending}
                onSaleSubmit={(event, after) => submitForm(event, createSaleAction, after)}
                onOrderSubmit={(event, after) => submitForm(event, createOrderAction, after)}
                onCashOperation={setCashOperation}
              />
            )}
            {displayedSection === "ready-orders" && (
              <ReadyOrdersSection
                data={data}
                pending={isPending}
                onPickup={(order, event) => {
                  event.preventDefault()
                  const formData = new FormData(event.currentTarget)
                  run(() => completePickupOrderAction(order.id, formData))
                }}
                onHandover={setHandoverOrder}
                onCloseDelivery={(order) => run(() => closeDeliveredOrderAction(order.id))}
              />
            )}
            {displayedSection === "shifts" && (
              <ShiftsSection data={data} onOpenDetails={(shiftId) => router.push(`/shifts/${shiftId}`)} />
            )}
            {displayedSection === "orders" && (
              <OrdersSection
                data={data}
                pending={isPending}
                onStart={(order) => run(() => startOrderWorkAction(order.id))}
                onReady={(order) => run(() => markOrderReadyAction(order.id))}
                onCancel={(order) => run(() => cancelOrderAction(order.id))}
              />
            )}
            {displayedSection === "history" && <HistorySection data={data} />}
            {displayedSection === "settings" && (
              <SettingsSection
                users={data.users}
                suppliers={data.suppliers}
                currentUserId={user.id}
                pending={isPending}
                onCreateUser={() => {
                  setEditingUser(null)
                  setUserSheet(true)
                }}
                onEditUser={(targetUser) => {
                  setEditingUser(targetUser)
                  setUserSheet(true)
                }}
                onPassword={setPasswordUser}
                onToggleUserActive={setActiveToggleUser}
                onCreateSupplier={() => {
                  setEditingSupplier(null)
                  setSupplierSheet(true)
                }}
                onEditSupplier={(supplier) => {
                  setEditingSupplier(supplier)
                  setSupplierSheet(true)
                }}
                onToggleSupplierActive={setActiveToggleSupplier}
              />
            )}
          </div>
        </main>
      </SidebarInset>

      <ProductSheet
        key={productSheet ? editingProduct?.code ?? "create-product" : "product-sheet-closed"}
        open={productSheet}
        product={editingProduct}
        categories={categories}
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
        categories={categories.filter((category) => category.path !== uncategorizedValue)}
        pending={isPending}
        onOpenChange={setCategoriesOpen}
        onRename={(event) => submitForm(event, renameProductCategoryAction)}
        onClear={setClearingCategory}
      />
      <ShiftSheet
        open={shiftSheet}
        currentUserId={user.id}
        currentUserName={user.name}
        currentUserRole={user.role}
        defaultOpeningCash={data.stats.defaultOpeningCash}
        activeFlorists={activeFlorists}
        openShift={data.stats.openShift}
        openShiftDetails={openShiftDetails}
        pending={isPending}
        onOpenChange={setShiftSheet}
        onSubmit={(event) =>
          submitForm(
            event,
            data.stats.openShift ? closeShiftAction : openShiftAction,
            () => setShiftSheet(false)
          )
        }
      />
      <CourierSheet
        order={handoverOrder}
        openShift={data.stats.openShift}
        pending={isPending}
        onOpenChange={(open) => !open && setHandoverOrder(null)}
        onSubmit={(event, order) => {
          event.preventDefault()
          const formData = new FormData(event.currentTarget)
          run(() => handOrderToCourierAction(order.id, formData), () => setHandoverOrder(null))
        }}
      />
      <StockDocumentDialog
        key={stockDocumentType ?? "stock-document-closed"}
        type={stockDocumentType}
        products={data.products}
        suppliers={data.suppliers.filter((supplier) => supplier.isActive)}
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
      <CashOperationDialog
        operation={cashOperation}
        pending={isPending}
        onOpenChange={(open) => !open && setCashOperation(null)}
        onSubmit={(event, operation) => {
          submitForm(event, operation === "cashIn" ? cashInAction : cashOutAction, () => setCashOperation(null))
        }}
      />
      <UserSheet
        key={editingUser ? `edit-user-${editingUser.id}` : "create-user"}
        open={userSheet}
        user={editingUser}
        pending={isPending}
        onOpenChange={(open) => {
          setUserSheet(open)
          if (!open) {
            setEditingUser(null)
          }
        }}
        onSubmit={(event, targetUser) =>
          submitForm(event, targetUser ? updateUserAction : createUserAction, () => {
            setUserSheet(false)
            setEditingUser(null)
          })
        }
      />
      <SupplierSheet
        key={editingSupplier ? `edit-supplier-${editingSupplier.id}` : "create-supplier"}
        open={supplierSheet}
        supplier={editingSupplier}
        pending={isPending}
        onOpenChange={(open) => {
          setSupplierSheet(open)
          if (!open) {
            setEditingSupplier(null)
          }
        }}
        onSubmit={(event) =>
          submitForm(event, saveSupplierAction, () => {
            setSupplierSheet(false)
            setEditingSupplier(null)
          })
        }
      />
      <PasswordDialog
        key={passwordUser ? `password-user-${passwordUser.id}` : "password-user-closed"}
        user={passwordUser}
        pending={isPending}
        onOpenChange={(open) => !open && setPasswordUser(null)}
        onSubmit={(event) =>
          submitForm(event, changeUserPasswordAction, () => {
            setPasswordUser(null)
          })
        }
      />

      <AlertDialog open={Boolean(deletingProduct)} onOpenChange={() => setDeletingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить товар?</AlertDialogTitle>
            <AlertDialogDescription>
              Позиция будет удалена со склада. История движений останется.
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
              Удалить
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

      <AlertDialog open={Boolean(activeToggleUser)} onOpenChange={() => setActiveToggleUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {activeToggleUser?.isActive ? "Отключить пользователя?" : "Включить пользователя?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {activeToggleUser?.isActive
                ? "Пользователь не сможет войти, но запись останется в системе."
                : "Пользователь снова сможет входить под своим логином и паролем."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant={activeToggleUser?.isActive ? "destructive" : "default"} disabled={isPending} />}
              onClick={() => {
                if (!activeToggleUser) {
                  return
                }
                run(
                  () => setUserActiveAction(activeToggleUser.id, !activeToggleUser.isActive),
                  () => setActiveToggleUser(null)
                )
              }}
            >
              {activeToggleUser?.isActive ? "Отключить" : "Включить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(activeToggleSupplier)} onOpenChange={() => setActiveToggleSupplier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {activeToggleSupplier?.isActive ? "Отключить поставщика?" : "Включить поставщика?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Отключенный поставщик не будет показан в новых актах пополнения. Старые акты сохранят его название.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant={activeToggleSupplier?.isActive ? "destructive" : "default"} disabled={isPending} />}
              onClick={() => {
                if (!activeToggleSupplier) {
                  return
                }
                run(
                  () => setSupplierActiveAction(activeToggleSupplier.id, !activeToggleSupplier.isActive),
                  () => setActiveToggleSupplier(null)
                )
              }}
            >
              {activeToggleSupplier?.isActive ? "Отключить" : "Включить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}

function StatsGrid({ data }: { data: DashboardData }) {
  const stats = [
    { label: "Товаров", value: data.stats.productsCount, subtitle: "в активном списке склада" },
    { label: "Низкий остаток", value: data.stats.lowStockCount, subtitle: "нужно проверить закупку" },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {stats.map((item) => (
        <Card key={item.label} className="rounded-2xl border bg-white">
          <CardHeader>
            <CardDescription className="text-xs">{item.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold">{item.value}</CardTitle>
            <CardDescription>{item.subtitle}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

function StockSection({
  products,
  categories,
  negativeStockCount,
  query,
  setQuery,
  categoryFilter,
  setCategoryFilter,
  onCreate,
  onEdit,
  onStockDocument,
  onImport,
  onOpenCategories,
  onDelete,
  pending,
}: {
  products: Product[]
  categories: CategorySummary[]
  negativeStockCount: number
  query: string
  setQuery: (value: string) => void
  categoryFilter: string
  setCategoryFilter: (value: string) => void
  onCreate: () => void
  onEdit: (product: Product) => void
  onStockDocument: (type: StockDocumentType) => void
  onImport: () => void
  onOpenCategories: () => void
  onDelete: (product: Product) => void
  pending: boolean
}) {
  const selectedCategory = categories.find((category) => category.path === categoryFilter)

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
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
          <div className="flex flex-wrap gap-2 xl:ml-auto xl:flex-nowrap">
            <Button className="h-10" onClick={() => onStockDocument("stock_in")} disabled={pending}>
              <PlusCircleIcon data-icon="inline-start" />
              Пополнить
            </Button>
            <Button className="h-10" variant="outline" onClick={() => onStockDocument("stock_out")} disabled={pending}>
              <MinusCircleIcon data-icon="inline-start" />
              Списать
            </Button>
            <Button className="h-10" variant="outline" render={<Link href="/stock/acts" />}>
              <ClipboardListIcon data-icon="inline-start" />
              Акты склада
            </Button>
            <Button className="h-10" onClick={onCreate}>
              <PlusIcon data-icon="inline-start" />
              Новый товар
            </Button>
            <Button className="h-10" variant="outline" onClick={onOpenCategories} disabled={pending}>
              <TagsIcon data-icon="inline-start" />
              Категории
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button className="h-10" variant="outline" disabled={pending} />}>
                <MoreHorizontalIcon data-icon="inline-start" />
                Действия
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
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
      <CardContent className="flex flex-col gap-3">
        <ResponsiveTable
          emptyTitle="Склад пуст"
          headers={["Код", "Товар", "Категория", "Остаток", "Цена", ""]}
          rows={products.map((product) => [
            product.code,
            <div key="name" className="min-w-52">
              <div className="font-medium">{product.name}</div>
              <div className="truncate text-xs text-muted-foreground">{product.article || "Артикул не указан"}</div>
            </div>,
            <CategoryCell key="category" categoryPath={product.categoryPath} />,
            <StockBadge key="stock" product={product} />,
            formatMoney(product.salePrice),
            <div key="actions" className="flex justify-end gap-1">
              <Button variant="outline" size="sm" onClick={() => onEdit(product)}>
                <PencilIcon data-icon="inline-start" />
                Редактировать
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => onDelete(product)}>
                <Trash2Icon />
              </Button>
            </div>,
          ])}
        />
        {negativeStockCount > 0 && (
          <div className="flex justify-end">
            <Badge variant="outline" className="text-muted-foreground">
              Есть позиции с отрицательным остатком
            </Badge>
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

function SalesSection({
  data,
  pending,
  onSaleSubmit,
  onOrderSubmit,
  onCashOperation,
}: {
  data: DashboardData
  pending: boolean
  onSaleSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
  onOrderSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
  onCashOperation: (operation: CashOperation) => void
}) {
  const openShift = data.stats.openShift
  const activeShiftDetail = openShift
    ? data.shiftDetails.find((detail) => detail.shift.id === openShift.id) ?? null
    : data.shiftDetails[0] ?? null

  return (
    <div className="flex flex-col gap-4">
      {!openShift && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertTriangleIcon />
          <AlertTitle>Откройте смену для кассовых операций</AlertTitle>
          <AlertDescription>
            Продажа, предоплата, доплата и выдача денег курьеру доступны только при открытой смене.
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="sale" className="gap-4">
        <TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
          <TabsTrigger value="sale">Быстрая продажа</TabsTrigger>
          <TabsTrigger value="order">Новый заказ</TabsTrigger>
        </TabsList>
        <TabsContent value="sale">
          <QuickSaleForm
            products={data.products}
            customers={data.customers}
            pending={pending}
            disabled={!openShift}
            onSubmit={onSaleSubmit}
          />
        </TabsContent>
        <TabsContent value="order">
          <NewOrderForm
            products={data.products}
            customers={data.customers}
            pending={pending}
            shiftOpen={Boolean(openShift)}
            onSubmit={onOrderSubmit}
          />
        </TabsContent>
      </Tabs>
      <CashShiftBlock
        detail={activeShiftDetail}
        openShift={openShift}
        pending={pending}
        onCashOperation={onCashOperation}
      />
    </div>
  )
}

function CustomerSelector({
  customers,
  value,
  disabled,
  onValueChange,
}: {
  customers: CustomerOption[]
  value: string
  disabled?: boolean
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedCustomer = value === "none"
    ? null
    : customers.find((customer) => String(customer.id) === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between"
            disabled={disabled}
          />
        }
      >
          <span className="truncate">
            {selectedCustomer
              ? `${selectedCustomer.name}${selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}`
              : "Без клиента"}
          </span>
          <ChevronsUpDownIcon className="size-4 opacity-60" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск клиента" />
          <CommandList>
            <CommandEmpty>Клиент не найден</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="Без клиента"
                data-checked={value === "none"}
                onSelect={() => {
                  onValueChange("none")
                  setOpen(false)
                }}
              >
                Без клиента
              </CommandItem>
              {customers.map((customer) => (
                <CommandItem
                  key={customer.id}
                  value={`${customer.name} ${customer.phone}`}
                  data-checked={value === String(customer.id)}
                  onSelect={() => {
                    onValueChange(String(customer.id))
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {customer.name}
                    {customer.phone ? ` · ${customer.phone}` : ""}
                  </span>
                  {customer.defaultDiscountPercent > 0 && (
                    <span className="text-xs text-muted-foreground">{customer.defaultDiscountPercent}%</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function QuickSaleForm({
  products,
  customers,
  pending,
  disabled,
  onSubmit,
}: {
  products: Product[]
  customers: CustomerOption[]
  pending: boolean
  disabled: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  const [items, setItems] = useState<ProductLineItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("none")
  const [saleDiscountType, setSaleDiscountType] = useState<DiscountType>("none")
  const [saleDiscountValue, setSaleDiscountValue] = useState(0)
  const [saleDiscountTouched, setSaleDiscountTouched] = useState(false)
  const selectedCustomer = selectedCustomerId === "none"
    ? null
    : customers.find((customer) => String(customer.id) === selectedCustomerId) ?? null
  const saleTotals = calculateCommercialTotals(items, saleDiscountType, saleDiscountValue)
  const saleTotal = saleTotals.total

  function addProduct(product: Product) {
    setItems((current) => addProductToLineItems(current, product))
  }

  function resetForm() {
    setItems([])
    setSelectedCustomerId("none")
    setSaleDiscountType("none")
    setSaleDiscountValue(0)
    setSaleDiscountTouched(false)
  }

  function handleCustomerChange(value: string) {
    const customer = value === "none" ? null : customers.find((current) => String(current.id) === value) ?? null
    setSelectedCustomerId(value)
    if (!saleDiscountTouched) {
      if (customer && customer.defaultDiscountPercent > 0) {
        setSaleDiscountType("percent")
        setSaleDiscountValue(customer.defaultDiscountPercent)
      } else {
        setSaleDiscountType("none")
        setSaleDiscountValue(0)
      }
    }
  }

  function handleSaleDiscountTypeChange(value: string) {
    const nextType = normalizeDiscountType(value)
    setSaleDiscountTouched(true)
    setSaleDiscountType(nextType)
    if (nextType === "none") {
      setSaleDiscountValue(0)
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const validationError = validateProductLineItems(items)
    if (validationError) {
      event.preventDefault()
      toast.error(validationError)
      return
    }

    onSubmit(event, resetForm)
  }

  return (
    <div className="flex flex-col gap-5 pt-3">
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-w-0 rounded-2xl border bg-white">
            <CardHeader>
              <CardTitle>Быстрая продажа</CardTitle>
              <CardDescription>Поиск товара и компактная корзина продажи</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              <ProductCombobox products={products} disabled={pending} onSelect={addProduct} />
              <div className="min-w-0">
                <div className="mb-2 text-sm font-medium">Корзина</div>
                <ProductLineItems
                  products={products}
                  items={items}
                  disabled={pending}
                  emptyTitle="Корзина пуста"
                  onItemsChange={setItems}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl border bg-white xl:sticky xl:top-20 xl:self-start">
            <CardHeader>
              <CardTitle>Оплата</CardTitle>
              <CardDescription>Итог и комментарий к чеку</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FieldGroup>
                <input type="hidden" name="customerId" value={selectedCustomer?.id ?? ""} />
                <input type="hidden" name="saleDiscountType" value={saleDiscountType} />
                <input type="hidden" name="saleDiscountValue" value={saleDiscountValue} />
                <Field>
                  <FieldLabel>Клиент</FieldLabel>
                  <CustomerSelector
                    customers={customers}
                    value={selectedCustomerId}
                    disabled={disabled || pending}
                    onValueChange={handleCustomerChange}
                  />
                  {selectedCustomer ? (
                    <div className="text-xs text-muted-foreground">
                      Скидка клиента: {selectedCustomer.defaultDiscountPercent}%
                    </div>
                  ) : (
                    <Link href="/clients" className="text-xs font-medium text-primary hover:underline">
                      Создать клиента
                    </Link>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="salePaymentMethod">Оплата</FieldLabel>
                  <select
                    id="salePaymentMethod"
                    name="paymentMethod"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={paymentMethod}
                    disabled={disabled || pending}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                  >
                    {paymentMethodOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="sale-note">Комментарий</FieldLabel>
                  <Textarea id="sale-note" name="note" disabled={disabled || pending} />
                </Field>
              </FieldGroup>
              <FieldSet>
                <FieldLegend>Скидка на чек</FieldLegend>
                <div className="flex items-end gap-2">
                  <Field>
                    <FieldLabel htmlFor="saleDiscountType">Тип</FieldLabel>
                    <select
                      id="saleDiscountType"
                      className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-sm"
                      value={saleDiscountType}
                      disabled={disabled || pending}
                      onChange={(event) => handleSaleDiscountTypeChange(event.target.value)}
                    >
                      <option value="none">Без скидки</option>
                      <option value="percent">%</option>
                      <option value="amount">Сумма</option>
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="saleDiscountValue">Значение</FieldLabel>
                    <Input
                      id="saleDiscountValue"
                      type="number"
                      step="1"
                      min="0"
                      value={saleDiscountValue}
                      disabled={disabled || pending}
                      readOnly={saleDiscountType === "none"}
                      className="w-24 text-right"
                      onChange={(event) => {
                        setSaleDiscountTouched(true)
                        setSaleDiscountValue(Number(event.target.value) || 0)
                      }}
                    />
                  </Field>
                </div>
              </FieldSet>
              <div className="grid gap-2 rounded-xl border bg-muted/40 p-4">
                <Info label="Товары до скидки" value={formatMoney(saleTotals.itemsTotalBeforeDiscount)} />
                <Info label="Скидка по позициям" value={formatMoney(saleTotals.itemsDiscountTotal)} />
                <Info label="Скидка на чек" value={formatMoney(saleTotals.dealDiscountAmount)} />
                <div>
                  <div className="text-xs text-muted-foreground">Итого после скидок</div>
                  <div className="text-3xl font-semibold">{formatMoney(saleTotal)}</div>
                </div>
              </div>
              <Button className="w-full" type="submit" disabled={pending || disabled || items.length === 0}>
                <ReceiptTextIcon data-icon="inline-start" />
                Провести продажу
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  )
}

function CashShiftBlock({
  detail,
  openShift,
  pending,
  onCashOperation,
}: {
  detail: DashboardData["shiftDetails"][number] | null
  openShift: DashboardData["stats"]["openShift"]
  pending: boolean
  onCashOperation: (operation: CashOperation) => void
}) {
  const summary = detail ? getShiftCashSummary(detail) : null
  const sales = detail?.sales ?? []

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader className="gap-3">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <CardTitle>Касса за смену</CardTitle>
            <CardDescription>
              {openShift
                ? `Текущая смена #${openShift.id}`
                : detail
                  ? `Последняя смена #${detail.shift.id}`
                  : "Откройте смену"}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {!openShift && <span className="text-xs text-muted-foreground">Откройте смену</span>}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!openShift || pending}
              onClick={() => onCashOperation("cashIn")}
            >
              <PlusCircleIcon data-icon="inline-start" />
              Внесение наличных
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!openShift || pending}
              onClick={() => onCashOperation("cashOut")}
            >
              <MinusCircleIcon data-icon="inline-start" />
              Изъятие наличных
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {summary ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            <CashMetric label="Выручка до скидок" value={formatMoney(summary.revenueBeforeDiscount)} />
            <CashMetric label="Скидки" value={formatMoney(summary.discountTotal)} />
            <CashMetric label="Выручка после скидок" value={formatMoney(summary.revenueTotal)} />
            <CashMetric label="Наличные" value={formatMoney(summary.cash)} />
            <CashMetric label="Карта" value={formatMoney(summary.card)} />
            <CashMetric label="Терминал" value={formatMoney(summary.terminal)} />
            <CashMetric label="Mbank" value={formatMoney(summary.mbank)} />
            <CashMetric label="Optima" value={formatMoney(summary.optima)} />
            <CashMetric label="ЭлСом" value={formatMoney(summary.elsom)} />
            <CashMetric label="Ожидается в кассе" value={formatMoney(summary.expectedCash)} />
          </div>
        ) : (
          <Empty className="min-h-28 py-4">
            <EmptyHeader>
              <EmptyTitle>Откройте смену</EmptyTitle>
              <EmptyDescription>После открытия здесь появятся кассовые показатели.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div>
          <div className="mb-2 text-sm font-medium">Последние продажи</div>
          <ResponsiveTable
            emptyTitle="Продаж пока нет"
            headers={["Дата", "Позиций", "До скидки", "Скидка", "Итого", "Способ оплаты", "Клиент", "Комментарий"]}
            rows={sales.map((sale) => [
              dateTime(sale.createdAt),
              sale.itemsCount,
              formatMoney(sale.totalBeforeDiscount),
              formatMoney(sale.discountTotal),
              formatMoney(sale.total),
              getPaymentMethodLabel(sale.paymentMethod),
              sale.customerName || "-",
              sale.note || "без комментария",
            ])}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function CashMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  )
}

function NewOrderForm({
  products,
  customers,
  pending,
  shiftOpen,
  onSubmit,
}: {
  products: Product[]
  customers: CustomerOption[]
  pending: boolean
  shiftOpen: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  const [deliveryType, setDeliveryType] = useState("pickup")
  const [deliveryPrice, setDeliveryPrice] = useState(0)
  const [courierPayout, setCourierPayout] = useState(0)
  const [prepaid, setPrepaid] = useState(0)
  const [items, setItems] = useState<ProductLineItem[]>([])
  const [customer, setCustomer] = useState("")
  const [phone, setPhone] = useState("")
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("none")
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>("none")
  const [orderDiscountValue, setOrderDiscountValue] = useState(0)
  const [orderDiscountTouched, setOrderDiscountTouched] = useState(false)
  const [dueDate, setDueDate] = useState("")
  const [dueTime, setDueTime] = useState("")
  const [address, setAddress] = useState("")
  const [note, setNote] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("cash")

  const selectedCustomer = selectedCustomerId === "none"
    ? null
    : customers.find((current) => String(current.id) === selectedCustomerId) ?? null
  const orderTotals = calculateCommercialTotals(items, orderDiscountType, orderDiscountValue)
  const itemsTotal = orderTotals.total
  const total = itemsTotal + deliveryPrice
  const balance = total - prepaid
  const needsShift = prepaid > 0 && !shiftOpen
  const prepaidTooHigh = prepaid > total
  const dueAt = dueDate && dueTime ? `${dueDate}T${dueTime}` : ""

  function addProduct(product: Product) {
    setItems((current) => addProductToLineItems(current, product))
  }

  function resetForm() {
    setItems([])
    setSelectedCustomerId("none")
    setCustomer("")
    setPhone("")
    setOrderDiscountType("none")
    setOrderDiscountValue(0)
    setOrderDiscountTouched(false)
    setDueDate("")
    setDueTime("")
    setDeliveryType("pickup")
    setAddress("")
    setNote("")
    setDeliveryPrice(0)
    setCourierPayout(0)
    setPrepaid(0)
    setPaymentMethod("cash")
  }

  function handleCustomerChange(value: string) {
    const nextCustomer = value === "none" ? null : customers.find((current) => String(current.id) === value) ?? null
    setSelectedCustomerId(value)
    setCustomer(nextCustomer?.name ?? "")
    setPhone(nextCustomer?.phone ?? "")
    if (!orderDiscountTouched) {
      if (nextCustomer && nextCustomer.defaultDiscountPercent > 0) {
        setOrderDiscountType("percent")
        setOrderDiscountValue(nextCustomer.defaultDiscountPercent)
      } else {
        setOrderDiscountType("none")
        setOrderDiscountValue(0)
      }
    }
  }

  function handleOrderDiscountTypeChange(value: string) {
    const nextType = normalizeDiscountType(value)
    setOrderDiscountTouched(true)
    setOrderDiscountType(nextType)
    if (nextType === "none") {
      setOrderDiscountValue(0)
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const validationError = validateProductLineItems(items)
    if (validationError) {
      event.preventDefault()
      toast.error(validationError)
      return
    }

    if (prepaid < 0 || deliveryPrice < 0 || courierPayout < 0) {
      event.preventDefault()
      toast.error("Суммы не могут быть отрицательными.")
      return
    }

    if (needsShift) {
      event.preventDefault()
      toast.error("Откройте смену для предоплаты.")
      return
    }

    if (prepaidTooHigh) {
      event.preventDefault()
      toast.error("Предоплата не может быть больше итога заказа.")
      return
    }

    onSubmit(event, resetForm)
  }

  function setDueDay(offsetDays: number) {
    const date = new Date()
    date.setDate(date.getDate() + offsetDays)
    setDueDate(dateInputValue(date))
    if (!dueTime) {
      setDueTime("18:00")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="pt-3">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <CardTitle>Клиент</CardTitle>
              <CardDescription>Основные контакты для менеджера</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <input type="hidden" name="customerId" value={selectedCustomer?.id ?? ""} />
                <input type="hidden" name="orderDiscountType" value={orderDiscountType} />
                <input type="hidden" name="orderDiscountValue" value={orderDiscountValue} />
                <Field>
                  <FieldLabel>Выбор клиента</FieldLabel>
                  <CustomerSelector
                    customers={customers}
                    value={selectedCustomerId}
                    disabled={pending}
                    onValueChange={handleCustomerChange}
                  />
                  {selectedCustomer ? (
                    <div className="text-xs text-muted-foreground">
                      Скидка клиента: {selectedCustomer.defaultDiscountPercent}%
                    </div>
                  ) : (
                    <Link href="/clients" className="text-xs font-medium text-primary hover:underline">
                      Создать клиента
                    </Link>
                  )}
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="customer">Имя клиента</FieldLabel>
                    <Input
                      id="customer"
                      name="customer"
                      value={customer}
                      onChange={(event) => setCustomer(event.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="phone">Телефон</FieldLabel>
                    <Input id="phone" name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <CardTitle>Получение</CardTitle>
              <CardDescription>Срок, самовывоз или доставка</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Дата / время</FieldLabel>
                    <input type="hidden" name="dueAt" value={dueAt} />
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                      <Input
                        id="dueDate"
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                      />
                      <Input
                        id="dueTime"
                        type="time"
                        step="900"
                        value={dueTime}
                        onChange={(event) => setDueTime(event.target.value)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setDueDay(0)}>
                        Сегодня
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setDueDay(1)}>
                        Завтра
                      </Button>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deliveryType">Получение</FieldLabel>
                    <select
                      id="deliveryType"
                      name="deliveryType"
                      className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                      value={deliveryType}
                      onChange={(event) => setDeliveryType(event.target.value)}
                    >
                      <option value="pickup">Самовывоз</option>
                      <option value="delivery">Доставка</option>
                    </select>
                  </Field>
                </div>
                {deliveryType === "delivery" && (
                  <Field>
                    <FieldLabel htmlFor="address">Адрес</FieldLabel>
                    <Input
                      id="address"
                      name="address"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                    />
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="order-note">Комментарий</FieldLabel>
                  <Textarea id="order-note" name="note" value={note} onChange={(event) => setNote(event.target.value)} />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl border bg-white">
            <CardHeader>
              <CardTitle>Состав заказа</CardTitle>
              <CardDescription>Добавляйте товары из products через поиск.</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              <ProductCombobox products={products} disabled={pending} onSelect={addProduct} />
              <ProductLineItems
                products={products}
                items={items}
                disabled={pending}
                emptyTitle="Добавьте товары через поиск"
                onItemsChange={setItems}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 rounded-2xl border bg-white xl:sticky xl:top-20 xl:self-start">
          <CardHeader>
            <CardTitle>Заказ</CardTitle>
            <CardDescription>Доставка, оплата и итог</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-5">
            <FieldSet>
              <FieldLegend>Доставка</FieldLegend>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Field>
                  <FieldLabel htmlFor="deliveryPrice">Платит клиент за доставку</FieldLabel>
                  <Input
                    id="deliveryPrice"
                    name="deliveryPrice"
                    type="number"
                    step="1"
                    min="0"
                    value={deliveryPrice}
                    onChange={(event) => setDeliveryPrice(Number(event.target.value) || 0)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="courierPayout">Выдать курьеру из кассы</FieldLabel>
                  <Input
                    id="courierPayout"
                    name="courierPayout"
                    type="number"
                    step="1"
                    min="0"
                    value={courierPayout}
                    onChange={(event) => setCourierPayout(Number(event.target.value) || 0)}
                  />
                </Field>
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Оплата</FieldLegend>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Field>
                  <FieldLabel htmlFor="prepaid">Предоплата</FieldLabel>
                  <Input
                    id="prepaid"
                    name="prepaid"
                    type="number"
                    step="1"
                    min="0"
                    value={prepaid}
                    onChange={(event) => setPrepaid(Number(event.target.value) || 0)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="orderPaymentMethod">Способ оплаты</FieldLabel>
                  <select
                    id="orderPaymentMethod"
                    name="paymentMethod"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                  >
                    {paymentMethodOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 rounded-lg border bg-background p-3">
                <div className="text-sm font-medium">Скидка на чек</div>
                <div className="flex items-end gap-2">
                  <Field>
                    <FieldLabel htmlFor="orderDiscountType">Тип</FieldLabel>
                    <select
                      id="orderDiscountType"
                      className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-sm"
                      value={orderDiscountType}
                      disabled={pending}
                      onChange={(event) => handleOrderDiscountTypeChange(event.target.value)}
                    >
                      <option value="none">Без скидки</option>
                      <option value="percent">%</option>
                      <option value="amount">Сумма</option>
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="orderDiscountValue">Значение</FieldLabel>
                    <Input
                      id="orderDiscountValue"
                      type="number"
                      step="1"
                      min="0"
                      value={orderDiscountValue}
                      disabled={pending}
                      readOnly={orderDiscountType === "none"}
                      className="w-24 text-right"
                      onChange={(event) => {
                        setOrderDiscountTouched(true)
                        setOrderDiscountValue(Number(event.target.value) || 0)
                      }}
                    />
                  </Field>
                </div>
              </div>
              {needsShift && (
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>Откройте смену для кассовых операций</AlertTitle>
                  <AlertDescription>Предоплату можно принять только при открытой смене.</AlertDescription>
                </Alert>
              )}
              {prepaidTooHigh && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                  <AlertTriangleIcon />
                  <AlertTitle>Предоплата выше итога</AlertTitle>
                  <AlertDescription>Уменьшите предоплату до суммы заказа после скидок.</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
                <Info label="До скидки" value={formatMoney(orderTotals.itemsTotalBeforeDiscount)} />
                <Info label="Скидка по позициям" value={formatMoney(orderTotals.itemsDiscountTotal)} />
                <Info label="Скидка на чек" value={formatMoney(orderTotals.dealDiscountAmount)} />
                <Info label="Доставка" value={formatMoney(deliveryPrice)} />
                <Info label="Итого после скидок" value={formatMoney(total)} />
                <div>
                  <div className="text-xs text-muted-foreground">Остаток</div>
                  <div className="text-3xl font-semibold">{formatMoney(balance)}</div>
                </div>
              </div>
            </FieldSet>

            <div className="mt-auto border-t pt-3">
              <Button className="w-full" type="submit" disabled={pending || needsShift || prepaidTooHigh || items.length === 0}>
                Провести заказ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}

function ReadyOrdersSection({
  data,
  pending,
  onPickup,
  onHandover,
  onCloseDelivery,
}: {
  data: DashboardData
  pending: boolean
  onPickup: (order: Order, event: React.FormEvent<HTMLFormElement>) => void
  onHandover: (order: Order) => void
  onCloseDelivery: (order: Order) => void
}) {
  const orders = data.orders.filter((order) => ["Готов", "Передан курьеру"].includes(order.status))
  const actionCount = orders.filter((order) => order.status === "Готов").length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Badge className="w-fit bg-amber-100 text-amber-900 hover:bg-amber-100">
          {actionCount} ожидают действия
        </Badge>
      </div>

      {!orders.length ? (
        <Empty className="min-h-36 rounded-lg border bg-white py-6">
          <EmptyHeader>
            <EmptyTitle>Готовых заказов пока нет</EmptyTitle>
            <EmptyDescription>Заказы появятся здесь после отметки “Букет готов”.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <ReadyOrderCard
              key={order.id}
              order={order}
              shiftOpen={Boolean(data.stats.openShift)}
              pending={pending}
              onPickup={onPickup}
              onHandover={onHandover}
              onCloseDelivery={onCloseDelivery}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReadyOrderCard({
  order,
  shiftOpen,
  pending,
  onPickup,
  onHandover,
  onCloseDelivery,
}: {
  order: Order
  shiftOpen: boolean
  pending: boolean
  onPickup: (order: Order, event: React.FormEvent<HTMLFormElement>) => void
  onHandover: (order: Order) => void
  onCloseDelivery: (order: Order) => void
}) {
  const balance = order.total - order.paid
  const needsPayment = balance > 0

  return (
    <Card className="min-w-0 rounded-lg border bg-white">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{order.number || `#${order.id}`}</CardTitle>
            <CardDescription className="truncate">{order.customer || "Клиент не указан"}</CardDescription>
          </div>
          <ReadyStatusBadge status={order.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {balance <= 0 ? (
            <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Сумма закрыта</Badge>
          ) : (
            <Badge
              className={
                balance > order.total / 2
                  ? "bg-red-100 text-red-900 hover:bg-red-100"
                  : "bg-amber-100 text-amber-900 hover:bg-amber-100"
              }
            >
              Остаток {formatMoney(balance)}
            </Badge>
          )}
          {order.deliveryPayoutPaid ? (
            <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Курьер оплачен</Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Курьер не оплачен</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid gap-3 text-sm">
          <Info label="Телефон" value={order.phone || "не указан"} />
          <Info label="Тип" value={deliveryTypeLabel(order.deliveryType)} />
          {order.deliveryType === "delivery" && <Info label="Адрес" value={order.address || "не указан"} />}
          <div className="grid grid-cols-2 gap-3">
            <Info label="К сроку" value={order.dueAt ? dateTime(order.dueAt) : "-"} />
            <Info label="Готов" value={order.readyAt ? dateTime(order.readyAt) : "-"} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-sm md:grid-cols-3">
          <Info label="До скидки" value={formatMoney(order.totalBeforeDiscount)} />
          <Info
            label="Скидка"
            value={formatMoney(order.itemsDiscountTotal + order.orderDiscountAmount)}
          />
          <Info label="Итого" value={formatMoney(order.total)} />
          <Info label="Оплачено" value={formatMoney(order.paid)} />
          <Info label="Остаток" value={formatMoney(balance)} />
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <Info label="Доставка" value={formatMoney(order.deliveryPrice)} />
          <Info label="Курьеру" value={formatMoney(order.courierPayout)} />
          <Info label="Выплата" value={order.deliveryPayoutPaid ? "выдана" : "не выдана"} />
        </div>

        <div className="mt-auto flex flex-col gap-2 border-t pt-3">
          {order.deliveryType === "pickup" && order.status === "Готов" && (
            <form onSubmit={(event) => onPickup(order, event)} className="flex flex-col gap-2">
              {needsPayment && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`pickupAmount-${order.id}`}>Доплата</FieldLabel>
                    <Input
                      id={`pickupAmount-${order.id}`}
                      name="paymentAmount"
                      type="number"
                      step="0.01"
                      defaultValue={balance}
                      disabled={!shiftOpen}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`pickupMethod-${order.id}`}>Оплата</FieldLabel>
                    <select
                      id={`pickupMethod-${order.id}`}
                      name="paymentMethod"
                      className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                      defaultValue="cash"
                      disabled={!shiftOpen}
                    >
                      {paymentMethodOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              <Button type="submit" disabled={pending || (needsPayment && !shiftOpen)}>
                Выдать клиенту
              </Button>
            </form>
          )}
          {order.deliveryType === "delivery" && order.status === "Готов" && (
            <Button onClick={() => onHandover(order)} disabled={pending}>
              Передать курьеру
            </Button>
          )}
          {order.status === "Передан курьеру" && (
            <Button onClick={() => onCloseDelivery(order)} disabled={pending}>
              Доставлен / Закрыть
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function OrdersSection({
  data,
  pending,
  onStart,
  onReady,
  onCancel,
}: {
  data: DashboardData
  pending: boolean
  onStart: (order: Order) => void
  onReady: (order: Order) => void
  onCancel: (order: Order) => void
}) {
  const orders = data.orders
    .filter((order) => ["Новый", "В работе", "Готов"].includes(order.status))
    .sort((left, right) => (left.dueAt || "").localeCompare(right.dueAt || ""))

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardTitle>Стол заказов</CardTitle>
        <CardDescription>Рабочий экран флористов без кассовых данных</CardDescription>
      </CardHeader>
      <CardContent>
        {!orders.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Заказов для флористов нет</EmptyTitle>
              <EmptyDescription>Новые заказы появятся после создания на кассе.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {orders.map((order) => (
              <div key={order.id} className="flex flex-col gap-4 rounded-2xl border bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">{order.number || `#${order.id}`}</div>
                    <div className="text-2xl font-semibold">{order.dueAt ? dateTime(order.dueAt) : "Без срока"}</div>
                  </div>
                  <OrderBadge status={order.status} />
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <div className="font-medium">{order.customer}</div>
                  <div>{deliveryTypeLabel(order.deliveryType)}</div>
                  {order.address && <div>{order.address}</div>}
                  {order.note && <div className="text-muted-foreground">{order.note}</div>}
                </div>
                <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3">
                      <span>{item.name}</span>
                      <span>{number(item.qty)} шт</span>
                    </div>
                  ))}
                </div>
                {(order.status === "Готов" || order.status === "Передан курьеру") && (
                  <Alert>
                    <AlertTriangleIcon />
                    <AlertTitle>Букет уже собран, склад автоматически не восстанавливается</AlertTitle>
                  </Alert>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  {order.status === "Новый" && (
                    <Button size="sm" onClick={() => onStart(order)} disabled={pending}>
                      В работу
                    </Button>
                  )}
                  {["Новый", "В работе"].includes(order.status) && (
                    <Button size="sm" variant="default" onClick={() => onReady(order)} disabled={pending}>
                      Букет готов
                    </Button>
                  )}
                  {["Новый", "В работе", "Готов"].includes(order.status) && (
                    <Button size="sm" variant="outline" onClick={() => onCancel(order)} disabled={pending}>
                      Отменить
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ShiftsSection({
  data,
  onOpenDetails,
}: {
  data: DashboardData
  onOpenDetails: (shiftId: number) => void
}) {
  const shiftDetailsById = new Map(data.shiftDetails.map((detail) => [detail.shift.id, detail]))

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <CardTitle>Смены</CardTitle>
          <CardDescription>Клик по строке ведет на полную страницу детализации</CardDescription>
        </CardHeader>
        <CardContent>
          {!data.shifts.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Смен пока нет</EmptyTitle>
                <EmptyDescription>Данные появятся после первой открытой смены.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>№ смены</TableHead>
                    <TableHead>Открыта</TableHead>
                    <TableHead>Закрыта</TableHead>
                    <TableHead>Кассир</TableHead>
                    <TableHead>Стартовая наличка</TableHead>
                    <TableHead>Ожидается в кассе</TableHead>
                    <TableHead>Факт закрытия</TableHead>
                    <TableHead>Разница</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действие</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.shifts.map((shift) => {
                    const detail = shiftDetailsById.get(shift.id)
                    const difference = shift.closingCash === null ? null : shift.closingCash - shift.expectedCash

                    return (
                      <TableRow
                        key={shift.id}
                        className="cursor-pointer"
                        onClick={() => onOpenDetails(shift.id)}
                      >
                        <TableCell className="font-medium">#{shift.id}</TableCell>
                        <TableCell>{dateTime(shift.openedAt)}</TableCell>
                        <TableCell>{shift.closedAt ? dateTime(shift.closedAt) : "активна"}</TableCell>
                        <TableCell>{detail?.cashier ?? "Кассир не указан"}</TableCell>
                        <TableCell>{formatMoney(shift.openingCash)}</TableCell>
                        <TableCell className="font-medium">{formatMoney(shift.expectedCash)}</TableCell>
                        <TableCell>{shift.closingCash === null ? "-" : formatMoney(shift.closingCash)}</TableCell>
                        <TableCell>{difference === null ? "-" : formatMoney(difference)}</TableCell>
                        <TableCell>
                          <Badge variant={shift.status === "open" ? "secondary" : "outline"}>
                            {shift.status === "open" ? "Открыта" : "Закрыта"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenDetails(shift.id)
                            }}
                          >
                            <EyeIcon data-icon="inline-start" />
                            Открыть
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function HistorySection({ data }: { data: DashboardData }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-2xl border bg-white">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>История</CardTitle>
            <CardDescription>Операции системы</CardDescription>
          </div>
          <a href="/history/export" className={buttonVariants({ variant: "outline" })}>
            <FileSpreadsheetIcon />
            Скачать XLSX
          </a>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            emptyTitle="История операций пуста"
            headers={["Дата", "Тип", "Товар", "Кол-во", "Сумма", "Провёл", "Комментарий"]}
            rows={data.movements.map((movement) => [
              dateTime(movement.createdAt),
              movementLabel(movement),
              movement.productName || movement.productCode || "-",
              signedNumber(movement.qty),
              movement.total === null ? "-" : formatMoney(movement.total),
              movement.userName || "не зафиксирован",
              movement.note || "-",
            ])}
          />
        </CardContent>
      </Card>
      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <CardTitle>Продажи</CardTitle>
          <CardDescription>До скидки, скидка и итог после скидок</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            emptyTitle="Продаж пока нет"
            headers={["Дата", "До скидки", "Скидка", "Итого", "Способ оплаты", "Клиент"]}
            rows={data.sales.map((sale) => [
              dateTime(sale.createdAt),
              formatMoney(sale.totalBeforeDiscount),
              formatMoney(sale.discountTotal),
              formatMoney(sale.total),
              getPaymentMethodLabel(sale.paymentMethod),
              sale.customerName || "-",
            ])}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function SettingsSection({
  users,
  suppliers,
  currentUserId,
  pending,
  onCreateUser,
  onEditUser,
  onPassword,
  onToggleUserActive,
  onCreateSupplier,
  onEditSupplier,
  onToggleSupplierActive,
}: {
  users: CurrentUser[]
  suppliers: Supplier[]
  currentUserId: number
  pending: boolean
  onCreateUser: () => void
  onEditUser: (user: CurrentUser) => void
  onPassword: (user: CurrentUser) => void
  onToggleUserActive: (user: CurrentUser) => void
  onCreateSupplier: () => void
  onEditSupplier: (supplier: Supplier) => void
  onToggleSupplierActive: (supplier: Supplier) => void
}) {
  return (
    <Tabs defaultValue="users" className="gap-4">
      <TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
        <TabsTrigger value="users">Пользователи</TabsTrigger>
        <TabsTrigger value="suppliers">Поставщики</TabsTrigger>
      </TabsList>
      <TabsContent value="users">
        <UsersSection
          users={users}
          currentUserId={currentUserId}
          pending={pending}
          onCreate={onCreateUser}
          onEdit={onEditUser}
          onPassword={onPassword}
          onToggleActive={onToggleUserActive}
        />
      </TabsContent>
      <TabsContent value="suppliers">
        <SuppliersSection
          suppliers={suppliers}
          pending={pending}
          onCreate={onCreateSupplier}
          onEdit={onEditSupplier}
          onToggleActive={onToggleSupplierActive}
        />
      </TabsContent>
    </Tabs>
  )
}

function SuppliersSection({
  suppliers,
  pending,
  onCreate,
  onEdit,
  onToggleActive,
}: {
  suppliers: Supplier[]
  pending: boolean
  onCreate: () => void
  onEdit: (supplier: Supplier) => void
  onToggleActive: (supplier: Supplier) => void
}) {
  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Поставщики</CardTitle>
          <CardDescription>Список для актов пополнения склада</CardDescription>
        </div>
        <Button onClick={onCreate} disabled={pending}>
          <PlusIcon data-icon="inline-start" />
          Добавить
        </Button>
      </CardHeader>
      <CardContent>
        {suppliers.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Комментарий</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell>{supplier.contactName || "-"}</TableCell>
                    <TableCell>{supplier.phone || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={supplier.isActive ? "secondary" : "outline"}>
                        {supplier.isActive ? "Активен" : "Отключен"}
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-56">{supplier.comment || "-"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="icon-sm" onClick={() => onEdit(supplier)} disabled={pending}>
                          <PencilIcon />
                          <span className="sr-only">Редактировать</span>
                        </Button>
                        <Button
                          variant={supplier.isActive ? "outline" : "default"}
                          size="sm"
                          onClick={() => onToggleActive(supplier)}
                          disabled={pending}
                        >
                          {supplier.isActive ? (
                            <UserXIcon data-icon="inline-start" />
                          ) : (
                            <UserCheckIcon data-icon="inline-start" />
                          )}
                          {supplier.isActive ? "Отключить" : "Включить"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Поставщиков нет</EmptyTitle>
              <EmptyDescription>Добавьте поставщика для актов пополнения.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onCreate}>
                <PlusIcon data-icon="inline-start" />
                Добавить поставщика
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}

function UsersSection({
  users,
  currentUserId,
  pending,
  onCreate,
  onEdit,
  onPassword,
  onToggleActive,
}: {
  users: CurrentUser[]
  currentUserId: number
  pending: boolean
  onCreate: () => void
  onEdit: (user: CurrentUser) => void
  onPassword: (user: CurrentUser) => void
  onToggleActive: (user: CurrentUser) => void
}) {
  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Пользователи</CardTitle>
          <CardDescription>Доступ, роли и активность учетных записей</CardDescription>
        </div>
        <Button onClick={onCreate} disabled={pending}>
          <PlusIcon data-icon="inline-start" />
          Добавить
        </Button>
      </CardHeader>
      <CardContent>
        {users.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Имя</TableHead>
                  <TableHead>Логин</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((targetUser) => (
                  <TableRow key={targetUser.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{targetUser.name}</span>
                        {targetUser.id === currentUserId && (
                          <span className="text-xs text-muted-foreground">Текущий пользователь</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{targetUser.login}</TableCell>
                    <TableCell>
                      <Badge variant={targetUser.role === "owner" ? "default" : "secondary"}>
                        {roleLabels[targetUser.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={targetUser.isActive ? "secondary" : "outline"}>
                        {targetUser.isActive ? "Активен" : "Отключен"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="icon-sm" onClick={() => onEdit(targetUser)} disabled={pending}>
                          <PencilIcon />
                          <span className="sr-only">Редактировать</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => onPassword(targetUser)}
                          disabled={pending}
                        >
                          <KeyRoundIcon />
                          <span className="sr-only">Сменить пароль</span>
                        </Button>
                        <Button
                          variant={targetUser.isActive ? "outline" : "default"}
                          size="sm"
                          onClick={() => onToggleActive(targetUser)}
                          disabled={pending}
                        >
                          {targetUser.isActive ? (
                            <UserXIcon data-icon="inline-start" />
                          ) : (
                            <UserCheckIcon data-icon="inline-start" />
                          )}
                          {targetUser.isActive ? "Отключить" : "Включить"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Пользователей нет</EmptyTitle>
              <EmptyDescription>Создайте первую учетную запись для доступа к системе.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onCreate}>
                <PlusIcon data-icon="inline-start" />
                Добавить пользователя
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}

function UserSheet({
  open,
  user,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  user: CurrentUser | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, user: CurrentUser | null) => void
}) {
  const [role, setRole] = useState<UserRole>(user?.role ?? "manager")
  const [isActive, setIsActive] = useState(user?.isActive ?? true)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{user ? "Редактировать пользователя" : "Новый пользователь"}</SheetTitle>
          <SheetDescription>Логин должен быть уникальным. Хэш пароля не показывается в интерфейсе.</SheetDescription>
        </SheetHeader>
        <form onSubmit={(event) => onSubmit(event, user)} className="flex flex-1 flex-col">
          <div className="px-4">
            <FieldGroup>
              {user && <input type="hidden" name="id" value={user.id} />}
              <input type="hidden" name="role" value={role} />
              <input type="hidden" name="isActive" value={isActive ? "1" : "0"} />
              <Field>
                <FieldLabel htmlFor="user-name">Имя</FieldLabel>
                <Input id="user-name" name="name" defaultValue={user?.name} disabled={pending} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-login">Логин</FieldLabel>
                <Input id="user-login" name="login" defaultValue={user?.login} disabled={pending} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-role">Роль</FieldLabel>
                <Select
                  items={userRoleOptions.map((option) => ({ label: roleLabels[option], value: option }))}
                  value={role}
                  onValueChange={(value) => setRole((value ?? "manager") as UserRole)}
                >
                  <SelectTrigger id="user-role" className="w-full" disabled={pending}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {userRoleOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {roleLabels[option]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {!user && (
                <Field>
                  <FieldLabel htmlFor="user-password">Пароль</FieldLabel>
                  <Input
                    id="user-password"
                    name="password"
                    type="password"
                    minLength={4}
                    autoComplete="new-password"
                    disabled={pending}
                    required
                  />
                  <FieldDescription>Минимум 4 символа.</FieldDescription>
                </Field>
              )}
              <Field orientation="horizontal">
                <Checkbox
                  id="user-is-active"
                  checked={isActive}
                  onCheckedChange={(checked) => setIsActive(checked === true)}
                  disabled={pending}
                />
                <FieldContent>
                  <FieldLabel htmlFor="user-is-active">Активен</FieldLabel>
                  <FieldDescription>Отключенный пользователь не сможет войти.</FieldDescription>
                </FieldContent>
              </Field>
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

function SupplierSheet({
  open,
  supplier,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  supplier: Supplier | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{supplier ? "Редактировать поставщика" : "Новый поставщик"}</SheetTitle>
          <SheetDescription>Отключенные поставщики не показываются в новых актах пополнения.</SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex flex-1 flex-col">
          <div className="px-4">
            <FieldGroup>
              {supplier && <input type="hidden" name="id" value={supplier.id} />}
              <input type="hidden" name="isActive" value={isActive ? "1" : "0"} />
              <Field>
                <FieldLabel htmlFor="supplier-name">Название</FieldLabel>
                <Input id="supplier-name" name="name" defaultValue={supplier?.name} disabled={pending} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="supplier-contact-name">Контактное лицо</FieldLabel>
                <Input
                  id="supplier-contact-name"
                  name="contactName"
                  defaultValue={supplier?.contactName}
                  disabled={pending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="supplier-phone">Телефон</FieldLabel>
                <Input id="supplier-phone" name="phone" defaultValue={supplier?.phone} disabled={pending} />
              </Field>
              <Field>
                <FieldLabel htmlFor="supplier-comment">Комментарий</FieldLabel>
                <Textarea id="supplier-comment" name="comment" defaultValue={supplier?.comment} disabled={pending} />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="supplier-is-active"
                  checked={isActive}
                  onCheckedChange={(checked) => setIsActive(checked === true)}
                  disabled={pending}
                />
                <FieldContent>
                  <FieldLabel htmlFor="supplier-is-active">Активен</FieldLabel>
                  <FieldDescription>Активный поставщик доступен для выбора в акте пополнения.</FieldDescription>
                </FieldContent>
              </Field>
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

function PasswordDialog({
  user,
  pending,
  onOpenChange,
  onSubmit,
}: {
  user: CurrentUser | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Сменить пароль</DialogTitle>
          <DialogDescription>{user ? `${user.name} · ${user.login}` : "Выберите пользователя"}</DialogDescription>
        </DialogHeader>
        {user && (
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <input type="hidden" name="id" value={user.id} />
              <Field>
                <FieldLabel htmlFor="newPassword">Новый пароль</FieldLabel>
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  minLength={4}
                  autoComplete="new-password"
                  disabled={pending}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="confirmPassword">Повторите пароль</FieldLabel>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  minLength={4}
                  autoComplete="new-password"
                  disabled={pending}
                  required
                />
                <FieldDescription>Минимум 4 символа.</FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Сохранить пароль
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
  const [categoryPath, setCategoryPath] = useState(product?.categoryPath ?? "")
  const selectableCategories = categories.filter((category) => category.path !== uncategorizedValue)

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
                <Input id="code" name="code" defaultValue={product?.code} readOnly={Boolean(product)} required />
              </Field>
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
            className="rounded-lg border bg-muted/30 p-3"
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

function ShiftSheet({
  open,
  currentUserId,
  currentUserName,
  currentUserRole,
  defaultOpeningCash,
  activeFlorists,
  openShift,
  openShiftDetails,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  currentUserId: number
  currentUserName: string
  currentUserRole: UserRole
  defaultOpeningCash: number
  activeFlorists: CurrentUser[]
  openShift: DashboardData["stats"]["openShift"]
  openShiftDetails: DashboardData["shiftDetails"][number] | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const formKey = open
    ? openShift
      ? `close-${openShift.id}-${openShift.expectedCash}`
      : "open-new"
    : "closed"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{openShift ? "Закрыть смену" : "Открыть смену"}</DialogTitle>
          <DialogDescription>
            {openShift
              ? `Смена #${openShift.id} · Ответственный: ${openShift.cashierName || "не указан"}`
              : "Ответственный берется из текущего профиля."}
          </DialogDescription>
        </DialogHeader>
        <ShiftSheetForm
          key={formKey}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserRole={currentUserRole}
          defaultOpeningCash={defaultOpeningCash}
          activeFlorists={activeFlorists}
          openShift={openShift}
          openShiftDetails={openShiftDetails}
          pending={pending}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

function ShiftSheetForm({
  currentUserId,
  currentUserName,
  currentUserRole,
  defaultOpeningCash,
  activeFlorists,
  openShift,
  openShiftDetails,
  pending,
  onSubmit,
}: {
  currentUserId: number
  currentUserName: string
  currentUserRole: UserRole
  defaultOpeningCash: number
  activeFlorists: CurrentUser[]
  openShift: DashboardData["stats"]["openShift"]
  openShiftDetails: DashboardData["shiftDetails"][number] | null
  pending: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const [openForm, setOpenForm] = useState({
    ...initialOpenShiftForm,
    openingCash: defaultOpeningCash.toString(),
  })
  const [closeForm, setCloseForm] = useState({
    ...initialCloseShiftForm,
    closingCash: openShift?.expectedCash?.toString() ?? "",
  })
  const [openNightShift, setOpenNightShift] = useState(false)
  const [nightFloristId, setNightFloristId] = useState("")
  const openingCash = Number(openForm.openingCash || 0)
  const openingDifference = openingCash - defaultOpeningCash
  const needsOpeningComment = !openShift && Math.abs(openingDifference) >= 0.01
  const closingCash = Number(closeForm.closingCash || 0)
  const difference = closingCash - (openShift?.expectedCash ?? 0)
  const needsClosingComment = Boolean(openShift) && Math.abs(difference) >= 0.01
  const canOpenNightShift =
    currentUserRole === "manager" &&
    openShift?.type === "day" &&
    openShift.userId === currentUserId

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (needsOpeningComment && !openForm.openingComment.trim()) {
      event.preventDefault()
      toast.error("Укажите комментарий, если начальная наличка отличается от прошлой закрытой смены.")
      return
    }

    if (needsClosingComment && !closeForm.closingComment.trim()) {
      event.preventDefault()
      toast.error("Укажите комментарий, если фактическая наличка отличается от ожидаемой.")
      return
    }

    if (openNightShift && !closeForm.closingCash.trim()) {
      event.preventDefault()
      toast.error("Введите фактическую наличку для открытия ночной смены.")
      return
    }

    if (openNightShift && !nightFloristId) {
      event.preventDefault()
      toast.error("Выберите флориста для ночной смены.")
      return
    }

    onSubmit(event)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FieldGroup>
        {openShift && <input type="hidden" name="shiftId" value={openShift.id} />}
        {!openShift && (
          <>
            <Field>
              <FieldLabel>Ответственный</FieldLabel>
              <FieldDescription className="rounded-xl border bg-muted/30 p-3 text-foreground">
                Ответственный: {currentUserName}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="openingCash">Начальная наличка</FieldLabel>
              <Input
                id="openingCash"
                name="openingCash"
                type="number"
                step="0.01"
                value={openForm.openingCash ?? ""}
                onChange={(event) =>
                  setOpenForm((current) => ({ ...current, openingCash: event.target.value }))
                }
                required
              />
              <FieldDescription>
                Ожидается по прошлой закрытой смене: {formatMoney(defaultOpeningCash)}
              </FieldDescription>
            </Field>
            {needsOpeningComment && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <AlertTriangleIcon />
                <AlertTitle>Начальная наличка отличается</AlertTitle>
                <AlertDescription>Добавьте комментарий к открытию смены.</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="opening-note">Комментарий</FieldLabel>
              <Textarea
                id="opening-note"
                name="note"
                value={openForm.openingComment ?? ""}
                onChange={(event) =>
                  setOpenForm((current) => ({ ...current, openingComment: event.target.value }))
                }
                required={needsOpeningComment}
              />
            </Field>
          </>
        )}
        {openShift && (
          <>
            {canOpenNightShift && (
              <>
                <input type="hidden" name="openNightShift" value={openNightShift ? "1" : "0"} />
                <input type="hidden" name="nightFloristId" value={nightFloristId} />
              </>
            )}
            {openShiftDetails && <ShiftCloseSummary detail={openShiftDetails} />}
            <Field>
              <FieldLabel htmlFor="closingCash">Фактическая наличка в кассе</FieldLabel>
              <Input
                id="closingCash"
                name="closingCash"
                type="number"
                step="0.01"
                value={closeForm.closingCash ?? ""}
                onChange={(event) =>
                  setCloseForm((current) => ({ ...current, closingCash: event.target.value }))
                }
                required
              />
            </Field>
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Разница = факт - ожидается</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="text-xl font-semibold">{formatMoney(difference)}</div>
                <Badge variant={Math.abs(difference) < 0.01 ? "secondary" : "destructive"}>
                  {Math.abs(difference) < 0.01 ? "совпало" : "есть разница"}
                </Badge>
              </div>
            </div>
            <Field>
              <FieldLabel htmlFor="closing-note">Комментарий</FieldLabel>
              <Textarea
                id="closing-note"
                name="note"
                value={closeForm.closingComment ?? ""}
                onChange={(event) =>
                  setCloseForm((current) => ({ ...current, closingComment: event.target.value }))
                }
                required={needsClosingComment}
              />
              {needsClosingComment && (
                <FieldDescription>
                  Комментарий обязателен, потому что факт отличается от ожидаемой кассы.
                </FieldDescription>
              )}
            </Field>
            {canOpenNightShift && (
              <FieldSet>
                <Field orientation="horizontal">
                  <Checkbox
                    id="openNightShift"
                    checked={openNightShift}
                    onCheckedChange={(checked) => setOpenNightShift(checked === true)}
                    disabled={pending}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="openNightShift">
                      Открыть ночную смену для флориста
                    </FieldLabel>
                    <FieldDescription>
                      Фактическая наличка станет начальной наличкой ночной смены
                    </FieldDescription>
                  </FieldContent>
                </Field>
                {openNightShift && (
                  <Field>
                    <FieldLabel htmlFor="nightFloristId">Флорист</FieldLabel>
                    <Select
                      items={[
                        { label: "Выберите флориста", value: null },
                        ...activeFlorists.map((florist) => ({
                          label: florist.name,
                          value: String(florist.id),
                        })),
                      ]}
                      value={nightFloristId || null}
                      onValueChange={(value) => setNightFloristId(value ?? "")}
                    >
                      <SelectTrigger id="nightFloristId" className="w-full">
                        <SelectValue placeholder="Выберите флориста" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={null}>Выберите флориста</SelectItem>
                          {activeFlorists.map((florist) => (
                            <SelectItem key={florist.id} value={String(florist.id)}>
                              {florist.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      В списке только активные пользователи с ролью florist.
                    </FieldDescription>
                  </Field>
                )}
              </FieldSet>
            )}
          </>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {openShift ? "Закрыть смену" : "Открыть смену"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CourierSheet({
  order,
  openShift,
  pending,
  onOpenChange,
  onSubmit,
}: {
  order: Order | null
  openShift: DashboardData["stats"]["openShift"]
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, order: Order) => void
}) {
  const balance = order ? order.total - order.paid : 0
  const needsCashOperation = balance > 0 || Boolean(order && order.courierPayout > 0 && !order.deliveryPayoutPaid)

  return (
    <Sheet open={Boolean(order)} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Передача курьеру</SheetTitle>
          <SheetDescription>Доплата и выдача курьеру проходят через открытую смену.</SheetDescription>
        </SheetHeader>
        {order && (
          <form onSubmit={(event) => onSubmit(event, order)} className="flex flex-1 flex-col">
            <div className="px-4">
              <FieldGroup>
                {needsCashOperation && !openShift && (
                  <Alert>
                    <AlertTriangleIcon />
                    <AlertTitle>Откройте смену для кассовых операций</AlertTitle>
                    <AlertDescription>Нужна открытая смена для доплаты или выдачи курьеру.</AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
                  <Info label="До скидки" value={formatMoney(order.totalBeforeDiscount)} />
                  <Info
                    label="Скидка"
                    value={formatMoney(order.itemsDiscountTotal + order.orderDiscountAmount)}
                  />
                  <Info label="Итого" value={formatMoney(order.total)} />
                  <Info label="Оплачено" value={formatMoney(order.paid)} />
                  <Info label="Остаток" value={formatMoney(balance)} />
                  <Info label="Доставка" value={formatMoney(order.deliveryPrice)} />
                  <Info label="Курьеру" value={formatMoney(order.courierPayout)} />
                  <Info label="Оплата" value={balance <= 0 ? "Сумма закрыта" : `Остаток: ${formatMoney(balance)}`} />
                </div>
                {balance > 0 && (
                  <FieldSet>
                    <FieldLegend>Принять доплату</FieldLegend>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="paymentAmount">Сумма</FieldLabel>
                        <Input id="paymentAmount" name="paymentAmount" type="number" step="0.01" defaultValue={balance} />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="paymentMethod">Способ оплаты</FieldLabel>
                        <select
                          id="paymentMethod"
                          name="paymentMethod"
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                          defaultValue="cash"
                        >
                          {paymentMethodOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  </FieldSet>
                )}
                <FieldSet>
                  <FieldLegend>Курьер</FieldLegend>
                  <Field>
                    <FieldLabel htmlFor="courierName">Имя курьера</FieldLabel>
                    <Input id="courierName" name="courierName" defaultValue={order.courierName} />
                  </Field>
                  {order.deliveryPayoutPaid ? (
                    <Badge variant="outline">Курьер оплачен</Badge>
                  ) : order.courierPayout > 0 ? (
                    <Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="payCourier" />
                        Выдать курьеру из кассы: {formatMoney(order.courierPayout)}
                      </label>
                    </Field>
                  ) : (
                    <FieldDescription>Выплата курьеру не указана.</FieldDescription>
                  )}
                </FieldSet>
              </FieldGroup>
            </div>
            <SheetFooter>
              <Button type="submit" disabled={pending || (needsCashOperation && !openShift)}>
                Передать курьеру
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
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

          <form onSubmit={onPreview} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-end">
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
              <AlertTitle>В файле есть ошибки</AlertTitle>
              <AlertDescription>Импорт нельзя применить. Исправьте XLSX и загрузите его снова.</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <ImportStat label="Строк" value={preview.totalRows} />
                <ImportStat label="Новых" value={preview.createdCount} />
                <ImportStat label="Обновлений" value={preview.updatedCount} />
                <ImportStat label="Без изменений" value={preview.unchangedCount} />
                <ImportStat label="Ошибок" value={preview.errorCount} />
              </div>

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
                      <TableHead className="min-w-52">Ошибка</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.items.map((item) => (
                      <TableRow key={item.id}>
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
                        <TableCell className="max-w-72 truncate text-destructive" title={item.error}>
                          {item.error}
                        </TableCell>
                      </TableRow>
                    ))}
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

function ImportStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
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

  function addProduct(product: Product) {
    const freshProduct = products.find((item) => item.code === product.code) ?? product
    setItems((current) => {
      const existing = current.find((item) => item.product.code === freshProduct.code)
      if (existing) {
        return current.map((item) =>
          item.product.code === freshProduct.code
            ? { ...item, product: freshProduct, qty: String(Number(item.qty || 0) + 1) }
            : item
        )
      }

      return [...current, { product: freshProduct, qty: "1" }]
    })
  }

  function updateQty(productCode: string, qty: string) {
    setItems((current) =>
      current.map((item) => (item.product.code === productCode ? { ...item, qty } : item))
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
                <Card className="rounded-lg">
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
                            <SelectValue placeholder="Без поставщика" />
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

                <Card className="rounded-lg">
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
                              <TableHead className="w-32">Qty</TableHead>
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
                                    <div className="font-medium">{product.name}</div>
                                    <div className="text-xs text-muted-foreground">{product.code}</div>
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
                        </Table>
                      </ScrollArea>
                    </div>
                  )}
                </div>
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

function CashOperationDialog({
  operation,
  pending,
  onOpenChange,
  onSubmit,
}: {
  operation: CashOperation | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, operation: CashOperation) => void
}) {
  const isCashOut = operation === "cashOut"
  const title = isCashOut ? "Изъятие наличных" : "Внесение наличных"

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!operation) {
      event.preventDefault()
      return
    }

    const amount = Number(new FormData(event.currentTarget).get("amount"))
    if (!Number.isFinite(amount) || amount <= 0) {
      event.preventDefault()
      toast.error("Сумма должна быть больше нуля.")
      return
    }

    onSubmit(event, operation)
  }

  return (
    <Dialog open={Boolean(operation)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Операция пройдет по текущей открытой смене.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cash-operation-amount">Сумма</FieldLabel>
              <Input id="cash-operation-amount" name="amount" type="number" min="0.01" step="0.01" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="cash-operation-comment">Комментарий</FieldLabel>
              <Textarea id="cash-operation-comment" name="comment" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" variant={isCashOut ? "destructive" : "default"} disabled={pending}>
              {isCashOut ? "Изъять" : "Внести"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResponsiveTable({
  headers,
  rows,
  emptyTitle,
}: {
  headers: string[]
  rows: React.ReactNode[][]
  emptyTitle: string
}) {
  if (!rows.length) {
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
    <div className="overflow-x-auto">
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
  if (product.stock < 0) {
    return <Badge variant="destructive">{number(product.stock)}</Badge>
  }

  if (product.stock <= 3) {
    return <Badge variant="outline">{number(product.stock)}</Badge>
  }

  return <Badge variant="secondary">{number(product.stock)}</Badge>
}

function OrderBadge({ status }: { status: OrderStatus }) {
  if (status === "Выдан") {
    return (
      <Badge variant="secondary">
        <CheckCircle2Icon data-icon="inline-start" />
        {status}
      </Badge>
    )
  }

  if (status === "Отменен") {
    return <Badge variant="destructive">{status}</Badge>
  }

  return <Badge variant="outline">{status}</Badge>
}

function ReadyStatusBadge({ status }: { status: OrderStatus }) {
  if (status === "Готов") {
    return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Готов</Badge>
  }

  if (status === "Передан курьеру") {
    return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Передан курьеру</Badge>
  }

  return <OrderBadge status={status} />
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

function movementLabel(movement: DashboardData["movements"][number]) {
  if (movement.type === "adjustment" && typeof movement.qty === "number") {
    if (movement.qty > 0) {
      return "Поступление"
    }

    if (movement.qty < 0) {
      return "Списание"
    }

    return "Корректировка"
  }

  const labels: Record<string, string> = {
    import: "Импорт",
    stock_in: "Пополнение по акту",
    stock_out: "Списание по акту",
    sale: "Реализация",
    order_fulfill: "Реализация заказа",
    stock_update: "Склад",
    delete_product: "Удаление",
    shift_open: "Открытие смены",
    shift_close: "Закрытие смены",
    order_create: "Заказ",
    order_status: "Статус заказа",
  }

  return labels[movement.type] ?? movement.type
}

function signedNumber(value: number | null) {
  if (value === null) {
    return "-"
  }

  const formatted = number(value)
  return value > 0 ? `+${formatted}` : formatted
}

function deliveryTypeLabel(type: string) {
  return type === "delivery" ? "Доставка" : "Самовывоз"
}

function getShiftCashSummary(detail: DashboardData["shiftDetails"][number]) {
  const revenueTypes = new Set(["sale", "prepayment", "order_payment", "deal_payment"])
  const byMethod: Record<PaymentMethod, number> = {
    cash: 0,
    card: 0,
    terminal: 0,
    mbank: 0,
    optima: 0,
    elsom: 0,
    transfer: 0,
  }

  for (const transaction of detail.cashTransactions) {
    if (revenueTypes.has(transaction.type)) {
      byMethod[transaction.paymentMethod] += transaction.amount
    }
  }

  return {
    ...byMethod,
    revenueBeforeDiscount: detail.summary.revenueBeforeDiscount,
    discountTotal: detail.summary.discountTotal,
    revenueTotal: detail.summary.revenueTotal,
    expectedCash: detail.summary.expectedCash,
  }
}

function number(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function dateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
