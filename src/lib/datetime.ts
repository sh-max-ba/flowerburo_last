export function toDatetimeLocalValue(dateString?: string | null) {
  const date = dateString ? new Date(dateString) : new Date()
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

export function fromDatetimeLocalValue(value?: FormDataEntryValue | string | null) {
  const rawValue = String(value ?? "").trim()
  if (!rawValue) {
    return new Date().toISOString()
  }

  const date = new Date(rawValue)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

// Магазин работает в одном часовом поясе (Бишкек, UTC+6). Метки времени из SQLite
// (created_at / opened_at / ready_at / updated_at …) пишутся через CURRENT_TIMESTAMP в UTC,
// поэтому при выводе их нужно переводить в этот пояс — иначе на устройствах/сервере в UTC
// время показывается на 6 часов назад. Срок заказа (due_at) — это «наивное» локальное время,
// которое ввёл пользователь; его сдвигать НЕ нужно, показываем ровно введённые часы.
export const SHOP_TIME_ZONE = "Asia/Bishkek"

// UTC-метка из БД ("YYYY-MM-DD HH:MM:SS" без зоны или ISO с Z/смещением) -> Date в правильный момент.
export function parseDbInstant(value: string | null | undefined): Date | null {
  const raw = String(value ?? "").trim()
  if (!raw) {
    return null
  }
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)
  const iso = hasZone ? raw.replace(" ", "T") : `${raw.replace(" ", "T")}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

// «Наивное» локальное время без зоны (due_at). Пиним к UTC и форматируем в UTC, чтобы вывод
// не зависел от пояса сервера/браузера и показывал ровно введённые часы и минуты.
export function parseWallClock(value: string | null | undefined): Date | null {
  const raw = String(value ?? "").trim()
  if (!raw) {
    return null
  }
  const base = raw.includes("T") ? raw : raw.replace(" ", "T")
  const withSeconds = /T\d{2}:\d{2}$/.test(base) ? `${base}:00` : base
  const date = new Date(`${withSeconds}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

type DisplayParts = { date?: boolean; time?: boolean; longMonth?: boolean }

// Показ UTC-метки из БД в часовом поясе магазина.
export function formatInstant(value: string | null | undefined, parts: DisplayParts = {}): string {
  const { date = true, time = true, longMonth = false } = parts
  const parsed = parseDbInstant(value)
  if (!parsed) {
    return value ? String(value) : ""
  }
  return formatParts(parsed, SHOP_TIME_ZONE, { date, time, longMonth })
}

// Показ срока заказа (наивное локальное время) — ровно введённые часы, без сдвига пояса.
export function formatDeadline(value: string | null | undefined, parts: DisplayParts = {}): string {
  const { date = true, time = true, longMonth = false } = parts
  const parsed = parseWallClock(value)
  if (!parsed) {
    return value ? String(value) : ""
  }
  return formatParts(parsed, "UTC", { date, time, longMonth })
}

// Собираем дату и время раздельно и склеиваем через «, » — иначе ICU для ru вставляет «в»
// («12 мая в 12:00» вместо «12 мая, 12:00»).
function formatParts(
  date: Date,
  timeZone: string,
  { date: withDate, time: withTime, longMonth }: Required<DisplayParts>
): string {
  const chunks: string[] = []
  if (withDate) {
    chunks.push(
      new Intl.DateTimeFormat(
        "ru-RU",
        longMonth
          ? { timeZone, day: "numeric", month: "long" }
          : { timeZone, day: "2-digit", month: "2-digit" }
      ).format(date)
    )
  }
  if (withTime) {
    chunks.push(new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date))
  }
  return chunks.join(", ")
}
