import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"

// Форматирование чисел для аналитики. Деньги в таблицах — formatMoney из utils («3 828 563 сом»);
// здесь — компактные формы для осей, тултипов и подписей («3,8 млн», «221 тыс»).

export function formatCompactMoney(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? "−" : ""
  if (abs >= 1_000_000) {
    return `${sign}${trimZero((abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1))} млн`
  }
  if (abs >= 10_000) {
    return `${sign}${Math.round(abs / 1_000)} тыс`
  }
  if (abs >= 1_000) {
    return `${sign}${trimZero((abs / 1_000).toFixed(1))} тыс`
  }
  return `${sign}${Math.round(abs)}`
}

function trimZero(text: string): string {
  return text.replace(/\.0$/, "").replace(".", ",")
}

export function formatQty(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits })
    .format(Number.isFinite(value) ? value : 0)
    .replace(/ /g, " ")
}

// Знаковое количество для журнала движений: «+12», «−5».
export function formatSignedQty(value: number): string {
  if (value > 0) return `+${formatQty(value)}`
  if (value < 0) return `−${formatQty(Math.abs(value))}`
  return formatQty(0)
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—"
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value)} %`
}

// Доля/наценка: 0..1 или проценты — считает вызывающий, тут только вид.
export function percentOf(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0
}

export function formatDay(iso: string, options: { weekday?: boolean; year?: boolean } = {}): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    ...(options.weekday ? { weekday: "short" } : {}),
    ...(options.year ? { year: "numeric" } : {}),
  })
    .format(date)
    .replace(".", "")
}

export function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date)
}

// Метка периода для заголовков: «1–10 сен», «24 авг – 22 сен», «12 сен».
export function formatRangeLabel(from: string, to: string): string {
  if (from === to) return formatDay(from)
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()}–${formatDay(to)}`
  }
  return `${formatDay(from)} – ${formatDay(to)}`
}

// UTC-метка из БД → «12.09, 14:03» в поясе магазина.
export function formatInstantShort(value: string | null | undefined): string {
  const date = parseDbInstant(value)
  if (!date) return value ? String(value) : "—"
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SHOP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatInstantDate(value: string | null | undefined): string {
  const date = parseDbInstant(value)
  if (!date) return value ? String(value) : "—"
  return new Intl.DateTimeFormat("ru-RU", { timeZone: SHOP_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
}

// Русские склонения по числу.
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.round(n))
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

export const DAYS_FORMS: [string, string, string] = ["день", "дня", "дней"]
export const DOCS_FORMS: [string, string, string] = ["акт", "акта", "актов"]
export const POSITIONS_FORMS: [string, string, string] = ["позиция", "позиции", "позиций"]
export const SALES_FORMS: [string, string, string] = ["чек", "чека", "чеков"]
export const ORDERS_FORMS: [string, string, string] = ["заказ", "заказа", "заказов"]
export const SUPPLIERS_FORMS: [string, string, string] = ["поставщик", "поставщика", "поставщиков"]

// Палитра рядов: цвет закреплён за сущностью (выручка всегда синяя, закупки — оранжевые,
// списания — фиолетовые, себестоимость — серая де-эмфаза рядом с выручкой), а не за порядком
// в легенде. Синий/оранжевый/фиолетовый проверены валидатором палитры (CVD ΔE ≥ 13, все пары).
export const SERIES_COLORS = {
  revenue: "#2a78d6",
  cost: "#98a2b3",
  purchases: "#eb6834",
  writeOffs: "#4a3aa7",
  stock: "#2a78d6",
} as const
