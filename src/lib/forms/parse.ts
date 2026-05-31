import { z } from "zod"
import { clean, toNumber } from "@/lib/db/form-parsers"

/**
 * ARCH-5: zod-валидация входов server actions.
 *
 * ВАЖНО (деньги): препроцессоры НЕ парсят числа сами и НЕ используют `z.coerce.number()`.
 * Они ПЕРЕИСПОЛЬЗУЮТ существующие парсеры `toNumber`/`clean` из `@/lib/db/form-parsers`,
 * чтобы поведение на входах вида "", "1,5", "abc", "  5 ", "-3" совпадало 1:1 с прежним
 * ручным парсингом (`toNumber` делает `replace(",",".").trim()` и возвращает 0 на нечисле/пусто;
 * `z.coerce.number()` дал бы NaN на "1,5"/"" и молча испортил бы цены).
 */

/**
 * Превращает FormData в плоский объект для `schema.parse(...)`.
 *
 * Скалярная часть формы: для повторяющихся ключей (параллельные массивы позиций
 * `itemProductCode`/`itemQty`/...) берётся последнее значение — эти ключи в скалярные
 * схемы НЕ входят и парсятся отдельно (`buildSaleItems`/`buildOrderItems` и т.п.).
 */
export function formDataToObject(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries())
}

/**
 * Число из формы через существующий `toNumber` (`String(v??"").replace(",",".").trim()`,
 * нечисло/пусто → 0). Результат всегда конечное число, поэтому `z.number()` всегда проходит;
 * границы (>=0, >0 и т.п.) задаются вызывающим через `.min(...)`/`.refine(...)` с русским текстом.
 */
export function zNum() {
  return z.preprocess(toNumber, z.number())
}

/**
 * Денежное число из формы. Семантически идентично `zNum()` — `toNumber` и есть денежный парсер
 * (поддерживает запятую как разделитель). Отдельное имя оставлено для читаемости денежных схем.
 */
export function zMoney() {
  return z.preprocess(toNumber, z.number())
}

/**
 * Строка из формы через существующий `clean` (`String(v??"").trim()`).
 */
export function zTrimmed() {
  return z.preprocess(clean, z.string())
}

/**
 * Прогоняет `schema.parse(formDataToObject(fd))` и при ошибке валидации бросает обычный
 * `Error` с ПЕРВЫМ (русским) сообщением из схемы. Это нужно, чтобы обёртки `runAction`
 * (`error instanceof Error ? error.message : ...`) отдали пользователю точный русский текст,
 * а не JSON-дамп `ZodError` или дефолтное "Операция не выполнена.".
 */
export function parseForm<T extends z.ZodType>(schema: T, formData: FormData): z.infer<T> {
  const result = schema.safeParse(formDataToObject(formData))
  if (!result.success) {
    const message = result.error.issues[0]?.message
    throw new Error(message || "Проверьте корректность заполнения формы.")
  }

  return result.data
}
