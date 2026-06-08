"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  MinusCircleIcon,
  PencilIcon,
  PlusIcon,
  UserCheckIcon,
  UserXIcon,
  XCircleIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  checkWazzupChannelsAction,
  checkWazzupWebhookSubscriptionsAction,
  clearWazzupApiKeyAction,
  connectWazzupWebhookAction,
  generateWazzupCrmKeyAction,
  getSecureWazzupWebhookUrlAction,
  saveOrderSettingsAction,
  saveStockCostSettingsAction,
  saveSupplierAction,
  saveWazzupSettingsAction,
  setSupplierActiveAction,
  syncWazzupAllAction,
  syncWazzupContactsAction,
  syncWazzupDealsAction,
  syncWazzupPipelinesAction,
  syncWazzupUsersAction,
  testLocalWazzupWebhookAction,
  testWazzupApiKeyAction,
} from "@/app/actions"
import type { OrderSettings, Supplier, UserRole } from "@/lib/db"
import type { WazzupSettingsStatus } from "@/lib/wazzup"
import { formatInstant } from "@/lib/datetime"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type Result = Awaited<ReturnType<typeof saveSupplierAction>>

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

export function SettingsPage({
  suppliers,
  wazzupStatus,
  orderSettings,
}: {
  suppliers: Supplier[]
  wazzupStatus: WazzupSettingsStatus
  orderSettings: OrderSettings
}) {
  const router = useRouter()
  const [supplierSheet, setSupplierSheet] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [activeToggleSupplier, setActiveToggleSupplier] = useState<Supplier | null>(null)
  const [isPending, startTransition] = useTransition()

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
      <Tabs defaultValue="suppliers" className="gap-4">
        <TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
          <TabsTrigger value="suppliers">Поставщики</TabsTrigger>
          <TabsTrigger value="orders">Заказы</TabsTrigger>
          <TabsTrigger value="wazzup">Wazzup</TabsTrigger>
        </TabsList>
        <TabsContent value="suppliers">
          <SuppliersSection
            suppliers={suppliers}
            pending={isPending}
            onCreate={() => {
              setEditingSupplier(null)
              setSupplierSheet(true)
            }}
            onEdit={(supplier) => {
              setEditingSupplier(supplier)
              setSupplierSheet(true)
            }}
            onToggleActive={setActiveToggleSupplier}
          />
        </TabsContent>
        <TabsContent value="orders" className="flex flex-col gap-4">
          <OrderPolicyBlock orderSettings={orderSettings} />
          <StockCostPolicyBlock orderSettings={orderSettings} />
        </TabsContent>
        <TabsContent value="wazzup">
          <WazzupSettingsBlock status={wazzupStatus} />
        </TabsContent>
      </Tabs>

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
    </>
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
                <Input
                  id="supplier-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+7 (___) ___-__-__"
                  defaultValue={supplier?.phone}
                  disabled={pending}
                />
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

// Политика создания заказов: тумблер «разрешить заказы с отсутствующими позициями».
function OrderPolicyBlock({ orderSettings }: { orderSettings: OrderSettings }) {
  const router = useRouter()
  const [allowOversell, setAllowOversell] = useState(orderSettings.allowOversellOrders)
  const [pending, startTransition] = useTransition()

  // Ресинхронизация после router.refresh(): когда сервер прислал новое значение,
  // считаем его «сохранённым» (подстройка во время рендера, без эффекта).
  const [lastSaved, setLastSaved] = useState(orderSettings.allowOversellOrders)
  if (lastSaved !== orderSettings.allowOversellOrders) {
    setLastSaved(orderSettings.allowOversellOrders)
    setAllowOversell(orderSettings.allowOversellOrders)
  }

  const isDirty = allowOversell !== orderSettings.allowOversellOrders

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    if (allowOversell) {
      formData.set("allowOversellOrders", "on")
    }
    startTransition(async () => {
      const result = await saveOrderSettingsAction(formData)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Создание заказов</CardTitle>
            <CardDescription>Правила резервирования склада при оформлении заказов</CardDescription>
          </div>
          {isDirty ? (
            <Badge variant="outline">
              <AlertCircleIcon data-icon="inline-start" />
              Несохраненные изменения
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <FieldGroup>
            <Field orientation="horizontal">
              <Checkbox
                id="allow-oversell-orders"
                checked={allowOversell}
                onCheckedChange={(checked) => setAllowOversell(checked === true)}
                disabled={pending}
              />
              <FieldContent>
                <FieldLabel htmlFor="allow-oversell-orders">Разрешить заказы с отсутствующими позициями</FieldLabel>
                <FieldDescription>
                  Если включено, заказ можно создать и изменить, даже когда товара не хватает на складе — остаток уйдет в
                  минус. По умолчанию выключено: система не дает зарезервировать больше, чем доступно («Недостаточно
                  остатка»). Касса (продажи) работает без этой проверки в любом случае.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
          <div>
            <GatedButton
              type="submit"
              disabled={pending || !isDirty}
              reason={!isDirty ? "Нет несохраненных изменений" : null}
            >
              Сохранить настройки
            </GatedButton>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function StockCostPolicyBlock({ orderSettings }: { orderSettings: OrderSettings }) {
  const router = useRouter()
  const [recompute, setRecompute] = useState(orderSettings.recomputeCostOnReceipt)
  const [pending, startTransition] = useTransition()

  // Ресинхронизация после router.refresh() (подстройка во время рендера, без эффекта).
  const [lastSaved, setLastSaved] = useState(orderSettings.recomputeCostOnReceipt)
  if (lastSaved !== orderSettings.recomputeCostOnReceipt) {
    setLastSaved(orderSettings.recomputeCostOnReceipt)
    setRecompute(orderSettings.recomputeCostOnReceipt)
  }

  const isDirty = recompute !== orderSettings.recomputeCostOnReceipt

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    if (recompute) {
      formData.set("recomputeCostOnReceipt", "on")
    }
    startTransition(async () => {
      const result = await saveStockCostSettingsAction(formData)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Себестоимость</CardTitle>
            <CardDescription>Пересчёт себестоимости товара при проведении приходного акта</CardDescription>
          </div>
          {isDirty ? (
            <Badge variant="outline">
              <AlertCircleIcon data-icon="inline-start" />
              Несохраненные изменения
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <FieldGroup>
            <Field orientation="horizontal">
              <Checkbox
                id="recompute-cost-on-receipt"
                checked={recompute}
                onCheckedChange={(checked) => setRecompute(checked === true)}
                disabled={pending}
              />
              <FieldContent>
                <FieldLabel htmlFor="recompute-cost-on-receipt">Пересчитывать себестоимость при приходе</FieldLabel>
                <FieldDescription>
                  Если включено, при проведении приходного акта себестоимость товара пересчитывается по
                  средневзвешенной из введённых цен закупки (учитывается остаток и новое поступление). По умолчанию
                  выключено — себестоимость меняется только вручную или импортом. Влияет лишь на новые приходы.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
          <div>
            <GatedButton
              type="submit"
              disabled={pending || !isDirty}
              reason={!isDirty ? "Нет несохраненных изменений" : null}
            >
              Сохранить настройки
            </GatedButton>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

type ApiResultState = {
  title: string
  lines: string[]
  ok: boolean
  at: string
} | null

function WazzupSettingsBlock({ status }: { status: WazzupSettingsStatus }) {
  const router = useRouter()
  const [apiKey, setApiKey] = useState("")
  const [showApiKey, setShowApiKey] = useState(false)
  const [isEnabled, setIsEnabled] = useState(status.isEnabled)
  const [webhookAuthRequired, setWebhookAuthRequired] = useState(status.webhookAuthRequired)
  const [chatMode, setChatMode] = useState<"iframe" | "custom">(status.chatMode)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [apiResult, setApiResult] = useState<ApiResultState>(null)
  const [pending, startTransition] = useTransition()
  const connectionState = getWazzupConnectionState(status)

  // Когда статус пересчитывается с сервера, локальные переключатели снова считаются "сохранёнными".
  // Подстройка во время рендера вместо эффекта (без каскадного ререндера).
  const [lastStatus, setLastStatus] = useState(status)
  if (
    lastStatus.isEnabled !== status.isEnabled ||
    lastStatus.webhookAuthRequired !== status.webhookAuthRequired ||
    lastStatus.chatMode !== status.chatMode
  ) {
    setLastStatus(status)
    setIsEnabled(status.isEnabled)
    setWebhookAuthRequired(status.webhookAuthRequired)
    setChatMode(status.chatMode)
  }

  const isDirty =
    apiKey.trim().length > 0 ||
    isEnabled !== status.isEnabled ||
    webhookAuthRequired !== status.webhookAuthRequired ||
    chatMode !== status.chatMode

  // Причины блокировки кнопок — выводятся в Tooltip над disabled-кнопкой.
  const apiKeyReason = !status.apiKeyConfigured ? "Сначала сохраните API key" : null
  const enabledReason = !status.isEnabled ? "Включите интеграцию Wazzup" : null
  const syncReason = apiKeyReason ?? enabledReason
  const secureUrlReason = !status.crmKeyConfigured ? "Сначала сгенерируйте CRM key" : null

  function copyWebhookUrl() {
    void navigator.clipboard.writeText(status.webhookUrl)
    toast.success("Webhook URL скопирован")
  }

  function copySecureWebhookUrl() {
    startTransition(async () => {
      const result = await getSecureWazzupWebhookUrlAction()
      if (result.ok) {
        await navigator.clipboard.writeText(result.data.url)
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    })
  }

  function run(action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(result.message)
        after?.()
        router.refresh()
      } else {
        toast.error(result.message)
        router.refresh()
      }
    })
  }

  function runWazzupApi(
    title: string,
    action: () => Promise<{ ok: boolean; message: string; messages?: string[] }>
  ) {
    // Очищаем предыдущий вывод сразу, чтобы под новым действием не оставался устаревший ответ.
    setApiResult(null)
    startTransition(async () => {
      const result = await action()
      setApiResult({
        title,
        lines: result.messages ?? [result.message],
        ok: result.ok,
        at: new Date().toISOString(),
      })
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function submitSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set("apiKey", apiKey)
    if (isEnabled) {
      formData.set("isEnabled", "on")
    }
    if (webhookAuthRequired) {
      formData.set("webhookAuthRequired", "on")
    }
    formData.set("chatMode", chatMode)

    run(() => saveWazzupSettingsAction(formData), () => setApiKey(""))
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="connection" className="gap-4">
        <TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
          <TabsTrigger value="connection">Подключение</TabsTrigger>
          <TabsTrigger value="operations">Синхронизация и диагностика</TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="flex flex-col gap-4">
          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Статус подключения</CardTitle>
                  <CardDescription>Без показа полных ключей в интерфейсе</CardDescription>
                </div>
                <ConnectionBadge state={connectionState} />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!status.appUrlConfigured ? (
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>NEXT_PUBLIC_APP_URL не задан</AlertTitle>
                  <AlertDescription>Укажите NEXT_PUBLIC_APP_URL для корректного webhook URL.</AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                <StatusTile
                  label="API key"
                  value={status.apiKeyConfigured ? "Настроен" : "Не настроен"}
                  tone={status.apiKeyConfigured ? "positive" : "muted"}
                />
                <StatusTile
                  label="CRM key"
                  value={status.crmKeyConfigured ? "Настроен" : "Не настроен"}
                  tone={status.crmKeyConfigured ? "positive" : "muted"}
                />
                <StatusTile
                  label="Webhook auth"
                  value={status.webhookAuthRequired ? "Обязателен" : "Гибкий"}
                  tone={status.webhookAuthRequired ? "positive" : "neutral"}
                />
                <StatusTile
                  label="Последняя проверка"
                  value={lastCheckLabel(status)}
                  tone={status.lastCheckStatus === "error" ? "negative" : status.lastCheckAt ? "neutral" : "muted"}
                />
              </div>
              {status.lastCheckMessage ? (
                <Alert variant={status.lastCheckStatus === "error" ? "destructive" : "default"}>
                  <AlertTitle>{status.lastCheckStatus === "error" ? "Ошибка проверки" : "Проверка выполнена"}</AlertTitle>
                  <AlertDescription>{status.lastCheckMessage}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Ключи</CardTitle>
                  <CardDescription>Ключи сохраняются server-side и показываются только в маске</CardDescription>
                </div>
                {isDirty ? (
                  <Badge variant="outline">
                    <AlertCircleIcon data-icon="inline-start" />
                    Несохраненные изменения
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={submitSettings}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="wazzup-api-key">Wazzup API key</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="wazzup-api-key"
                        type={showApiKey ? "text" : "password"}
                        value={apiKey}
                        placeholder={status.apiKeyConfigured ? "Ключ сохранен" : "Вставьте API key"}
                        autoComplete="off"
                        onChange={(event) => setApiKey(event.target.value)}
                        disabled={pending}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          size="icon-xs"
                          aria-label={showApiKey ? "Скрыть ключ" : "Показать ключ"}
                          aria-pressed={showApiKey}
                          onClick={() => setShowApiKey((value) => !value)}
                          disabled={pending}
                        >
                          {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                    <FieldDescription>
                      Текущий ключ: {status.apiKeyMasked ?? "не настроен"}. Пустое поле не затирает сохраненный ключ.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="wazzup-crm-key">CRM key</FieldLabel>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="wazzup-crm-key"
                        type="password"
                        readOnly
                        value={status.crmKeyMasked ?? ""}
                        placeholder="CRM key не настроен"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => run(generateWazzupCrmKeyAction)}
                      >
                        <KeyRoundIcon data-icon="inline-start" />
                        Сгенерировать новый
                      </Button>
                    </div>
                    <FieldDescription>CRM key проверяется по Authorization Bearer или query key в защищенном webhook URL.</FieldDescription>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="wazzup-is-enabled"
                      checked={isEnabled}
                      onCheckedChange={(checked) => setIsEnabled(checked === true)}
                      disabled={pending}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor="wazzup-is-enabled">Интеграция включена</FieldLabel>
                      <FieldDescription>Если выключить, реальные webhooks будут сохранены как ignored.</FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="wazzup-webhook-auth-required"
                      checked={webhookAuthRequired}
                      onCheckedChange={(checked) => setWebhookAuthRequired(checked === true)}
                      disabled={pending}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor="wazzup-webhook-auth-required">Защита webhook по CRM key</FieldLabel>
                      <FieldDescription>
                        Для безопасности webhook без действительного CRM key отклоняется в любом случае. Регистрируйте защищённый URL с ?key=… кнопкой «Подключить webhook» — иначе входящие сообщения приходить не будут.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="wazzup-chat-mode"
                      checked={chatMode === "custom"}
                      onCheckedChange={(checked) => setChatMode(checked === true ? "custom" : "iframe")}
                      disabled={pending}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor="wazzup-chat-mode">Собственный чат сделок</FieldLabel>
                      <FieldDescription>
                        Вместо встроенного Wazzup iframe показывать собственный чат в сделке: единая лента входящих и
                        исходящих из базы, отправка текста и букетов через Wazzup API. По умолчанию используется iframe.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldGroup>
                <div className="flex flex-wrap items-center gap-2">
                  <GatedButton
                    type="submit"
                    disabled={pending || !isDirty}
                    reason={!isDirty ? "Нет несохраненных изменений" : null}
                  >
                    Сохранить настройки
                  </GatedButton>
                  <GatedButton
                    variant="outline"
                    disabled={pending || !status.apiKeyConfigured}
                    reason={apiKeyReason}
                    onClick={() => setClearDialogOpen(true)}
                  >
                    Очистить API key
                  </GatedButton>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <CardTitle>Подключение webhook</CardTitle>
              <CardDescription>Что включить в Wazzup</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <WebhookUrlRow label="Public webhook URL" webhookUrl={status.webhookUrl} onCopy={copyWebhookUrl} />
              <WebhookUrlRow
                label="Secure webhook URL"
                webhookUrl={status.secureWebhookUrlMasked}
                onCopy={copySecureWebhookUrl}
                copyLabel="Скопировать защищенный URL"
                disabled={!status.crmKeyConfigured || pending}
                reason={secureUrlReason}
              />
              <ol className="grid gap-2 text-sm text-muted-foreground">
                <li>1. В Wazzup откройте Интеграция с CRM / API.</li>
                <li>2. Укажите защищенный Webhook URL или нажмите “Подключить webhook в Wazzup”.</li>
                <li>3. Включите подписки: messagesAndStatuses и contactsAndDealsCreation.</li>
                <li>4. При тестовом POST CRM должна вернуть 200 OK.</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <CardTitle>Проверка</CardTitle>
              <CardDescription>Быстрые проверки без показа ключей</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(testWazzupApiKeyAction)}>
                Проверить API key
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(testLocalWazzupWebhookAction)}>
                Проверить webhook endpoint
              </Button>
              <GatedButton
                variant="outline"
                disabled={pending || !status.apiKeyConfigured}
                reason={apiKeyReason}
                onClick={() => runWazzupApi("Проверка подписок", checkWazzupWebhookSubscriptionsAction)}
              >
                Проверить подписки
              </GatedButton>
              <GatedButton
                variant="outline"
                disabled={pending || !status.apiKeyConfigured}
                reason={apiKeyReason}
                onClick={() => runWazzupApi("Подключение webhook в Wazzup", connectWazzupWebhookAction)}
              >
                Подключить webhook в Wazzup
              </GatedButton>
              <GatedButton
                variant="outline"
                disabled={pending || !status.apiKeyConfigured}
                reason={apiKeyReason}
                onClick={() => runWazzupApi("Проверка каналов", checkWazzupChannelsAction)}
              >
                Проверить каналы
              </GatedButton>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operations" className="flex flex-col gap-4">
          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Пользователи Wazzup</CardTitle>
                  <CardDescription>
                    Синхронизируйте пользователей CRM в Wazzup. После этого администратор Wazzup сможет назначить им роли и доступ в личном кабинете Wazzup.
                  </CardDescription>
                </div>
                <GatedButton
                  variant="outline"
                  disabled={pending || !status.apiKeyConfigured}
                  reason={apiKeyReason}
                  onClick={() => runWazzupApi("Синхронизация пользователей", syncWazzupUsersAction)}
                >
                  <UserCheckIcon data-icon="inline-start" />
                  Синхронизировать пользователей
                </GatedButton>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Alert>
                <AlertTriangleIcon />
                <AlertTitle>Роли назначаются в Wazzup</AlertTitle>
                <AlertDescription>
                  Если iframe пишет “Нет доступа к приложению”, пользователь уже может быть отправлен из CRM, но ему нужно назначить роль в личном кабинете Wazzup.
                </AlertDescription>
              </Alert>
              {status.userSync.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Пользователь CRM</TableHead>
                      <TableHead>Роль CRM</TableHead>
                      <TableHead>Wazzup ID</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Последний sync</TableHead>
                      <TableHead>Ошибка</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.userSync.map((user) => (
                      <TableRow key={user.userId}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">{user.crmName || user.crmLogin || `User ${user.userId}`}</span>
                            <span className="text-xs text-muted-foreground">{user.crmLogin || "-"}</span>
                          </div>
                        </TableCell>
                        <TableCell>{roleLabels[user.crmRole]}</TableCell>
                        <TableCell>{user.wazzupUserId || String(user.userId)}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Badge variant={wazzupUserSyncBadgeVariant(user.syncStatus)}>
                                  {wazzupUserSyncLabel(user.syncStatus)}
                                </Badge>
                              }
                            />
                            <TooltipContent>{user.syncStatus}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>{user.lastSyncedAt ? dateTime(user.lastSyncedAt) : "-"}</TableCell>
                        <TableCell className="max-w-80 truncate">
                          {user.lastError || (!user.isActive ? "Пользователь отключен в CRM" : "-")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Empty className="min-h-36">
                  <EmptyHeader>
                    <EmptyTitle>Пользователей CRM нет</EmptyTitle>
                    <EmptyDescription>Создайте активного пользователя CRM, чтобы отправить его в Wazzup.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Синхронизация CRM</CardTitle>
                  <CardDescription>Воронки, клиенты и сделки для списка “Сделки” внутри Wazzup iframe</CardDescription>
                </div>
                <GatedButton
                  disabled={pending || !status.apiKeyConfigured || !status.isEnabled}
                  reason={syncReason}
                  onClick={() => runWazzupApi("Синхронизация всего", syncWazzupAllAction)}
                >
                  <UserCheckIcon data-icon="inline-start" />
                  Синхронизировать всё
                </GatedButton>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!status.isEnabled || !status.apiKeyConfigured ? (
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>Синхронизация недоступна</AlertTitle>
                  <AlertDescription>Включите интеграцию Wazzup и сохраните API key, чтобы отправлять данные CRM.</AlertDescription>
                </Alert>
              ) : null}
              {!status.appUrlConfigured ? (
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>NEXT_PUBLIC_APP_URL не задан</AlertTitle>
                  <AlertDescription>Контакты и сделки будут отправлены с относительными ссылками. Для Wazzup лучше задать публичный URL.</AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                <StatusTile label="Воронки" value={wazzupSyncValue(status.entitySync.pipelines)} tone={syncTone(status.entitySync.pipelines)} />
                <StatusTile label="Этапы" value={wazzupSyncValue(status.entitySync.stages)} tone={syncTone(status.entitySync.stages)} />
                <StatusTile label="Клиенты" value={wazzupSyncValue(status.entitySync.contacts)} tone={syncTone(status.entitySync.contacts)} />
                <StatusTile label="Сделки" value={wazzupSyncValue(status.entitySync.deals)} tone={syncTone(status.entitySync.deals)} />
                <StatusTile
                  label="Ошибки клиентов"
                  value={String(status.entitySync.contacts.failed)}
                  tone={status.entitySync.contacts.failed ? "negative" : "neutral"}
                />
                <StatusTile
                  label="Ошибки сделок"
                  value={String(status.entitySync.deals.failed)}
                  tone={status.entitySync.deals.failed ? "negative" : "neutral"}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <GatedButton
                  variant="outline"
                  disabled={pending || !status.apiKeyConfigured || !status.isEnabled}
                  reason={syncReason}
                  onClick={() => runWazzupApi("Синхронизация воронок", syncWazzupPipelinesAction)}
                >
                  Синхронизировать воронки
                </GatedButton>
                <GatedButton
                  variant="outline"
                  disabled={pending || !status.apiKeyConfigured || !status.isEnabled}
                  reason={syncReason}
                  onClick={() => runWazzupApi("Синхронизация клиентов", syncWazzupContactsAction)}
                >
                  Синхронизировать клиентов
                </GatedButton>
                <GatedButton
                  variant="outline"
                  disabled={pending || !status.apiKeyConfigured || !status.isEnabled}
                  reason={syncReason}
                  onClick={() => runWazzupApi("Синхронизация сделок", syncWazzupDealsAction)}
                >
                  Синхронизировать сделки
                </GatedButton>
              </div>
              {status.entitySync.pipelines.lastError ||
              status.entitySync.contacts.lastError ||
              status.entitySync.deals.lastError ? (
                <Alert variant="destructive">
                  <AlertTitle>Последняя ошибка синхронизации</AlertTitle>
                  <AlertDescription>
                    {status.entitySync.deals.lastError ||
                      status.entitySync.contacts.lastError ||
                      status.entitySync.pipelines.lastError}
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border bg-white">
            <CardHeader>
              <CardTitle>Диагностика</CardTitle>
              <CardDescription>Последние Wazzup события без raw payload и секретов</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                <StatusTile label="Webhook события" value={String(status.diagnostics.webhookEventsCount)} />
                <StatusTile label="Сообщения Wazzup" value={String(status.diagnostics.wazzupMessagesCount)} />
                <StatusTile
                  label="Ошибки авторизации"
                  value={String(status.diagnostics.failedAuthEventsCount)}
                  tone={status.diagnostics.failedAuthEventsCount ? "negative" : "neutral"}
                />
                <StatusTile label="Последний тип события" value={wazzupEventTypeLabel(status.diagnostics.latestEventType)} />
                <StatusTile
                  label="Последнее сообщение"
                  value={
                    status.diagnostics.latestMessage
                      ? `${status.diagnostics.latestMessage.chatType} · ${status.diagnostics.latestMessage.chatId}`
                      : "Нет сообщений"
                  }
                />
              </div>
              {status.diagnostics.onlyTestWebhooks ? (
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>Получены только test webhooks</AlertTitle>
                  <AlertDescription>Реальных сообщений или createDeal еще не было.</AlertDescription>
                </Alert>
              ) : null}
              {status.diagnostics.latestError.includes("unauthorized webhook:") ? (
                <Alert variant="destructive">
                  <AlertTriangleIcon />
                  <AlertTitle>Webhook отклонен по CRM key</AlertTitle>
                  <AlertDescription>
                    Wazzup отправил webhook без ожидаемого CRM key. Используйте защищенный webhook URL с key или выключите обязательную проверку.
                  </AlertDescription>
                </Alert>
              ) : null}
              {status.diagnostics.latestMessage ? (
                <div className="text-sm text-muted-foreground">
                  Последнее сообщение Wazzup: {dateTime(status.diagnostics.latestMessage.createdAt)}
                </div>
              ) : null}
              {status.diagnostics.recentWebhookEvents.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Тип события</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Создано</TableHead>
                      <TableHead>Ошибка</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.diagnostics.recentWebhookEvents.map((event, index) => (
                      <TableRow key={`${event.createdAt}-${event.eventType}-${index}`}>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger render={<span>{wazzupEventTypeLabel(event.eventType)}</span>} />
                            <TooltipContent>{event.eventType || "unknown"}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Badge variant={event.status === "failed" ? "destructive" : "secondary"}>
                                  {wazzupEventStatusLabel(event.status)}
                                </Badge>
                              }
                            />
                            <TooltipContent>{event.status || "unknown"}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>{dateTime(event.createdAt)}</TableCell>
                        <TableCell className="max-w-80 truncate">{event.error || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Empty className="min-h-36">
                  <EmptyHeader>
                    <EmptyTitle>Webhook events еще нет</EmptyTitle>
                    <EmptyDescription>После теста или реального события Wazzup они появятся здесь.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(apiResult)}
        onOpenChange={(open) => {
          if (!open) {
            setApiResult(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{apiResult?.title ?? "Ответ Wazzup API"}</DialogTitle>
            <DialogDescription>
              {apiResult ? `${apiResult.ok ? "Успешно" : "Ошибка"} · ${dateTime(apiResult.at)}` : null}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
            {apiResult?.lines.join("\n")}
          </pre>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApiResult(null)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить Wazzup API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Сохраненный в базе API key будет удален. Если ключ задан в .env, он останется fallback на сервере.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" disabled={pending} />}
              onClick={() => run(clearWazzupApiKeyAction, () => setClearDialogOpen(false))}
            >
              Очистить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type StatusTone = "positive" | "negative" | "muted" | "neutral"

const statusToneIcon: Record<Exclude<StatusTone, "neutral">, React.ReactNode> = {
  positive: <CheckCircle2Icon className="size-4 text-emerald-600" />,
  negative: <XCircleIcon className="size-4 text-destructive" />,
  muted: <MinusCircleIcon className="size-4 text-muted-foreground" />,
}

function StatusTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: StatusTone }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 font-medium">
        {tone !== "neutral" ? statusToneIcon[tone] : null}
        <span>{value}</span>
      </div>
    </div>
  )
}

// Кнопка с причиной блокировки: при disabled оборачиваем в span,
// чтобы Tooltip ловил наведение (disabled-кнопка не получает pointer-событий).
function GatedButton({
  reason,
  disabled,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { reason?: string | null }) {
  if (disabled && reason) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex cursor-not-allowed" tabIndex={0} />}>
          <Button {...props} disabled aria-disabled className="pointer-events-none">
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Button {...props} disabled={disabled}>
      {children}
    </Button>
  )
}

function WebhookUrlRow({
  label,
  webhookUrl,
  onCopy,
  copyLabel = "Копировать",
  disabled = false,
  reason = null,
}: {
  label: string
  webhookUrl: string
  onCopy: () => void
  copyLabel?: string
  disabled?: boolean
  reason?: string | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={webhookUrl} />
        <GatedButton variant="outline" onClick={onCopy} disabled={disabled} reason={reason}>
          <CopyIcon data-icon="inline-start" />
          {copyLabel}
        </GatedButton>
      </div>
    </div>
  )
}

type ConnectionState = {
  label: string
  variant: "secondary" | "destructive" | "outline"
  tone: StatusTone
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const icon =
    state.tone === "positive" ? (
      <CheckCircle2Icon data-icon="inline-start" />
    ) : state.tone === "negative" ? (
      <XCircleIcon data-icon="inline-start" />
    ) : (
      <AlertCircleIcon data-icon="inline-start" />
    )

  return (
    <Badge variant={state.variant}>
      {icon}
      {state.label}
    </Badge>
  )
}

function getWazzupConnectionState(status: WazzupSettingsStatus): ConnectionState {
  if (status.lastCheckStatus === "error") {
    return { label: "Ошибка", variant: "destructive", tone: "negative" }
  }

  if (status.isEnabled && status.apiKeyConfigured && status.crmKeyConfigured) {
    return { label: "Подключено", variant: "secondary", tone: "positive" }
  }

  return { label: "Не настроено", variant: "outline", tone: "muted" }
}

function lastCheckLabel(status: WazzupSettingsStatus) {
  if (!status.lastCheckAt) {
    return "Не выполнялась"
  }

  return `${status.lastCheckStatus || "unknown"} · ${dateTime(status.lastCheckAt)}`
}

function wazzupSyncValue(summary: WazzupSettingsStatus["entitySync"]["contacts"]) {
  return `${summary.synced}/${summary.total}${summary.failed ? ` · ошибок ${summary.failed}` : ""}`
}

function syncTone(summary: WazzupSettingsStatus["entitySync"]["contacts"]): StatusTone {
  if (summary.failed) {
    return "negative"
  }
  if (summary.total && summary.synced >= summary.total) {
    return "positive"
  }
  return "neutral"
}

const wazzupUserSyncLabels: Record<WazzupSettingsStatus["userSync"][number]["syncStatus"], string> = {
  synced: "Синхронизирован",
  failed: "Ошибка",
  skipped: "Пропущен",
  pending: "Ожидает",
}

function wazzupUserSyncLabel(status: WazzupSettingsStatus["userSync"][number]["syncStatus"]) {
  return wazzupUserSyncLabels[status] ?? "Ожидает"
}

function wazzupUserSyncBadgeVariant(status: WazzupSettingsStatus["userSync"][number]["syncStatus"]) {
  if (status === "synced") {
    return "secondary" as const
  }
  if (status === "failed") {
    return "destructive" as const
  }

  return "outline" as const
}

const wazzupEventTypeLabels: Record<string, string> = {
  messagesAndStatuses: "Сообщения и статусы",
  contactsAndDealsCreation: "Создание контактов и сделок",
  createContact: "Создание контакта",
  createDeal: "Создание сделки",
  channelsUpdates: "Обновления каналов",
  templateStatus: "Статус шаблона",
  test: "Тест",
}

function wazzupEventTypeLabel(eventType: string) {
  if (!eventType) {
    return "-"
  }
  return wazzupEventTypeLabels[eventType] ?? eventType
}

const wazzupEventStatusLabels: Record<string, string> = {
  processed: "Обработано",
  failed: "Ошибка",
  ignored: "Пропущено",
  pending: "Ожидает",
}

function wazzupEventStatusLabel(status: string) {
  if (!status) {
    return "unknown"
  }
  return wazzupEventStatusLabels[status] ?? status
}

function dateTime(value: string) {
  return formatInstant(value)
}
