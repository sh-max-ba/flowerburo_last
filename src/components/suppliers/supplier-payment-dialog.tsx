"use client"

import { useMemo, useState, useTransition } from "react"
import type React from "react"
import { useRouter } from "next/navigation"
import { BanknoteIcon } from "lucide-react"
import { toast } from "sonner"
import { recordSupplierPaymentAction } from "@/app/actions"
import type { PaymentMethod, SupplierDebtDocument } from "@/lib/db"
import { toDatetimeLocalValue } from "@/lib/datetime"
import { paymentMethodOptions } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { formatInstantDate } from "@/components/analytics/format"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Textarea } from "@/components/ui/textarea"

export type SupplierPaymentTarget = {
  supplierId: number
  supplierName: string
  // Проведённые приходы с долгом, от старого к новому (порядок погашения).
  debtDocuments: SupplierDebtDocument[]
  // Открыта ли смена — можно ли изъять наличные из кассы.
  hasOpenShift: boolean
}

type SupplierPaymentDialogProps = SupplierPaymentTarget & {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Погасить только этот акт (кнопка на странице акта).
  documentId?: number | null
}

const ALL_DOCS = "all"

function round2(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Погашение долга поставщику: сумма, способ, дата, комментарий; по умолчанию сумма разносится по
 * актам с долгом от старого к новому (предпросмотр ниже), либо гасится один выбранный акт.
 * Наличные можно изъять из кассы открытой смены (проводка cash_out).
 */
export function SupplierPaymentDialog({
  supplierId,
  supplierName,
  debtDocuments,
  hasOpenShift,
  open,
  onOpenChange,
  documentId = null,
}: SupplierPaymentDialogProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<string>(documentId ? String(documentId) : ALL_DOCS)
  const targetDocuments = useMemo(
    () => (target === ALL_DOCS ? debtDocuments : debtDocuments.filter((document) => String(document.id) === target)),
    [debtDocuments, target]
  )
  const targetDebt = round2(targetDocuments.reduce((sum, document) => sum + document.debt, 0))
  const [amount, setAmount] = useState<string>(targetDebt > 0 ? String(targetDebt) : "")
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const [fromCash, setFromCash] = useState(false)
  const [paidAt, setPaidAt] = useState(() => toDatetimeLocalValue())
  const [comment, setComment] = useState("")

  const amountValue = Number(String(amount).replace(",", "."))
  const amountValid = Number.isFinite(amountValue) && amountValue > 0
  const overDebt = amountValid && amountValue > targetDebt + 0.005

  // Предпросмотр разнесения: FIFO по актам с долгом.
  const allocations = useMemo(() => {
    if (!amountValid) return []
    let remaining = amountValue
    const result: Array<{ document: SupplierDebtDocument; amount: number }> = []
    for (const document of targetDocuments) {
      if (remaining <= 0.005) break
      const share = round2(Math.min(document.debt, remaining))
      result.push({ document, amount: share })
      remaining = round2(remaining - share)
    }
    return result
  }, [amountValid, amountValue, targetDocuments])

  function changeTarget(next: string) {
    setTarget(next)
    const documents = next === ALL_DOCS ? debtDocuments : debtDocuments.filter((document) => String(document.id) === next)
    const debt = round2(documents.reduce((sum, document) => sum + document.debt, 0))
    setAmount(debt > 0 ? String(debt) : "")
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!amountValid || overDebt) return
    const formData = new FormData()
    formData.set("supplierId", String(supplierId))
    formData.set("amount", String(amountValue))
    formData.set("paymentMethod", method)
    formData.set("paidAt", paidAt)
    formData.set("comment", comment)
    if (target !== ALL_DOCS) formData.set("documentId", target)
    if (fromCash && method === "cash" && hasOpenShift) formData.set("fromCash", "1")
    startTransition(async () => {
      const result = await recordSupplierPaymentAction(formData)
      if (result.ok) {
        for (const message of result.messages ?? [result.message]) toast.success(message)
        onOpenChange(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Оплата поставщику</DialogTitle>
            <DialogDescription>
              {supplierName} · долг {formatMoney(round2(debtDocuments.reduce((sum, document) => sum + document.debt, 0)))}
              {" по "}
              {debtDocuments.length} {plural(debtDocuments.length, ["акту", "актам", "актам"])}
            </DialogDescription>
          </DialogHeader>

          {debtDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Долга перед поставщиком нет — все проведённые приходы оплачены.</p>
          ) : (
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="supplier-payment-amount">Сумма, сом</FieldLabel>
                  <Input
                    id="supplier-payment-amount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={pending}
                    autoFocus
                    aria-invalid={overDebt || undefined}
                    className="text-base tabular-nums sm:text-sm"
                  />
                  {overDebt ? (
                    <FieldDescription className="text-destructive">Больше долга ({formatMoney(targetDebt)}) — аванс не учитывается.</FieldDescription>
                  ) : (
                    <FieldDescription>
                      <button type="button" className="underline-offset-4 hover:underline" onClick={() => setAmount(String(targetDebt))}>
                        Погасить всё: {formatMoney(targetDebt)}
                      </button>
                    </FieldDescription>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-payment-method">Способ оплаты</FieldLabel>
                  <Select
                    items={paymentMethodOptions}
                    value={method}
                    onValueChange={(next) => {
                      const value = (next ?? "cash") as PaymentMethod
                      setMethod(value)
                      if (value !== "cash") setFromCash(false)
                    }}
                    disabled={pending}
                  >
                    <SelectTrigger id="supplier-payment-method" className="w-full">
                      <SelectValue>{paymentMethodOptions.find((option) => option.value === method)?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {paymentMethodOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-payment-target">Какие акты</FieldLabel>
                  <Select
                    items={[{ value: ALL_DOCS, label: "Все с долгом, по порядку" }, ...debtDocuments.map((document) => ({ value: String(document.id), label: document.number }))]}
                    value={target}
                    onValueChange={(next) => changeTarget(next ?? ALL_DOCS)}
                    disabled={pending}
                  >
                    <SelectTrigger id="supplier-payment-target" className="w-full">
                      <SelectValue>
                        {target === ALL_DOCS
                          ? "Все с долгом, по порядку"
                          : debtDocuments.find((document) => String(document.id) === target)?.number}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        <SelectItem value={ALL_DOCS}>Все с долгом, по порядку</SelectItem>
                        {debtDocuments.map((document) => (
                          <SelectItem key={document.id} value={String(document.id)}>
                            {document.number} · {formatInstantDate(document.operationAt)} · {formatMoney(document.debt)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-payment-date">Дата оплаты</FieldLabel>
                  <Input
                    id="supplier-payment-date"
                    type="datetime-local"
                    value={paidAt}
                    onChange={(event) => setPaidAt(event.target.value)}
                    disabled={pending}
                    className="tabular-nums"
                  />
                </Field>
              </div>

              {method === "cash" ? (
                <Field orientation="horizontal">
                  <Checkbox
                    id="supplier-payment-from-cash"
                    checked={fromCash}
                    onCheckedChange={(checked) => setFromCash(checked === true)}
                    disabled={pending || !hasOpenShift}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="supplier-payment-from-cash">Изъять наличные из кассы смены</FieldLabel>
                    <FieldDescription>
                      {hasOpenShift
                        ? "В открытой смене появится изъятие «Оплата поставщику» — «ожидается в кассе» уменьшится."
                        : "Смена не открыта — оплата запишется без движения по кассе."}
                    </FieldDescription>
                  </FieldContent>
                </Field>
              ) : null}

              <Field>
                <FieldLabel htmlFor="supplier-payment-comment">Комментарий</FieldLabel>
                <Textarea
                  id="supplier-payment-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Например: перевод на Mbank, чек №…"
                  rows={2}
                  disabled={pending}
                />
              </Field>

              {allocations.length > 0 ? (
                <div className="rounded-xl bg-muted/40 p-3 text-sm">
                  <div className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Будет разнесено по актам</div>
                  <ul className="flex flex-col gap-1">
                    {allocations.map(({ document, amount: share }) => (
                      <li key={document.id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {document.number}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {formatInstantDate(document.operationAt)} · долг {formatMoney(document.debt)}
                          </span>
                        </span>
                        <span className={cn("shrink-0 font-medium tabular-nums", share < document.debt && "text-amber-700")}>
                          {formatMoney(share)}
                          {share < document.debt ? " (частично)" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </FieldGroup>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending || !amountValid || overDebt || debtDocuments.length === 0}>
              <BanknoteIcon data-icon="inline-start" />
              {pending ? "Записываем…" : `Оплатить ${amountValid ? formatMoney(amountValue) : ""}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Кнопка + диалог для серверных страниц (карточка поставщика, акт).
export function SupplierPaymentButton({
  label = "Погасить долг",
  variant = "default",
  size = "default",
  className,
  documentId,
  ...target
}: SupplierPaymentTarget & {
  label?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  className?: string
  documentId?: number | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <BanknoteIcon data-icon="inline-start" />
        {label}
      </Button>
      {open ? (
        <SupplierPaymentDialog {...target} open={open} onOpenChange={setOpen} documentId={documentId ?? null} />
      ) : null}
    </>
  )
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}
