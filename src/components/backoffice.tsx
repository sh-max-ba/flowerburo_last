"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  BanknoteIcon,
  BoxesIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  EyeIcon,
  HistoryIcon,
  KeyRoundIcon,
  LogOutIcon,
  MenuIcon,
  MinusCircleIcon,
  PencilIcon,
  PlusIcon,
  PlusCircleIcon,
  ReceiptTextIcon,
  SearchIcon,
  Trash2Icon,
  UserCheckIcon,
  UserXIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  cancelOrderAction,
  cashInAction,
  cashOutAction,
  changeUserPasswordAction,
  closeDeliveredOrderAction,
  closeShiftAction,
  completePickupOrderAction,
  createOrderAction,
  createSaleAction,
  createUserAction,
  deleteProductAction,
  handOrderToCourierAction,
  markOrderReadyAction,
  openShiftAction,
  replenishProductStockAction,
  saveProductAction,
  setUserActiveAction,
  startOrderWorkAction,
  updateUserAction,
  writeOffProductStockAction,
} from "@/app/actions"
import { logoutAction } from "@/app/auth-actions"
import type { CurrentUser, DashboardData, Order, OrderStatus, PaymentMethod, Product, UserRole } from "@/lib/db"
import { getPaymentMethodLabel, paymentMethodOptions } from "@/lib/labels"
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
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Separator } from "@/components/ui/separator"
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
import { ProductCombobox } from "@/components/products/product-combobox"
import {
  addProductToLineItems,
  ProductLineItems,
  getLineItemsTotal,
  type ProductLineItem,
  validateProductLineItems,
} from "@/components/products/product-line-items"

export type Section = "stock" | "sales" | "shifts" | "orders" | "history" | "users"
type Result = Awaited<ReturnType<typeof saveProductAction>>
type StockOperation = { product: Product; type: "replenish" | "writeOff" }
type CashOperation = "cashIn" | "cashOut"

const initialOpenShiftForm = {
  openingCash: "0",
  openingComment: "",
}

const initialCloseShiftForm = {
  closingCash: "",
  closingComment: "",
}

const sections: Array<{ id: Section; label: string; icon: typeof BoxesIcon }> = [
  { id: "stock", label: "Склад", icon: BoxesIcon },
  { id: "sales", label: "Касса", icon: ReceiptTextIcon },
  { id: "shifts", label: "Смены", icon: BanknoteIcon },
  { id: "orders", label: "Стол заказов", icon: ClipboardListIcon },
  { id: "history", label: "История", icon: HistoryIcon },
  { id: "users", label: "Пользователи", icon: UsersIcon },
]

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

const userRoleOptions: UserRole[] = ["owner", "manager", "florist"]

const roleSectionIds: Record<UserRole, Section[]> = {
  owner: ["stock", "sales", "shifts", "orders", "history", "users"],
  manager: ["sales", "orders"],
  florist: ["orders"],
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
  const [productSheet, setProductSheet] = useState(false)
  const [shiftSheet, setShiftSheet] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null)
  const [stockOperation, setStockOperation] = useState<StockOperation | null>(null)
  const [cashOperation, setCashOperation] = useState<CashOperation | null>(null)
  const [handoverOrder, setHandoverOrder] = useState<Order | null>(null)
  const [userSheet, setUserSheet] = useState(false)
  const [editingUser, setEditingUser] = useState<CurrentUser | null>(null)
  const [passwordUser, setPasswordUser] = useState<CurrentUser | null>(null)
  const [activeToggleUser, setActiveToggleUser] = useState<CurrentUser | null>(null)
  const [isPending, startTransition] = useTransition()
  const displayedSection = visibleSectionIds.includes(section) ? section : visibleSectionIds[0]
  const activeSection = sections.find((item) => item.id === displayedSection)
  const canManageShift = user.role === "owner" || user.role === "manager" || canAccessCash
  const openShiftDetails = data.stats.openShift
    ? data.shiftDetails.find((detail) => detail.shift.id === data.stats.openShift?.id) ?? null
    : null

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return data.products
    }

    return data.products.filter((product) =>
      `${product.code} ${product.article} ${product.name} ${product.categoryPath}`
        .toLowerCase()
        .includes(normalized)
    )
  }, [data.products, query])

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
                {visibleSections.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={displayedSection === item.id}
                      tooltip={item.label}
                      onClick={() => setSection(item.id)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
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
                negativeStockCount={data.stats.negativeStockCount}
                query={query}
                setQuery={setQuery}
                onCreate={() => {
                  setEditingProduct(null)
                  setProductSheet(true)
                }}
                onEdit={(product) => {
                  setEditingProduct(product)
                  setProductSheet(true)
                }}
                onStockOperation={(product, type) => setStockOperation({ product, type })}
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
            {displayedSection === "users" && (
              <UsersSection
                users={data.users}
                currentUserId={user.id}
                pending={isPending}
                onCreate={() => {
                  setEditingUser(null)
                  setUserSheet(true)
                }}
                onEdit={(targetUser) => {
                  setEditingUser(targetUser)
                  setUserSheet(true)
                }}
                onPassword={setPasswordUser}
                onToggleActive={setActiveToggleUser}
              />
            )}
          </div>
        </main>
      </SidebarInset>

      <ProductSheet
        open={productSheet}
        product={editingProduct}
        pending={isPending}
        onOpenChange={setProductSheet}
        onSubmit={(event) =>
          submitForm(event, saveProductAction, () => {
            setProductSheet(false)
            setEditingProduct(null)
          })
        }
      />
      <ShiftSheet
        open={shiftSheet}
        currentUserId={user.id}
        currentUserName={user.name}
        currentUserRole={user.role}
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
      <StockOperationDialog
        key={stockOperation ? `${stockOperation.type}-${stockOperation.product.code}` : "stock-operation-closed"}
        operation={stockOperation}
        pending={isPending}
        onOpenChange={(open) => !open && setStockOperation(null)}
        onSubmit={(event, operation) => {
          submitForm(
            event,
            operation.type === "replenish" ? replenishProductStockAction : writeOffProductStockAction,
            () => setStockOperation(null)
          )
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
    </SidebarProvider>
  )
}

function StatsGrid({ data }: { data: DashboardData }) {
  const stats = [
    { label: "Товаров", value: data.stats.productsCount, subtitle: "в активном списке склада" },
    { label: "Низкий остаток", value: data.stats.lowStockCount, subtitle: "нужно проверить закупку" },
    { label: "В резерве", value: data.stats.reservedCount, subtitle: "позиции в заказах" },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
  negativeStockCount,
  query,
  setQuery,
  onCreate,
  onEdit,
  onStockOperation,
  onDelete,
}: {
  products: Product[]
  negativeStockCount: number
  query: string
  setQuery: (value: string) => void
  onCreate: () => void
  onEdit: (product: Product) => void
  onStockOperation: (product: Product, type: StockOperation["type"]) => void
  onDelete: (product: Product) => void
}) {
  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader className="gap-3">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <CardTitle>Склад</CardTitle>
            <CardDescription>Остаток считается как stock - reserved</CardDescription>
          </div>
          <Button onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            Товар
          </Button>
        </div>
        <div className="relative max-w-md">
          <SearchIcon className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            className="h-10 pl-9"
            placeholder="Найти товар по названию, коду или артикулу"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ResponsiveTable
          emptyTitle="Склад пуст"
          headers={["Товар", "Код", "Остаток", "Резерв", "Цена", ""]}
          rows={products.map((product) => [
            <div key="name" className="min-w-52">
              <div className="font-medium">{product.name}</div>
              <div className="truncate text-xs text-muted-foreground">{product.categoryPath}</div>
            </div>,
            product.code,
            <StockBadge key="stock" product={product} />,
            number(product.reserved),
            formatMoney(product.salePrice),
            <div key="actions" className="flex justify-end gap-1">
              <Button variant="outline" size="sm" onClick={() => onStockOperation(product, "replenish")}>
                <PlusCircleIcon data-icon="inline-start" />
                Пополнить
              </Button>
              <Button variant="outline" size="sm" onClick={() => onStockOperation(product, "writeOff")}>
                <MinusCircleIcon data-icon="inline-start" />
                Списать
              </Button>
              <Button variant="outline" size="sm" onClick={() => onEdit(product)}>
                Изм.
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

function SalesSection({
  data,
  pending,
  onSaleSubmit,
  onOrderSubmit,
  onCashOperation,
  onPickup,
  onHandover,
  onCloseDelivery,
}: {
  data: DashboardData
  pending: boolean
  onSaleSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
  onOrderSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
  onCashOperation: (operation: CashOperation) => void
  onPickup: (order: Order, event: React.FormEvent<HTMLFormElement>) => void
  onHandover: (order: Order) => void
  onCloseDelivery: (order: Order) => void
}) {
  const readyOrders = data.orders.filter((order) => ["Готов", "Передан курьеру"].includes(order.status))
  const openShift = data.stats.openShift
  const activeShiftDetail = openShift
    ? data.shiftDetails.find((detail) => detail.shift.id === openShift.id) ?? null
    : data.shiftDetails[0] ?? null

  return (
    <div className="flex flex-col gap-4">
      {!openShift && (
        <Alert>
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
          <TabsTrigger value="ready">Готовые заказы</TabsTrigger>
        </TabsList>
        <TabsContent value="sale">
          <QuickSaleForm
            products={data.products}
            pending={pending}
            disabled={!openShift}
            onSubmit={onSaleSubmit}
          />
        </TabsContent>
        <TabsContent value="order">
          <NewOrderForm
            products={data.products}
            pending={pending}
            shiftOpen={Boolean(openShift)}
            onSubmit={onOrderSubmit}
          />
        </TabsContent>
        <TabsContent value="ready">
          <ReadyOrders
            orders={readyOrders}
            shiftOpen={Boolean(openShift)}
            pending={pending}
            onPickup={onPickup}
            onHandover={onHandover}
            onCloseDelivery={onCloseDelivery}
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

function QuickSaleForm({
  products,
  pending,
  disabled,
  onSubmit,
}: {
  products: Product[]
  pending: boolean
  disabled: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>, after?: () => void) => void
}) {
  const [items, setItems] = useState<ProductLineItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const saleTotal = getLineItemsTotal(items)

  function addProduct(product: Product) {
    setItems((current) => addProductToLineItems(current, product))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const validationError = validateProductLineItems(items)
    if (validationError) {
      event.preventDefault()
      toast.error(validationError)
      return
    }

    onSubmit(event, () => setItems([]))
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
                  maxHeightClassName="max-h-[320px]"
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
              <div className="rounded-xl border bg-muted/40 p-4">
                <div className="text-sm text-muted-foreground">Общий итог</div>
                <div className="text-3xl font-semibold">{formatMoney(saleTotal)}</div>
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
            <CashMetric label="Выручка за смену" value={formatMoney(summary.revenueTotal)} />
            <CashMetric label="Наличные" value={formatMoney(summary.cash)} />
            <CashMetric label="Карта" value={formatMoney(summary.card)} />
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
            headers={["Дата", "Позиций", "Способ оплаты", "Сумма", "Комментарий"]}
            rows={sales.map((sale) => [
              dateTime(sale.createdAt),
              sale.itemsCount,
              getPaymentMethodLabel(sale.paymentMethod),
              formatMoney(sale.total),
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
  pending,
  shiftOpen,
  onSubmit,
}: {
  products: Product[]
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
  const [dueAt, setDueAt] = useState("")
  const [address, setAddress] = useState("")
  const [note, setNote] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("cash")

  const itemsTotal = getLineItemsTotal(items)
  const total = itemsTotal + deliveryPrice
  const balance = total - prepaid
  const needsShift = prepaid > 0 && !shiftOpen

  function addProduct(product: Product) {
    setItems((current) => addProductToLineItems(current, product))
  }

  function resetForm() {
    setItems([])
    setCustomer("")
    setPhone("")
    setDueAt("")
    setDeliveryType("pickup")
    setAddress("")
    setNote("")
    setDeliveryPrice(0)
    setCourierPayout(0)
    setPrepaid(0)
    setPaymentMethod("cash")
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

    onSubmit(event, resetForm)
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
                    <FieldLabel htmlFor="dueAt">Дата / время</FieldLabel>
                    <Input
                      id="dueAt"
                      name="dueAt"
                      type="datetime-local"
                      value={dueAt}
                      onChange={(event) => setDueAt(event.target.value)}
                    />
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
                maxHeightClassName="max-h-[320px]"
                onItemsChange={setItems}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 rounded-2xl border bg-white xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]">
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
              {needsShift && (
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>Откройте смену для кассовых операций</AlertTitle>
                  <AlertDescription>Предоплату можно принять только при открытой смене.</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
                <Info label="Состав" value={formatMoney(itemsTotal)} />
                <Info label="Итого" value={formatMoney(total)} />
                <div>
                  <div className="text-xs text-muted-foreground">Остаток</div>
                  <div className="text-3xl font-semibold">{formatMoney(balance)}</div>
                </div>
              </div>
            </FieldSet>

            <div className="mt-auto border-t pt-3">
              <Button className="w-full" type="submit" disabled={pending || needsShift || items.length === 0}>
                Создать заказ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}

function ReadyOrders({
  orders,
  shiftOpen,
  pending,
  onPickup,
  onHandover,
  onCloseDelivery,
}: {
  orders: Order[]
  shiftOpen: boolean
  pending: boolean
  onPickup: (order: Order, event: React.FormEvent<HTMLFormElement>) => void
  onHandover: (order: Order) => void
  onCloseDelivery: (order: Order) => void
}) {
  if (!orders.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Готовых заказов нет</EmptyTitle>
          <EmptyDescription>Здесь появятся заказы после отметки флориста.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      {orders.map((order) => {
        const balance = order.total - order.paid
        const needsPayment = balance > 0
        const nextAction =
          order.deliveryType === "pickup"
            ? needsPayment
              ? "Принять доплату и выдать клиенту"
              : "Выдать клиенту"
            : order.status === "Передан курьеру"
              ? "Закрыть после доставки"
              : needsPayment
                ? "Принять доплату и передать курьеру"
                : "Передать курьеру"
        return (
          <div key={order.id} className="rounded-2xl border bg-white p-4">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div className="flex flex-col gap-1">
                <div className="font-semibold">{order.number || `#${order.id}`} · {order.customer}</div>
                <div className="text-sm text-muted-foreground">{order.phone || "телефон не указан"}</div>
                <div className="text-sm">
                  {deliveryTypeLabel(order.deliveryType)}
                  {order.address ? ` · ${order.address}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <OrderBadge status={order.status} />
                {balance <= 0 ? (
                  <Badge variant="secondary">Сумма закрыта</Badge>
                ) : (
                  <Badge variant="destructive">Остаток: {formatMoney(balance)}</Badge>
                )}
                {order.deliveryPayoutPaid ? (
                  <Badge variant="outline">Курьер оплачен</Badge>
                ) : (
                  <Badge variant="outline">Курьер не оплачен</Badge>
                )}
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-muted/50 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Состав</div>
              <div className="flex flex-col gap-1 text-sm">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-3">
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0">{number(item.qty)} шт</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-5">
              <Info label="Итого" value={formatMoney(order.total)} />
              <Info label="Оплачено" value={formatMoney(order.paid)} />
              <Info label="Доставка" value={formatMoney(order.deliveryPrice)} />
              <Info label="Курьеру" value={formatMoney(order.courierPayout)} />
              <Info label="Выплата" value={order.deliveryPayoutPaid ? "выдана" : "не выдана"} />
            </div>
            <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Следующее действие: </span>
              <span className="font-medium">{nextAction}</span>
            </div>
            <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-end">
              {order.deliveryType === "pickup" && order.status === "Готов" && (
                <form onSubmit={(event) => onPickup(order, event)} className="flex flex-col gap-2 md:flex-row md:items-end">
                  {needsPayment && (
                    <>
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
                    </>
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
          </div>
        )
      })}
    </div>
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
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardTitle>История движений</CardTitle>
        <CardDescription>Импорт, продажи, смены, заказы и ручные изменения</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveTable
          emptyTitle="История пуста"
          headers={["Дата", "Тип", "Товар", "Кол-во", "Сумма", "Комментарий"]}
          rows={data.movements.map((movement) => [
            dateTime(movement.createdAt),
            movementLabel(movement),
            movement.productName || movement.productCode || "-",
            movement.qty === null ? "-" : number(movement.qty),
            movement.total === null ? "-" : formatMoney(movement.total),
            movement.note || "-",
          ])}
        />
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
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  product: Product | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
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
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="stock">Stock</FieldLabel>
                  <Input id="stock" name="stock" type="number" step="0.01" defaultValue={product?.stock ?? 0} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="reserved">Reserved</FieldLabel>
                  <Input id="reserved" name="reserved" type="number" step="0.01" defaultValue={product?.reserved ?? 0} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="costPrice">Закупка</FieldLabel>
                  <Input id="costPrice" name="costPrice" type="number" step="0.01" defaultValue={product?.costPrice ?? 0} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="salePrice">Цена</FieldLabel>
                  <Input id="salePrice" name="salePrice" type="number" step="0.01" defaultValue={product?.salePrice ?? 0} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="categoryPath">Категория</FieldLabel>
                <Input id="categoryPath" name="categoryPath" defaultValue={product?.categoryPath} />
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
              <Field>
                <FieldLabel htmlFor="expected">Ожидается</FieldLabel>
                <Input id="expected" name="expected" type="number" step="0.01" defaultValue={product?.expected ?? 0} />
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

function ShiftSheet({
  open,
  currentUserId,
  currentUserName,
  currentUserRole,
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
  activeFlorists,
  openShift,
  openShiftDetails,
  pending,
  onSubmit,
}: {
  currentUserId: number
  currentUserName: string
  currentUserRole: UserRole
  activeFlorists: CurrentUser[]
  openShift: DashboardData["stats"]["openShift"]
  openShiftDetails: DashboardData["shiftDetails"][number] | null
  pending: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const [openForm, setOpenForm] = useState(initialOpenShiftForm)
  const [closeForm, setCloseForm] = useState({
    ...initialCloseShiftForm,
    closingCash: openShift?.expectedCash?.toString() ?? "",
  })
  const [openNightShift, setOpenNightShift] = useState(false)
  const [nightFloristId, setNightFloristId] = useState("")
  const closingCash = Number(closeForm.closingCash || 0)
  const difference = closingCash - (openShift?.expectedCash ?? 0)
  const canOpenNightShift =
    currentUserRole === "manager" &&
    openShift?.type === "day" &&
    openShift.userId === currentUserId

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
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
            </Field>
            <Field>
              <FieldLabel htmlFor="opening-note">Комментарий</FieldLabel>
              <Textarea
                id="opening-note"
                name="note"
                value={openForm.openingComment ?? ""}
                onChange={(event) =>
                  setOpenForm((current) => ({ ...current, openingComment: event.target.value }))
                }
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
              />
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

function StockOperationDialog({
  operation,
  pending,
  onOpenChange,
  onSubmit,
}: {
  operation: StockOperation | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>, operation: StockOperation) => void
}) {
  const [qty, setQty] = useState("1")
  const isWriteOff = operation?.type === "writeOff"
  const product = operation?.product ?? null
  const nextStock = product ? product.stock + (isWriteOff ? -Number(qty || 0) : Number(qty || 0)) : 0

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!operation) {
      event.preventDefault()
      return
    }

    const parsedQty = Number(qty)
    if (!Number.isInteger(parsedQty) || parsedQty < 1) {
      event.preventDefault()
      toast.error("Количество должно быть целым числом от 1.")
      return
    }

    onSubmit(event, operation)
  }

  return (
    <Dialog open={Boolean(operation)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isWriteOff ? "Списать товар" : "Пополнить товар"}</DialogTitle>
          <DialogDescription>{product ? product.name : "Выберите товар"}</DialogDescription>
        </DialogHeader>
        {product && operation && (
          <form key={`${operation.type}-${product.code}`} onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="productCode" value={product.code} />
            <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3">
              <Info label="Stock" value={number(product.stock)} />
              <Info label="Reserved" value={number(product.reserved)} />
              <Info label="Available" value={number(product.available)} />
            </div>
            {isWriteOff && nextStock < 0 && (
              <Alert>
                <AlertTriangleIcon />
                <AlertTitle>Остаток уйдет в минус</AlertTitle>
                <AlertDescription>Операция разрешена, но проверьте количество перед подтверждением.</AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="stock-operation-qty">Количество</FieldLabel>
                <Input
                  id="stock-operation-qty"
                  name="qty"
                  type="number"
                  min="1"
                  step="1"
                  value={qty}
                  onChange={(event) => setQty(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="stock-operation-comment">Комментарий</FieldLabel>
                <Textarea id="stock-operation-comment" name="comment" />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" variant={isWriteOff ? "destructive" : "default"} disabled={pending}>
                {isWriteOff ? "Списать" : "Пополнить"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
  if (product.available < 0) {
    return <Badge variant="destructive">{number(product.available)}</Badge>
  }

  if (product.available <= 3) {
    return <Badge variant="outline">{number(product.available)}</Badge>
  }

  return <Badge variant="secondary">{number(product.available)}</Badge>
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
      return "Пополнение"
    }

    if (movement.qty < 0) {
      return "Списание"
    }
  }

  const labels: Record<string, string> = {
    import: "Импорт",
    stock_update: "Склад",
    delete_product: "Удаление",
    sale: "Продажа",
    shift_open: "Открытие смены",
    shift_close: "Закрытие смены",
    order_create: "Заказ",
    order_status: "Статус заказа",
  }

  return labels[movement.type] ?? movement.type
}

function deliveryTypeLabel(type: string) {
  return type === "delivery" ? "Доставка" : "Самовывоз"
}

function getShiftCashSummary(detail: DashboardData["shiftDetails"][number]) {
  const revenueTypes = new Set(["sale", "prepayment", "order_payment"])
  const byMethod: Record<PaymentMethod, number> = {
    cash: 0,
    card: 0,
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
