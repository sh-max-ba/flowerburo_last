"use client"

import { CalendarHeartIcon, UsersIcon } from "lucide-react"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"

export type ClientsView = "clients" | "dates"

// Вкладки раздела «Клиенты»: список клиентов и «Даты» — дни рождения и годовщины по порядку
// наступления. Счётчик у «Даты» — сколько дат в ближайшие 7 дней (кого поздравить на неделе).
export function ClientsTabs({ value, weekCount }: { value: ClientsView; weekCount: number }) {
  return (
    <SegmentedTabs
      aria-label="Раздел клиентов"
      fill
      value={value}
      items={[
        { value: "clients", label: "Клиенты", icon: UsersIcon, href: "/clients" },
        { value: "dates", label: "Даты", icon: CalendarHeartIcon, href: "/clients?view=dates", count: weekCount },
      ]}
    />
  )
}
