"use client"

import type React from "react"
import { useState } from "react"
import { AlertTriangleIcon } from "lucide-react"
import { toast } from "sonner"
import type { CurrentUser, DashboardData, UserRole } from "@/lib/db"
import { formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  const [closeForm, setCloseForm] = useState({
    ...initialCloseShiftForm,
    closingCash: openShift?.expectedCash?.toString() ?? "",
  })
  const [openNightShift, setOpenNightShift] = useState(false)
  const [nightFloristId, setNightFloristId] = useState("")
  const openingCash = Number(openForm.openingCash || 0)
  const openingDifference = openingCash - defaultOpeningCash
  const needsOpeningComment = !openShift && Math.abs(openingDifference) >= 0.01
  const closingCash = Number(closeForm.closingCash || 0)
  const difference = closingCash - (openShift?.expectedCash ?? 0)
  const needsClosingComment = Boolean(openShift) && Math.abs(difference) >= 0.01
  const canOpenNightShift =
    currentUserRole === "manager" &&
    openShift?.type === "day" &&
    openShift.userId === currentUserId

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (needsOpeningComment && !openForm.openingComment.trim()) {
      event.preventDefault()
      toast.error("Укажите комментарий, если начальная наличка отличается от прошлой закрытой смены.")
      return
    }

    if (needsClosingComment && !closeForm.closingComment.trim()) {
      event.preventDefault()
      toast.error("Укажите комментарий, если фактическая наличка отличается от ожидаемой.")
      return
    }

    if (openNightShift && !closeForm.closingCash.trim()) {
      event.preventDefault()
      toast.error("Введите фактическую наличку для открытия ночной смены.")
      return
    }

    if (openNightShift && !nightFloristId) {
      event.preventDefault()
      toast.error("Выберите флориста для ночной смены.")
      return
    }

    onSubmit(event)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <AlertTriangleIcon />
                <AlertTitle>Начальная наличка отличается</AlertTitle>
                <AlertDescription>Добавьте комментарий к открытию смены.</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="opening-note">Комментарий</FieldLabel>
              <Textarea
                id="opening-note"
                name="note"
                value={openForm.openingComment ?? ""}
                onChange={(event) =>
                  setOpenForm((current) => ({ ...current, openingComment: event.target.value }))
                }
                required={needsOpeningComment}
              />
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
                id="closingCash"
                name="closingCash"
                type="number"
                step="0.01"
                value={closeForm.closingCash ?? ""}
                onChange={(event) =>
                  setCloseForm((current) => ({ ...current, closingCash: event.target.value }))
                }
                required
              />
            </Field>
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Разница = факт - ожидается</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="text-xl font-semibold">{formatMoney(difference)}</div>
                <Badge variant={Math.abs(difference) < 0.01 ? "secondary" : "destructive"}>
                  {Math.abs(difference) < 0.01 ? "совпало" : "есть разница"}
                </Badge>
              </div>
            </div>
            <Field>
              <FieldLabel htmlFor="closing-note">Комментарий</FieldLabel>
              <Textarea
                id="closing-note"
                name="note"
                value={closeForm.closingComment ?? ""}
                onChange={(event) =>
                  setCloseForm((current) => ({ ...current, closingComment: event.target.value }))
                }
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
  )
}
