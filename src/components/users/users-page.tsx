"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { KeyRoundIcon, PencilIcon, PlusIcon, UserCheckIcon, UserXIcon } from "lucide-react"
import { toast } from "sonner"
import {
  changeUserPasswordAction,
  createUserAction,
  setUserActiveAction,
  updateUserAction,
} from "@/app/actions"
import type { CurrentUser, UserRole } from "@/lib/db"
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
import { Button } from "@/components/ui/button"
import { ScreenBody } from "@/components/screen-body"
import { HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Result = Awaited<ReturnType<typeof createUserAction>>

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

const userRoleOptions: UserRole[] = ["owner", "manager", "florist"]

export function UsersPage({
  users,
  currentUserId,
}: {
  users: CurrentUser[]
  currentUserId: number
}) {
  const router = useRouter()
  const [userSheet, setUserSheet] = useState(false)
  const [editingUser, setEditingUser] = useState<CurrentUser | null>(null)
  const [passwordUser, setPasswordUser] = useState<CurrentUser | null>(null)
  const [activeToggleUser, setActiveToggleUser] = useState<CurrentUser | null>(null)
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
      <UsersSection
        users={users}
        currentUserId={currentUserId}
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
    </>
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
  const [search, setSearch] = useState("")
  const normalized = search.trim().toLowerCase()
  const visible = normalized
    ? users.filter((targetUser) => `${targetUser.name} ${targetUser.login}`.toLowerCase().includes(normalized))
    : users

  return (
    <>
      <ScreenHeader
        title="Пользователи"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Поиск по имени или логину",
          inputProps: { "aria-label": "Поиск пользователей" },
        }}
        primaryAction={<HeaderPrimaryAction icon={PlusIcon} label="Добавить" onClick={onCreate} disabled={pending} />}
      />
      <ScreenBody>
        {visible.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Имя</TableHead>
                  <TableHead>Логин</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Действия</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((targetUser) => (
                  <TableRow key={targetUser.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{targetUser.name}</span>
                        {targetUser.id === currentUserId && (
                          <span className="text-xs font-normal text-muted-foreground">Текущий пользователь</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{targetUser.login}</TableCell>
                    <TableCell>{roleLabels[targetUser.role]}</TableCell>
                    <TableCell className={targetUser.isActive ? "" : "text-muted-foreground"}>
                      {targetUser.isActive ? "Активен" : "Отключен"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className="size-9 text-muted-foreground"
                          onClick={() => onEdit(targetUser)}
                          disabled={pending}
                          aria-label="Редактировать"
                          title="Редактировать"
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className="size-9 text-muted-foreground"
                          onClick={() => onPassword(targetUser)}
                          disabled={pending}
                          aria-label="Сменить пароль"
                          title="Сменить пароль"
                        >
                          <KeyRoundIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={targetUser.isActive ? "text-muted-foreground" : ""}
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
          <Empty className="min-h-56">
            <EmptyHeader>
              <EmptyTitle>{normalized ? "Ничего не найдено" : "Пользователей нет"}</EmptyTitle>
              <EmptyDescription>
                {normalized ? "Измените запрос или очистите поиск." : "Создайте первую учетную запись для доступа к системе."}
              </EmptyDescription>
            </EmptyHeader>
            {!normalized && (
              <EmptyContent>
                <Button onClick={onCreate}>
                  <PlusIcon data-icon="inline-start" />
                  Добавить пользователя
                </Button>
              </EmptyContent>
            )}
          </Empty>
        )}
      </ScreenBody>
    </>
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
