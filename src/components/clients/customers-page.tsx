"use client"

import type React from "react"
import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpDownIcon,
  ExternalLinkIcon,
  AtSignIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { createCustomerAction } from "@/app/actions"
import type { Customer } from "@/lib/crm"
import { sourceLabel, sourceOptions } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type ActionResult = Awaited<ReturnType<typeof createCustomerAction>>

const LIST_LIMIT = 200
const NO_SOURCE = "__all__"

type SortKey = "recent" | "name" | "activity" | "discount"

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "recent", label: "Сначала новые" },
  { value: "name", label: "По имени" },
  { value: "activity", label: "По активности" },
  { value: "discount", label: "По скидке" },
]

export function CustomersPage({
  customers,
  search,
}: {
  customers: Customer[]
  search: string
}) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Search is server-driven (the page reads ?search=). We mirror it locally for the
  // debounced auto-submit + clear affordance.
  const [searchInput, setSearchInput] = useState(search)
  const [searchPending, startSearchTransition] = useTransition()

  // Filter/sort run fully client-side over the already-fetched rows.
  const [sourceFilter, setSourceFilter] = useState<string>(NO_SOURCE)
  const [sortKey, setSortKey] = useState<SortKey>("recent")

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

  const visibleCustomers = useMemo(() => {
    const filtered =
      sourceFilter === NO_SOURCE
        ? customers
        : customers.filter((customer) => customer.source === sourceFilter)

    const sorted = [...filtered]
    switch (sortKey) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name, "ru"))
        break
      case "activity":
        sorted.sort((a, b) => activityScore(b) - activityScore(a))
        break
      case "discount":
        sorted.sort((a, b) => b.defaultDiscountPercent - a.defaultDiscountPercent)
        break
      case "recent":
      default:
        // Already created_at DESC from the server.
        break
    }
    return sorted
  }, [customers, sourceFilter, sortKey])

  const isCapped = customers.length >= LIST_LIMIT
  const isFiltered = sourceFilter !== NO_SOURCE
  const countLabel = search
    ? `найдено ${visibleCustomers.length}`
    : isCapped
      ? `показано ${visibleCustomers.length} из ${LIST_LIMIT}+`
      : `${visibleCustomers.length} в списке`

  function clearSearch() {
    setSearchInput("")
    startSearchTransition(() => {
      router.push("/clients")
    })
  }

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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative max-w-md flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Поиск по имени или телефону"
              className="h-10 pl-9 pr-9"
              aria-label="Поиск клиентов"
            />
            {searchInput ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={clearSearch}
                className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
              >
                <XIcon className="size-4" />
                <span className="sr-only">Очистить поиск</span>
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value ?? NO_SOURCE)}>
              <SelectTrigger className="h-10 w-[150px]" aria-label="Фильтр по источнику">
                <SelectValue placeholder="Источник">{(value) => (value === NO_SOURCE ? "Все источники" : sourceLabel(String(value ?? "")))}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  <SelectItem value={NO_SOURCE}>Все источники</SelectItem>
                  {sourceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(value) => setSortKey((value ?? "recent") as SortKey)}>
              <SelectTrigger className="h-10 w-[160px]" aria-label="Сортировка">
                <SelectValue placeholder="Сортировка">{(value) => sortOptions.find((o) => o.value === value)?.label ?? "Сортировка"}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={searchPending ? "secondary" : "outline"}>
            {searchPending ? "Поиск…" : countLabel}
          </Badge>
          <Button className="h-10" onClick={() => setDialogOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Новый клиент
          </Button>
        </div>
      </div>

      {isCapped && !search ? (
        <p className="text-xs text-muted-foreground">
          Показаны первые {LIST_LIMIT} клиентов. Чтобы найти остальных, уточните поиск по имени или телефону.
        </p>
      ) : null}

      <Card className="rounded-2xl border-zinc-200 bg-white">
        <CardContent className="px-2 py-1 sm:px-4 sm:py-2">
          {visibleCustomers.length ? (
            <>
              {/* Desktop / tablet wide: table */}
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <SortableHead label="Имя" active={sortKey === "name"} onClick={() => setSortKey("name")} />
                      <TableHead>Телефон</TableHead>
                      <SortableHead
                        label="Скидка"
                        active={sortKey === "discount"}
                        onClick={() => setSortKey("discount")}
                      />
                      <SortableHead
                        label="Активность"
                        active={sortKey === "activity"}
                        onClick={() => setSortKey("activity")}
                      />
                      <TableHead>Источник</TableHead>
                      <SortableHead
                        label="Создан"
                        active={sortKey === "recent"}
                        onClick={() => setSortKey("recent")}
                      />
                      <TableHead className="text-right">Связь</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleCustomers.map((customer) => (
                      <CustomerRow key={customer.id} customer={customer} router={router} />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Narrow: card list */}
              <div className="flex flex-col divide-y divide-zinc-200 md:hidden">
                {visibleCustomers.map((customer) => (
                  <CustomerCardRow key={customer.id} customer={customer} />
                ))}
              </div>
            </>
          ) : (
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
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={submitCustomer}>
            <DialogHeader>
              <DialogTitle>Новый клиент</DialogTitle>
            </DialogHeader>
            <CustomerFields />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
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

function CustomerRow({
  customer,
  router,
}: {
  customer: Customer
  router: ReturnType<typeof useRouter>
}) {
  const href = `/clients/${customer.id}`
  const telHref = telLink(customer.phone)
  const igHref = instagramLink(customer.instagram)

  function navigate() {
    router.push(href)
  }

  return (
    <TableRow
      className="cursor-pointer"
      role="link"
      tabIndex={0}
      onClick={navigate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          navigate()
        }
      }}
    >
      <TableCell className="font-medium text-zinc-950">
        <Link
          href={href}
          className="hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {customer.name}
        </Link>
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        {customer.phone ? (
          telHref ? (
            <a href={telHref} className="font-medium text-zinc-950 hover:underline">
              {customer.phone}
            </a>
          ) : (
            customer.phone
          )
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            <AlertTriangleIcon />
            Нет телефона
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {customer.defaultDiscountPercent > 0 ? (
          <Badge variant="secondary">{customer.defaultDiscountPercent}%</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{pluralize(customer.dealsCount ?? 0, dealForms)}</Badge>
          <Badge variant="outline">{pluralize(customer.ordersCount ?? 0, orderForms)}</Badge>
          <Badge variant="outline">{pluralize(customer.salesCount ?? 0, saleForms)}</Badge>
        </div>
      </TableCell>
      <TableCell>{sourceLabel(customer.source)}</TableCell>
      <TableCell>{dateShort(customer.createdAt)}</TableCell>
      <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
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
                  className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-8")}
                  onClick={(event) => event.stopPropagation()}
                />
              }
            >
              <ExternalLinkIcon className="size-4" />
              <span className="sr-only">Открыть карточку</span>
            </TooltipTrigger>
            <TooltipContent>Открыть карточку</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  )
}

function CustomerCardRow({ customer }: { customer: Customer }) {
  const href = `/clients/${customer.id}`
  const telHref = telLink(customer.phone)

  return (
    <div className="flex items-start justify-between gap-3 p-4">
      <Link href={href} className="min-w-0 flex-1">
        <div className="truncate font-medium text-zinc-950">{customer.name}</div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          {customer.phone || "Телефон не указан"}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {customer.defaultDiscountPercent > 0 ? (
            <Badge variant="secondary">{customer.defaultDiscountPercent}%</Badge>
          ) : null}
          <Badge variant="outline">{pluralize(customer.dealsCount ?? 0, dealForms)}</Badge>
          <Badge variant="outline">{pluralize(customer.ordersCount ?? 0, orderForms)}</Badge>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {telHref ? (
          <IconLink href={telHref} label="Позвонить">
            <PhoneIcon className="size-4" />
          </IconLink>
        ) : null}
        <Button variant="outline" size="icon" className="size-9" render={<Link href={href} />}>
          <ExternalLinkIcon className="size-4" />
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
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-8")}
            onClick={(event) => event.stopPropagation()}
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

function SortableHead({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <TableHead>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-zinc-950",
          active ? "font-semibold text-zinc-950" : "text-muted-foreground"
        )}
      >
        {label}
        {active ? <ArrowDownIcon className="size-3.5" /> : <ArrowUpDownIcon className="size-3.5 opacity-50" />}
      </button>
    </TableHead>
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
