"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { PencilIcon, PlusIcon, SearchIcon, UserCheckIcon, UserXIcon } from "lucide-react"
import { toast } from "sonner"
import { saveSupplierAction, setSupplierActiveAction } from "@/app/actions"
import type { Supplier } from "@/lib/db"
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
import { Card, CardContent } from "@/components/ui/card"
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
import { Checkbox } from "@/components/ui/checkbox"
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
import { Textarea } from "@/components/ui/textarea"

type Result = Awaited<ReturnType<typeof saveSupplierAction>>

export function SuppliersClient({ suppliers }: { suppliers: Supplier[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editParam = searchParams.get("edit")
  const newParam = searchParams.get("new")

  const [query, setQuery] = useState("")
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(
    editParam ? suppliers.find((supplier) => String(supplier.id) === editParam) ?? null : null
  )
  const [supplierSheet, setSupplierSheet] = useState(Boolean(editParam) || newParam === "1")
  const [activeToggleSupplier, setActiveToggleSupplier] = useState<Supplier | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return suppliers
    return suppliers.filter((supplier) =>
      `${supplier.name} ${supplier.inn} ${supplier.phone} ${supplier.email} ${supplier.legalName}`
        .toLowerCase()
        .includes(normalized)
    )
  }, [query, suppliers])

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

  function submitForm(event: React.FormEvent<HTMLFormElement>, after?: () => void) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    run(() => saveSupplierAction(formData), after)
  }

  function openCreate() {
    setEditingSupplier(null)
    setSupplierSheet(true)
  }

  function openEdit(supplier: Supplier) {
    setEditingSupplier(supplier)
    setSupplierSheet(true)
  }

  return (
    <>
      <Card className="rounded-2xl border bg-white">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-64 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 pl-9"
                placeholder="Поиск по названию, ИНН, телефону, почте"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button className="h-10" onClick={openCreate} disabled={isPending}>
              <PlusIcon data-icon="inline-start" />
              Добавить поставщика
            </Button>
          </div>

          {filtered.length ? (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>ИНН</TableHead>
                    <TableHead>Контакты</TableHead>
                    <TableHead>Условия оплаты</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((supplier) => (
                    <TableRow key={supplier.id}>
                      <TableCell className="font-medium">
                        <Link href={`/suppliers/${supplier.id}`} className="hover:underline">
                          {supplier.name}
                        </Link>
                        {supplier.legalName && (
                          <div className="text-xs text-muted-foreground">{supplier.legalName}</div>
                        )}
                      </TableCell>
                      <TableCell>{supplier.inn || "-"}</TableCell>
                      <TableCell>
                        <div className="text-sm">{supplier.phone || supplier.email || "-"}</div>
                        {supplier.contactName && (
                          <div className="text-xs text-muted-foreground">{supplier.contactName}</div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-40">
                        {supplier.paymentTerms ||
                          (supplier.paymentDelayDays != null ? `Отсрочка ${supplier.paymentDelayDays} дн.` : "-")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={supplier.isActive ? "secondary" : "outline"}>
                          {supplier.isActive ? "Активен" : "В архиве"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/suppliers/${supplier.id}`}
                            className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-accent"
                          >
                            Открыть
                          </Link>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={() => openEdit(supplier)}
                            disabled={isPending}
                          >
                            <PencilIcon />
                            <span className="sr-only">Редактировать</span>
                          </Button>
                          <Button
                            variant={supplier.isActive ? "outline" : "default"}
                            size="sm"
                            onClick={() => setActiveToggleSupplier(supplier)}
                            disabled={isPending}
                          >
                            {supplier.isActive ? (
                              <UserXIcon data-icon="inline-start" />
                            ) : (
                              <UserCheckIcon data-icon="inline-start" />
                            )}
                            {supplier.isActive ? "В архив" : "Вернуть"}
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
                <EmptyTitle>{query ? "Ничего не найдено" : "Поставщиков нет"}</EmptyTitle>
                <EmptyDescription>
                  {query ? "Измените запрос." : "Добавьте поставщика для актов пополнения склада."}
                </EmptyDescription>
              </EmptyHeader>
              {!query && (
                <EmptyContent>
                  <Button onClick={openCreate}>
                    <PlusIcon data-icon="inline-start" />
                    Добавить поставщика
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}
        </CardContent>
      </Card>

      <SupplierSheet
        key={editingSupplier ? `edit-${editingSupplier.id}` : "create"}
        open={supplierSheet}
        supplier={editingSupplier}
        pending={isPending}
        onOpenChange={(open) => {
          setSupplierSheet(open)
          if (!open) setEditingSupplier(null)
        }}
        onSubmit={(event) =>
          submitForm(event, () => {
            setSupplierSheet(false)
            setEditingSupplier(null)
          })
        }
      />

      <AlertDialog
        open={Boolean(activeToggleSupplier)}
        onOpenChange={() => setActiveToggleSupplier(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {activeToggleSupplier?.isActive ? "Отправить в архив?" : "Вернуть из архива?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Архивный поставщик не показывается в новых актах пополнения. Старые акты сохранят его название.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant={activeToggleSupplier?.isActive ? "destructive" : "default"} disabled={isPending} />}
              onClick={() => {
                if (!activeToggleSupplier) return
                run(
                  () => setSupplierActiveAction(activeToggleSupplier.id, !activeToggleSupplier.isActive),
                  () => setActiveToggleSupplier(null)
                )
              }}
            >
              {activeToggleSupplier?.isActive ? "В архив" : "Вернуть"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{supplier ? "Редактировать поставщика" : "Новый поставщик"}</SheetTitle>
          <SheetDescription>Архивные поставщики не показываются в новых актах пополнения.</SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex flex-1 flex-col">
          <div className="flex flex-col gap-6 px-4">
            {supplier && <input type="hidden" name="id" value={supplier.id} />}
            <input type="hidden" name="isActive" value={isActive ? "1" : "0"} />

            <FieldSet>
              <FieldLegend>Основное</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="s-name">Название*</FieldLabel>
                  <Input id="s-name" name="name" defaultValue={supplier?.name} disabled={pending} required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-legal">Юридическое название</FieldLabel>
                  <Input id="s-legal" name="legalName" defaultValue={supplier?.legalName} disabled={pending} />
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="s-active"
                    checked={isActive}
                    onCheckedChange={(checked) => setIsActive(checked === true)}
                    disabled={pending}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="s-active">Активен</FieldLabel>
                    <FieldDescription>Доступен для выбора в акте пополнения.</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Контакты</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="s-contact">Контактное лицо</FieldLabel>
                  <Input id="s-contact" name="contactName" defaultValue={supplier?.contactName} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-phone">Телефон</FieldLabel>
                  <Input
                    id="s-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="+7 (___) ___-__-__"
                    defaultValue={supplier?.phone}
                    disabled={pending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-contact2">Доп. контакт</FieldLabel>
                  <Input id="s-contact2" name="contactName2" defaultValue={supplier?.contactName2} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-phone2">Доп. телефон</FieldLabel>
                  <Input id="s-phone2" name="phone2" type="tel" inputMode="tel" defaultValue={supplier?.phone2} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-email">Email</FieldLabel>
                  <Input id="s-email" name="email" type="email" inputMode="email" defaultValue={supplier?.email} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-responsible">Ответственный (наш закупщик)</FieldLabel>
                  <Input id="s-responsible" name="responsibleName" defaultValue={supplier?.responsibleName} disabled={pending} />
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Реквизиты</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="s-inn">ИНН</FieldLabel>
                  <Input id="s-inn" name="inn" inputMode="numeric" placeholder="10 или 12 цифр" defaultValue={supplier?.inn} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-kpp">КПП</FieldLabel>
                  <Input id="s-kpp" name="kpp" inputMode="numeric" placeholder="9 цифр" defaultValue={supplier?.kpp} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-ogrn">ОГРН / ОГРНИП</FieldLabel>
                  <Input id="s-ogrn" name="ogrn" inputMode="numeric" placeholder="13 или 15 цифр" defaultValue={supplier?.ogrn} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-address">Адрес</FieldLabel>
                  <Textarea id="s-address" name="address" defaultValue={supplier?.address} disabled={pending} />
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Банк</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="s-bank">Банк</FieldLabel>
                  <Input id="s-bank" name="bankName" defaultValue={supplier?.bankName} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-acc">Расчётный счёт</FieldLabel>
                  <Input id="s-acc" name="bankAccount" inputMode="numeric" defaultValue={supplier?.bankAccount} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-bik">БИК</FieldLabel>
                  <Input id="s-bik" name="bik" inputMode="numeric" defaultValue={supplier?.bik} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-corr">Корр. счёт</FieldLabel>
                  <Input id="s-corr" name="corrAccount" inputMode="numeric" defaultValue={supplier?.corrAccount} disabled={pending} />
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Оплата</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="s-terms">Условия оплаты</FieldLabel>
                  <Textarea id="s-terms" name="paymentTerms" placeholder="напр. предоплата 50%" defaultValue={supplier?.paymentTerms} disabled={pending} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-delay">Отсрочка платежа, дней</FieldLabel>
                  <Input
                    id="s-delay"
                    name="paymentDelayDays"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    defaultValue={supplier?.paymentDelayDays ?? ""}
                    disabled={pending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s-comment">Комментарий</FieldLabel>
                  <Textarea id="s-comment" name="comment" defaultValue={supplier?.comment} disabled={pending} />
                </Field>
              </FieldGroup>
            </FieldSet>
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
