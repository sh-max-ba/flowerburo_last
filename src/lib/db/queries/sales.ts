import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { calculateCommercialTotals, normalizeDiscountType } from "@/lib/pricing"
import type { CurrentUser } from "../types"
import { db } from "../connection"
import { addMovement, applyProductDelta, getProduct, recordCashTransaction } from "../ledger"
import { clean, parsePaymentMethod, toNumber, toOptionalNumber } from "../form-parsers"
import { parseForm } from "@/lib/forms/parse"
import { SaleInputSchema } from "@/lib/forms/schemas"
import { calculateComponentLineTotal, itemsForCommercialTotals, resolveCashCustomer } from "./commercial"
import { requireOpenShift } from "./shifts"

function buildSaleItems(client: Database.Database, formData: FormData) {
  const multiProductCodes = formData.getAll("itemProductCode").map((value) => clean(value))
  const productCodes = multiProductCodes.length ? multiProductCodes : [clean(formData.get("productCode"))]
  const qtyValues = multiProductCodes.length ? formData.getAll("itemQty") : [formData.get("qty")]
  const priceValues = multiProductCodes.length ? formData.getAll("itemPrice") : [formData.get("price")]
  const discountTypes = multiProductCodes.length ? formData.getAll("itemDiscountType") : [formData.get("itemDiscountType")]
  const discountValues = multiProductCodes.length ? formData.getAll("itemDiscountValue") : [formData.get("itemDiscountValue")]
  const bouquetIds = multiProductCodes.length ? formData.getAll("itemBouquetId") : [formData.get("itemBouquetId")]
  const bouquetNames = multiProductCodes.length ? formData.getAll("itemBouquetName") : [formData.get("itemBouquetName")]
  const bouquetGroupIds = multiProductCodes.length
    ? formData.getAll("itemBouquetGroupId")
    : [formData.get("itemBouquetGroupId")]

  if (!productCodes.length || productCodes.every((code) => !code)) {
    throw new Error("Добавьте в продажу хотя бы одну позицию со склада.")
  }

  return productCodes.map((productCode, index) => {
    if (!productCode) {
      throw new Error("У каждой позиции продажи должен быть товар со склада.")
    }

    const product = getProduct(client, productCode)
    if (!product) {
      throw new Error(`Товар ${productCode} не найден.`)
    }

    const qty = toNumber(qtyValues[index])
    if (qty <= 0) {
      throw new Error("Количество в каждой позиции продажи должно быть больше нуля.")
    }

    const explicitPrice = toOptionalNumber(priceValues[index])
    if (explicitPrice !== null && explicitPrice < 0) {
      throw new Error("Цена продажи не может быть отрицательной.")
    }

    const unitPrice = explicitPrice ?? numberFromRow(product.sale_price)
    const discountType = normalizeDiscountType(clean(discountTypes[index] ?? null))
    const discountValue = Math.max(0, toNumber(discountValues[index]))
    const bouquetId = toOptionalNumber(bouquetIds[index] ?? null)
    const bouquetName = clean(bouquetNames[index] ?? null)
    const bouquetGroupId = clean(bouquetGroupIds[index] ?? null)
    const totals = calculateComponentLineTotal({
      qty,
      price: unitPrice,
      bouquetGroupId,
      discountType,
      discountValue,
    })

    return {
      productCode,
      product,
      qty,
      unitPrice,
      price: unitPrice,
      bouquetId: bouquetId && bouquetId > 0 ? bouquetId : null,
      bouquetName: bouquetGroupId ? bouquetName : "",
      bouquetGroupId,
      discountType,
      discountValue: discountType === "none" ? 0 : discountValue,
      discountAmount: totals.discountAmount,
      totalBeforeDiscount: totals.totalBeforeDiscount,
      total: totals.total,
    }
  })
}

export function createSale(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const paymentMethod = parsePaymentMethod(formData.get("paymentMethod"))
  const { note } = parseForm(SaleInputSchema, formData)

  const saveSale = client.transaction(() => {
    const shift = requireOpenShift(client)
    const items = buildSaleItems(client, formData)
    const customer = resolveCashCustomer(client, formData)
    const saleDiscountType = normalizeDiscountType(clean(formData.get("saleDiscountType")))
    const saleDiscountValue = saleDiscountType === "none" ? 0 : Math.max(0, toNumber(formData.get("saleDiscountValue")))
    const totals = calculateCommercialTotals(itemsForCommercialTotals(items), saleDiscountType, saleDiscountValue)
    const total = totals.total
    const sale = client
      .prepare(
        `INSERT INTO sales (
          shift_id, user_id, payment_method, customer_id, customer_name, customer_phone,
          items_total_before_discount, items_discount_total, sale_discount_type, sale_discount_value,
          sale_discount_amount, total_before_discount, total, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        shift.id,
        currentUser.id,
        paymentMethod,
        customer.id,
        customer.name,
        customer.phone,
        totals.itemsTotalBeforeDiscount,
        totals.itemsDiscountTotal,
        saleDiscountType,
        saleDiscountValue,
        totals.dealDiscountAmount,
        totals.itemsTotalBeforeDiscount,
        total,
        note
      )
    const saleId = Number(sale.lastInsertRowid)

    const insertItem = client.prepare(
      `INSERT INTO sale_items (
        sale_id, product_code, qty, unit_price, discount_type, discount_value,
        discount_amount, total_before_discount, total, bouquet_id, bouquet_name, bouquet_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const item of items) {
      insertItem.run(
        saleId,
        item.productCode,
        item.qty,
        item.unitPrice,
        item.discountType,
        item.discountValue,
        item.discountAmount,
        item.totalBeforeDiscount,
        item.total,
        item.bouquetId,
        item.bouquetName,
        item.bouquetGroupId
      )
      applyProductDelta(client, {
        productCode: item.productCode,
        stockDelta: -item.qty,
        type: "sale",
        qty: -item.qty,
        saleId,
        shiftId: shift.id,
        userId: currentUser.id,
        comment: note || "Продажа на кассе",
      })
      addMovement(client, {
        userId: currentUser.id,
        type: "sale",
        productCode: item.productCode,
        productName: String(item.product.name),
        qty: -item.qty,
        unitPrice: item.unitPrice,
        total: item.total,
        note: note || "Продажа на кассе",
      })
    }
    if (total > 0) {
      recordCashTransaction(client, {
        shiftId: shift.id,
        saleId,
        customerId: customer.id,
        userId: currentUser.id,
        type: "sale",
        paymentMethod,
        amount: total,
        comment: note || "Продажа на кассе",
      })
    }
  })

  saveSale()
}
