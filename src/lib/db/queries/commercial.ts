import type Database from "better-sqlite3"
import { numberFromRow } from "@/lib/db-row"
import { calculateLineTotal, type CommercialLineInput } from "@/lib/pricing"
import { clean, toNumber } from "../form-parsers"

export function calculateComponentLineTotal({
  qty,
  price,
  discountType,
  discountValue,
  bouquetGroupId,
}: CommercialLineInput & { bouquetGroupId?: string | null }) {
  return calculateLineTotal({
    qty: bouquetGroupId && price > 0 ? 1 : qty,
    price,
    discountType,
    discountValue,
  })
}

export function itemsForCommercialTotals<T extends CommercialLineInput & { bouquetGroupId?: string | null }>(items: T[]) {
  return items.map((item) => ({
    qty: item.bouquetGroupId && item.price > 0 ? 1 : item.qty,
    price: item.price,
    discountType: item.discountType,
    discountValue: item.discountValue,
  }))
}

export function resolveCashCustomer(client: Database.Database, formData: FormData) {
  const customerId = toNumber(formData.get("customerId"))
  if (!customerId) {
    return {
      id: null,
      name: clean(formData.get("customer")) || clean(formData.get("customerName")),
      phone: clean(formData.get("phone")) || clean(formData.get("customerPhone")),
    }
  }

  const customer = client.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as
    | Record<string, unknown>
    | undefined

  if (!customer) {
    throw new Error("Клиент не найден.")
  }

  return {
    id: numberFromRow(customer.id),
    name: String(customer.name ?? ""),
    phone: String(customer.phone ?? ""),
  }
}
