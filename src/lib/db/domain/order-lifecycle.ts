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
import { getAllowOversellOrders } from "../queries/app-settings"

export function buildOrderItems(client: Database.Database, formData: FormData) {
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
    // Настройка «разрешить заказы с отсутствующими позициями»: когда включена, не упираемся
    // в доступный остаток при резерве (остаток уходит в минус).
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
        enforceAvailable: !allowOversell,
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

// Мягкий разбор позиций черновика: пропускаем пустые строки и несуществующие товары / qty<=0,
// НЕ бросаем (валидация состава — при отправке в работу). Цена по умолчанию = sale_price товара.
function buildDraftOrderItems(client: Database.Database, formData: FormData) {
  const productCodes = formData.getAll("itemProductCode").map((value) => clean(value))
  const qtyValues = formData.getAll("itemQty")
  const priceValues = formData.getAll("itemPrice")
  const discountTypes = formData.getAll("itemDiscountType")
  const discountValues = formData.getAll("itemDiscountValue")
  const bouquetIds = formData.getAll("itemBouquetId")
  const bouquetNames = formData.getAll("itemBouquetName")
  const bouquetGroupIds = formData.getAll("itemBouquetGroupId")

  const items: ReturnType<typeof buildOrderItems> = []
  productCodes.forEach((productCode, index) => {
    if (!productCode) return
    const product = getProduct(client, productCode)
    if (!product) return
    const qty = toNumber(qtyValues[index]) || 0
    if (qty <= 0) return
    const explicitPrice = toOptionalNumber(priceValues[index])
    const price = explicitPrice !== null && explicitPrice >= 0 ? explicitPrice : numberFromRow(product.sale_price)
    const discountType = normalizeDiscountType(clean(discountTypes[index] ?? null))
    const discountValue = discountType === "none" ? 0 : Math.max(0, toNumber(discountValues[index]))
    const bouquetId = toOptionalNumber(bouquetIds[index] ?? null)
    const bouquetGroupId = clean(bouquetGroupIds[index] ?? null)
    const bouquetName = clean(bouquetNames[index] ?? null)
    const totals = calculateComponentLineTotal({ qty, price, bouquetGroupId, discountType, discountValue })
    items.push({
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
    })
  })
  return items
}

// Общие необязательные поля черновика (всё мягко, без OrderInputSchema/инварианта prepaid<=total).
function parseDraftFields(formData: FormData) {
  const deliveryType = clean(formData.get("deliveryType")) === "delivery" ? "delivery" : "pickup"
  return {
    recipientPhone: clean(formData.get("recipientPhone")),
    dueAt: clean(formData.get("dueAt")),
    deliveryType,
    address: deliveryType === "delivery" ? clean(formData.get("address")) : "",
    source: clean(formData.get("source")),
    note: clean(formData.get("note")),
    deliveryPrice: Math.max(0, toNumber(formData.get("deliveryPrice"))),
    courierPayout: Math.max(0, toNumber(formData.get("courierPayout"))),
    orderDiscountType: normalizeDiscountType(clean(formData.get("orderDiscountType"))),
    orderDiscountValue: Math.max(0, toNumber(formData.get("orderDiscountValue"))),
  }
}

function writeDraftItems(
  client: Database.Database,
  orderId: number,
  items: ReturnType<typeof buildOrderItems>
) {
  client.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId)
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
  }
}

// Черновик заказа: недоформленный заказ. Минимум — имя клиента; БЕЗ резерва склада, БЕЗ предоплаты/смены,
// БЕЗ движения в журнале (резерв и событие — только при отправке в работу).
export function createOrderDraft(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const customerSnapshot = resolveCashCustomer(client, formData)
  const customer = customerSnapshot.name || clean(formData.get("customer")) || clean(formData.get("customer_name"))
  if (!customer) {
    throw new Error("Укажите имя клиента.")
  }
  const phone = customerSnapshot.phone || clean(formData.get("phone"))
  const fields = parseDraftFields(formData)

  const save = client.transaction(() => {
    const items = buildDraftOrderItems(client, formData)
    const totals = calculateCommercialTotals(
      itemsForCommercialTotals(items),
      fields.orderDiscountType,
      fields.orderDiscountValue
    )
    const total = totals.total + fields.deliveryPrice
    const inserted = client
      .prepare(
        `INSERT INTO orders (
          created_by_user_id, updated_by_user_id, customer_id, customer, phone, recipient_phone, source,
          delivery_type, address, due_at, status, items_total_before_discount, items_discount_total, order_discount_type,
          order_discount_value, order_discount_amount, total_before_discount, total, prepaid, paid,
          delivery_price, courier_payout, is_reserved, note, updated_at
        ) VALUES (
          @createdByUserId, @updatedByUserId, @customerId, @customer, @phone, @recipientPhone, @source,
          @deliveryType, @address, @dueAt, 'Черновик', @itemsTotalBeforeDiscount, @itemsDiscountTotal, @orderDiscountType,
          @orderDiscountValue, @orderDiscountAmount, @totalBeforeDiscount, @total, 0, 0,
          @deliveryPrice, @courierPayout, 0, @note, CURRENT_TIMESTAMP
        )`
      )
      .run({
        createdByUserId: currentUser.id,
        updatedByUserId: currentUser.id,
        customerId: customerSnapshot.id,
        customer,
        phone,
        recipientPhone: fields.recipientPhone,
        source: fields.source,
        deliveryType: fields.deliveryType,
        address: fields.address,
        dueAt: fields.dueAt,
        itemsTotalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        itemsDiscountTotal: totals.itemsDiscountTotal,
        orderDiscountType: fields.orderDiscountType,
        orderDiscountValue: fields.orderDiscountValue,
        orderDiscountAmount: totals.dealDiscountAmount,
        totalBeforeDiscount: totals.itemsTotalBeforeDiscount + fields.deliveryPrice,
        total,
        deliveryPrice: fields.deliveryPrice,
        courierPayout: fields.courierPayout,
        note: fields.note,
      })
    const orderId = Number(inserted.lastInsertRowid)
    const number = generateOrderNumber(orderId)
    client.prepare("UPDATE orders SET number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(number, orderId)
    writeDraftItems(client, orderId, items)
    return orderId
  })

  return save()
}

// Редактирование черновика: мягкий разбор, замена позиций, пересчёт итогов. БЕЗ резерва. Только 'Черновик'.
export function updateOrderDraft(orderId: number, formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const save = client.transaction(() => {
    const head = client.prepare("SELECT status, is_reserved FROM orders WHERE id = ?").get(orderId) as
      | { status: string; is_reserved: number }
      | undefined
    if (!head) {
      throw new Error("Заказ не найден.")
    }
    if (normalizeOrderStatus(head.status) !== "Черновик") {
      throw new Error("Редактировать так можно только черновик.")
    }
    const customerSnapshot = resolveCashCustomer(client, formData)
    const customer = customerSnapshot.name || clean(formData.get("customer")) || clean(formData.get("customer_name"))
    if (!customer) {
      throw new Error("Укажите имя клиента.")
    }
    const phone = customerSnapshot.phone || clean(formData.get("phone"))
    const fields = parseDraftFields(formData)
    const items = buildDraftOrderItems(client, formData)
    const totals = calculateCommercialTotals(
      itemsForCommercialTotals(items),
      fields.orderDiscountType,
      fields.orderDiscountValue
    )
    const total = totals.total + fields.deliveryPrice
    client
      .prepare(
        `UPDATE orders SET
          updated_by_user_id = @updatedByUserId, customer_id = @customerId, customer = @customer, phone = @phone,
          recipient_phone = @recipientPhone, source = @source, delivery_type = @deliveryType, address = @address,
          due_at = @dueAt, items_total_before_discount = @itemsTotalBeforeDiscount, items_discount_total = @itemsDiscountTotal,
          order_discount_type = @orderDiscountType, order_discount_value = @orderDiscountValue,
          order_discount_amount = @orderDiscountAmount, total_before_discount = @totalBeforeDiscount, total = @total,
          delivery_price = @deliveryPrice, courier_payout = @courierPayout, note = @note, updated_at = CURRENT_TIMESTAMP
        WHERE id = @orderId`
      )
      .run({
        orderId,
        updatedByUserId: currentUser.id,
        customerId: customerSnapshot.id,
        customer,
        phone,
        recipientPhone: fields.recipientPhone,
        source: fields.source,
        deliveryType: fields.deliveryType,
        address: fields.address,
        dueAt: fields.dueAt,
        itemsTotalBeforeDiscount: totals.itemsTotalBeforeDiscount,
        itemsDiscountTotal: totals.itemsDiscountTotal,
        orderDiscountType: fields.orderDiscountType,
        orderDiscountValue: fields.orderDiscountValue,
        orderDiscountAmount: totals.dealDiscountAmount,
        totalBeforeDiscount: totals.itemsTotalBeforeDiscount + fields.deliveryPrice,
        total,
        deliveryPrice: fields.deliveryPrice,
        courierPayout: fields.courierPayout,
        note: fields.note,
      })
    writeDraftItems(client, orderId, items)
    return orderId
  })
  return save()
}

// Расхождения цен черновика с текущими sale_price (для подтверждения при отправке в работу).
export function getDraftPriceChanges(orderId: number) {
  const client = db()
  const rows = client
    .prepare("SELECT product_code as productCode, name, price, qty FROM order_items WHERE order_id = ?")
    .all(orderId) as Array<{ productCode: string | null; name: string; price: number; qty: number }>
  const changes: Array<{ name: string; oldPrice: number; newPrice: number }> = []
  for (const row of rows) {
    if (!row.productCode) continue
    const product = getProduct(client, row.productCode)
    if (!product) continue
    const oldPrice = numberFromRow(row.price)
    const newPrice = numberFromRow(product.sale_price)
    if (roundMoney(oldPrice) !== roundMoney(newPrice)) {
      changes.push({ name: row.name || String(row.productCode), oldPrice, newPrice })
    }
  }
  return changes
}

// Отправка черновика в работу: ПОЛНАЯ валидация состава, резерв склада (один раз), статус → 'Новый'.
// priceMode: 'keep' — цены как в черновике; 'current' — пересчёт по текущим sale_price.
export function finalizeOrderDraft(
  orderId: number,
  currentUser: CurrentUser,
  options: { priceMode?: "keep" | "current" } = {}
) {
  const client = db()
  const priceMode = options.priceMode === "current" ? "current" : "keep"
  const run = client.transaction(() => {
    const order = client.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as Record<string, unknown> | undefined
    if (!order) {
      throw new Error("Заказ не найден.")
    }
    if (normalizeOrderStatus(order.status) !== "Черновик") {
      throw new Error("Этот заказ не является черновиком.")
    }
    if (numberFromRow(order.is_reserved) !== 0) {
      throw new Error("Черновик в несогласованном состоянии резерва.")
    }
    const rows = client.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId) as Array<Record<string, unknown>>
    if (!rows.length) {
      throw new Error("Добавьте в заказ хотя бы одну позицию, прежде чем отправить в работу.")
    }

    // Полная валидация ВСЕХ позиций ДО любого резерва.
    const lines = rows.map((row) => {
      const productCode = String(row.product_code ?? "")
      if (!productCode) {
        throw new Error("У позиции заказа нет товара со склада — удалите её или укажите товар.")
      }
      const product = getProduct(client, productCode)
      if (!product) {
        throw new Error(`Товар «${String(row.name ?? productCode)}» не найден — обновите позицию.`)
      }
      const qty = numberFromRow(row.qty)
      if (qty <= 0) {
        throw new Error("Количество в каждой позиции должно быть больше нуля.")
      }
      const price = priceMode === "current" ? numberFromRow(product.sale_price) : numberFromRow(row.price)
      if (price < 0) {
        throw new Error("Цена позиции не может быть отрицательной.")
      }
      const discountType = normalizeDiscountType(String(row.discount_type ?? "none"))
      const discountValue = numberFromRow(row.discount_value)
      const bouquetGroupId = String(row.bouquet_group_id ?? "")
      const totals = calculateComponentLineTotal({ qty, price, bouquetGroupId, discountType, discountValue })
      return {
        id: numberFromRow(row.id),
        productCode,
        qty,
        price,
        bouquetGroupId,
        discountType,
        discountValue,
        discountAmount: totals.discountAmount,
        totalBeforeDiscount: totals.totalBeforeDiscount,
        total: totals.total,
      }
    })

    const orderDiscountType = normalizeDiscountType(String(order.order_discount_type ?? "none"))
    const orderDiscountValue = numberFromRow(order.order_discount_value)
    const totals = calculateCommercialTotals(itemsForCommercialTotals(lines), orderDiscountType, orderDiscountValue)
    const deliveryPrice = numberFromRow(order.delivery_price)
    const total = totals.total + deliveryPrice
    const prepaid = numberFromRow(order.prepaid)
    if (prepaid > total && total >= 0) {
      throw new Error("Предоплата не может быть больше суммы заказа.")
    }
    const shift = prepaid > 0 ? requireOpenShift(client) : null

    // Обновляем цены/итоги позиций (на случай priceMode='current' или пересчёта скидок).
    const updateItem = client.prepare(
      "UPDATE order_items SET price = ?, discount_amount = ?, total_before_discount = ?, total = ? WHERE id = ?"
    )
    for (const line of lines) {
      updateItem.run(line.price, line.discountAmount, line.totalBeforeDiscount, line.total, line.id)
    }

    const number = String(order.number ?? "")
    client
      .prepare(
        `UPDATE orders SET status = 'Новый', is_reserved = 1, items_total_before_discount = ?, items_discount_total = ?,
          order_discount_amount = ?, total_before_discount = ?, total = ?, prepaid = ?, paid = ?,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(
        totals.itemsTotalBeforeDiscount,
        totals.itemsDiscountTotal,
        totals.dealDiscountAmount,
        totals.itemsTotalBeforeDiscount + deliveryPrice,
        total,
        prepaid,
        prepaid,
        currentUser.id,
        orderId
      )

    const allowOversell = getAllowOversellOrders(client)
    for (const line of lines) {
      applyProductDelta(client, {
        productCode: line.productCode,
        reservedDelta: line.qty,
        type: "reserve",
        qty: line.qty,
        orderId,
        userId: currentUser.id,
        comment: "Резерв при отправке черновика в работу",
        enforceAvailable: !allowOversell,
      })
    }

    if (shift && prepaid > 0) {
      recordCashTransaction(client, {
        shiftId: shift.id,
        orderId,
        customerId: order.customer_id == null ? null : numberFromRow(order.customer_id),
        userId: currentUser.id,
        type: "prepayment",
        paymentMethod: "cash",
        amount: prepaid,
        comment: `Предоплата по заказу ${number}`,
      })
    }

    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      total,
      note: `Заказ ${number}: отправлен в работу`,
    })
  })

  run()
}

// Физическое удаление черновика (резерва/оплат нет — освобождать нечего). Только 'Черновик'.
export function deleteDraftOrder(orderId: number, currentUser: CurrentUser) {
  void currentUser
  const client = db()
  const run = client.transaction(() => {
    const head = client.prepare("SELECT status, is_reserved FROM orders WHERE id = ?").get(orderId) as
      | { status: string; is_reserved: number }
      | undefined
    if (!head) {
      throw new Error("Заказ не найден.")
    }
    if (normalizeOrderStatus(head.status) !== "Черновик" || numberFromRow(head.is_reserved) !== 0) {
      throw new Error("Удалять можно только черновик.")
    }
    client.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId)
    client.prepare("DELETE FROM orders WHERE id = ?").run(orderId)
  })
  run()
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

    if (order.status === "Черновик") {
      throw new Error("Сначала отправьте черновик в работу.")
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
  if (String(order.status) === "Отменен") {
    throw new Error("Заказ отменён — оплату по нему принять нельзя.")
  }
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

    // Выручка по заказу садится на смену завершения, поэтому выдача требует открытой смены.
    const shift = requireOpenShift(client)
    const beforeBalance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (beforeBalance > 0) {
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
         SET status = 'Выдан', completed_at = CURRENT_TIMESTAMP, completed_shift_id = ?,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(shift.id, currentUser.id, orderId)
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
    // Передача — завершение заказа: выручка садится на смену завершения, поэтому нужна открытая смена.
    const shift = requireOpenShift(client)

    if (needsPayment) {
      result.acceptedPayment = applyOrderPayment(client, orderId, formData, shift.id, currentUser) > 0
    }

    order = getOrderWithItems(client, orderId).order
    const balance = numberFromRow(order.total) - numberFromRow(order.paid)
    if (balance > 0) {
      throw new Error("Нельзя передать курьеру заказ с остатком к оплате.")
    }

    if (needsCourierCash) {
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

    // «Передан курьеру» — завершающий статус доставки: проставляем completed_at,
    // чтобы заказ считался выполненным (отдельного шага «Доставлен/Закрыть» больше нет).
    client
      .prepare(
        `UPDATE orders
         SET status = 'Передан курьеру', handed_to_courier_at = CURRENT_TIMESTAMP,
          completed_at = CURRENT_TIMESTAMP, completed_shift_id = ?, courier_name = ?,
          updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(shift.id, clean(formData.get("courierName")), currentUser.id, orderId)
    addMovement(client, {
      userId: currentUser.id,
      type: "order_status",
      note: `Заказ #${orderId}: Передан курьеру`,
    })
  })

  handOver()
  return result
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

  // Группируем приходы по способу И смене прихода: возврат зеркалит способ, а source_shift_id
  // = смена, в которой деньги были получены (по ней нетируется выручка прошлой смены, решение №3).
  const byMethod = client
    .prepare(
      `SELECT payment_method as paymentMethod, shift_id as sourceShiftId, COALESCE(SUM(amount), 0) as amount
       FROM cash_transactions
       WHERE order_id = ? AND type IN ('prepayment', 'order_payment', 'deal_payment')
       GROUP BY payment_method, shift_id
       ORDER BY amount DESC`
    )
    .all(orderId) as Array<{ paymentMethod: PaymentMethod; sourceShiftId: number; amount: number }>

  let remaining = orderPaid
  // Возврат проводится в ТЕКУЩЕЙ открытой смене (физически деньги выходят сейчас — shift.id,
  // по нему считается expectedCash). source_shift_id = смена исходного прихода. Для возврата
  // в той же смене source == текущая → пометки нет и поведение прежнее.
  const refund = (paymentMethod: PaymentMethod, amount: number, sourceShiftId: number | null, suffix = "") => {
    const value = roundMoney(amount)
    if (value <= 0.009) {
      return
    }
    const crossShiftNote = sourceShiftId && sourceShiftId !== shift.id ? ` (за смену #${sourceShiftId})` : ""
    recordCashTransaction(client, {
      shiftId: shift.id,
      orderId,
      customerId,
      dealId,
      userId: currentUser.id,
      sourceShiftId: sourceShiftId ?? shift.id,
      type: "cash_refund",
      paymentMethod,
      amount: value,
      comment: `Возврат при отмене заказа ${orderLabel}${suffix}${crossShiftNote}`,
    })
    remaining = roundMoney(remaining - value)
  }

  for (const row of byMethod) {
    if (remaining <= 0.009) {
      break
    }
    const method = paymentMethods.has(row.paymentMethod) ? row.paymentMethod : "cash"
    refund(method, Math.min(numberFromRow(row.amount), remaining), numberFromRow(row.sourceShiftId) || null)
  }

  if (remaining > 0.009) {
    // Перенесённая предоплата без проводки, привязанной к заказу (например, оплата
    // по сделке до создания заказа) — возвращаем остаток наличными текущей сменой.
    refund("cash", remaining, null, " (предоплата)")
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

    if (order.status === "Отменен") {
      return
    }

    if (["Новый", "В работе"].includes(order.status)) {
      if (wasReserved) {
        cancelOrderReserve(client, orderId, items, currentUser)
      }
    } else if (["Готов", "Передан курьеру", "Выдан"].includes(order.status)) {
      // «Готов»/«Передан курьеру»/«Выдан» — букет уже собран (склад списан), резерва нет:
      // автоматически склад не восстанавливаем, но деньги клиенту возвращаем.
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
