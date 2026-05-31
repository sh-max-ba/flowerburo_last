import { z } from "zod"
import { zMoney, zNum, zTrimmed } from "./parse"

/**
 * ARCH-5: схемы кодируют ТОЛЬКО уже существующие правила валидации скалярных полей
 * server actions и сохраняют ТОЧНЫЕ русские тексты ошибок. Новая строгость НЕ добавляется:
 * если функция раньше принимала пусто→0 / отрицательное / любой способ оплаты — схема тоже
 * принимает. Денежные инварианты (prepaid<=total, неотрицательность остатка, requireOpenShift,
 * лимиты оплаты сделки) ОСТАЮТСЯ в транзакции и здесь НЕ дублируются.
 *
 * Денежные/числовые поля проходят через `zNum()`/`zMoney()` (препроцессор `toNumber`),
 * строки — через `zTrimmed()` (препроцессор `clean`). Без `z.coerce`.
 */

// --- upsertProduct (pilot) ---------------------------------------------------
// Исходные правила: code/name обязательны ("Код и название обязательны."),
// costPrice/salePrice >= 0 ("Цены не могут быть отрицательными.").
export const ProductInputSchema = z.object({
  code: zTrimmed().refine((value) => value.length > 0, "Код и название обязательны."),
  name: zTrimmed().refine((value) => value.length > 0, "Код и название обязательны."),
  categoryPath: zTrimmed(),
  article: zTrimmed(),
  unit: zTrimmed(),
  costPrice: zMoney().refine((value) => value >= 0, "Цены не могут быть отрицательными."),
  salePrice: zMoney().refine((value) => value >= 0, "Цены не могут быть отрицательными."),
})

export type ProductInput = z.infer<typeof ProductInputSchema>

// --- crm: createCustomer / updateCustomer ------------------------------------
// ВНИМАНИЕ: crm.ts имеет СВОЙ локальный toNumber = Number(value) (БЕЗ replace(",",".")/trim),
// отличный от form-parsers.toNumber. Для crm-числовых полей используем тот же Number(value),
// чтобы не изменить семантику (например Number("1,5") -> NaN -> 0 через clampPercent).
const crmNumber = z.preprocess((value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}, z.number())

// createCustomer: имя обязательно проверяется ниже по стеку (insertCustomer ->
// "Укажите имя клиента."), поэтому здесь только нормализация полей.
export const CustomerCreateSchema = z.object({
  name: zTrimmed(),
  phone: zTrimmed(),
  instagram: zTrimmed(),
  source: zTrimmed(),
  defaultDiscountPercent: crmNumber,
  comment: zTrimmed(),
})

export type CustomerCreateInput = z.infer<typeof CustomerCreateSchema>

// updateCustomer: !id || !name -> "Укажите клиента и имя." (id из crm toNumber = Number()).
export const CustomerUpdateSchema = z
  .object({
    customerId: crmNumber,
    name: zTrimmed(),
    phone: zTrimmed(),
    instagram: zTrimmed(),
    source: zTrimmed(),
    defaultDiscountPercent: crmNumber,
    comment: zTrimmed(),
  })
  .refine((value) => value.customerId !== 0 && value.name.length > 0, {
    message: "Укажите клиента и имя.",
  })

export type CustomerUpdateInput = z.infer<typeof CustomerUpdateSchema>

// --- createSale --------------------------------------------------------------
// Скалярная часть продажи минимальна: только note. paymentMethod валидируется
// отдельно через parsePaymentMethod; позиции/скидки/requireOpenShift/остаток — в транзакции.
export const SaleInputSchema = z.object({
  note: zTrimmed(),
})

export type SaleInput = z.infer<typeof SaleInputSchema>

// --- createOrder -------------------------------------------------------------
// Исходные правила (вне транзакции):
//   prepaid < 0 -> "Предоплата не может быть отрицательной."
//   deliveryType not in [pickup, delivery] -> "Некорректный тип получения."
//   deliveryPrice < 0 || courierPayout < 0 -> "Доставка и выплата курьеру не могут быть отрицательными."
// Имя клиента (`customer`) собирается из снапшота клиента + полей формы, поэтому проверка
// "Укажите имя клиента." остаётся в функции (зависит от resolveCashCustomer).
// Порядок полей подобран так, чтобы ПЕРВАЯ ошибка совпадала с исходным порядком проверок
// в createOrder: prepaid -> deliveryType -> deliveryPrice/courierPayout. (Проверка имени
// клиента в оригинале первая, но остаётся в функции до вызова схемы.)
export const OrderInputSchema = z.object({
  prepaid: zMoney().refine((value) => value >= 0, "Предоплата не может быть отрицательной."),
  deliveryType: zTrimmed()
    .transform((value) => value || "pickup")
    .refine((value) => value === "pickup" || value === "delivery", "Некорректный тип получения."),
  deliveryPrice: zMoney().refine((value) => value >= 0, "Доставка и выплата курьеру не могут быть отрицательными."),
  courierPayout: zMoney().refine((value) => value >= 0, "Доставка и выплата курьеру не могут быть отрицательными."),
  recipientPhone: zTrimmed(),
  dueAt: zTrimmed(),
  address: zTrimmed(),
  source: zTrimmed(),
  note: zTrimmed(),
})

export type OrderInput = z.infer<typeof OrderInputSchema>

// --- createOrderFromDeal -----------------------------------------------------
// Скалярная часть вне транзакции: dealId truthy, иначе "Сделка не найдена.".
// deliveryPrice/courierPayout парсятся ВНУТРИ транзакции (зависят от данных сделки) — оставлены там.
export const DealOrderInputSchema = z.object({
  dealId: zNum().refine((value) => value !== 0, "Сделка не найдена."),
})

export type DealOrderInput = z.infer<typeof DealOrderInputSchema>

// --- acceptDealPayment -------------------------------------------------------
// Исходные правила (вне транзакции):
//   dealId truthy -> "Сделка не найдена."
//   amount <= 0 -> "Сумма оплаты должна быть больше нуля."
//   comment -> clean ; paymentMethod валидируется отдельно через parsePaymentMethod.
export const DealPaymentInputSchema = z.object({
  dealId: zNum().refine((value) => value !== 0, "Сделка не найдена."),
  amount: zMoney().refine((value) => value > 0, "Сумма оплаты должна быть больше нуля."),
  comment: zTrimmed(),
})

export type DealPaymentInput = z.infer<typeof DealPaymentInputSchema>

// --- cashIn / cashOut (recordManualCash) -------------------------------------
// Исходные правила (вне транзакции): amount <= 0 -> "Сумма должна быть больше нуля."; comment -> clean.
export const ManualCashInputSchema = z.object({
  amount: zMoney().refine((value) => value > 0, "Сумма должна быть больше нуля."),
  comment: zTrimmed(),
})

export type ManualCashInput = z.infer<typeof ManualCashInputSchema>
