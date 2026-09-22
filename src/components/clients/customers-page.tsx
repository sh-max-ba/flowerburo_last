"use client"

import type React from "react"
import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import {
  AtSignIcon,
  ChevronRightIcon,
  FunnelIcon,
  PhoneIcon,
  PlusIcon,
} from "lucide-react"
import { toast } from "sonner"
import { createCustomerAction } from "@/app/actions"
import { useUrlFlagDialog } from "@/hooks/use-url-flag"
import type { Customer } from "@/lib/crm"
import { sourceLabel, sourceOptions } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { DataView, type DataViewColumn } from "@/components/data-view"
import { ScreenBody } from "@/components/screen-body"
import { HeaderFilter, HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type ActionResult = Awaited<ReturnType<typeof createCustomerAction>>

const LIST_LIMIT = 200
const NO_SOURCE = "__all__"

const sourceFilterOptions = [
  { value: NO_SOURCE, label: "Все источники" },
  ...sourceOptions.map((option) => ({ value: option.value, label: option.label })),
]

export function CustomersPage({
  customers,
  search,
}: {
  customers: Customer[]
  search: string
}) {
  const router = useRouter()
  // Диалог открывается кнопкой в шапке и ссылкой /clients?new=1 («+» на строке меню).
  const [dialogOpen, setDialogOpen] = useUrlFlagDialog("new")
  const [pending, startTransition] = useTransition()

  // Search is server-driven (the page reads ?search=). We mirror it locally for the
  // debounced auto-submit + clear affordance.
  const [searchInput, setSearchInput] = useState(search)
  const [searchPending, startSearchTransition] = useTransition()

  // Фильтр по источнику — клиентский, поверх уже загруженных строк; сортировка — в таблице.
  const [sourceFilter, setSourceFilter] = useState<string>(NO_SOURCE)

  // Keep the input in sync if the server search changes (e.g. browser navigation).
  // Render-time adjustment instead of an effect (avoids a cascading re-render).
  const [lastServerSearch, setLastServerSearch] = useState(search)
  if (lastServerSearch !== search) {
    setLastServerSearch(search)
    setSearchInput(search)
  }

  // Debounced auto-submit: push ?search= once the user pauses typing.
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === search.trim()) {
      return
    }
    const handle = setTimeout(() => {
      startSearchTransition(() => {
        router.push(trimmed ? `/clients?search=${encodeURIComponent(trimmed)}` : "/clients")
      })
    }, 300)
    return () => clearTimeout(handle)
  }, [searchInput, search, router])

  const visibleCustomers = useMemo(
    () =>
      sourceFilter === NO_SOURCE
        ? customers
        : customers.filter((customer) => customer.source === sourceFilter),
    [customers, sourceFilter]
  )

  const isCapped = customers.length >= LIST_LIMIT
  const isFiltered = sourceFilter !== NO_SOURCE
  const countLabel = search
    ? `найдено ${visibleCustomers.length}`
    : isCapped
      ? `показано ${visibleCustomers.length} из ${LIST_LIMIT}+`
      : `${visibleCustomers.length} в списке`

  function submitCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    run(() => createCustomerAction(formData), () => setDialogOpen(false))
  }

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(result.message)
        after?.()
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <>
      <ScreenHeader
        title="Клиенты"
        search={{
          value: searchInput,
          onChange: setSearchInput,
          placeholder: "Поиск по имени или телефону",
          pending: searchPending,
          inputProps: { "aria-label": "Поиск клиентов" },
        }}
        meta={countLabel}
        actions={
          <HeaderFilter
            icon={FunnelIcon}
            label="Источник"
            value={sourceFilter}
            allValue={NO_SOURCE}
            options={sourceFilterOptions}
            onValueChange={setSourceFilter}
          />
        }
        primaryAction={
          <HeaderPrimaryAction icon={PlusIcon} label="Новый клиент" onClick={() => setDialogOpen(true)} />
        }
        tabs={null}
      />

      <ScreenBody>
        <DataView
          rows={visibleCustomers}
          columns={customerColumns}
          getRowKey={(customer) => customer.id}
          onRowSelect={(customer) => router.push(`/clients/${customer.id}`)}
          rowActions={(customer) => <CustomerRowActions customer={customer} />}
          renderCard={(customer) => <CustomerCardRow customer={customer} />}
          empty={
            <Empty className="min-h-56">
              <EmptyHeader>
                <EmptyTitle>Клиенты не найдены</EmptyTitle>
                <EmptyDescription>
                  {search || isFiltered
                    ? "Измените поисковый запрос или фильтр."
                    : "Создайте первого клиента, чтобы он появился здесь."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
        {isCapped && !search ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Показаны первые {LIST_LIMIT} клиентов. Чтобы найти остальных, уточните поиск по имени или телефону.
          </p>
        ) : null}
      </ScreenBody>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={submitCustomer}>
            <DialogHeader>
              <DialogTitle>Новый клиент</DialogTitle>
            </DialogHeader>
            <CustomerFields />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={pending}>
                Создать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Колонки таблицы: сортировка кликом по заголовку; телефон/дата/скидка — tabular-nums;
// источник и дата — второстепенные (скрыты до lg). Счётчики активности — обычный текст,
// нули приглушены; бейджи не используем — цвет здесь ничего не значит.
const customerColumns: DataViewColumn<Customer>[] = [
  {
    key: "name",
    header: "Имя",
    grow: true,
    sortValue: (customer) => customer.name,
    cell: (customer) => (
      <Link
        href={`/clients/${customer.id}`}
        className="block truncate font-medium text-foreground hover:underline"
      >
        {customer.name}
      </Link>
    ),
  },
  {
    key: "phone",
    header: "Телефон",
    className: "tabular-nums",
    cell: (customer) => {
      const telHref = telLink(customer.phone)
      if (!customer.phone) {
        return <span className="text-muted-foreground">—</span>
      }
      return telHref ? (
        <a href={telHref} className="text-foreground hover:underline">
          {customer.phone}
        </a>
      ) : (
        customer.phone
      )
    },
  },
  {
    key: "discount",
    header: "Скидка",
    align: "right",
    className: "w-24 tabular-nums",
    sortValue: (customer) => customer.defaultDiscountPercent,
    defaultDirection: "desc",
    cell: (customer) => <MutedZero value={customer.defaultDiscountPercent} suffix="%" />,
  },
  {
    key: "activity",
    header: "Активность",
    hideBelow: "3xl",
    className: "tabular-nums",
    sortValue: activityScore,
    defaultDirection: "desc",
    cell: (customer) => <ActivityCell customer={customer} />,
  },
  {
    key: "source",
    header: "Источник",
    secondary: true,
    sortValue: (customer) => sourceLabel(customer.source),
    cell: (customer) => <span className="text-muted-foreground">{sourceLabel(customer.source)}</span>,
  },
  {
    key: "created",
    header: "Создан",
    secondary: true,
    className: "w-28 tabular-nums",
    sortValue: (customer) => customer.createdAt,
    defaultDirection: "desc",
    cell: (customer) => <span className="text-muted-foreground">{dateShort(customer.createdAt)}</span>,
  },
]

function MutedZero({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (!value) {
    return <span className="text-muted-foreground/60">0{suffix}</span>
  }
  return (
    <span>
      {value}
      {suffix}
    </span>
  )
}

// «2 сделки · 0 заказов · 1 продажа» одной строкой: нули приглушены, без бейджей.
function ActivityCell({ customer }: { customer: Customer }) {
  const parts: Array<[number, PluralForms]> = [
    [customer.dealsCount ?? 0, dealForms],
    [customer.ordersCount ?? 0, orderForms],
    [customer.salesCount ?? 0, saleForms],
  ]
  return (
    <span className="inline-flex gap-x-1.5 whitespace-nowrap">
      {parts.map(([count, forms], index) => (
        <span key={forms[0]} className={cn(count === 0 ? "text-muted-foreground/60" : "text-foreground")}>
          {pluralize(count, forms)}
          {index < parts.length - 1 ? <span className="text-muted-foreground/40"> ·</span> : null}
        </span>
      ))}
    </span>
  )
}

// Действия строки видны всегда: позвонить, Instagram, открыть карточку.
function CustomerRowActions({ customer }: { customer: Customer }) {
  const href = `/clients/${customer.id}`
  const telHref = telLink(customer.phone)
  const igHref = instagramLink(customer.instagram)

  return (
    <>
      {telHref ? (
        <IconLink href={telHref} label="Позвонить">
          <PhoneIcon className="size-4" />
        </IconLink>
      ) : null}
      {igHref ? (
        <IconLink href={igHref} label="Открыть Instagram" external>
          <AtSignIcon className="size-4" />
        </IconLink>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={href}
              className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "size-9 text-muted-foreground")}
            />
          }
        >
          <ChevronRightIcon className="size-4" />
          <span className="sr-only">Открыть карточку</span>
        </TooltipTrigger>
        <TooltipContent>Открыть карточку</TooltipContent>
      </Tooltip>
    </>
  )
}

// Карточка строки до md: имя, телефон, активность; действия справа.
function CustomerCardRow({ customer }: { customer: Customer }) {
  const href = `/clients/${customer.id}`
  const telHref = telLink(customer.phone)

  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <Link href={href} className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{customer.name}</div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground tabular-nums">
          {customer.phone || "Телефон не указан"}
          {customer.defaultDiscountPercent > 0 ? ` · скидка ${customer.defaultDiscountPercent}%` : ""}
        </div>
        <div className="mt-1 text-xs">
          <ActivityCell customer={customer} />
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {telHref ? (
          <IconLink href={telHref} label="Позвонить">
            <PhoneIcon className="size-4" />
          </IconLink>
        ) : null}
        <Button variant="ghost" size="icon" className="text-muted-foreground" render={<Link href={href} />}>
          <ChevronRightIcon className="size-4" />
          <span className="sr-only">Открыть карточку</span>
        </Button>
      </div>
    </div>
  )
}

function IconLink({
  href,
  label,
  external,
  children,
}: {
  href: string
  label: string
  external?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "size-9 text-muted-foreground")}
          />
        }
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function CustomerFields({ customer }: { customer?: Customer }) {
  const sourceValue = customer?.source ?? ""
  const hasCustomSource = Boolean(sourceValue) && !sourceOptions.some((option) => option.value === sourceValue)

  return (
    <div className="grid gap-4 py-4">
      <Field>
        <FieldLabel htmlFor="name">Имя</FieldLabel>
        <FieldContent>
          <Input id="name" name="name" defaultValue={customer?.name ?? ""} required />
        </FieldContent>
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="phone">Телефон</FieldLabel>
          <FieldContent>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              placeholder="+7 999 123-45-67"
              defaultValue={customer?.phone ?? ""}
            />
            <FieldDescription>Любой формат — номер нормализуется автоматически.</FieldDescription>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="instagram">Instagram</FieldLabel>
          <FieldContent>
            <Input id="instagram" name="instagram" placeholder="@username" defaultValue={customer?.instagram ?? ""} />
          </FieldContent>
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="source">Источник</FieldLabel>
          <FieldContent>
            <Select name="source" defaultValue={sourceValue}>
              <SelectTrigger id="source" className="w-full">
                <SelectValue placeholder="Источник">{(value) => (value ? sourceLabel(String(value)) : "Не указан")}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  <SelectItem value="">Не указан</SelectItem>
                  {sourceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                  {hasCustomSource && (
                    <SelectItem value={sourceValue}>{sourceLabel(sourceValue)}</SelectItem>
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="defaultDiscountPercent">Скидка клиента, %</FieldLabel>
          <FieldContent>
            <Input
              id="defaultDiscountPercent"
              name="defaultDiscountPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue={customer?.defaultDiscountPercent ?? 0}
            />
            <FieldDescription>Допустимо 0–100%.</FieldDescription>
          </FieldContent>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="comment">Комментарий</FieldLabel>
        <FieldContent>
          <Textarea id="comment" name="comment" defaultValue={customer?.comment ?? ""} rows={3} />
        </FieldContent>
      </Field>
    </div>
  )
}

function activityScore(customer: Customer) {
  return (customer.dealsCount ?? 0) + (customer.ordersCount ?? 0) + (customer.salesCount ?? 0)
}

// --- Shared contact/format helpers (also re-used by the detail card) ---

export function telLink(phone: string | null | undefined) {
  if (!phone) {
    return null
  }
  const digits = phone.replace(/[^\d+]/g, "")
  return digits ? `tel:${digits}` : null
}

export function instagramLink(instagram: string | null | undefined) {
  const value = (instagram ?? "").trim()
  if (!value) {
    return null
  }
  if (/^https?:\/\//i.test(value)) {
    return value
  }
  return `https://instagram.com/${value.replace(/^@/, "")}`
}

type PluralForms = [one: string, few: string, many: string]

const dealForms: PluralForms = ["сделка", "сделки", "сделок"]
const orderForms: PluralForms = ["заказ", "заказа", "заказов"]
const saleForms: PluralForms = ["продажа", "продажи", "продаж"]

export function pluralize(count: number, [one, few, many]: PluralForms) {
  const mod10 = count % 10
  const mod100 = count % 100
  let word = many
  if (mod10 === 1 && mod100 !== 11) {
    word = one
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    word = few
  }
  return `${count} ${word}`
}

export function dateShort(value: string) {
  if (!value) {
    return "—"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

export function dateTime(value: string) {
  if (!value) {
    return "—"
  }
  const date = parseDbInstant(value)
  if (!date) {
    return value
  }
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SHOP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
