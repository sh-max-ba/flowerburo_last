import type { UserRole } from "@/lib/db"
import { SHOP_TIME_ZONE } from "@/lib/datetime"

// Важные даты клиента: день рождения, годовщина, ДР близких — повторяются каждый год. Храним
// день и месяц, год — по желанию (тогда видно «исполнится 30», «10 лет»). Здесь только чистые
// помощники без БД: их используют и сервер (ближайшие даты), и формы в браузере.

export type CustomerDate = {
  id: number
  customerId: number
  title: string
  month: number
  day: number
  year: number | null
  note: string
  // Чья дата: получатель клиента («ДР жены» → Алия, жена); null — самого клиента.
  recipientId: number | null
  recipientName: string
  recipientRelation: string
  createdByUserId: number | null
  createdByName: string | null
  createdByRole: UserRole | null
  createdAt: string
  // Ближайшее наступление (сегодня или позже) в поясе магазина.
  nextDate: string
  daysLeft: number
  // Сколько лет исполнится в ближайшую дату (если известен год).
  turns: number | null
}

// Дата клиента в общем списке «кого поздравить» (дашборд, «Клиенты → Даты»).
export type UpcomingCustomerDate = CustomerDate & {
  customerName: string
  customerPhone: string
  hasChat: boolean
}

// Окно списка «Клиенты → Даты» (?days=): сегодня, неделя, месяц, квартал, весь год.
export type DatesWindow = "0" | "7" | "30" | "90" | "all"

export const DEFAULT_DATES_WINDOW: DatesWindow = "30"

export const DATES_WINDOW_OPTIONS: Array<{ value: DatesWindow; label: string }> = [
  { value: "0", label: "Сегодня" },
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: "all", label: "Весь год" },
]

export function parseDatesWindow(value: string | undefined): DatesWindow {
  return DATES_WINDOW_OPTIONS.some((option) => option.value === value) ? (value as DatesWindow) : DEFAULT_DATES_WINDOW
}

export const CUSTOMER_DATE_TITLES = ["День рождения", "Годовщина свадьбы", "ДР жены", "ДР мужа", "ДР мамы"] as const

export const customerDateTitleMax = 60
export const customerDateNoteMax = 200

export const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]

export const MONTHS_NOMINATIVE = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
]

export type CalendarDay = { year: number; month: number; day: number }

// Сегодняшняя дата магазина (Бишкек), а не сервера или устройства.
export function shopToday(now: Date = new Date()): CalendarDay {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get("year"), month: get("month"), day: get("day") }
}

export function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

// Дней в месяце; без года февраль — 29 (день рождения 29 февраля бывает).
export function daysInMonth(month: number, year?: number | null) {
  if (month === 2) {
    return year == null || isLeapYear(year) ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function dayNumber({ year, month, day }: CalendarDay) {
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000)
}

// Ближайшее наступление даты начиная с today. 29 февраля в невисокосный год — 28 февраля.
export function nextOccurrence(month: number, day: number, today: CalendarDay): CalendarDay & { daysLeft: number } {
  const inYear = (year: number): CalendarDay => ({ year, month, day: Math.min(day, daysInMonth(month, year)) })
  let next = inYear(today.year)
  if (dayNumber(next) < dayNumber(today)) {
    next = inYear(today.year + 1)
  }
  return { ...next, daysLeft: dayNumber(next) - dayNumber(today) }
}

export function isoDay({ year, month, day }: CalendarDay) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

// «14 марта», с годом — «14 марта 1990».
export function formatDayMonth(day: number, month: number, year?: number | null) {
  const base = `${day} ${MONTHS_GENITIVE[month - 1] ?? ""}`.trim()
  return year ? `${base} ${year}` : base
}

// «сегодня», «завтра», «послезавтра», «через 5 дней».
export function formatDaysLeft(daysLeft: number) {
  if (daysLeft <= 0) {
    return "сегодня"
  }
  if (daysLeft === 1) {
    return "завтра"
  }
  if (daysLeft === 2) {
    return "послезавтра"
  }
  return `через ${daysLeft} ${plural(daysLeft, ["день", "дня", "дней"])}`
}

// «30 лет», «1 год», «2 года».
export function formatYears(turns: number) {
  return `${turns} ${plural(turns, ["год", "года", "лет"])}`
}

// Одной строкой для истории правок клиента: «День рождения · Алия, жена · 14 марта 1990 · любит пионы».
export function describeCustomerDate(value: {
  title: string
  day: number
  month: number
  year: number | null
  note: string
  recipientLabel?: string
}) {
  return [value.title, value.recipientLabel ?? "", formatDayMonth(value.day, value.month, value.year), value.note]
    .filter(Boolean)
    .join(" · ")
}

// Насколько близко: сегодня/завтра — «горит», неделя — «скоро», дальше — спокойно.
export function dateUrgency(daysLeft: number): "today" | "soon" | "week" | "later" {
  if (daysLeft <= 0) {
    return "today"
  }
  if (daysLeft <= 2) {
    return "soon"
  }
  if (daysLeft <= 7) {
    return "week"
  }
  return "later"
}

export function withNextOccurrence<T extends { month: number; day: number; year: number | null }>(
  row: T,
  today: CalendarDay
): T & { nextDate: string; daysLeft: number; turns: number | null } {
  const next = nextOccurrence(row.month, row.day, today)
  const turns = row.year && next.year > row.year ? next.year - row.year : null
  return { ...row, nextDate: isoDay(next), daysLeft: next.daysLeft, turns }
}

function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
