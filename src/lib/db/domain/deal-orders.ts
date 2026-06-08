import type Database from "better-sqlite3"
import { cleanRowString, numberFromRow, normalizeOrderStatus } from "@/lib/db-row"
import { calculateCommercialTotals, normalizeDiscountType } from "@/lib/pricing"
import type { CurrentUser } from "../types"
import { activeDealOrderStatuses } from "../types"
import { db } from "../connection"
import { addMovement, applyProductDelta, getProduct, recordCashTransaction } from "../ledger"
import { clean, generateOrderNumber, normalizeDeliveryType, parsePaymentMethod, toNumber } from "../form-parsers"
import { parseForm } from "@/lib/forms/parse"
import { DealOrderInputSchema, DealOrderUpdateInputSchema, DealPaymentInputSchema } from "@/lib/forms/schemas"
import { calculateComponentLineTotal, itemsForCommercialTotals } from "../queries/commercial"
import { requireOpenShift } from "../queries/shifts"
import { getAllowOversellOrders } from "../queries/app-settings"
import { buildOrderItems } from "./order-lifecycle"

export function createOrderFromDeal(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  // Скалярная проверка dealId ("Сделка не найдена.") — через схему. Парсинг deliveryPrice/
  // courierPayout и их проверка >=0 остаются в транзакции (зависят от данных сделки).
  const { dealId } = parseForm(DealOrderInputSchema, formData)

  const create = client.transaction(() => {
    const deal = client.prepare("SELECT * FROM deals WHERE id = ?").get(dealId) as
      | Record<string, unknown>
      | undefined

    if (!deal) {
      throw new Error("Сделка не найдена.")
    }

    const activeOrder = client
      .prepare(
        `SELECT id, status
         FROM orders
         WHERE deal_id = ?
          AND status IN (${activeDealOrderStatuses.map(() => "?").join(", ")})
         ORDER BY updated_at DESC, created_at DESC, id DESC
         LIMIT 1`
      )
      .get(dealId, ...activeDealOrderStatuses) as { id: number; status: string } | undefined

    if (activeOrder) {
      throw new Error("По сделке уже есть активный заказ.")
    }

    const dealItems = client
      .prepare(
        `SELECT id, product_code as productCode, product_name as productName,
          qty, price, COALESCE(discount_type, 'none') as discountType,
          COALESCE(discount_value, 0) as discountValue,
          bouquet_id as bouquetId, COALESCE(bouquet_name, '') as bouquetName,
          COALESCE(bouquet_group_id, '') as bouquetGroupId
         FROM deal_items
         WHERE deal_id = ?
         ORDER BY id ASC`
      )
      .all(dealId) as Array<Record<string, unknown>>

    if (!dealItems.length) {
      throw new Error("Добавьте товары в сделку перед созданием заказа")
    }

    const items = dealItems.map((item) => {
      const productCode = String(item.productCode ?? "")
      if (!getProduct(client, productCode)) {
        throw new Error(`Товар ${productCode} не найден.`)
      }

      const qty = numberFromRow(item.qty)
      if (qty <= 0) {
        throw new Error("Количество в каждой позиции сделки должно быть больше нуля.")
      }

      const discountType = normalizeDiscountType(String(item.discountType ?? "none"))
      const discountValue = discountType === "none" ? 0 : Math.max(0, numberFromRow(item.discountValue))
      const price = numberFromRow(item.price)
      const bouquetId = item.bouquetId === null || item.bouquetId === undefined ? null : numberFromRow(item.bouquetId)
      const bouquetName = String(item.bouquetName ?? "")
      const bouquetGroupId = String(item.bouquetGroupId ?? "")
      const line = calculateComponentLineTotal({
        qty,
        price,
        bouquetGroupId,
        discountType,
        discountValue,
      })

      return {
        id: numberFromRow(item.id),
        productCode,
        name: String(item.productName ?? productCode),
        qty,
        price,
        bouquetId: bouquetId && bouquetId > 0 ? bouquetId : null,
        bouquetName: bouquetGroupId ? bouquetName : "",
        bouquetGroupId,
        discountType,
        discountValue,
        discountAmount: line.discountAmount,
        totalBeforeDiscount: line.totalBeforeDiscount,
        total: line.total,
      }
    })

    const orderDiscountType = normalizeDiscountType(String(deal.deal_discount_type ?? "none"))
    const orderDiscountValue =
      orderDiscountType === "none" ? 0 : Math.max(0, numberFromRow(deal.deal_discount_value))
    const totals = calculateCommercialTotals(itemsForCommercialTotals(items), orderDiscountType, orderDiscountValue)
    const deliveryPrice = toNumber(formData.get("deliveryPrice"))
    const courierPayout = toNumber(formData.get("courierPayout"))
    if (deliveryPrice < 0 || courierPayout < 0) {
      throw new Error("Доставка и выплата курьеру не могут быть отрицательными.")
    }

    const orderTotal = totals.total + deliveryPrice
    // C1: в новый заказ переносим только ту часть оплаты сделки, что ещё НЕ закреплена за
    // существующими (не отменёнными) заказами. Иначе повторный заказ по сделке (после уже
    // выданного) скопировал бы deal.paid как оплату, не приняв денег → бесплатный заказ.
    const dealPaid = Math.max(0, numberFromRow(deal.paid))
    const priorPaidRow = client
      .prepare("SELECT COALESCE(SUM(paid), 0) AS paid FROM orders WHERE deal_id = ? AND status <> 'Отменен'")
      .get(dealId) as { paid: number } | undefined
    const paid = Math.max(0, dealPaid - Math.max(0, numberFromRow(priorPaidRow?.paid)))
    if (paid - orderTotal > 0.009) {
      throw new Error("Оплата по сделке не может быть больше суммы заказа.")
    }
    const customer = cleanRowString(deal.customer_name) || "Клиент сделки"
    const phone = cleanRowString(deal.customer_phone)
    const recipientPhone = formData.has("recipientPhone")
      ? clean(formData.get("recipientPhone"))
      : cleanRowString(deal.recipient_phone)
    const deliveryType = normalizeDeliveryType(
      formData.has("deliveryType") ? clean(formData.get("deliveryType")) : cleanRowString(deal.delivery_type)
    )
    const address = formData.has("address") ? clean(formData.get("address")) : cleanRowString(deal.address)
    const dueAt = formData.has("dueAt") ? clean(formData.get("dueAt")) : cleanRowString(deal.due_at)
    const note = formData.has("comment") ? clean(formData.get("comment")) : cleanRowString(deal.comment)

    const order = client
      .prepare(
        `INSERT INTO orders (
          created_by_user_id, updated_by_user_id, customer_id, deal_id, customer, phone, recipient_phone, source,
          delivery_type, address, due_at, status, items_total_before_discount, items_discount_total,
          order_discount_type, order_discount_value, order_discount_amount, total_before_discount,
          total, prepaid, paid, delivery_price, courier_payout, is_reserved, note, updated_at
        ) VALUES (
          @createdByUserId, @updatedByUserId, @customerId, @dealId, @customer, @phone, @recipientPhone, 'deal',
          @deliveryType, @address, @dueAt, 'Новый', @itemsTotalBeforeDiscount, @itemsDiscountTotal,
          @orderDiscountType, @orderDiscountValue, @orderDiscountAmount, @totalBeforeDiscount,
          @total, @prepaid, @paid, @deliveryPrice, @courierPayout, 1, @note, CURRENT_TIMESTAMP
        )`
      )
      .run({
        createdByUserId: currentUser.id,
        updatedByUserId: currentUser.id,
        customerId: deal.customer_id === null || deal.customer_id === undefined ? null : numberFromRow(deal.customer_id),
        dealId,
        customer,
        phone,
        recipientPhone,
        deliveryType,
        address: deliveryType === "delivery" ? address : "",
        dueAt,
        itemsTotalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        itemsDiscountTotal: totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountAmount: totals.dealDiscountAmount,
        totalBeforeDiscount: totals.itemsTotalBeforeDiscount + deliveryPrice,
        total: orderTotal,
        prepaid: paid,
        paid,
        deliveryPrice,
        courierPayout,
        note,
      })
    const orderId = Number(order.lastInsertRowid)
    const number = generateOrderNumber(orderId)

    client.prepare("UPDATE orders SET number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(number, orderId)

    // H2: привязываем «предоплаты по сделке» (внесённые ДО создания заказа, order_id IS NULL)
    // к этому заказу, чтобы при отмене возврат шёл ТЕМ ЖЕ способом оплаты (карта/перевод),
    // а не наличными из кассы.
    client
      .prepare(
        `UPDATE cash_transactions
         SET order_id = ?
         WHERE deal_id = ? AND order_id IS NULL
          AND type IN ('prepayment', 'order_payment', 'deal_payment')`
      )
      .run(orderId, dealId)

    const insertItem = client.prepare(
      `INSERT INTO order_items (
        order_id, product_code, name, qty, price, discount_type, discount_value,
        discount_amount, total_before_discount, total, is_custom, bouquet_id, bouquet_name, bouquet_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    const updateDealItem = client.prepare(
      `UPDATE deal_items
       SET discount_amount = ?, total_before_discount = ?, total = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )

    // Настройка «разрешить заказы с отсутствующими позициями» (резерв сверх остатка).
    const allowOversell = getAllowOversellOrders(client)
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
        item.bouquetId,
        item.bouquetName,
        item.bouquetGroupId
      )
      updateDealItem.run(item.discountAmount, item.totalBeforeDiscount, item.total, item.id)
      applyProductDelta(client, {
        productCode: item.productCode,
        reservedDelta: item.qty,
        type: "reserve",
        qty: item.qty,
        orderId,
        userId: currentUser.id,
        comment: "Резерв при создании заказа из сделки",
        enforceAvailable: !allowOversell,
      })
    }

    const orderStage = client
      .prepare(
        `SELECT id FROM deal_stages
         WHERE name = 'Оформлен заказ' COLLATE NOCASE
          AND (pipeline_id = ? OR ? IS NULL)
         ORDER BY pipeline_id = ? DESC, position ASC
         LIMIT 1`
      )
      .get(deal.pipeline_id ?? null, deal.pipeline_id ?? null, deal.pipeline_id ?? null) as
      | { id: number }
      | undefined

    client
      .prepare(
        `UPDATE deals
         SET order_id = ?, stage_id = COALESCE(?, stage_id),
          items_total = ?, items_discount_total = ?, deal_discount_type = ?,
          deal_discount_value = ?, deal_discount_amount = ?, total = ?,
          paid = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(
        orderId,
        orderStage?.id ?? null,
        totals.itemsTotalBeforeDiscount,
        totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        totals.dealDiscountAmount,
        orderTotal,
        dealPaid,
        dealId
      )

    addMovement(client, {
      userId: currentUser.id,
      type: "order_create",
      total: orderTotal,
      note: `Создан заказ ${number} из сделки ${String(deal.number ?? `#${dealId}`)}: ${customer}`,
    })

    return orderId
  })

  return create()
}

// Правка уже созданного заказа из карточки сделки. Источник истины по составу/суммам — заказ:
// переписываем order_items, корректируем резерв склада ДЕЛЬТОЙ, синхронно обновляем deal_items
// (заблокированное отражение) и итоги сделки, ставим is_modified=1. Менять можно только пока
// заказ ещё зарезервирован и не собран ('Новый'/'В работе'); иначе склад уже списан.
export function updateOrderFromDeal(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const { dealId, orderId } = parseForm(DealOrderUpdateInputSchema, formData)

  const update = client.transaction(() => {
    const deal = client.prepare("SELECT * FROM deals WHERE id = ?").get(dealId) as
      | Record<string, unknown>
      | undefined
    if (!deal) {
      throw new Error("Сделка не найдена.")
    }

    const order = client
      .prepare("SELECT id, status, paid, is_reserved FROM orders WHERE id = ? AND deal_id = ?")
      .get(orderId, dealId) as { id: number; status: string; paid: number; is_reserved: number } | undefined
    if (!order) {
      throw new Error("Заказ по сделке не найден.")
    }
    if (!order.is_reserved || (order.status !== "Новый" && order.status !== "В работе")) {
      throw new Error("Изменить состав можно только у нового заказа или заказа в работе.")
    }

    const items = buildOrderItems(client, formData)

    const orderDiscountType = normalizeDiscountType(String(deal.deal_discount_type ?? "none"))
    const orderDiscountValue =
      orderDiscountType === "none" ? 0 : Math.max(0, numberFromRow(deal.deal_discount_value))
    const totals = calculateCommercialTotals(itemsForCommercialTotals(items), orderDiscountType, orderDiscountValue)
    const deliveryPrice = toNumber(formData.get("deliveryPrice"))
    const courierPayout = toNumber(formData.get("courierPayout"))
    if (deliveryPrice < 0 || courierPayout < 0) {
      throw new Error("Доставка и выплата курьеру не могут быть отрицательными.")
    }
    const orderTotal = totals.total + deliveryPrice

    const paid = Math.max(0, numberFromRow(order.paid))
    if (paid - orderTotal > 0.009) {
      throw new Error("Сумма заказа не может быть меньше уже принятой оплаты.")
    }

    const recipientPhone = formData.has("recipientPhone")
      ? clean(formData.get("recipientPhone"))
      : cleanRowString(deal.recipient_phone)
    const deliveryType = normalizeDeliveryType(
      formData.has("deliveryType") ? clean(formData.get("deliveryType")) : cleanRowString(deal.delivery_type)
    )
    const address = formData.has("address") ? clean(formData.get("address")) : cleanRowString(deal.address)
    const dueAt = formData.has("dueAt") ? clean(formData.get("dueAt")) : cleanRowString(deal.due_at)
    const note = formData.has("comment") ? clean(formData.get("comment")) : cleanRowString(deal.comment)

    // Резерв склада меняем нетто-дельтой по товару. Сначала освобождаем (delta<0), затем
    // резервируем (delta>0) — иначе перестановка позиций ложно упёрлась бы в enforceAvailable.
    const reservedByProduct = new Map<string, number>()
    const oldItems = client
      .prepare("SELECT product_code as productCode, qty FROM order_items WHERE order_id = ?")
      .all(orderId) as Array<{ productCode: string; qty: number }>
    for (const item of oldItems) {
      reservedByProduct.set(
        item.productCode,
        (reservedByProduct.get(item.productCode) ?? 0) - numberFromRow(item.qty)
      )
    }
    for (const item of items) {
      reservedByProduct.set(item.productCode, (reservedByProduct.get(item.productCode) ?? 0) + item.qty)
    }
    // Настройка «разрешить заказы с отсутствующими позициями»: при включении не упираемся
    // в доступный остаток даже при увеличении резерва.
    const allowOversell = getAllowOversellOrders(client)
    const deltas = [...reservedByProduct.entries()].sort((a, b) => a[1] - b[1])
    for (const [productCode, delta] of deltas) {
      if (delta === 0) {
        continue
      }
      applyProductDelta(client, {
        productCode,
        reservedDelta: delta,
        type: delta > 0 ? "reserve" : "reserve_cancel",
        qty: delta,
        orderId,
        userId: currentUser.id,
        comment: "Изменение состава заказа из сделки",
        enforceAvailable: allowOversell ? false : delta > 0,
      })
    }

    // Переписываем позиции заказа.
    client.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId)
    const insertOrderItem = client.prepare(
      `INSERT INTO order_items (
        order_id, product_code, name, qty, price, discount_type, discount_value,
        discount_amount, total_before_discount, total, is_custom, bouquet_id, bouquet_name, bouquet_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    // Зеркалим состав в deal_items: карточка показывает заблокированное отражение заказа.
    client.prepare("DELETE FROM deal_items WHERE deal_id = ?").run(dealId)
    const insertDealItem = client.prepare(
      `INSERT INTO deal_items (
        deal_id, product_code, product_name, qty, price, bouquet_id, bouquet_name, bouquet_group_id,
        discount_type, discount_value, discount_amount, total_before_discount, total, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    for (const item of items) {
      insertOrderItem.run(
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
        item.bouquetId,
        item.bouquetName,
        item.bouquetGroupId
      )
      insertDealItem.run(
        dealId,
        item.productCode,
        item.name,
        item.qty,
        item.price,
        item.bouquetId,
        item.bouquetName,
        item.bouquetGroupId,
        item.discountType,
        item.discountValue,
        item.discountAmount,
        item.totalBeforeDiscount,
        item.total
      )
    }

    client
      .prepare(
        `UPDATE orders SET
          recipient_phone = @recipientPhone, delivery_type = @deliveryType, address = @address,
          due_at = @dueAt, note = @note,
          items_total_before_discount = @itemsTotalBeforeDiscount, items_discount_total = @itemsDiscountTotal,
          order_discount_type = @orderDiscountType, order_discount_value = @orderDiscountValue,
          order_discount_amount = @orderDiscountAmount, total_before_discount = @totalBeforeDiscount,
          total = @total, delivery_price = @deliveryPrice, courier_payout = @courierPayout,
          is_modified = 1, updated_by_user_id = @userId, updated_at = CURRENT_TIMESTAMP
         WHERE id = @orderId`
      )
      .run({
        orderId,
        recipientPhone,
        deliveryType,
        address: deliveryType === "delivery" ? address : "",
        dueAt,
        note,
        itemsTotalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        itemsDiscountTotal: totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountAmount: totals.dealDiscountAmount,
        totalBeforeDiscount: totals.itemsTotalBeforeDiscount + deliveryPrice,
        total: orderTotal,
        deliveryPrice,
        courierPayout,
        userId: currentUser.id,
      })

    // Синхронизируем итоги сделки с заказом (deal_items уже переписаны выше).
    client
      .prepare(
        `UPDATE deals
         SET items_total = ?, items_discount_total = ?, deal_discount_type = ?,
          deal_discount_value = ?, deal_discount_amount = ?, total = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(
        totals.itemsTotalBeforeDiscount,
        totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        totals.dealDiscountAmount,
        orderTotal,
        dealId
      )

    return orderId
  })

  return update()
}

// Редактирование заказа со «Стола заказов» (owner/manager/florist). Источник истины — заказ.
// Менять состав/срок/доставку можно ТОЛЬКО пока заказ зарезервирован и не собран ('Новый'/'В работе');
// после 'Готов' склад уже списан. Резерв правим нетто-дельтой по товару, поэтому при отметке
// «Букет готов» спишется ровно новый состав. Заказ из сделки обновляем через updateOrderFromDeal
// (та же логика резерва + зеркалирование состава/итогов в сделку); прямой кассовый заказ — здесь.
export function updateOrder(
  formData: FormData,
  currentUser: CurrentUser
): { orderId: number; dealId: number | null } {
  const client = db()
  const orderId = Number(String(formData.get("orderId") ?? ""))
  if (!orderId) {
    throw new Error("Не указан заказ для изменения.")
  }

  const head = client
    .prepare("SELECT status, COALESCE(is_reserved, 0) as isReserved, deal_id as dealId FROM orders WHERE id = ?")
    .get(orderId) as { status: string; isReserved: number; dealId: number | null } | undefined
  if (!head) {
    throw new Error("Заказ не найден.")
  }

  const status = normalizeOrderStatus(head.status)
  if (!head.isReserved || (status !== "Новый" && status !== "В работе")) {
    throw new Error("Изменить заказ можно только пока он не собран — в статусе «Новый» или «В работе».")
  }

  // Заказ привязан к сделке — переиспользуем проверенный путь (правит резерв и зеркалит в сделку).
  if (head.dealId !== null && head.dealId !== undefined) {
    const dealId = numberFromRow(head.dealId)
    formData.set("dealId", String(dealId))
    formData.set("orderId", String(orderId))
    updateOrderFromDeal(formData, currentUser)
    return { orderId, dealId }
  }

  const update = client.transaction(() => {
    const order = client.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as Record<string, unknown>

    const items = buildOrderItems(client, formData)

    // Скидку на чек прямого (не из сделки) заказа сохраняем как была, если форма её не прислала.
    const orderDiscountType = normalizeDiscountType(
      formData.has("orderDiscountType")
        ? clean(formData.get("orderDiscountType"))
        : String(order.order_discount_type ?? "none")
    )
    const orderDiscountValue =
      orderDiscountType === "none"
        ? 0
        : Math.max(
            0,
            formData.has("orderDiscountValue")
              ? toNumber(formData.get("orderDiscountValue"))
              : numberFromRow(order.order_discount_value)
          )

    const totals = calculateCommercialTotals(itemsForCommercialTotals(items), orderDiscountType, orderDiscountValue)

    const deliveryType = normalizeDeliveryType(
      formData.has("deliveryType") ? clean(formData.get("deliveryType")) : String(order.delivery_type ?? "pickup")
    )
    const deliveryPrice = formData.has("deliveryPrice")
      ? toNumber(formData.get("deliveryPrice"))
      : numberFromRow(order.delivery_price)
    const courierPayout = formData.has("courierPayout")
      ? toNumber(formData.get("courierPayout"))
      : numberFromRow(order.courier_payout)
    if (deliveryPrice < 0 || courierPayout < 0) {
      throw new Error("Доставка и выплата курьеру не могут быть отрицательными.")
    }
    const effectiveDeliveryPrice = deliveryType === "delivery" ? deliveryPrice : 0
    const orderTotal = totals.total + effectiveDeliveryPrice

    const paid = Math.max(0, numberFromRow(order.paid))
    if (paid - orderTotal > 0.009) {
      throw new Error("Сумма заказа не может быть меньше уже принятой оплаты.")
    }

    const recipientPhone = formData.has("recipientPhone")
      ? clean(formData.get("recipientPhone"))
      : cleanRowString(order.recipient_phone)
    const address = formData.has("address") ? clean(formData.get("address")) : cleanRowString(order.address)
    const dueAt = formData.has("dueAt") ? clean(formData.get("dueAt")) : cleanRowString(order.due_at)
    const note = formData.has("comment") ? clean(formData.get("comment")) : cleanRowString(order.note)

    // Резерв склада — нетто-дельтой (сперва освобождаем, потом резервируем, чтобы перестановка
    // позиций не упёрлась ложно в проверку доступного остатка).
    reconcileOrderReserve(client, orderId, items, getAllowOversellOrders(client), currentUser)

    client.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId)
    const insertOrderItem = client.prepare(
      `INSERT INTO order_items (
        order_id, product_code, name, qty, price, discount_type, discount_value,
        discount_amount, total_before_discount, total, is_custom, bouquet_id, bouquet_name, bouquet_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    for (const item of items) {
      insertOrderItem.run(
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
        item.bouquetId,
        item.bouquetName,
        item.bouquetGroupId
      )
    }

    client
      .prepare(
        `UPDATE orders SET
          recipient_phone = @recipientPhone, delivery_type = @deliveryType, address = @address,
          due_at = @dueAt, note = @note,
          items_total_before_discount = @itemsTotalBeforeDiscount, items_discount_total = @itemsDiscountTotal,
          order_discount_type = @orderDiscountType, order_discount_value = @orderDiscountValue,
          order_discount_amount = @orderDiscountAmount, total_before_discount = @totalBeforeDiscount,
          total = @total, delivery_price = @deliveryPrice, courier_payout = @courierPayout,
          is_modified = 1, updated_by_user_id = @userId, updated_at = CURRENT_TIMESTAMP
         WHERE id = @orderId`
      )
      .run({
        orderId,
        recipientPhone,
        deliveryType,
        address: deliveryType === "delivery" ? address : "",
        dueAt,
        note,
        itemsTotalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        itemsDiscountTotal: totals.itemsDiscountTotal,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountAmount: totals.dealDiscountAmount,
        totalBeforeDiscount: totals.itemsTotalBeforeDiscount + effectiveDeliveryPrice,
        total: orderTotal,
        deliveryPrice: effectiveDeliveryPrice,
        courierPayout,
        userId: currentUser.id,
      })
  })

  update()
  return { orderId, dealId: null }
}

// Нетто-коррекция резерва склада по составу заказа (общая для прямого редактирования заказа).
function reconcileOrderReserve(
  client: Database.Database,
  orderId: number,
  newItems: Array<{ productCode: string; qty: number }>,
  allowOversell: boolean,
  currentUser: CurrentUser
) {
  const reservedByProduct = new Map<string, number>()
  const oldItems = client
    .prepare("SELECT product_code as productCode, qty FROM order_items WHERE order_id = ?")
    .all(orderId) as Array<{ productCode: string; qty: number }>
  for (const item of oldItems) {
    reservedByProduct.set(item.productCode, (reservedByProduct.get(item.productCode) ?? 0) - numberFromRow(item.qty))
  }
  for (const item of newItems) {
    reservedByProduct.set(item.productCode, (reservedByProduct.get(item.productCode) ?? 0) + item.qty)
  }
  const deltas = [...reservedByProduct.entries()].sort((a, b) => a[1] - b[1])
  for (const [productCode, delta] of deltas) {
    if (delta === 0) {
      continue
    }
    applyProductDelta(client, {
      productCode,
      reservedDelta: delta,
      type: delta > 0 ? "reserve" : "reserve_cancel",
      qty: delta,
      orderId,
      userId: currentUser.id,
      comment: "Изменение состава заказа",
      enforceAvailable: allowOversell ? false : delta > 0,
    })
  }
}

export function acceptDealPayment(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  // parsePaymentMethod сохраняет исходный порядок (бросает "Некорректный способ оплаты." до
  // проверок dealId/amount). Скалярные правила dealId!=0 / amount>0 с теми же русскими
  // текстами кодирует DealPaymentInputSchema; лимиты остатка остаются в транзакции.
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const { dealId, amount, comment } = parseForm(DealPaymentInputSchema, formData)

  const accept = client.transaction(() => {
    const shift = requireOpenShift(client)
    const deal = client.prepare("SELECT * FROM deals WHERE id = ?").get(dealId) as
      | Record<string, unknown>
      | undefined

    if (!deal) {
      throw new Error("Сделка не найдена.")
    }

    const total = numberFromRow(deal.total)
    const paid = numberFromRow(deal.paid)
    const balance = Math.max(0, total - paid)

    if (balance <= 0) {
      throw new Error("Сделка уже оплачена.")
    }

    if (amount - balance > 0.009) {
      throw new Error("Сумма оплаты не может быть больше остатка.")
    }

    const orderId = numberFromRow(deal.order_id) || null
    const customerId = numberFromRow(deal.customer_id) || null
    let paymentLimit = balance

    if (orderId) {
      const order = client.prepare("SELECT total, paid FROM orders WHERE id = ?").get(orderId) as
        | { total: number; paid: number }
        | undefined
      if (!order) {
        throw new Error("Заказ по сделке не найден.")
      }

      const orderBalance = Math.max(0, numberFromRow(order.total) - numberFromRow(order.paid))
      if (orderBalance <= 0) {
        throw new Error("Заказ уже оплачен.")
      }

      paymentLimit = Math.min(paymentLimit, orderBalance)
    }

    if (amount - paymentLimit > 0.009) {
      throw new Error("Сумма оплаты не может быть больше остатка.")
    }

    recordCashTransaction(client, {
      shiftId: shift.id,
      orderId,
      customerId,
      dealId,
      userId: currentUser.id,
      type: "deal_payment",
      paymentMethod,
      amount,
      comment: comment || `Оплата по сделке ${String(deal.number ?? `#${dealId}`)}`,
    })

    client
      .prepare("UPDATE deals SET paid = COALESCE(paid, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(amount, dealId)

    if (orderId) {
      client
        .prepare(
          `UPDATE orders
           SET paid = COALESCE(paid, 0) + ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(amount, currentUser.id, orderId)
    }
  })

  accept()
}
