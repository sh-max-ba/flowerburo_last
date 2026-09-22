import type { AnalyticsRange } from "@/lib/db"

export type AnalyticsTab = "overview" | "sales" | "suppliers" | "writeoffs" | "operations"

// Параметры периода для ссылок между экранами аналитики — период общий для всех вкладок и
// карточки товара (по умолчанию 30 дней — его в URL не пишем).
export function rangeParams(range: AnalyticsRange): URLSearchParams {
  const params = new URLSearchParams()
  if (range.preset === "custom") {
    params.set("from", range.from)
    params.set("to", range.to)
  } else if (range.preset !== "30d") {
    params.set("preset", range.preset)
  }
  return params
}

export function tabHref(tab: AnalyticsTab, range: AnalyticsRange): string {
  const params = rangeParams(range)
  if (tab !== "overview") params.set("tab", tab)
  const qs = params.toString()
  return qs ? `/analytics?${qs}` : "/analytics"
}

export function productCardHref(code: string, range?: AnalyticsRange): string {
  const base = `/stock/products/${encodeURIComponent(code)}`
  if (!range) return base
  const qs = rangeParams(range).toString()
  return qs ? `${base}?${qs}` : base
}

// Вкладка «Операции» с фильтрами: сюда ведут клики по категории, причине списания, поставщику
// и товару — список относящихся чеков, заказов, приходов и списаний за тот же период.
export type OperationsLinkFilters = {
  type?: "all" | "sales" | "sale" | "order" | "receipt" | "writeoff" | "inventory"
  category?: string
  product?: string
  reason?: string
  supplier?: number | string
  query?: string
}

export function operationsHref(range: AnalyticsRange, filters: OperationsLinkFilters = {}): string {
  const params = rangeParams(range)
  params.set("tab", "operations")
  if (filters.type && filters.type !== "all") params.set("type", filters.type)
  if (filters.category) params.set("category", filters.category)
  if (filters.product) params.set("product", filters.product)
  if (filters.reason) params.set("reason", filters.reason)
  if (filters.supplier) params.set("supplier", String(filters.supplier))
  if (filters.query) params.set("q", filters.query)
  return `/analytics?${params.toString()}`
}
