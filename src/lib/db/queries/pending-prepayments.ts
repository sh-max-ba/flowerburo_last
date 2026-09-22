import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { formatInstant } from "@/lib/datetime"
import type { PaymentMethod } from "../types"
import { paymentMethods } from "../types"
import { recordCashTransaction } from "../ledger"
import { roundMoney } from "../form-parsers"

// Отложенная предоплата заказа (таблица order_pending_prepayments, v25).
//
// Предоплата, указанная при создании заказа (или в черновике — при отправке в работу), в кассу
// НЕ проводится сразу. Сумма уже сидит в orders.prepaid/paid (остаток к доплате считается верно),
// а способ + сумма + кто принял хранятся здесь. Кассовая проводка type='prepayment' создаётся
// в момент ВЫДАЧИ заказа (выдан клиенту / передан курьеру) — в смену выдачи, тем способом и от
// имени того сотрудника, что принял деньги. Так предоплата попадает в кассу того дня, когда
// заказ выдан, а не когда создан (по решению клиента; выручка и раньше признавалась в смене выдачи).
//
// Отмена заказа с непроведённой предоплатой — без кассовой операции по этой части: денег в кассе
// не было, возвращать «через кассу» нечего (как у черновиков). Строки при этом удаляются.

export type PendingPrepayment = {
  id: number
  orderId: number
  userId: number | null
  paymentMethod: PaymentMethod
  amount: number
  createdAt: string
}

type PendingPrepaymentRow = {
  id: number
  orderId: number
  userId: number | null
  paymentMethod: string
  amount: number
  createdAt: string
}

function rowToPendingPrepayment(row: PendingPrepaymentRow): PendingPrepayment {
  const method = paymentMethods.has(row.paymentMethod as PaymentMethod) ? (row.paymentMethod as PaymentMethod) : "cash"
  return {
    id: numberFromRow(row.id),
    orderId: numberFromRow(row.orderId),
    userId: row.userId == null ? null : numberFromRow(row.userId),
    paymentMethod: method,
    amount: numberFromRow(row.amount),
    createdAt: String(row.createdAt ?? ""),
  }
}

export function addPendingPrepayment(
  client: Database.Database,
  input: { orderId: number; userId: number | null; paymentMethod: PaymentMethod; amount: number }
) {
  if (!paymentMethods.has(input.paymentMethod)) {
    throw new Error("Некорректный способ оплаты.")
  }
  const amount = roundMoney(input.amount)
  if (amount <= 0) {
    throw new Error("Сумма предоплаты должна быть больше нуля.")
  }
  client
    .prepare(
      `INSERT INTO order_pending_prepayments (order_id, user_id, payment_method, amount)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.orderId, input.userId, input.paymentMethod, amount)
}

export function listPendingPrepayments(client: Database.Database, orderId: number): PendingPrepayment[] {
  const rows = client
    .prepare(
      `SELECT id, order_id as orderId, user_id as userId, payment_method as paymentMethod, amount, created_at as createdAt
       FROM order_pending_prepayments
       WHERE order_id = ?
       ORDER BY id ASC`
    )
    .all(orderId) as PendingPrepaymentRow[]
  return rows.map(rowToPendingPrepayment)
}

// Непроведённые части по списку заказов — для «Уже оплачено: …» на выдаче и в попапе возврата.
export function listPendingPrepaymentsByOrders(
  client: Database.Database,
  orderIds: number[]
): Map<number, PendingPrepayment[]> {
  const byOrder = new Map<number, PendingPrepayment[]>()
  if (!orderIds.length) {
    return byOrder
  }
  const placeholders = orderIds.map(() => "?").join(", ")
  const rows = client
    .prepare(
      `SELECT id, order_id as orderId, user_id as userId, payment_method as paymentMethod, amount, created_at as createdAt
       FROM order_pending_prepayments
       WHERE order_id IN (${placeholders})
       ORDER BY id ASC`
    )
    .all(...orderIds) as PendingPrepaymentRow[]
  for (const row of rows) {
    const entry = rowToPendingPrepayment(row)
    const list = byOrder.get(entry.orderId) ?? []
    list.push(entry)
    byOrder.set(entry.orderId, list)
  }
  return byOrder
}

export function sumPendingPrepayments(client: Database.Database, orderId: number): number {
  const row = client
    .prepare("SELECT COALESCE(SUM(amount), 0) as v FROM order_pending_prepayments WHERE order_id = ?")
    .get(orderId) as { v: number }
  return roundMoney(numberFromRow(row.v))
}

// Сумма всех непроведённых предоплат по незавершённым заказам — справочная строка в панели смены
// («проведутся в кассу при выдаче»). Строки удаляются при выдаче/отмене, JOIN — страховка.
export function sumAllPendingPrepayments(client: Database.Database): number {
  const row = client
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) as v
       FROM order_pending_prepayments p
       JOIN orders o ON o.id = p.order_id
       WHERE o.status != 'Отменен' AND o.completed_shift_id IS NULL`
    )
    .get() as { v: number }
  return roundMoney(numberFromRow(row.v))
}

// Момент выдачи: непроведённые части становятся кассовыми проводками смены выдачи (по одной
// на часть — смешанная предоплата остаётся метод-в-метод), user_id — кто принял деньги при
// создании заказа. Строки удаляются, чтобы повторная выдача/пересчёт не провёл их дважды.
// Возвращает проведённую сумму.
export function postPendingPrepayments(
  client: Database.Database,
  input: {
    orderId: number
    orderNumber: string
    shiftId: number
    customerId: number | null
    dealId: number | null
    fallbackUserId: number
  }
): number {
  const parts = listPendingPrepayments(client, input.orderId)
  let posted = 0
  for (const part of parts) {
    const acceptedOn = formatInstant(part.createdAt, { time: false })
    recordCashTransaction(client, {
      shiftId: input.shiftId,
      orderId: input.orderId,
      customerId: input.customerId,
      dealId: input.dealId,
      userId: part.userId ?? input.fallbackUserId,
      type: "prepayment",
      paymentMethod: part.paymentMethod,
      amount: part.amount,
      comment: `Предоплата по заказу ${input.orderNumber}${acceptedOn ? ` (принята ${acceptedOn}, проведена при выдаче)` : ""}`,
    })
    posted = roundMoney(posted + part.amount)
  }
  if (parts.length) {
    client.prepare("DELETE FROM order_pending_prepayments WHERE order_id = ?").run(input.orderId)
  }
  return posted
}

// Отмена заказа: непроведённые части просто снимаются (кассовой операции не было — и возврата
// через кассу нет). Возвращаем снятые части для сообщения менеджеру и журнала.
export function discardPendingPrepayments(client: Database.Database, orderId: number): PendingPrepayment[] {
  const parts = listPendingPrepayments(client, orderId)
  if (parts.length) {
    client.prepare("DELETE FROM order_pending_prepayments WHERE order_id = ?").run(orderId)
  }
  return parts
}
