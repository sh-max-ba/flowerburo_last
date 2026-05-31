import type { CurrentUser } from "../types"
import { db } from "../connection"
import { addMovement, recordCashTransaction } from "../ledger"
import { clean, toNumber } from "../form-parsers"
import { parseForm } from "@/lib/forms/parse"
import { ManualCashInputSchema } from "@/lib/forms/schemas"
import {
  calculateShiftSummary,
  getDefaultOpeningCash,
  getOpenShift,
  getShiftAccessInfo,
  requireOpenShift,
} from "./shifts"
import { getActiveFloristById } from "./users"

export function openShift(formData: FormData, currentUser: CurrentUser) {
  const client = db()

  const startShift = client.transaction(() => {
    const opened = getOpenShift(client)

    if (opened) {
      throw new Error("Открытая смена уже есть.")
    }

    const rawOpeningCash = clean(formData.get("openingCash"))
    const cash = rawOpeningCash ? toNumber(rawOpeningCash) : getDefaultOpeningCash(client)
    const defaultOpeningCash = getDefaultOpeningCash(client)
    const cashierName = currentUser.name
    const note = clean(formData.get("note"))

    if (Math.abs(cash - defaultOpeningCash) >= 0.01 && !note) {
      throw new Error("Укажите комментарий, если начальная наличка отличается от прошлой закрытой смены.")
    }

    const shift = client
      .prepare(
        `INSERT INTO shifts (opening_cash, cashier_name, note, user_id, opened_by_user_id, type)
         VALUES (?, ?, ?, ?, ?, 'day')`
      )
      .run(cash, cashierName, note, currentUser.id, currentUser.id)

    addMovement(client, {
      userId: currentUser.id,
      type: "shift_open",
      total: cash,
      note: `Открыта смена #${shift.lastInsertRowid}: ${cashierName}`,
    })
  })

  startShift()
}

export function closeShift(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const shiftId = Number(clean(formData.get("shiftId")))
  const rawClosingCash = clean(formData.get("closingCash"))
  const cash = toNumber(rawClosingCash)
  const note = clean(formData.get("note"))
  const openNightShift = clean(formData.get("openNightShift")) === "1"
  const nightFloristId = Number(clean(formData.get("nightFloristId")))

  if (!shiftId) {
    throw new Error("Смена не выбрана.")
  }

  const finishShift = client.transaction(() => {
    if (openNightShift) {
      if (currentUser.role !== "manager") {
        throw new Error("Ночную смену может открыть только менеджер при закрытии своей смены.")
      }

      if (!rawClosingCash) {
        throw new Error("Введите фактическую наличку для открытия ночной смены.")
      }

      if (!nightFloristId) {
        throw new Error("Выберите флориста для ночной смены.")
      }

      const closingShift = getShiftAccessInfo(shiftId)
      if (!closingShift || closingShift.status !== "open") {
        throw new Error("Открытая смена не найдена.")
      }

      if (closingShift.type !== "day" || closingShift.userId !== currentUser.id) {
        throw new Error("Ночную смену можно открыть только при закрытии своей дневной смены.")
      }

      const otherOpenShift = client
        .prepare("SELECT id FROM shifts WHERE status = 'open' AND id <> ? LIMIT 1")
        .get(shiftId) as { id: number } | undefined

      if (otherOpenShift) {
        throw new Error("Открытая смена уже есть.")
      }
    }

    const summary = calculateShiftSummary(shiftId, client)
    if (Math.abs(cash - summary.expectedCash) >= 0.01 && !note) {
      throw new Error("Укажите комментарий, если фактическая наличка отличается от ожидаемой.")
    }

    const result = client
      .prepare(
        `UPDATE shifts
         SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closing_cash = ?, note = ?,
          closed_by_user_id = ?
         WHERE id = ? AND status = 'open'`
      )
      .run(cash, note, currentUser.id, shiftId)

    if (result.changes === 0) {
      throw new Error("Открытая смена не найдена.")
    }

    addMovement(client, {
      userId: currentUser.id,
      type: "shift_close",
      total: cash,
      note: `Закрыта смена #${shiftId}`,
    })

    if (openNightShift) {
      const florist = getActiveFloristById(nightFloristId, client)
      if (!florist) {
        throw new Error("Флорист не найден или неактивен.")
      }

      const opened = getOpenShift(client)
      if (opened) {
        throw new Error("Открытая смена уже есть.")
      }

      const nightShift = client
        .prepare(
          `INSERT INTO shifts (
            opening_cash, cashier_name, note, user_id, opened_by_user_id, type
          ) VALUES (
            ?, ?, ?, ?, ?, 'night'
          )`
        )
        .run(cash, florist.name, "Ночная смена", florist.id, currentUser.id)

      addMovement(client, {
        userId: currentUser.id,
        type: "shift_open",
        total: cash,
        note: `Открыта ночная смена #${nightShift.lastInsertRowid}: ${florist.name}`,
      })
    }
  })

  finishShift()
}

function recordManualCash(formData: FormData, type: "cash_in" | "cash_out", currentUser: CurrentUser) {
  const client = db()
  // Скалярные правила amount>0 ("Сумма должна быть больше нуля.") / comment кодирует
  // ManualCashInputSchema; requireOpenShift остаётся в транзакции.
  const { amount, comment } = parseForm(ManualCashInputSchema, formData)

  const record = client.transaction(() => {
    const shift = requireOpenShift(client)
    recordCashTransaction(client, {
      shiftId: shift.id,
      userId: currentUser.id,
      type,
      paymentMethod: "cash",
      amount,
      comment,
    })
  })

  record()
}

export function cashIn(formData: FormData, currentUser: CurrentUser) {
  recordManualCash(formData, "cash_in", currentUser)
}

export function cashOut(formData: FormData, currentUser: CurrentUser) {
  recordManualCash(formData, "cash_out", currentUser)
}
