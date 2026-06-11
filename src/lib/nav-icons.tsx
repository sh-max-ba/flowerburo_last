"use client"

import {
  BanknoteIcon,
  BoxesIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  Flower2Icon,
  HistoryIcon,
  LayoutDashboardIcon,
  NotebookPenIcon,
  PackageCheckIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  SettingsIcon,
  TagsIcon,
  TruckIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// Иконки навигации, привязанные к iconKey из @/lib/nav. Вынесены в отдельный
// "use client"-модуль, чтобы nav.ts оставался серверно-нейтральным (без lucide).
export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  deals: TagsIcon,
  clients: UserCheckIcon,
  bouquets: Flower2Icon,
  cash: ReceiptTextIcon,
  orders: ClipboardListIcon,
  "order-drafts": NotebookPenIcon,
  "ready-orders": PackageCheckIcon,
  stock: BoxesIcon,
  "stock-acts": ScrollTextIcon,
  "stock-lots": CalendarClockIcon,
  "stock-inventory": ClipboardCheckIcon,
  suppliers: TruckIcon,
  history: HistoryIcon,
  shifts: BanknoteIcon,
  settings: SettingsIcon,
  users: UsersIcon,
}
