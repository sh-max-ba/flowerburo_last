"use client"

import type React from "react"
import { useRef, useState } from "react"
import { AlertTriangleIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon } from "lucide-react"
import { toast } from "sonner"
import type { CurrentUser, DashboardData, UserRole } from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
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
import { ShiftCloseSummary } from "@/components/shifts/shift-pages"

const initialOpenShiftForm = {
  openingCash: "",
  openingComment: "",
}

const initialCloseShiftForm = {
  closingCash: "",
  closingComment: "",
}

export function ShiftSheet({
  open,
  currentUserId,
  currentUserName,
  currentUserRole,
  defaultOpeningCash,
  activeFlorists,
  openShift,
  openShiftDetails,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  currentUserId: number
  currentUserName: string
  currentUserRole: UserRole
  defaultOpeningCash: number
  activeFlorists: CurrentUser[]
  openShift: DashboardData["stats"]["openShift"]
  openShiftDetails: DashboardData["shiftDetails"][number] | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const formKey = open
    ? openShift
      ? `close-${openShift.id}-${openShift.expectedCash}`
      : "open-new"
    : "closed"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{openShift ? "Закрыть смену" : "Открыть смену"}</DialogTitle>
          <DialogDescription>
            {openShift
              ? `Смена #${openShift.id} · Ответственный: ${openShift.cashierName || "не указан"}`
              : "Ответственный берется из текущего профиля."}
          </DialogDescription>
        </DialogHeader>
        <ShiftSheetForm
          key={formKey}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserRole={currentUserRole}
          defaultOpeningCash={defaultOpeningCash}
          activeFlorists={activeFlorists}
          openShift={openShift}
          openShiftDetails={openShiftDetails}
          pending={pending}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

function ShiftSheetForm({
  currentUserId,
  currentUserName,
  currentUserRole,
  defaultOpeningCash,
  activeFlorists,
  openShift,
  openShiftDetails,
  pending,
  onSubmit,
}: {
  currentUserId: number
  currentUserName: string
  currentUserRole: UserRole
  defaultOpeningCash: number
  activeFlorists: CurrentUser[]
  openShift: DashboardData["stats"]["openShift"]
  openShiftDetails: DashboardData["shiftDetails"][number] | null
  pending: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const [openForm, setOpenForm] = useState({
    ...initialOpenShiftForm,
    openingCash: defaultOpeningCash.toString(),
  })
  // Поле «Фактическая наличка» намеренно пустое — кассир обязан пересчитать кассу,
  // а не подтверждать подставленное ожидаемое значение.
  const [closeForm, setCloseForm] = useState({ ...initialCloseShiftForm })
  const [openNightShift, setOpenNightShift] = useState(false)
  const [nightFloristId, setNightFloristId] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const openingCommentRef = useRef<HTMLTextAreaElement>(null)
  const closingCashRef = useRef<HTMLInputElement>(null)
  const closingCommentRef = useRef<HTMLTextAreaElement>(null)
  const confirmedRef = useRef(false)
  const [openingCommentError, setOpeningCommentError] = useState(false)
  const [closingCashError, setClosingCashError] = useState(false)
  const [closingCommentError, setClosingCommentError] = useState(false)
  const openingCash = Number(openForm.openingCash || 0)
  const openingDifference = openingCash - defaultOpeningCash
  const needsOpeningComment = !openShift && Math.abs(openingDifference) >= 0.01
  const closingCashEntered = closeForm.closingCash.trim() !== ""
  const closingCash = Number(closeForm.closingCash || 0)
  const expectedCash = openShift?.expectedCash ?? 0
  const difference = closingCash - expectedCash
  const matched = closingCashEntered && Math.abs(difference) < 0.01
  const needsClosingComment = Boolean(openShift) && closingCashEntered && Math.abs(difference) >= 0.01
  const canOpenNightShift =
    currentUserRole === "manager" &&
    openShift?.type === "day" &&
    openShift.userId === currentUserId
  const nightFloristName = activeFlorists.find((florist) => String(florist.id) === nightFloristId)?.name ?? ""

  // Возвращает true, если форма валидна; иначе подсвечивает и фокусирует первое проблемное поле.
  function validate(): boolean {
    setOpeningCommentError(false)
    setClosingCashError(false)
    setClosingCommentError(false)

    if (needsOpeningComment && !openForm.openingComment.trim()) {
      setOpeningCommentError(true)
      openingCommentRef.current?.focus()
      toast.error("Укажите комментарий, если начальная наличка отличается от прошлой закрытой смены.")
      return false
    }

    if (openShift && !closingCashEntered) {
      setClosingCashError(true)
      closingCashRef.current?.focus()
      toast.error("Введите фактическую наличку — пересчитайте кассу перед закрытием смены.")
      return false
    }

    if (needsClosingComment && !closeForm.closingComment.trim()) {
      setClosingCommentError(true)
      closingCommentRef.current?.focus()
      toast.error("Укажите комментарий, если фактическая наличка отличается от ожидаемой.")
      return false
    }

    if (openNightShift && !nightFloristId) {
      toast.error("Выберите флориста для ночной смены.")
      return false
    }

    return true
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Повторный submit после подтверждения в AlertDialog — пропускаем проверки и шлём форму.
    if (confirmedRef.current) {
      confirmedRef.current = false
      onSubmit(event)
      return
    }

    if (!validate()) {
      event.preventDefault()
      return
    }

    // Закрытие смены необратимо финализирует кассу — требуем подтверждения.
    if (openShift) {
      event.preventDefault()
      setConfirmOpen(true)
      return
    }

    onSubmit(event)
  }

  function confirmClose() {
    setConfirmOpen(false)
    confirmedRef.current = true
    formRef.current?.requestSubmit()
  }

  return (
    <>
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FieldGroup>
        {openShift && <input type="hidden" name="shiftId" value={openShift.id} />}
        {!openShift && (
          <>
            <Field>
              <FieldLabel>Ответственный</FieldLabel>
              <FieldDescription className="rounded-xl border bg-muted/30 p-3 text-foreground">
                Ответственный: {currentUserName}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="openingCash">Начальная наличка</FieldLabel>
              <Input
                id="openingCash"
                name="openingCash"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={openForm.openingCash ?? ""}
                onChange={(event) =>
                  setOpenForm((current) => ({ ...current, openingCash: event.target.value }))
                }
                required
              />
              <FieldDescription>
                Ожидается по прошлой закрытой смене: {formatMoney(defaultOpeningCash)}
              </FieldDescription>
            </Field>
            {needsOpeningComment && (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>Начальная наличка отличается</AlertTitle>
                <AlertDescription>Добавьте комментарий к открытию смены.</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="opening-note">Комментарий</FieldLabel>
              <Textarea
                ref={openingCommentRef}
                id="opening-note"
                name="note"
                aria-invalid={openingCommentError || undefined}
                value={openForm.openingComment ?? ""}
                onChange={(event) => {
                  setOpeningCommentError(false)
                  setOpenForm((current) => ({ ...current, openingComment: event.target.value }))
                }}
                required={needsOpeningComment}
              />
              {needsOpeningComment && (
                <FieldDescription>
                  Комментарий обязателен, потому что начальная наличка отличается от прошлой закрытой смены.
                </FieldDescription>
              )}
            </Field>
          </>
        )}
        {openShift && (
          <>
            {canOpenNightShift && (
              <>
                <input type="hidden" name="openNightShift" value={openNightShift ? "1" : "0"} />
                <input type="hidden" name="nightFloristId" value={nightFloristId} />
              </>
            )}
            {openShiftDetails && <ShiftCloseSummary detail={openShiftDetails} />}
            <Field>
              <FieldLabel htmlFor="closingCash">Фактическая наличка в кассе</FieldLabel>
              <Input
                ref={closingCashRef}
                id="closingCash"
                name="closingCash"
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="Пересчитайте кассу и введите сумму"
                aria-invalid={closingCashError || undefined}
                value={closeForm.closingCash ?? ""}
                onChange={(event) => {
                  setClosingCashError(false)
                  setCloseForm((current) => ({ ...current, closingCash: event.target.value }))
                }}
                required
              />
              <FieldDescription>
                Ожидается в кассе: {formatMoney(expectedCash)}. Введите фактически пересчитанную сумму.
              </FieldDescription>
            </Field>
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Разница = факт − ожидается</div>
              {closingCashEntered ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div
                    className={cn(
                      "text-xl font-semibold tabular-nums",
                      matched ? "text-foreground" : difference < 0 ? "text-destructive" : "text-amber-700"
                    )}
                  >
                    {formatMoney(difference)}
                  </div>
                  <CloseDifferenceBadge difference={difference} />
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <AlertTriangleIcon className="size-4" />
                  Введите фактическую наличку, чтобы рассчитать разницу
                </div>
              )}
            </div>
            <Field>
              <FieldLabel htmlFor="closing-note">Комментарий</FieldLabel>
              <Textarea
                ref={closingCommentRef}
                id="closing-note"
                name="note"
                aria-invalid={closingCommentError || undefined}
                value={closeForm.closingComment ?? ""}
                onChange={(event) => {
                  setClosingCommentError(false)
                  setCloseForm((current) => ({ ...current, closingComment: event.target.value }))
                }}
                required={needsClosingComment}
              />
              {needsClosingComment && (
                <FieldDescription>
                  Комментарий обязателен, потому что факт отличается от ожидаемой кассы.
                </FieldDescription>
              )}
            </Field>
            {canOpenNightShift && (
              <FieldSet>
                <Field orientation="horizontal">
                  <Checkbox
                    id="openNightShift"
                    checked={openNightShift}
                    onCheckedChange={(checked) => setOpenNightShift(checked === true)}
                    disabled={pending}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="openNightShift">
                      Открыть ночную смену для флориста
                    </FieldLabel>
                    <FieldDescription>
                      Фактическая наличка станет начальной наличкой ночной смены
                    </FieldDescription>
                  </FieldContent>
                </Field>
                {openNightShift && (
                  <Field>
                    <FieldLabel htmlFor="nightFloristId">Флорист</FieldLabel>
                    <Select
                      items={[
                        { label: "Выберите флориста", value: null },
                        ...activeFlorists.map((florist) => ({
                          label: florist.name,
                          value: String(florist.id),
                        })),
                      ]}
                      value={nightFloristId || null}
                      onValueChange={(value) => setNightFloristId(value ?? "")}
                    >
                      <SelectTrigger id="nightFloristId" className="w-full">
                        <SelectValue placeholder="Выберите флориста" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={null}>Выберите флориста</SelectItem>
                          {activeFlorists.map((florist) => (
                            <SelectItem key={florist.id} value={String(florist.id)}>
                              {florist.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      В списке только активные пользователи с ролью florist.
                    </FieldDescription>
                  </Field>
                )}
              </FieldSet>
            )}
          </>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {openShift ? "Закрыть смену" : "Открыть смену"}
        </Button>
      </DialogFooter>
    </form>
    {openShift && (
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть смену #{openShift.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              {matched
                ? "Касса сходится. Закрытие смены финализирует кассу — отменить будет нельзя."
                : difference < 0
                  ? `Будет зафиксирована недостача ${formatMoney(Math.abs(difference))}. Закрытие смены необратимо.`
                  : `Будет зафиксирован излишек ${formatMoney(Math.abs(difference))}. Закрытие смены необратимо.`}
              {openNightShift && nightFloristName
                ? ` После закрытия будет открыта ночная смена для флориста ${nightFloristName}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant={difference < 0 ? "destructive" : "default"} disabled={pending} />}
              onClick={confirmClose}
            >
              Закрыть смену
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )}
    </>
  )
}

const DIFFERENCE_WARNING_THRESHOLD = 100

function CloseDifferenceBadge({ difference }: { difference: number }) {
  const matched = Math.abs(difference) < 0.01
  if (matched) {
    return (
      <Badge variant="secondary">
        <CheckIcon data-icon="inline-start" />
        Совпало
      </Badge>
    )
  }

  const magnitude = Math.abs(difference)
  const isLarge = magnitude >= DIFFERENCE_WARNING_THRESHOLD

  if (difference < 0) {
    return (
      <Badge variant="destructive">
        {isLarge ? <AlertTriangleIcon data-icon="inline-start" /> : <ArrowDownIcon data-icon="inline-start" />}
        Недостача <span className="font-semibold">{formatMoney(magnitude)}</span>
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="border-amber-300 text-amber-700">
      <ArrowUpIcon data-icon="inline-start" />
      Излишек <span className="font-semibold">{formatMoney(magnitude)}</span>
    </Badge>
  )
}
