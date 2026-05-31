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
