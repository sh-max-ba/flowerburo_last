// Префилл <input type="datetime-local"> — в поясе МАГАЗИНА, симметрично fromDatetimeLocalValue
// (наивный ввод трактуется как бишкекский). Раньше префилл шёл в поясе УСТРОЙСТВА
// (getTimezoneOffset), и на устройстве не в +6 каждый цикл «открыть черновик → сохранить»
// сдвигал дату на разницу поясов.
export function toDatetimeLocalValue(dateString?: string | null) {
  const date = dateString ? (parseDbInstant(dateString) ?? new Date(dateString)) : new Date()
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
}

// Смещение пояса магазина (Бишкек, UTC+6, перехода на летнее время нет). Нужно при разборе
// «наивных» значений <input type="datetime-local">: их вводят в часах магазина, не сервера.
const SHOP_UTC_OFFSET = "+06:00"

// То же смещение в синтаксисе модификаторов SQLite: границы «дня» и «сейчас» в SQL-агрегатах
// считаются в поясе магазина, а не сервера ('localtime' на проде = UTC).
export const SHOP_UTC_OFFSET_SQL = "+6 hours"

export function fromDatetimeLocalValue(value?: FormDataEntryValue | string | null) {
  const rawValue = String(value ?? "").trim()
  if (!rawValue) {
    return new Date().toISOString()
  }

  // "YYYY-MM-DDTHH:MM(:SS)" без зоны — наивное время в поясе МАГАЗИНА. new Date(naive)
  // трактовал бы его в поясе сервера (UTC на проде) → даты актов уезжали на +6 часов,
  // и сдвиг накапливался при каждом цикле редактирования черновика.
  const isNaive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(rawValue)
  const date = isNaive
    ? new Date(`${rawValue}${rawValue.length === 16 ? ":00" : ""}${SHOP_UTC_OFFSET}`)
    : new Date(rawValue)
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
