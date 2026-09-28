"use client"

import type React from "react"
import { useState, useTransition } from "react"
import { CalendarHeartIcon, Loader2Icon, PencilIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { deleteCustomerDateAction, saveCustomerDateAction } from "@/app/actions"
import {
  CUSTOMER_DATE_TITLES,
  MONTHS_NOMINATIVE,
  customerDateNoteMax,
  customerDateTitleMax,
  dateUrgency,
  daysInMonth,
  formatDayMonth,
  formatDaysLeft,
  formatYears,
  shopToday,
  type CustomerDate,
} from "@/lib/customer-dates"
import { cn } from "@/lib/utils"
import { FloristMark } from "@/components/florist-mark"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Блок «Важные даты» — в карточке клиента (variant="card") и в панели «Контакт» чата
// (variant="panel", узкая колонка). Нажатие на дату — правка, «Добавить» — новая дата.

export function CustomerDatesSection({
  customerId,
  dates,
  onChanged,
  variant = "card",
}: {
  customerId: number
  dates: CustomerDate[]
  onChanged: () => void | Promise<void>
  variant?: "card" | "panel"
}) {
  const [editing, setEditing] = useState<CustomerDate | "new" | null>(null)

  return (
    <section data-slot="customer-dates" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {variant === "panel" ? (
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <CalendarHeartIcon className="size-3.5" />
            Важные даты
          </h3>
        ) : (
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
            <CalendarHeartIcon className="size-4 text-muted-foreground" />
            Важные даты
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

      {dates.length === 0 ? (
        <p className={cn("text-muted-foreground", variant === "panel" ? "text-sm" : "rounded-xl bg-muted/30 p-3 text-sm")}>
          Дней рождения и годовщин пока нет. Узнайте у клиента — ближайшие даты всей команде видны в «Клиенты → Даты».
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {dates.map((date) => (
            <li key={date.id}>
              <CustomerDateRow date={date} variant={variant} onEdit={() => setEditing(date)} />
            </li>
          ))}
        </ul>
      )}

      <CustomerDateDialog
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        customerId={customerId}
        date={editing === "new" ? null : editing}
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

function CustomerDateRow({
  date,
  variant,
  onEdit,
}: {
  date: CustomerDate
  variant: "card" | "panel"
  onEdit: () => void
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      title="Изменить дату"
      className={cn(
        "group/date flex w-full items-start gap-3 rounded-xl text-left transition-colors hover:bg-muted/60",
        variant === "panel" ? "bg-muted/40 px-2.5 py-2" : "bg-muted/30 px-3 py-2.5"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-medium text-foreground">{date.title}</span>
          <FloristMark role={date.createdByRole} name={date.createdByName} action="Добавил" compact />
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground tabular-nums">
          {formatDayMonth(date.day, date.month, date.year)}
          {date.turns ? ` · ${date.title === "День рождения" ? "исполнится " : ""}${formatYears(date.turns)}` : ""}
        </span>
        {date.note ? <span className="mt-0.5 block text-sm break-words text-zinc-600">{date.note}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <DaysLeftPill daysLeft={date.daysLeft} />
        <PencilIcon
          className="mt-1 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/date:opacity-100 pointer-coarse:opacity-60"
          aria-hidden
        />
      </span>
    </button>
  )
}

// «сегодня» — фирменный цвет, до послезавтра — янтарный, неделя — тёмный текст, дальше — серый.
export function DaysLeftPill({ daysLeft, className }: { daysLeft: number; className?: string }) {
  const urgency = dateUrgency(daysLeft)
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums",
        urgency === "today" && "bg-brand text-brand-foreground",
        urgency === "soon" && "bg-amber-50 text-amber-700",
        urgency === "week" && "bg-muted text-foreground",
        urgency === "later" && "text-muted-foreground",
        className
      )}
    >
      {formatDaysLeft(daysLeft)}
    </span>
  )
}

export function CustomerDateDialog({
  customerId,
  date,
  open,
  onOpenChange,
  onSaved,
}: {
  customerId: number
  date: CustomerDate | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void | Promise<void>
}) {
  const [title, setTitle] = useState(date?.title ?? "")
  const [day, setDay] = useState(date ? String(date.day) : "")
  const [month, setMonth] = useState(date ? String(date.month) : "")
  const [year, setYear] = useState(date?.year ? String(date.year) : "")
  const [note, setNote] = useState(date?.note ?? "")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  const maxDay = month ? daysInMonth(Number(month)) : 31
  const dayOptions = Array.from({ length: maxDay }, (_, index) => String(index + 1))
  const monthItems = MONTHS_NOMINATIVE.map((label, index) => ({ label, value: String(index + 1) }))
  const currentYear = shopToday().year

  function changeMonth(value: string) {
    setMonth(value)
    // 31 → 30 при переходе на месяц короче, чтобы не сохранить «31 апреля».
    if (day && Number(day) > daysInMonth(Number(value))) {
      setDay(String(daysInMonth(Number(value))))
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) {
      toast.error("Укажите повод — например, «День рождения».")
      return
    }
    if (!day || !month) {
      toast.error("Выберите день и месяц.")
      return
    }
    startTransition(async () => {
      const result = await saveCustomerDateAction(date?.id ?? null, {
        customerId,
        title,
        day: Number(day),
        month: Number(month),
        year: year.trim() ? Number(year) : null,
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
    if (!date) {
      return
    }
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    startTransition(async () => {
      const result = await deleteCustomerDateAction(date.id)
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
            <DialogTitle>{date ? "Изменить дату" : "Новая важная дата"}</DialogTitle>
            <DialogDescription>Повторяется каждый год. Ближайшие даты видны в «Клиенты → Даты» и на дашборде — чтобы вовремя поздравить.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="customer-date-title">Повод</FieldLabel>
              <Input
                id="customer-date-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={customerDateTitleMax}
                placeholder="Например: День рождения"
                autoComplete="off"
                className="text-base sm:text-sm"
              />
              <div className="flex flex-wrap gap-1.5" data-slot="customer-date-presets">
                {CUSTOMER_DATE_TITLES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTitle(preset)}
                    aria-pressed={title === preset}
                    className={cn(
                      "inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors pointer-coarse:h-9",
                      title === preset ? "bg-brand-subtle text-brand-strong" : "bg-muted text-foreground hover:bg-zinc-200"
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_6.5rem] gap-2" data-slot="customer-date-when">
              <Field>
                <FieldLabel htmlFor="customer-date-day">День</FieldLabel>
                <Select items={dayOptions.map((value) => ({ label: value, value }))} value={day || null} onValueChange={(value) => setDay(value ?? "")}>
                  <SelectTrigger id="customer-date-day" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {dayOptions.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="customer-date-month">Месяц</FieldLabel>
                <Select items={monthItems} value={month || null} onValueChange={(value) => changeMonth(value ?? "")}>
                  <SelectTrigger id="customer-date-month" className="w-full">
                    <SelectValue placeholder="Выберите" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {monthItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="customer-date-year">Год</FieldLabel>
                <Input
                  id="customer-date-year"
                  value={year}
                  onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  placeholder="не знаю"
                  aria-describedby="customer-date-year-hint"
                  className="text-base tabular-nums sm:text-sm"
                />
              </Field>
            </div>
            <FieldDescription id="customer-date-year-hint" className="-mt-2">
              Год необязателен — с ним видно, сколько лет исполнится (например, {currentYear - 30} → «30 лет»).
            </FieldDescription>
            <Field>
              <FieldLabel htmlFor="customer-date-note">Заметка</FieldLabel>
              <Input
                id="customer-date-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={customerDateNoteMax}
                placeholder="Кому и что любит: жена Алия, пионы"
                autoComplete="off"
                className="text-base sm:text-sm"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="sm:justify-between">
            {date ? (
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
                {date ? "Сохранить" : "Добавить"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
