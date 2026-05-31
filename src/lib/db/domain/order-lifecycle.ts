import type Database from "better-sqlite3"
import { numberFromRow, normalizeOrderStatus } from "@/lib/db-row"
import { calculateCommercialTotals, normalizeDiscountType } from "@/lib/pricing"
import type { CurrentUser, OrderStatus } from "../types"
import { db } from "../connection"
import { addMovement, applyProductDelta, getProduct, recordCashTransaction } from "../ledger"
import { clean, generateOrderNumber, parsePaymentMethod, roundMoney, toNumber, toOptionalNumber } from "../form-parsers"
import { parseForm } from "@/lib/forms/parse"
import { OrderInputSchema } from "@/lib/forms/schemas"
import { paymentMethods } from "../types"
import type { PaymentMethod } from "../types"
import { calculateComponentLineTotal, itemsForCommercialTotals, resolveCashCustomer } from "../queries/commercial"
import { requireOpenShift } from "../queries/shifts"

function buildOrderItems(client: Database.Database, formData: FormData) {
  const productCodes = formData.getAll("itemProductCode").map((value) => clean(value))
  const qtyValues = formData.getAll("itemQty")
  const priceValues = formData.getAll("itemPrice")
  const discountTypes = formData.getAll("itemDiscountType")
  const discountValues = formData.getAll("itemDiscountValue")
  const bouquetIds = formData.getAll("itemBouquetId")
  const bouquetNames = formData.getAll("itemBouquetName")
  const bouquetGroupIds = formData.getAll("itemBouquetGroupId")

  if (!productCodes.length || productCodes.every((code) => !code)) {
    throw new Error("Добавьте в заказ хотя бы одну позицию со склада.")
  }

  return productCodes.map((productCode, index) => {
    if (!productCode) {
      throw new Error("У каждой позиции заказа должен быть товар со склада.")
    }

    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }

    const qty = toNumber(qtyValues[index]) || 0
    if (qty <= 0) {
      throw new Error("Количество в каждой позиции заказа должно быть больше нуля.")
    }

    const explicitPrice = toOptionalNumber(priceValues[index])
    if (explicitPrice !== null && explicitPrice < 0) {
      throw new Error("Цена позиции заказа не может быть отрицательной.")
    }

    const price = explicitPrice ?? numberFromRow(product.sale_price)
    const discountType = normalizeDiscountType(clean(discountTypes[index] ?? null))
    const discountValue = discountType === "none" ? 0 : Math.max(0, toNumber(discountValues[index]))
    const bouquetId = toOptionalNumber(bouquetIds[index] ?? null)
    const bouquetName = clean(bouquetNames[index] ?? null)
    const bouquetGroupId = clean(bouquetGroupIds[index] ?? null)
    const totals = calculateComponentLineTotal({
      qty,
      price,
      bouquetGroupId,
      discountType,
      discountValue,
    })

    return {
      productCode,
      name: String(product.name),
      qty,
      price,
      bouquetId: bouquetId && bouquetId > 0 ? bouquetId : null,
      bouquetName: bouquetGroupId ? bouquetName : "",
      bouquetGroupId,
      discountType,
      discountValue,
      discountAmount: totals.discountAmount,
      totalBeforeDiscount: totals.totalBeforeDiscount,
      total: totals.total,
    }
  })
}

export function createOrder(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const customerSnapshot = resolveCashCustomer(client, formData)
  const customer = customerSnapshot.name || clean(formData.get("customer")) || clean(formData.get("customer_name"))
  const phone = customerSnapshot.phone || clean(formData.get("phone"))
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const orderDiscountType = normalizeDiscountType(clean(formData.get("orderDiscountType")))
  const orderDiscountValue = orderDiscountType === "none" ? 0 : Math.max(0, toNumber(formData.get("orderDiscountValue")))

  if (!customer) {
    throw new Error("Укажите имя клиента.")
  }

  // Скалярные правила prepaid>=0 / deliveryType in [pickup,delivery] / delivery>=0,courier>=0
  // (с теми же русскими текстами) кодирует OrderInputSchema; порядок полей сохраняет порядок
  // исходных проверок. Инвариант prepaid<=total остаётся в транзакции (зависит от позиций).
  const { recipientPhone, dueAt, deliveryType, address, source, note, deliveryPrice, courierPayout, prepaid } =
    parseForm(OrderInputSchema, formData)

  const saveOrder = client.transaction(() => {
    const items = buildOrderItems(client, formData)
    const totals = calculateCommercialTotals(itemsForCommercialTotals(items), orderDiscountType, orderDiscountValue)
    const total = totals.total + deliveryPrice

    if (prepaid > total && total >= 0) {
      throw new Error("Предоплата не может быть больше суммы заказа.")
    }

    const shift = prepaid > 0 ? requireOpenShift(client) : null
    const order = client
      .prepare(
        `INSERT INTO orders (
          created_by_user_id, updated_by_user_id, customer_id, customer, phone, recipient_phone, source,
          delivery_type, address, due_at, status, items_total_before_discount, items_discount_total, order_discount_type,
          order_discount_value, order_discount_amount, total_before_discount, total, prepaid, paid,
          delivery_price, courier_payout, is_reserved, note, updated_at
        ) VALUES (
          @createdByUserId, @updatedByUserId, @customerId, @customer, @phone, @recipientPhone, @source,
          @deliveryType, @address, @dueAt, 'Новый', @itemsTotalBeforeDiscount, @itemsDiscountTotal, @orderDiscountType,
          @orderDiscountValue, @orderDiscountAmount, @totalBeforeDiscount, @total, @prepaid, @paid,
          @deliveryPrice, @courierPayout, 1, @note, CURRENT_TIMESTAMP
        )`
      )
      .run({
        createdByUserId: currentUser.id,
        updatedByUserId: currentUser.id,
        customerId: customerSnapshot.id,
        customer,
        phone,
        recipientPhone,
        source,
        deliveryType,
        address: deliveryType === "delivery" ? address : "",
        dueAt,
        itemsTotalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        itemsDiscountTotal: totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountAmount: totals.dealDiscountAmount,
        totalBeforeDiscount: totals.itemsTotalBeforeDiscount + deliveryPrice,
        total,
        prepaid,
        paid: prepaid,
        deliveryPrice,
        courierPayout,
        note,
      })
    const orderId = Number(order.lastInsertRowid)
    const number = generateOrderNumber(orderId)

    client.prepare("UPDATE orders SET number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(number, orderId)

    const insertItem = client.prepare(
      `INSERT INTO order_items (
        order_id, product_code, name, qty, price, discount_type, discount_value,
        discount_amount, total_before_discount, total, is_custom, bouquet_id, bouquet_name, bouquet_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const item of items) {
      insertItem.run(
        orderId,
        item.productCode,
        item.name,
        item.qty,
        item.price,
        item.discountType,
        item.discountValue,
        item.discountAmount,
        item.totalBeforeDiscount,
        item.total,
        0,
        item.bouquetId,
        item.bouquetName,
        item.bouquetGroupId
      )
      applyProductDelta(client, {
        productCode: item.productCode,
        reservedDelta: item.qty,
        type: "reserve",
        qty: item.qty,
        orderId,
        userId: currentUser.id,
        comment: "Резерв при создании заказа",
        enforceAvailable: true,
      })
    }

    if (shift && prepaid > 0) {
      recordCashTransaction(client, {
        shiftId: shift.id,
        orderId,
        customerId: customerSnapshot.id,
        userId: currentUser.id,
        type: "prepayment",
        paymentMethod,
        amount: prepaid,
        comment: `Предоплата по заказу ${number}`,
      })
    }

    addMovement(client, {
      userId: currentUser.id,
      type: "order_create",
      total,
      note: `Создан заказ ${number}: ${customer}`,
    })
  })

  saveOrder()
}

function getOrderWithItems(client: Database.Database, orderId: number) {
  const order = client.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as
    | Record<string, unknown>
    | undefined

  if (!order) {
    throw new Error("Заказ не найден.")
  }

  const items = client
    .prepare("SELECT * FROM order_items WHERE order_id = ?")
    .all(orderId) as Array<{ product_code: string | null; qty: number; name: string }>

  if (items.some((item) => !item.product_code)) {
    throw new Error("В заказе есть позиция без product_code. Новые операции доступны только для товаров со склада.")
  }

  return {
    order: {
      ...order,
      status: normalizeOrderStatus(order.status),
    } as Record<string, unknown> & { status: OrderStatus },
    items: items as Array<{ product_code: string; qty: number; name: string }>,
  }
}

function cancelOrderReserve(
  client: Database.Database,
  orderId: number,
  items: Array<{ product_code: string; qty: number; name: string }>,
  currentUser: CurrentUser
) {
  for (const item of items) {
    applyProductDelta(client, {
      productCode: item.product_code,
      reservedDelta: -numberFromRow(item.qty),
      type: "reserve_cancel",
      qty: -numberFromRow(item.qty),
      orderId,
      userId: currentUser.id,
      comment: "Отмена резерва при отмене заказа",
    })
  }
}

function fulfillOrderItems(
  client: Database.Database,
  orderId: number,
  items: Array<{ product_code: string; qty: number; name: string }>,
  wasReserved: boolean,
  currentUser: CurrentUser
) {
  for (const item of items) {
    const qty = numberFromRow(item.qty)
    applyProductDelta(client, {
      productCode: item.product_code,
      stockDelta: -qty,
      reservedDelta: wasReserved ? -qty : 0,
      type: "order_fulfill",
      qty: -qty,
      orderId,
      userId: currentUser.id,
      comment: "Списание при готовности букета",
    })
  }
}

export function startOrderWork(orderId: number, currentUser: CurrentUser) {
  const client = db()

  const changeStatus = client.transaction(() => {
    const { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Новый") {
      return
    }

    client
      .prepare("UPDATE orders SET status = 'В работе', updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: В работе`,
    })
  })

  changeStatus()
}

export function markOrderReady(orderId: number, currentUser: CurrentUser) {
  const client = db()
  const changeStatus = client.transaction(() => {
    const { order, items } = getOrderWithItems(client, orderId)
    const wasReserved = Number(order.is_reserved ?? 0) === 1

    if (["Готов", "Передан курьеру", "Выдан"].includes(order.status)) {
      return
    }

    if (!["Новый", "В работе"].includes(order.status)) {
      throw new Error("Этот заказ нельзя отметить готовым.")
    }

    fulfillOrderItems(client, orderId, items, wasReserved, currentUser)

    client
      .prepare(
        `UPDATE orders
         SET status = 'Готов', is_reserved = 0, ready_at = CURRENT_TIMESTAMP,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Готов`,
    })
  })

  changeStatus()
}

function applyOrderPayment(
  client: Database.Database,
  orderId: number,
  formData: FormData,
  shiftId: number,
  currentUser: CurrentUser
) {
  const amount = toNumber(formData.get("paymentAmount"))
  if (amount <= 0) {
    return 0
  }

  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const { order } = getOrderWithItems(client, orderId)
  const dealId = numberFromRow(order.deal_id) || null
  const customerId = numberFromRow(order.customer_id) || null
  const balance = Math.max(0, numberFromRow(order.total) - numberFromRow(order.paid))
  let paymentLimit = balance

  if (balance <= 0) {
    throw new Error("Заказ уже оплачен.")
  }

  if (dealId) {
    const deal = client.prepare("SELECT total, paid FROM deals WHERE id = ?").get(dealId) as
      | { total: number; paid: number }
      | undefined
    if (!deal) {
      throw new Error("Сделка по заказу не найдена.")
    }

    const dealBalance = Math.max(0, numberFromRow(deal.total) - numberFromRow(deal.paid))
    if (dealBalance <= 0) {
      throw new Error("Сделка уже оплачена.")
    }

    paymentLimit = Math.min(paymentLimit, dealBalance)
  }

  if (amount - paymentLimit > 0.009) {
    throw new Error("Сумма оплаты не может быть больше остатка.")
  }

  recordCashTransaction(client, {
    shiftId,
    orderId,
    customerId,
    dealId,
    userId: currentUser.id,
    type: "order_payment",
    paymentMethod,
    amount,
    comment: `Доплата по заказу #${orderId}`,
  })
  client
    .prepare(
      `UPDATE orders
       SET paid = COALESCE(paid, 0) + ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(amount, currentUser.id, orderId)

  if (dealId) {
    client
      .prepare("UPDATE deals SET paid = COALESCE(paid, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(amount, dealId)
  }

  return amount
}

export function completePickupOrder(orderId: number, formData: FormData, currentUser: CurrentUser) {
  const client = db()
  let acceptedPayment = false

  const complete = client.transaction(() => {
    let { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Готов") {
      throw new Error("Выдать клиенту можно только готовый заказ.")
    }

    const beforeBalance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (beforeBalance > 0) {
      const shift = requireOpenShift(client)
      acceptedPayment = applyOrderPayment(client, orderId, formData, shift.id, currentUser) > 0
    }

    order = getOrderWithItems(client, orderId).order
    const balance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (balance > 0) {
      throw new Error("Нельзя выдать заказ, пока сумма не закрыта.")
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Выдан', completed_at = CURRENT_TIMESTAMP,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Выдан`,
    })
  })

  complete()
  return acceptedPayment
}

export function handOrderToCourier(orderId: number, formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const result = { acceptedPayment: false, paidCourier: false }

  const handOver = client.transaction(() => {
    let { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Готов") {
      throw new Error("Передать курьеру можно только готовый заказ.")
    }

    const needsPayment = numberFromRow(order.total) - numberFromRow(order.paid) > 0
    const wantsCourierCash = clean(formData.get("payCourier")) === "on"
    const needsCourierCash =
      numberFromRow(order.courier_payout) > 0 && Number(order.delivery_payout_paid ?? 0) !== 1 && wantsCourierCash
    const shift = needsPayment || needsCourierCash ? requireOpenShift(client) : null

    if (needsPayment && shift) {
      result.acceptedPayment = applyOrderPayment(client, orderId, formData, shift.id, currentUser) > 0
    }

    order = getOrderWithItems(client, orderId).order
    const balance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (balance > 0) {
      throw new Error("Нельзя передать курьеру заказ с остатком к оплате.")
    }

    if (needsCourierCash && shift) {
      const amount = numberFromRow(order.courier_payout)
      recordCashTransaction(client, {
        shiftId: shift.id,
        orderId,
        userId: currentUser.id,
        type: "cash_out",
        paymentMethod: "cash",
        amount,
        comment: `Оплата курьеру за заказ №${String(order.number ?? orderId)}`,
      })
      client
        .prepare(
          `UPDATE orders
           SET delivery_payout_paid = 1, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(currentUser.id, orderId)
      result.paidCourier = true
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Передан курьеру', handed_to_courier_at = CURRENT_TIMESTAMP,
          courier_name = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(clean(formData.get("courierName")), currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Передан курьеру`,
    })
  })

  handOver()
  return result
}

export function closeDeliveredOrder(orderId: number, currentUser: CurrentUser) {
  const client = db()
  const close = client.transaction(() => {
    const { order } = getOrderWithItems(client, orderId)
    if (order.status !== "Передан курьеру") {
      throw new Error("Закрыть доставку можно только после передачи курьеру.")
    }

    client
      .prepare(
        `UPDATE orders
         SET status = 'Выдан', completed_at = CURRENT_TIMESTAMP,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Выдан`,
    })
  })

  close()
}

// Возврат клиенту денег, фактически полученных по заказу, при его отмене.
// Возвращает сумму тем же способом оплаты, которым она поступала (это важно для
// expectedCash: в кассу влияет только cash_refund со способом "cash").
function refundOrderPayments(
  client: Database.Database,
  orderId: number,
  order: Record<string, unknown>,
  currentUser: CurrentUser
) {
  const orderPaid = roundMoney(numberFromRow(order.paid))
  if (orderPaid <= 0.009) {
    return 0
  }

  const shift = requireOpenShift(client)
  const customerId = numberFromRow(order.customer_id) || null
  const dealId = numberFromRow(order.deal_id) || null
  const orderLabel = String(order.number ?? `#${orderId}`)

  const byMethod = client
    .prepare(
      `SELECT payment_method as paymentMethod, COALESCE(SUM(amount), 0) as amount
       FROM cash_transactions
       WHERE order_id = ? AND type IN ('prepayment', 'order_payment', 'deal_payment')
       GROUP BY payment_method
       ORDER BY amount DESC`
    )
    .all(orderId) as Array<{ paymentMethod: PaymentMethod; amount: number }>

  let remaining = orderPaid
  const refund = (paymentMethod: PaymentMethod, amount: number, suffix = "") => {
    const value = roundMoney(amount)
    if (value <= 0.009) {
      return
    }
    recordCashTransaction(client, {
      shiftId: shift.id,
      orderId,
      customerId,
      dealId,
      userId: currentUser.id,
      type: "cash_refund",
      paymentMethod,
      amount: value,
      comment: `Возврат при отмене заказа ${orderLabel}${suffix}`,
    })
    remaining = roundMoney(remaining - value)
  }

  for (const row of byMethod) {
    if (remaining <= 0.009) {
      break
    }
    const method = paymentMethods.has(row.paymentMethod) ? row.paymentMethod : "cash"
    refund(method, Math.min(numberFromRow(row.amount), remaining))
  }

  if (remaining > 0.009) {
    // Перенесённая предоплата без проводки, привязанной к заказу (например, оплата
    // по сделке до создания заказа) — возвращаем остаток наличными.
    refund("cash", remaining, " (предоплата)")
  }

  client
    .prepare(
      `UPDATE orders
       SET paid = 0, prepaid = 0, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(currentUser.id, orderId)

  if (dealId) {
    client
      .prepare(
        `UPDATE deals
         SET paid = MAX(0, COALESCE(paid, 0) - ?), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(orderPaid, dealId)
  }

  return orderPaid
}

export function cancelOrder(orderId: number, currentUser: CurrentUser) {
  const client = db()
  let alreadyBuilt = false
  let dealId: number | null = null
  let refunded = 0

  const cancel = client.transaction(() => {
    const { order, items } = getOrderWithItems(client, orderId)
    const wasReserved = Number(order.is_reserved ?? 0) === 1
    dealId = numberFromRow(order.deal_id) || null

    if (["Выдан", "Отменен"].includes(order.status)) {
      return
    }

    if (["Новый", "В работе"].includes(order.status)) {
      if (wasReserved) {
        cancelOrderReserve(client, orderId, items, currentUser)
      }
    } else if (["Готов", "Передан курьеру"].includes(order.status)) {
      alreadyBuilt = true
    }

    refunded = refundOrderPayments(client, orderId, order, currentUser)

    client
      .prepare(
        `UPDATE orders
         SET status = 'Отменен', is_reserved = 0, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Отменен`,
    })
  })

  cancel()
  return { alreadyBuilt, dealId, refunded }
}
