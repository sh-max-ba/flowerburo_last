"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRightIcon, PencilIcon, PlusIcon, RotateCcwIcon, UserCheckIcon, UserXIcon } from "lucide-react"
import { toast } from "sonner"
import { saveSupplierAction, setSupplierActiveAction } from "@/app/actions"
import type { Supplier } from "@/lib/db"
import { cn } from "@/lib/utils"
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
import { Button, buttonVariants } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
import { DataView, type DataViewColumn } from "@/components/data-view"
import { ScreenBody } from "@/components/screen-body"
import { FilterChips, HeaderAction, HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"

type Result = Awaited<ReturnType<typeof saveSupplierAction>>

export function SuppliersClient({ suppliers }: { suppliers: Supplier[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editParam = searchParams.get("edit")
  const newParam = searchParams.get("new")

  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all")
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(
    editParam ? suppliers.find((supplier) => String(supplier.id) === editParam) ?? null : null
  )
  const [supplierSheet, setSupplierSheet] = useState(Boolean(editParam) || newParam === "1")
  const [activeToggleSupplier, setActiveToggleSupplier] = useState<Supplier | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return suppliers.filter((supplier) => {
      if (statusFilter === "active" && !supplier.isActive) return false
      if (statusFilter === "archived" && supplier.isActive) return false
      if (!normalized) return true
      return `${supplier.name} ${supplier.inn} ${supplier.phone} ${supplier.email} ${supplier.legalName} ${supplier.contactName}`
        .toLowerCase()
        .includes(normalized)
    })
  }, [query, statusFilter, suppliers])

  const activeCount = useMemo(() => suppliers.filter((supplier) => supplier.isActive).length, [suppliers])
  const statusChips = [
    { value: "all" as const, label: "Все", count: suppliers.length },
    { value: "active" as const, label: "Активные", count: activeCount },
    { value: "archived" as const, label: "В архиве", count: suppliers.length - activeCount },
  ]
  const hasFilters = query.trim() !== "" || statusFilter !== "all"

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

  const columns: DataViewColumn<Supplier>[] = [
    {
      key: "name",
      header: "Название",
      grow: true,
      sortValue: (supplier) => supplier.name,
      cell: (supplier) => (
        <div className="min-w-0">
          <Link href={`/suppliers/${supplier.id}`} className="block truncate font-medium hover:underline">
            {supplier.name}
          </Link>
          {supplier.legalName && <div className="truncate text-xs text-muted-foreground">{supplier.legalName}</div>}
        </div>
      ),
    },
    {
      key: "inn",
      header: "ИНН",
      secondary: true,
      className: "tabular-nums",
      sortValue: (supplier) => supplier.inn,
      cell: (supplier) => supplier.inn || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "contacts",
      header: "Контакты",
      className: "tabular-nums",
      cell: (supplier) => (
        <div className="min-w-0">
          <div className="truncate text-sm">{supplier.phone || supplier.email || "—"}</div>
          {supplier.contactName && <div className="truncate text-xs text-muted-foreground">{supplier.contactName}</div>}
        </div>
      ),
    },
    {
      key: "terms",
      header: "Условия оплаты",
      secondary: true,
      cell: (supplier) => (
        <span className="text-muted-foreground">
          {supplier.paymentTerms || (supplier.paymentDelayDays != null ? `Отсрочка ${supplier.paymentDelayDays} дн.` : "—")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Статус",
      className: "w-28",
      sortValue: (supplier) => (supplier.isActive ? 0 : 1),
      cell: (supplier) => (
        <span className={supplier.isActive ? "text-foreground" : "text-muted-foreground"}>
          {supplier.isActive ? "Активен" : "В архиве"}
        </span>
      ),
    },
  ]

  function rowActions(supplier: Supplier) {
    return (
      <>
        <Button variant="ghost" size="icon-lg" className="size-9 text-muted-foreground" onClick={() => openEdit(supplier)} disabled={isPending} aria-label="Редактировать" title="Редактировать">
          <PencilIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-9 text-muted-foreground"
          onClick={() => setActiveToggleSupplier(supplier)}
          disabled={isPending}
          aria-label={supplier.isActive ? "В архив" : "Вернуть из архива"}
          title={supplier.isActive ? "В архив" : "Вернуть из архива"}
        >
          {supplier.isActive ? <UserXIcon className="size-4" /> : <UserCheckIcon className="size-4" />}
        </Button>
        <Link
          href={`/suppliers/${supplier.id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "size-9 text-muted-foreground")}
          aria-label="Открыть"
          title="Открыть"
        >
          <ChevronRightIcon className="size-4" />
        </Link>
      </>
    )
  }

  return (
    <>
      <ScreenHeader
        title="Поставщики"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Поиск по названию, ИНН, телефону, почте",
          inputProps: { "aria-label": "Поиск поставщиков" },
        }}
        actions={
          hasFilters ? (
            <HeaderAction
              icon={RotateCcwIcon}
              label="Сброс"
              onClick={() => {
                setQuery("")
                setStatusFilter("all")
              }}
            />
          ) : undefined
        }
        primaryAction={<HeaderPrimaryAction icon={PlusIcon} label="Добавить поставщика" onClick={openCreate} disabled={isPending} />}
      />

      <FilterChips className="shrink-0" label="Статус" value={statusFilter} options={statusChips} onValueChange={setStatusFilter} />

      <ScreenBody>
        <DataView
          rows={filtered}
          columns={columns}
          getRowKey={(supplier) => supplier.id}
          onRowSelect={(supplier) => router.push(`/suppliers/${supplier.id}`)}
          rowActions={rowActions}
          renderCard={(supplier) => (
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <Link href={`/suppliers/${supplier.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium">{supplier.name}</div>
                <div className="mt-0.5 truncate text-sm text-muted-foreground tabular-nums">
                  {supplier.phone || supplier.email || "—"}
                  {supplier.inn ? ` · ИНН ${supplier.inn}` : ""}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{supplier.isActive ? "Активен" : "В архиве"}</div>
              </Link>
              <div className="flex shrink-0 items-center gap-1">{rowActions(supplier)}</div>
            </div>
          )}
          empty={
            <Empty className="min-h-56">
              <EmptyHeader>
                <EmptyTitle>{hasFilters ? "Ничего не найдено" : "Поставщиков нет"}</EmptyTitle>
                <EmptyDescription>
                  {hasFilters ? "Измените запрос или фильтр." : "Добавьте поставщика для актов пополнения склада."}
                </EmptyDescription>
              </EmptyHeader>
              {!hasFilters && (
                <EmptyContent>
                  <Button onClick={openCreate}>
                    <PlusIcon data-icon="inline-start" />
                    Добавить поставщика
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          }
        />
      </ScreenBody>

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
