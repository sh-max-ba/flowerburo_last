"use client"

import type React from "react"
import { useState, useTransition } from "react"
import { Loader2Icon, MapPinIcon, PencilIcon, PhoneIcon, PlusIcon, UsersRoundIcon } from "lucide-react"
import { toast } from "sonner"
import { deleteCustomerRecipientAction, saveCustomerRecipientAction } from "@/app/actions"
import {
  RECIPIENT_RELATIONS,
  recipientAddressMax,
  recipientNameMax,
  recipientNoteMax,
  recipientRelationMax,
  type CustomerRecipient,
} from "@/lib/recipients"
import { cn } from "@/lib/utils"
import { FloristMark } from "@/components/florist-mark"
import { PHONE_PREFIX, phoneForSubmit } from "@/components/customers/customer-create-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Блок «Получатели» — кому клиент дарит цветы: в карточке клиента (variant="card") и в панели
// «Контакт» чата (variant="panel"). Нажатие на получателя — правка, «Добавить» — новый.
// В окне заказа получатель выбирается одним нажатием (имя, телефон, адрес подставятся сами).

export function CustomerRecipientsSection({
  customerId,
  recipients,
  onChanged,
  variant = "card",
}: {
  customerId: number
  recipients: CustomerRecipient[]
  onChanged: () => void | Promise<void>
  variant?: "card" | "panel"
}) {
  const [editing, setEditing] = useState<CustomerRecipient | "new" | null>(null)

  return (
    <section data-slot="customer-recipients" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {variant === "panel" ? (
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <UsersRoundIcon className="size-3.5" />
            Получатели
          </h3>
        ) : (
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
            <UsersRoundIcon className="size-4 text-muted-foreground" />
            Получатели
          </h3>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2 text-brand-strong pointer-coarse:h-10"
          onClick={() => setEditing("new")}
        >
          <PlusIcon data-icon="inline-start" />
          Добавить
        </Button>
      </div>

      {recipients.length === 0 ? (
        <p className={cn("text-muted-foreground", variant === "panel" ? "text-sm" : "rounded-xl bg-muted/30 p-3 text-sm")}>
          Кому клиент дарит цветы: жена, мама, коллега. В заказе получатель выберется одним нажатием — с телефоном и адресом.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {recipients.map((recipient) => (
            <li key={recipient.id}>
              <RecipientRow recipient={recipient} variant={variant} onEdit={() => setEditing(recipient)} />
            </li>
          ))}
        </ul>
      )}

      <RecipientDialog
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        customerId={customerId}
        recipient={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          await onChanged()
        }}
      />
    </section>
  )
}

function RecipientRow({
  recipient,
  variant,
  onEdit,
}: {
  recipient: CustomerRecipient
  variant: "card" | "panel"
  onEdit: () => void
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      title="Изменить получателя"
      className={cn(
        "group/recipient flex w-full items-start gap-3 rounded-xl text-left transition-colors hover:bg-muted/60",
        variant === "panel" ? "bg-muted/40 px-2.5 py-2" : "bg-muted/30 px-3 py-2.5"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-medium text-foreground">{recipient.name}</span>
          {recipient.relation ? <span className="text-sm text-muted-foreground">{recipient.relation}</span> : null}
          <FloristMark role={recipient.createdByRole} name={recipient.createdByName} action="Добавил" compact />
        </span>
        {recipient.phone ? (
          <span className="mt-0.5 flex items-center gap-1.5 text-sm text-zinc-600 tabular-nums">
            <PhoneIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {recipient.phone}
          </span>
        ) : null}
        {recipient.address ? (
          <span className="mt-0.5 flex items-start gap-1.5 text-sm break-words text-zinc-600">
            <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {recipient.address}
          </span>
        ) : null}
        {recipient.note ? <span className="mt-0.5 block text-sm break-words text-muted-foreground">{recipient.note}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {recipient.ordersCount ? (
          <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {recipient.ordersCount} {plural(recipient.ordersCount, ["заказ", "заказа", "заказов"])}
          </span>
        ) : null}
        <PencilIcon
          className="mt-1 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/recipient:opacity-100 pointer-coarse:opacity-60"
          aria-hidden
        />
      </span>
    </button>
  )
}

export function RecipientDialog({
  customerId,
  recipient,
  open,
  onOpenChange,
  onSaved,
}: {
  customerId: number
  recipient: CustomerRecipient | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void | Promise<void>
}) {
  const [name, setName] = useState(recipient?.name ?? "")
  const [relation, setRelation] = useState(recipient?.relation ?? "")
  const [phone, setPhone] = useState(recipient?.phone || PHONE_PREFIX)
  const [address, setAddress] = useState(recipient?.address ?? "")
  const [note, setNote] = useState(recipient?.note ?? "")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      toast.error("Укажите имя получателя.")
      return
    }
    startTransition(async () => {
      const result = await saveCustomerRecipientAction(recipient?.id ?? null, {
        customerId,
        name,
        relation,
        phone: phoneForSubmit(phone),
        address,
        note,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      await onSaved()
    })
  }

  function remove() {
    if (!recipient) {
      return
    }
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    startTransition(async () => {
      const result = await deleteCustomerRecipientAction(recipient.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      await onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{recipient ? "Получатель" : "Новый получатель"}</DialogTitle>
            <DialogDescription>Кому клиент дарит цветы. В заказе выберется одним нажатием.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Field>
                <FieldLabel htmlFor="recipient-name">Имя</FieldLabel>
                <Input
                  id="recipient-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={recipientNameMax}
                  placeholder="Алия"
                  autoComplete="off"
                  className="text-base sm:text-sm"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="recipient-relation">Кем приходится</FieldLabel>
                <Input
                  id="recipient-relation"
                  value={relation}
                  onChange={(event) => setRelation(event.target.value)}
                  maxLength={recipientRelationMax}
                  placeholder="жена"
                  autoComplete="off"
                  className="text-base sm:text-sm"
                />
              </Field>
            </div>
            <div className="-mt-2 flex flex-wrap gap-1.5" data-slot="recipient-relations">
              {RECIPIENT_RELATIONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRelation(preset)}
                  aria-pressed={relation === preset}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors pointer-coarse:h-9",
                    relation === preset ? "bg-brand-subtle text-brand-strong" : "bg-muted text-foreground hover:bg-zinc-200"
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
            <Field>
              <FieldLabel htmlFor="recipient-phone">Телефон</FieldLabel>
              <Input
                id="recipient-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="text-base tabular-nums sm:text-sm"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="recipient-address">Адрес доставки</FieldLabel>
              <Input
                id="recipient-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                maxLength={recipientAddressMax}
                placeholder="Улица, дом, подъезд, ориентир"
                autoComplete="off"
                className="text-base sm:text-sm"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="recipient-note">Заметка</FieldLabel>
              <Input
                id="recipient-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={recipientNoteMax}
                placeholder="Любит пионы, аллергия на лилии"
                autoComplete="off"
                className="text-base sm:text-sm"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="sm:justify-between">
            {recipient ? (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={pending}>
                {confirmDelete ? "Точно удалить?" : "Удалить"}
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                Отмена
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
                {recipient ? "Сохранить" : "Добавить"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
