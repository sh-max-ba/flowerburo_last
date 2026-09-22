"use client"

import type React from "react"
import { useTransition } from "react"
import { toast } from "sonner"
import { createCashCustomerAction } from "@/app/actions"
import type { CustomerOption } from "@/lib/db"
import { sourceLabel, sourceOptions } from "@/lib/labels"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

// Быстрое создание клиента из кассы/заказа/чата: после сохранения клиент сразу выбирается в форме.

type CustomerCreateResult = Awaited<ReturnType<typeof createCashCustomerAction>>

// Номера в Кыргызстане начинаются с +996 — поля номера предзаполняем этим префиксом.
export const PHONE_PREFIX = "+996 "

// Если в поле остался только префикс (номер не вводили) — отправляем пустую строку,
// чтобы не сохранять «+996» как телефон/получателя.
export function phoneForSubmit(value: string) {
  const trimmed = value.trim()
  return trimmed === PHONE_PREFIX.trim() ? "" : trimmed
}

export function upsertCustomerOption(customers: CustomerOption[], customer: CustomerOption) {
  const next = [customer, ...customers.filter((item) => item.id !== customer.id)]
  return next.sort((left, right) => left.name.localeCompare(right.name, "ru"))
}

export function CustomerCreateDialog({
  open,
  pending,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (customer: CustomerOption) => void
}) {
  const [isCreating, startTransition] = useTransition()
  const disabled = pending || isCreating

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    startTransition(async () => {
      const result: CustomerCreateResult = await createCashCustomerAction(formData)
      if (result.ok) {
        toast.success(result.message)
        onCreated(result.data)
        form.reset()
        onOpenChange(false)
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Новый клиент</DialogTitle>
            <DialogDescription>Клиент будет сразу выбран в текущей продаже или заказе.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="cash-customer-name">Имя</FieldLabel>
              <Input id="cash-customer-name" name="name" disabled={disabled} required />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="cash-customer-phone">Телефон</FieldLabel>
                <Input id="cash-customer-phone" name="phone" inputMode="tel" defaultValue={PHONE_PREFIX} disabled={disabled} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cash-customer-instagram">Instagram</FieldLabel>
                <Input id="cash-customer-instagram" name="instagram" disabled={disabled} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="cash-customer-source">Источник</FieldLabel>
                <Select name="source" defaultValue="manual">
                  <SelectTrigger id="cash-customer-source" className="w-full" disabled={disabled}>
                    <SelectValue placeholder="Источник">{(value) => sourceLabel(String(value ?? "manual"))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      {sourceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="cash-customer-discount">Скидка клиента, %</FieldLabel>
                <Input
                  id="cash-customer-discount"
                  name="defaultDiscountPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue="0"
                  disabled={disabled}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="cash-customer-comment">Комментарий</FieldLabel>
              <Textarea id="cash-customer-comment" name="comment" disabled={disabled} rows={3} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={disabled}>
              Создать клиента
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
