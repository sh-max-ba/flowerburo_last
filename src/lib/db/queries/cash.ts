import { numberFromRow } from "@/lib/db-row"
import type { CurrentUser, PaymentMethod } from "../types"
import { paymentMethods } from "../types"
import { db } from "../connection"
import { addMovement, applyProductDelta, recordCashTransaction } from "../ledger"
import { clean, parsePaymentMethod, toNumber } from "../form-parsers"
import { parseForm } from "@/lib/forms/parse"
import { ManualCashInputSchema } from "@/lib/forms/schemas"
import {
  calculateShiftSummary,
  getDefaultOpeningCash,
  getOpenShift,
  getShiftAccessInfo,
  requireOpenShift,
} from "./shifts"
import { getActiveCashUserById, getActiveFloristById } from "./users"

// Флорист может изменять только СВОИ кассовые операции (сторно / смена способа оплаты) — чтобы при
// общей кассе (несколько операторов в одной открытой смене) флорист не правил чужие операции.
// owner/manager — без ограничений. Атрибуция остаётся в отчёте (свод по операторам).
function assertFloristEditsOwn(currentUser: CurrentUser, operationUserId: unknown) {
  if (currentUser.role === "florist" && numberFromRow(operationUserId) !== currentUser.id) {
    throw new Error("Флорист может изменять только свои операции.")
  }
}

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
    const note = clean(formData.get("note"))

    // Ответственный за смену: по умолчанию открывающий; владелец/менеджер могут открыть смену
    // на другого активного сотрудника (общая сессия на кассе — кейс «смену держит флорист»).
    // Старые вкладки поле не шлют → поведение прежнее (на себя).
    let responsible: { id: number; name: string } = { id: currentUser.id, name: currentUser.name }
    const requestedResponsibleId = Number(clean(formData.get("responsibleUserId")))
    if (
      Number.isInteger(requestedResponsibleId) &&
      requestedResponsibleId > 0 &&
      requestedResponsibleId !== currentUser.id
    ) {
      if (currentUser.role !== "owner" && currentUser.role !== "manager") {
        throw new Error("Открыть смену на другого сотрудника может только владелец или менеджер.")
      }
      const target = getActiveCashUserById(requestedResponsibleId, client)
      if (!target) {
        throw new Error("Сотрудник не найден или отключён.")
      }
      responsible = { id: target.id, name: target.name }
    }

    if (Math.abs(cash - defaultOpeningCash) >= 0.01 && !note) {
      throw new Error("Укажите комментарий, если начальная наличка отличается от прошлой закрытой смены.")
    }

    const shift = client
      .prepare(
        `INSERT INTO shifts (opening_cash, cashier_name, note, user_id, opened_by_user_id, type)
         VALUES (?, ?, ?, ?, ?, 'day')`
      )
      .run(cash, responsible.name, note, responsible.id, currentUser.id)

    addMovement(client, {
      userId: currentUser.id,
      type: "shift_open",
      total: cash,
      note:
        responsible.id === currentUser.id
          ? `Открыта смена #${shift.lastInsertRowid}: ${responsible.name}`
          : `Открыта смена #${shift.lastInsertRowid}: ${responsible.name} (открыл: ${currentUser.name})`,
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

  // Серверная защита: фактическую наличку нужно ввести при ЛЮБОМ закрытии смены
  // (UI делает поле обязательным, но прямой POST экшена мог бы записать closing_cash=0).
  if (!rawClosingCash) {
    throw new Error("Введите фактическую наличку.")
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

// Исправление способа оплаты уже проведённой операции прямо из «Кассы за смену».
// Менеджеры, не привыкшие к новой логике, иногда выбирают не тот способ — эта правка
// только ПЕРЕКЛАССИФИЦИРУЕТ платёж по методу, не двигая сумму:
//  • суммы продаж/заказов и признанная выручка от метода не зависят (остаются прежними);
//  • «Ожидается в кассе» считается по наличке на лету — после правки оно сходится с фактом;
//  • правка разрешена ТОЛЬКО в текущей открытой смене (у закрытой фактическая наличка
//    уже зафиксирована, перекладывать деньги между методами задним числом нельзя).
// ВАЖНО (касса РЕАЛЬНО ломается в одном случае): приход по заказу, у которого уже есть
// возврат. refundOrderPayments повторяет способ прихода на момент возврата, образуя
// сбалансированную пару «приход+возврат». Если сдвинуть метод только у прихода, его возврат
// (cash_refund) остаётся в старом методе и пара разъезжается → «Ожидается в кассе» уходит в
// минус/плюс (так смена ушла в −6870 04.06.2026). Поэтому такой приход править ЗАПРЕЩАЕМ
// (guard ниже): отменённый заказ — терминальное состояние, метод исходного платежа уже не
// важен для кассы (пара netто = 0). Каждое изменение пишем в movements как аудит-след.
// target = "sale" (правим продажу + её проводку) | "transaction" (платёж по заказу/сделке).
export function updatePaymentMethod(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const target = clean(formData.get("target"))
  const id = Number(clean(formData.get("id")))
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))

  if (!paymentMethods.has(paymentMethod)) {
    throw new Error("Некорректный способ оплаты.")
  }

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Операция не найдена.")
  }

  const apply = client.transaction(() => {
    const shift = requireOpenShift(client)

    if (target === "sale") {
      const sale = client
        .prepare(
          "SELECT shift_id as shiftId, user_id as userId, payment_method as paymentMethod, total, reversed_at as reversedAt FROM sales WHERE id = ?"
        )
        .get(id) as
        | {
            shiftId: number | null
            userId: number | null
            paymentMethod: PaymentMethod
            total: number
            reversedAt: string | null
          }
        | undefined
      if (!sale) {
        throw new Error("Продажа не найдена.")
      }
      if (numberFromRow(sale.shiftId) !== shift.id) {
        throw new Error("Способ оплаты можно менять только в текущей смене.")
      }
      // Guard (зеркало заказного): сторно создало cash_refund тем же методом — правка прихода
      // разбалансирует пару «приход+возврат» и развалит кассу по методам. Проверяем и флаг
      // reversed_at, и фактический возврат по sale_id (на случай старых строк без флага).
      const refunded =
        sale.reversedAt ||
        client.prepare("SELECT 1 FROM cash_transactions WHERE sale_id = ? AND type = 'cash_refund' LIMIT 1").get(id)
      if (refunded) {
        throw new Error(
          "Продажа сторнирована — способ оплаты менять нельзя, иначе касса разойдётся. Если способ был неверным, проведите продажу заново нужным способом."
        )
      }
      // У смешанной оплаты две проводки разными способами — массовая перезапись смешала бы их.
      if (String(sale.paymentMethod) === "mixed") {
        throw new Error(
          "У продажи смешанная оплата — способ менять нельзя. Если оплата проведена неверно, сторнируйте продажу и проведите заново."
        )
      }
      assertFloristEditsOwn(currentUser, sale.userId)
      if (sale.paymentMethod === paymentMethod) {
        return
      }

      client.prepare("UPDATE sales SET payment_method = ? WHERE id = ?").run(paymentMethod, id)
      // Денежная проводка продажи хранит способ оплаты отдельно от строки sales —
      // держим в синхроне, чтобы разбор кассы по методам остался верным.
      client
        .prepare("UPDATE cash_transactions SET payment_method = ? WHERE sale_id = ? AND type = 'sale'")
        .run(paymentMethod, id)
      addMovement(client, {
        userId: currentUser.id,
        type: "payment_method_change",
        total: numberFromRow(sale.total),
        note: `Способ оплаты продажи #${id}: ${sale.paymentMethod} → ${paymentMethod}`,
      })
      return
    }

    if (target === "transaction") {
      const transaction = client
        .prepare(
          "SELECT shift_id as shiftId, user_id as userId, type, order_id as orderId, payment_method as paymentMethod, amount FROM cash_transactions WHERE id = ?"
        )
        .get(id) as
        | {
            shiftId: number | null
            userId: number | null
            type: string
            orderId: number | null
            paymentMethod: PaymentMethod
            amount: number
          }
        | undefined
      if (!transaction) {
        throw new Error("Операция не найдена.")
      }
      if (numberFromRow(transaction.shiftId) !== shift.id) {
        throw new Error("Способ оплаты можно менять только в текущей смене.")
      }
      assertFloristEditsOwn(currentUser, transaction.userId)
      // Только платежи по заказам/сделкам. Служебные операции (внесение/изъятие/возврат)
      // и продажи (правятся через target="sale") здесь трогать нельзя.
      if (
        transaction.type !== "prepayment" &&
        transaction.type !== "order_payment" &&
        transaction.type !== "deal_payment"
      ) {
        throw new Error("У этой операции нельзя изменить способ оплаты.")
      }
      if (transaction.paymentMethod === paymentMethod) {
        return
      }
      // Guard: приход по заказу, у которого есть возврат (cash_refund), править нельзя —
      // возврат повторяет старый метод и этой правкой не двигается, так что пара
      // «приход+возврат» разбалансируется и касса разъезжается. Если метод правда был другим,
      // правьте до отмены заказа (тогда возврат повторит уже исправленный метод).
      const orderId = numberFromRow(transaction.orderId)
      if (orderId) {
        const refunded = client
          .prepare("SELECT 1 FROM cash_transactions WHERE order_id = ? AND type = 'cash_refund' LIMIT 1")
          .get(orderId)
        if (refunded) {
          throw new Error(
            "По этому заказу оформлен возврат — менять способ оплаты прихода нельзя, иначе касса разойдётся."
          )
        }
      }

      client.prepare("UPDATE cash_transactions SET payment_method = ? WHERE id = ?").run(paymentMethod, id)
      addMovement(client, {
        userId: currentUser.id,
        type: "payment_method_change",
        total: numberFromRow(transaction.amount),
        note:
          `Способ оплаты операции #${id}` +
          (orderId ? ` (заказ #${orderId})` : "") +
          `: ${transaction.paymentMethod} → ${paymentMethod}`,
      })
      return
    }

    throw new Error("Некорректная операция.")
  })

  apply()
}

// Отмена служебной кассовой операции (внесение/изъятие) встречной операцией в ТЕКУЩЕЙ
// открытой смене. Оригинал помечается через reverses_id у встречной проводки — это защищает
// от двойной отмены и помечает строку «Отменено» в истории. Деньги физически двигаются
// сейчас → влияет на expectedCash текущей смены; выручки не касается (cash_in/out не выручка).
export function reverseCashTransaction(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const id = Number(clean(formData.get("id")))
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Операция не найдена.")
  }

  const apply = client.transaction(() => {
    const shift = requireOpenShift(client)
    const original = client
      .prepare(
        "SELECT shift_id as shiftId, user_id as userId, type, sale_id as saleId, payment_method as paymentMethod, amount, reverses_id as reversesId FROM cash_transactions WHERE id = ?"
      )
      .get(id) as
      | {
          shiftId: number | null
          userId: number | null
          type: string
          saleId: number | null
          paymentMethod: PaymentMethod
          amount: number
          reversesId: number | null
        }
      | undefined
    if (!original) {
      throw new Error("Операция не найдена.")
    }
    assertFloristEditsOwn(currentUser, original.userId)
    if (numberFromRow(original.reversesId)) {
      throw new Error("Это операция отмены — её отменять нельзя.")
    }
    const already = client.prepare("SELECT 1 FROM cash_transactions WHERE reverses_id = ? LIMIT 1").get(id)
    if (already) {
      throw new Error("Операция уже отменена.")
    }

    const amount = numberFromRow(original.amount)
    const originalShiftId = numberFromRow(original.shiftId) || null
    const crossShiftNote = originalShiftId && originalShiftId !== shift.id ? ` (за смену #${originalShiftId})` : ""

    // Ручные внесения/изъятия — встречной операцией (выручки/склада не касается).
    if (original.type === "cash_in" || original.type === "cash_out") {
      const counterType = original.type === "cash_in" ? "cash_out" : "cash_in"
      recordCashTransaction(client, {
        shiftId: shift.id,
        userId: currentUser.id,
        reversesId: id,
        type: counterType,
        paymentMethod: original.paymentMethod,
        amount,
        comment: `Отмена операции #${id}${crossShiftNote}`,
      })
      addMovement(client, {
        userId: currentUser.id,
        type: "cash_reversal",
        total: amount,
        note: `Отмена операции #${id}: ${original.type} → ${counterType}`,
      })
      return
    }

    // Сторно быстрой продажи: возврат денег тем же способом (для expectedCash и выручки по
    // методам — cash_refund с source_shift_id = смена продажи), исключение продажи из выручки
    // (reversed_at) и возврат товара на склад.
    if (original.type === "sale") {
      const saleId = numberFromRow(original.saleId)
      if (!saleId) {
        throw new Error("Продажа не найдена.")
      }
      const saleRow = client.prepare("SELECT reversed_at as reversedAt FROM sales WHERE id = ?").get(saleId) as
        | { reversedAt: string | null }
        | undefined
      if (!saleRow) {
        throw new Error("Продажа не найдена.")
      }
      if (saleRow.reversedAt) {
        throw new Error("Продажа уже сторнирована.")
      }
      // Сторно возвращает ВСЕ денежные части продажи (при смешанной оплате их две) — каждую
      // тем же способом, которым пришла: пара «приход+возврат» остаётся метод-в-метод.
      const saleParts = client
        .prepare(
          "SELECT id, shift_id as shiftId, payment_method as paymentMethod, amount FROM cash_transactions WHERE sale_id = ? AND type = 'sale' ORDER BY id"
        )
        .all(saleId) as Array<{ id: number; shiftId: number | null; paymentMethod: PaymentMethod; amount: number }>
      let refundedTotal = 0
      for (const part of saleParts) {
        const partShiftId = numberFromRow(part.shiftId) || null
        const partNote = partShiftId && partShiftId !== shift.id ? ` (за смену #${partShiftId})` : ""
        const partAmount = numberFromRow(part.amount)
        refundedTotal += partAmount
        recordCashTransaction(client, {
          shiftId: shift.id,
          saleId,
          sourceShiftId: partShiftId,
          userId: currentUser.id,
          reversesId: numberFromRow(part.id),
          type: "cash_refund",
          paymentMethod: part.paymentMethod,
          amount: partAmount,
          comment: `Сторно продажи #${saleId}${partNote}`,
        })
      }
      client.prepare("UPDATE sales SET reversed_at = CURRENT_TIMESTAMP WHERE id = ?").run(saleId)
      const saleItems = client
        .prepare("SELECT product_code as productCode, qty FROM sale_items WHERE sale_id = ?")
        .all(saleId) as Array<{ productCode: string; qty: number }>
      for (const item of saleItems) {
        applyProductDelta(client, {
          productCode: item.productCode,
          stockDelta: numberFromRow(item.qty),
          type: "adjustment",
          qty: numberFromRow(item.qty),
          saleId,
          shiftId: shift.id,
          userId: currentUser.id,
          comment: `Сторно продажи #${saleId}`,
        })
      }
      addMovement(client, {
        userId: currentUser.id,
        type: "cash_reversal",
        total: refundedTotal,
        note: `Сторно продажи #${saleId}`,
      })
      return
    }

    // Оплаты по заказам — через отмену заказа (№7); возврат — через откат возврата (этап C).
    throw new Error("Эту операцию здесь отменить нельзя.")
  })

  apply()
}

// Разбивка принятых оплат заказа по способам (prepayment/order_payment/deal_payment) — чтобы
// комбинированная оплата была видна явно: «чем уже оплачено» рядом с «к доплате» на выдаче.
// Plain-object (не Map) — результат уходит пропсом в клиентский компонент.
export function getOrderPaymentBreakdowns(
  orderIds: number[]
): Record<number, Array<{ paymentMethod: PaymentMethod; amount: number }>> {
  const breakdowns: Record<number, Array<{ paymentMethod: PaymentMethod; amount: number }>> = {}
  if (!orderIds.length) {
    return breakdowns
  }
  const placeholders = orderIds.map(() => "?").join(", ")
  const rows = db()
    .prepare(
      `SELECT order_id as orderId, payment_method as paymentMethod, COALESCE(SUM(amount), 0) as amount
       FROM cash_transactions
       WHERE order_id IN (${placeholders}) AND type IN ('prepayment', 'order_payment', 'deal_payment')
       GROUP BY order_id, payment_method
       ORDER BY MIN(id)`
    )
    .all(...orderIds) as Array<{ orderId: number; paymentMethod: string; amount: number }>
  for (const row of rows) {
    const orderId = numberFromRow(row.orderId)
    const method = paymentMethods.has(row.paymentMethod as PaymentMethod)
      ? (row.paymentMethod as PaymentMethod)
      : "cash"
    const list = breakdowns[orderId] ?? (breakdowns[orderId] = [])
    list.push({ paymentMethod: method, amount: numberFromRow(row.amount) })
  }
  return breakdowns
}
