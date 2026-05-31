"use client"

import {
  BanknoteIcon,
  BoxesIcon,
  ClipboardListIcon,
  Flower2Icon,
  HistoryIcon,
  PackageCheckIcon,
  ReceiptTextIcon,
  SettingsIcon,
  TagsIcon,
  UserCheckIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// Иконки навигации, привязанные к iconKey из @/lib/nav. Вынесены в отдельный
// "use client"-модуль, чтобы nav.ts оставался серверно-нейтральным (без lucide).
export const NAV_ICONS: Record<string, LucideIcon> = {
  deals: TagsIcon,
  clients: UserCheckIcon,
  bouquets: Flower2Icon,
  cash: ReceiptTextIcon,
  orders: ClipboardListIcon,
  "ready-orders": PackageCheckIcon,
  stock: BoxesIcon,
  "stock-acts": ClipboardListIcon,
  history: HistoryIcon,
  shifts: BanknoteIcon,
  settings: SettingsIcon,
}
