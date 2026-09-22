"use client"

import { useState } from "react"
import { CameraIcon, MessageCircleIcon, SendIcon, UsersRoundIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { wazzupMessageTypeLabel } from "@/lib/labels"
import { cn } from "@/lib/utils"

// Общие кусочки единого окна чатов: канал (иконка + цвет), аватар с фолбэком на инициалы,
// форматирование времени в поясе магазина.

export type ChannelMeta = { label: string; icon: LucideIcon; className: string; dotClassName: string }

const channels: Record<string, ChannelMeta> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircleIcon, className: "text-emerald-600", dotClassName: "bg-emerald-500" },
  whatsgroup: { label: "Группа WhatsApp", icon: UsersRoundIcon, className: "text-emerald-600", dotClassName: "bg-emerald-500" },
  instagram: { label: "Instagram", icon: CameraIcon, className: "text-pink-600", dotClassName: "bg-pink-500" },
  telegram: { label: "Telegram", icon: SendIcon, className: "text-sky-600", dotClassName: "bg-sky-500" },
  telegroup: { label: "Группа Telegram", icon: UsersRoundIcon, className: "text-sky-600", dotClassName: "bg-sky-500" },
  max: { label: "MAX", icon: MessageCircleIcon, className: "text-violet-600", dotClassName: "bg-violet-500" },
}

export function channelMeta(chatType: string): ChannelMeta {
  return channels[chatType] ?? { label: chatType || "Чат", icon: MessageCircleIcon, className: "text-muted-foreground", dotClassName: "bg-zinc-400" }
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((part) => Array.from(part)[0] ?? "")
  const value = letters.join("").toUpperCase()
  return /[\p{L}\p{N}]/u.test(value) ? value : "•"
}

// Цвет фолбэк-аватара — стабильный по имени, приглушённые оттенки.
const avatarPalette = [
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-teal-100 text-teal-800",
]

function paletteFor(seed: string) {
  let hash = 0
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return avatarPalette[hash % avatarPalette.length]
}

export function ChatAvatar({
  chatId,
  name,
  hasAvatar,
  chatType,
  size = "md",
  className,
}: {
  chatId: number
  name: string
  hasAvatar: boolean
  chatType?: string
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const dimension = size === "lg" ? "size-16 text-xl" : size === "sm" ? "size-8 text-xs" : "size-11 text-sm"
  const showImage = hasAvatar && !failed
  const channel = chatType ? channelMeta(chatType) : null

  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full font-semibold select-none",
          dimension,
          paletteFor(name || String(chatId))
        )}
        aria-hidden
      >
        {initials(name)}
        {showImage ? (
          // Аватар — через серверный прокси по id диалога (см. /api/chats/[id]/avatar); пока грузится
          // или если ссылка протухла — под ним инициалы.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/chats/${chatId}/avatar`}
            alt=""
            className="absolute inset-0 size-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : null}
      </div>
      {channel ? (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full bg-background ring-2 ring-background",
            size === "lg" ? "size-5" : "size-4"
          )}
          title={channel.label}
        >
          <span className={cn("flex size-full items-center justify-center rounded-full", channel.dotClassName)}>
            <channel.icon className={cn("text-white", size === "lg" ? "size-3" : "size-2.5")} aria-hidden />
          </span>
        </span>
      ) : null}
    </div>
  )
}

const timeFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: SHOP_TIME_ZONE, hour: "2-digit", minute: "2-digit" })
const dayFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: SHOP_TIME_ZONE, day: "numeric", month: "long" })
const dayYearFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: SHOP_TIME_ZONE, day: "numeric", month: "long", year: "numeric" })
const shortDayFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: SHOP_TIME_ZONE, day: "numeric", month: "short" })
const weekdayFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: SHOP_TIME_ZONE, weekday: "short" })
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

function dayKey(date: Date) {
  return dateKeyFormatter.format(date)
}

export function formatTime(value: string) {
  const date = parseDbInstant(value)
  return date ? timeFormatter.format(date) : ""
}

export function formatDateTime(value: string) {
  const date = parseDbInstant(value)
  return date ? dateTimeFormatter.format(date).replace(",", "") : ""
}

// Разделитель дней в ленте: «Сегодня», «Вчера», «12 сентября», «12 сентября 2025».
export function formatDayLabel(value: string, now = new Date()) {
  const date = parseDbInstant(value)
  if (!date) {
    return ""
  }
  const key = dayKey(date)
  if (key === dayKey(now)) {
    return "Сегодня"
  }
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) {
    return "Вчера"
  }
  const sameYear = key.slice(0, 4) === dayKey(now).slice(0, 4)
  return (sameYear ? dayFormatter : dayYearFormatter).format(date)
}

export function sameDay(left: string, right: string) {
  const a = parseDbInstant(left)
  const b = parseDbInstant(right)
  return Boolean(a && b && dayKey(a) === dayKey(b))
}

// Время в списке диалогов: сегодня — часы, вчера — «вчера», на этой неделе — день недели, иначе дата.
export function formatListTime(value: string, now = new Date()) {
  const date = parseDbInstant(value)
  if (!date) {
    return ""
  }
  const key = dayKey(date)
  if (key === dayKey(now)) {
    return timeFormatter.format(date)
  }
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) {
    return "вчера"
  }
  const ageDays = (now.getTime() - date.getTime()) / 86_400_000
  if (ageDays < 6) {
    return weekdayFormatter.format(date)
  }
  return shortDayFormatter.format(date).replace(".", "")
}

// Как долго диалог ждёт ответа: «3 мин», «2 ч», «1 д».
export function formatWaiting(value: string, now = new Date()) {
  const date = parseDbInstant(value)
  if (!date) {
    return ""
  }
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000))
  if (minutes < 1) {
    return "только что"
  }
  if (minutes < 60) {
    return `${minutes} мин`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours} ч`
  }
  return `${Math.round(hours / 24)} д`
}

// Превью сообщения в списке: текст или тип вложения с иконкой-подсказкой.
export function messagePreview(text: string, messageType: string) {
  const value = text.trim()
  if (value && !/^\[[a-z_]+\]$/.test(value)) {
    return value.replace(/\s+/g, " ")
  }
  const type = value.startsWith("[") ? value.slice(1, -1) : messageType
  if (type === "audio") {
    return "🎤 Голосовое сообщение"
  }
  if (type === "image") {
    return "📷 Фото"
  }
  if (type === "video") {
    return "🎬 Видео"
  }
  if (type === "document") {
    return "📎 Документ"
  }
  if (!type || type === "text") {
    return ""
  }
  return wazzupMessageTypeLabel(type)
}

export function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "")
  if (!digits) {
    return value
  }
  if (digits.length === 12 && digits.startsWith("996")) {
    return `+996 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
  }
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`
  }
  return `+${digits}`
}
