import type { UserRole } from "@/lib/db"

export type NavSectionId =
  | "dashboard"
  | "deals"
  | "clients"
  | "bouquets"
  | "sales"
  | "orders"
  | "ready-orders"
  | "stock"
  | "stock-acts"
  | "stock-lots"
  | "suppliers"
  | "shifts"
  | "history"
  | "history-cash"
  | "settings"
  | "users"

export type NavGroupId = "overview" | "crm" | "work" | "stock" | "admin"

export type NavItem = {
  id: NavSectionId
  label: string
  href: string
  iconKey: string
  roles: UserRole[]
}

export type NavGroup = {
  id: NavGroupId
  label: string
  ids: NavSectionId[]
}

// Единый источник навигации. roles — консервативное ОБЪЕДИНЕНИЕ текущих прав
// (backoffice.tsx roleSectionIds + florist/cash override, crm-shell navItems,
// backoffice-route canAccessSection). НЕ расширять и НЕ сужать без отдельной задачи.
// florist получает только "orders"; доступ к "sales" (Касса) — особый случай,
// разрешён лишь при открытой ночной смене (canAccessCash) — см. getNavForRole.
export const NAV: NavItem[] = [
  { id: "dashboard", label: "Дашборд", href: "/dashboard", iconKey: "dashboard", roles: ["owner"] },
  { id: "deals", label: "Сделки", href: "/deals", iconKey: "deals", roles: ["owner", "manager"] },
  { id: "clients", label: "Клиенты", href: "/clients", iconKey: "clients", roles: ["owner", "manager"] },
  { id: "bouquets", label: "Букеты", href: "/bouquets", iconKey: "bouquets", roles: ["owner", "manager"] },
  { id: "sales", label: "Касса", href: "/cash", iconKey: "cash", roles: ["owner", "manager"] },
  { id: "orders", label: "Стол заказов", href: "/orders", iconKey: "orders", roles: ["owner", "manager", "florist"] },
  { id: "ready-orders", label: "Готовые заказы", href: "/ready-orders", iconKey: "ready-orders", roles: ["owner", "manager"] },
  { id: "stock", label: "Склад", href: "/stock", iconKey: "stock", roles: ["owner"] },
  { id: "stock-acts", label: "Акты склада", href: "/stock/acts", iconKey: "stock-acts", roles: ["owner"] },
  { id: "stock-lots", label: "Партии и сроки", href: "/stock/lots", iconKey: "stock-lots", roles: ["owner"] },
  { id: "suppliers", label: "Поставщики", href: "/suppliers", iconKey: "suppliers", roles: ["owner"] },
  { id: "history-cash", label: "История кассы", href: "/history", iconKey: "history", roles: ["owner", "manager"] },
  { id: "history", label: "История склада", href: "/history/stock", iconKey: "history", roles: ["owner"] },
  { id: "shifts", label: "Смены", href: "/shifts", iconKey: "shifts", roles: ["owner"] },
  { id: "settings", label: "Настройки", href: "/settings", iconKey: "settings", roles: ["owner"] },
  { id: "users", label: "Пользователи", href: "/users", iconKey: "users", roles: ["owner"] },
]

export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "Обзор", ids: ["dashboard"] },
  { id: "crm", label: "CRM", ids: ["deals", "clients", "bouquets"] },
  { id: "work", label: "Работа", ids: ["sales", "orders", "ready-orders", "history-cash"] },
  { id: "stock", label: "Склад", ids: ["stock", "stock-acts", "stock-lots", "suppliers", "history"] },
  { id: "admin", label: "Администрирование", ids: ["shifts", "settings", "users"] },
]

export const NAV_BY_ID: Record<NavSectionId, NavItem> = NAV.reduce(
  (acc, item) => {
    acc[item.id] = item
    return acc
  },
  {} as Record<NavSectionId, NavItem>
)

export const NAV_BY_HREF: Record<string, NavItem> = NAV.reduce(
  (acc, item) => {
    acc[item.href] = item
    return acc
  },
  {} as Record<string, NavItem>
)

// Доступ к конкретному разделу. Воспроизводит ОБЪЕДИНЕНИЕ текущих правил:
// owner — всё; manager — все его разделы из NAV; florist — только "orders",
// плюс "sales" при открытой ночной смене (canAccessCash).
export function canAccessSection(
  section: NavSectionId,
  role: UserRole,
  canAccessCash: boolean
): boolean {
  if (role === "owner") {
    return true
  }

  if (role === "florist") {
    if (section === "orders") {
      return true
    }

    return section === "sales" && canAccessCash
  }

  return NAV_BY_ID[section]?.roles.includes(role) ?? false
}

// Видимые в сайдбаре разделы для роли. florist при открытой ночной смене
// получает дополнительно "Касса" (sales), иначе — только "orders".
export function getNavForRole(
  role: UserRole,
  { canAccessCash }: { canAccessCash: boolean }
): NavItem[] {
  return NAV.filter((item) => canAccessSection(item.id, role, canAccessCash))
}
