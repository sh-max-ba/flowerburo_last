import type { AnalyticsRange } from "@/lib/db"

export type AnalyticsTab = "overview" | "sales" | "suppliers" | "writeoffs"

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
