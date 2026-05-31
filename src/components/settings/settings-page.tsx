"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  CopyIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  UserCheckIcon,
  UserXIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  checkWazzupChannelsAction,
  checkWazzupWebhookSubscriptionsAction,
  clearWazzupApiKeyAction,
  connectWazzupWebhookAction,
  generateWazzupCrmKeyAction,
  getSecureWazzupWebhookUrlAction,
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
import type { Supplier, UserRole } from "@/lib/db"
import type { WazzupSettingsStatus } from "@/lib/wazzup"
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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

type Result = Awaited<ReturnType<typeof saveSupplierAction>>

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

export function SettingsPage({
  suppliers,
  wazzupStatus,
}: {
  suppliers: Supplier[]
  wazzupStatus: WazzupSettingsStatus
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

function WazzupSettingsBlock({ status }: { status: WazzupSettingsStatus }) {
  const router = useRouter()
  const [apiKey, setApiKey] = useState("")
  const [isEnabled, setIsEnabled] = useState(status.isEnabled)
  const [webhookAuthRequired, setWebhookAuthRequired] = useState(status.webhookAuthRequired)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [wazzupApiResult, setWazzupApiResult] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const connectionState = getWazzupConnectionState(status)

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

  function runWazzupApi(action: () => Promise<{ ok: boolean; message: string; messages?: string[] }>) {
    startTransition(async () => {
      const result = await action()
      setWazzupApiResult(result.messages ?? [result.message])
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

    run(() => saveWazzupSettingsAction(formData), () => setApiKey(""))
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Статус подключения</CardTitle>
              <CardDescription>Без показа полных ключей в интерфейсе</CardDescription>
            </div>
            <Badge variant={connectionState.variant}>{connectionState.label}</Badge>
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
          <div className="grid gap-3 md:grid-cols-3">
            <StatusTile label="API key" value={status.apiKeyConfigured ? "Настроен" : "Не настроен"} />
            <StatusTile label="CRM key" value={status.crmKeyConfigured ? "Настроен" : "Не настроен"} />
            <StatusTile label="Webhook auth" value={status.webhookAuthRequired ? "Обязателен" : "Гибкий"} />
            <StatusTile label="Последняя проверка" value={lastCheckLabel(status)} />
          </div>
          {status.lastCheckMessage ? (
            <Alert variant={status.lastCheckStatus === "error" ? "destructive" : "default"}>
              <AlertTitle>{status.lastCheckStatus === "error" ? "Ошибка проверки" : "Проверка выполнена"}</AlertTitle>
              <AlertDescription>{status.lastCheckMessage}</AlertDescription>
            </Alert>
          ) : null}
          <WebhookUrlRow label="Public webhook URL" webhookUrl={status.webhookUrl} onCopy={copyWebhookUrl} />
          <WebhookUrlRow
            label="Secure webhook URL"
            webhookUrl={status.secureWebhookUrlMasked}
            onCopy={copySecureWebhookUrl}
            copyLabel="Скопировать защищенный URL"
            disabled={!status.crmKeyConfigured || pending}
          />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <CardTitle>Ключи</CardTitle>
          <CardDescription>Ключи сохраняются server-side и показываются только в маске</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submitSettings}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="wazzup-api-key">Wazzup API key</FieldLabel>
                <Input
                  id="wazzup-api-key"
                  type="password"
                  value={apiKey}
                  placeholder={status.apiKeyConfigured ? "Ключ сохранен" : "Вставьте API key"}
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.target.value)}
                  disabled={pending}
                />
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
                  <FieldLabel htmlFor="wazzup-webhook-auth-required">Требовать CRM key для webhook</FieldLabel>
                  <FieldDescription>
                    Если выключено, сообщения без Authorization принимаются и помечаются предупреждением в диагностике.
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                Сохранить настройки
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(testWazzupApiKeyAction)}>
                Проверить API key
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !status.apiKeyConfigured}
                onClick={() => setClearDialogOpen(true)}
              >
                Очистить API key
              </Button>
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Пользователи Wazzup</CardTitle>
              <CardDescription>
                Синхронизируйте пользователей CRM в Wazzup. После этого администратор Wazzup сможет назначить им роли и доступ в личном кабинете Wazzup.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !status.apiKeyConfigured}
              onClick={() => runWazzupApi(syncWazzupUsersAction)}
            >
              <UserCheckIcon data-icon="inline-start" />
              Синхронизировать пользователей
            </Button>
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
                      <Badge variant={wazzupUserSyncBadgeVariant(user.syncStatus)}>
                        {wazzupUserSyncLabel(user.syncStatus)}
                      </Badge>
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
            <Button
              type="button"
              disabled={pending || !status.apiKeyConfigured || !status.isEnabled}
              onClick={() => runWazzupApi(syncWazzupAllAction)}
            >
              <UserCheckIcon data-icon="inline-start" />
              Синхронизировать всё
            </Button>
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
          <div className="grid gap-3 md:grid-cols-3">
            <StatusTile label="Воронки" value={wazzupSyncValue(status.entitySync.pipelines)} />
            <StatusTile label="Этапы" value={wazzupSyncValue(status.entitySync.stages)} />
            <StatusTile label="Клиенты" value={wazzupSyncValue(status.entitySync.contacts)} />
            <StatusTile label="Сделки" value={wazzupSyncValue(status.entitySync.deals)} />
            <StatusTile label="Ошибки клиентов" value={String(status.entitySync.contacts.failed)} />
            <StatusTile label="Ошибки сделок" value={String(status.entitySync.deals.failed)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending || !status.apiKeyConfigured || !status.isEnabled}
              onClick={() => runWazzupApi(syncWazzupPipelinesAction)}
            >
              Синхронизировать воронки
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !status.apiKeyConfigured || !status.isEnabled}
              onClick={() => runWazzupApi(syncWazzupContactsAction)}
            >
              Синхронизировать клиентов
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !status.apiKeyConfigured || !status.isEnabled}
              onClick={() => runWazzupApi(syncWazzupDealsAction)}
            >
              Синхронизировать сделки
            </Button>
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
          <div className="grid gap-3 md:grid-cols-3">
            <StatusTile label="Webhook события" value={String(status.diagnostics.webhookEventsCount)} />
            <StatusTile label="Сообщения Wazzup" value={String(status.diagnostics.wazzupMessagesCount)} />
            <StatusTile label="Ошибки авторизации" value={String(status.diagnostics.failedAuthEventsCount)} />
            <StatusTile label="Последний тип события" value={status.diagnostics.latestEventType || "-"} />
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
                    <TableCell>{event.eventType || "unknown"}</TableCell>
                    <TableCell>
                      <Badge variant={event.status === "failed" ? "destructive" : "secondary"}>
                        {event.status || "unknown"}
                      </Badge>
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
          <Button
            type="button"
            variant="outline"
            disabled={pending || !status.apiKeyConfigured}
            onClick={() => runWazzupApi(checkWazzupWebhookSubscriptionsAction)}
          >
            Проверить подписки
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !status.apiKeyConfigured}
            onClick={() => runWazzupApi(connectWazzupWebhookAction)}
          >
            Подключить webhook в Wazzup
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !status.apiKeyConfigured}
            onClick={() => runWazzupApi(checkWazzupChannelsAction)}
          >
            Проверить каналы
          </Button>
        </CardContent>
      </Card>

      {wazzupApiResult.length ? (
        <Alert>
          <AlertTitle>Ответ Wazzup API</AlertTitle>
          <AlertDescription>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{wazzupApiResult.join("\n")}</pre>
          </AlertDescription>
        </Alert>
      ) : null}

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

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}

function WebhookUrlRow({
  label,
  webhookUrl,
  onCopy,
  copyLabel = "Копировать",
  disabled = false,
}: {
  label: string
  webhookUrl: string
  onCopy: () => void
  copyLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={webhookUrl} />
        <Button type="button" variant="outline" onClick={onCopy} disabled={disabled}>
          <CopyIcon data-icon="inline-start" />
          {copyLabel}
        </Button>
      </div>
    </div>
  )
}

function getWazzupConnectionState(status: WazzupSettingsStatus) {
  if (status.lastCheckStatus === "error") {
    return { label: "Ошибка", variant: "destructive" as const }
  }

  if (status.isEnabled && status.apiKeyConfigured && status.crmKeyConfigured) {
    return { label: "Подключено", variant: "secondary" as const }
  }

  return { label: "Не настроено", variant: "outline" as const }
}

function lastCheckLabel(status: WazzupSettingsStatus) {
  if (!status.lastCheckAt) {
    return "Не выполнялась"
  }

  return `${status.lastCheckStatus || "unknown"} · ${dateTime(status.lastCheckAt)}`
}

function wazzupSyncValue(summary: WazzupSettingsStatus["entitySync"]["contacts"]) {
  return `${summary.synced}/${summary.total}${summary.failed ? ` · failed ${summary.failed}` : ""}`
}

function wazzupUserSyncLabel(status: WazzupSettingsStatus["userSync"][number]["syncStatus"]) {
  if (status === "synced") {
    return "synced"
  }
  if (status === "failed") {
    return "failed"
  }
  if (status === "skipped") {
    return "skipped"
  }

  return "pending"
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
