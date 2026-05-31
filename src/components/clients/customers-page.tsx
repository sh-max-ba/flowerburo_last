"use client"

import type React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, ExternalLinkIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { createCustomerAction } from "@/app/actions"
import type { Customer } from "@/lib/crm"
import { sourceLabel, sourceOptions } from "@/lib/labels"
import { Button } from "@/components/ui/button"
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
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
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

type ActionResult = Awaited<ReturnType<typeof createCustomerAction>>

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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <form action="/clients" className="relative max-w-xl flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input name="search" defaultValue={search} placeholder="Поиск по имени или телефону" className="h-10 pl-9" />
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{customers.length} в списке</Badge>
          <Button className="h-10 bg-zinc-950 text-white hover:bg-zinc-800" onClick={() => setDialogOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Новый клиент
          </Button>
        </div>
      </div>

      <Card className="rounded-2xl border-zinc-200 bg-white">
        <CardContent>
          {customers.length ? (
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Имя</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Скидка</TableHead>
                    <TableHead>Активность</TableHead>
                    <TableHead>Источник</TableHead>
                    <TableHead>Комментарий</TableHead>
                    <TableHead>Создан</TableHead>
                    <TableHead className="text-right">Действие</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium text-zinc-950">{customer.name}</TableCell>
                      <TableCell>
                        {customer.phone ? (
                          customer.phone
                        ) : (
                          <Badge className="border-amber-300 bg-amber-100 text-amber-900">
                            <AlertTriangleIcon />
                            Нет телефона
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">{customer.defaultDiscountPercent}%</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary">{customer.dealsCount ?? 0} сделок</Badge>
                          <Badge variant="outline">{customer.ordersCount ?? 0} заказов</Badge>
                          <Badge variant="outline">{customer.salesCount ?? 0} продаж</Badge>
                        </div>
                      </TableCell>
                      <TableCell>{sourceLabel(customer.source)}</TableCell>
                      <TableCell className="max-w-72 truncate">{customer.comment || "-"}</TableCell>
                      <TableCell>{formatDate(customer.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" render={<Link href={`/clients/${customer.id}`} />}>
                          <ExternalLinkIcon data-icon="inline-start" />
                          Открыть
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="min-h-56">
              <EmptyHeader>
                <EmptyTitle>Клиенты не найдены</EmptyTitle>
                <EmptyDescription>Создайте клиента или измените поисковый запрос.</EmptyDescription>
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
              <Button type="submit" disabled={pending} className="bg-zinc-950 text-white hover:bg-zinc-800">
                Создать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
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
            <Input id="phone" name="phone" defaultValue={customer?.phone ?? ""} />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="instagram">Instagram</FieldLabel>
          <FieldContent>
            <Input id="instagram" name="instagram" defaultValue={customer?.instagram ?? ""} />
          </FieldContent>
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="source">Источник</FieldLabel>
          <FieldContent>
            <Select name="source" defaultValue={sourceValue}>
              <SelectTrigger id="source" className="w-full">
                <SelectValue placeholder="Источник" />
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

function formatDate(value: string) {
  if (!value) {
    return "-"
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value))
}
