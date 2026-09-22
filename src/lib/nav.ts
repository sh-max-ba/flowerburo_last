import type { UserRole } from "@/lib/db"

export type NavSectionId =
  | "dashboard"
  | "deals"
  | "clients"
  | "bouquets"
  | "sales"
  | "orders"
  | "order-drafts"
  | "ready-orders"
  | "stock"
  | "stock-report"
  | "stock-acts"
  | "stock-lots"
  | "stock-inventory"
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
  // sidebar:false — раздел доступен и имеет маршрут, но в сайдбаре не показывается
  // (открывается вкладкой внутри родительского раздела, напр. складские подстраницы).
  sidebar?: boolean
}

export type NavGroup = {
  id: NavGroupId
  label: string
  ids: NavSectionId[]
}

// Единый источник навигации. roles — консервативное ОБЪЕДИНЕНИЕ текущих прав
// (backoffice.tsx roleSectionIds + florist/cash override, crm-shell navItems,
// backoffice-route canAccessSection). НЕ расширять и НЕ сужать без отдельной задачи.
// florist получает "orders" и "order-drafts" (черновики доступны ему полностью — см. роли
// draft-экшенов в actions.ts); доступ к "sales" (Касса) — особый случай, разрешён при ЛЮБОЙ
// открытой смене (canAccessCash = canUseCash) — см. getNavForRole.
export const NAV: NavItem[] = [
  { id: "dashboard", label: "Дашборд", href: "/dashboard", iconKey: "dashboard", roles: ["owner"] },
  { id: "deals", label: "Сделки", href: "/deals", iconKey: "deals", roles: ["owner", "manager"] },
  { id: "clients", label: "Клиенты", href: "/clients", iconKey: "clients", roles: ["owner", "manager"] },
  { id: "bouquets", label: "Букеты", href: "/bouquets", iconKey: "bouquets", roles: ["owner", "manager"] },
  { id: "sales", label: "Касса", href: "/cash", iconKey: "cash", roles: ["owner", "manager"] },
  { id: "orders", label: "Стол заказов", href: "/orders", iconKey: "orders", roles: ["owner", "manager", "florist"] },
  { id: "order-drafts", label: "Черновики", href: "/orders/drafts", iconKey: "order-drafts", roles: ["owner", "manager", "florist"], sidebar: false },
  { id: "ready-orders", label: "Готовые заказы", href: "/ready-orders", iconKey: "ready-orders", roles: ["owner", "manager"] },
  // Раздел «Склад»: в сайдбаре виден одним пунктом «Склад», остальное — вкладки STOCK_SUBNAV.
  { id: "stock", label: "Склад", href: "/stock", iconKey: "stock", roles: ["owner"] },
  { id: "stock-report", label: "Остатки", href: "/stock/report", iconKey: "stock-report", roles: ["owner"], sidebar: false },
  { id: "stock-acts", label: "Акты склада", href: "/stock/acts", iconKey: "stock-acts", roles: ["owner"], sidebar: false },
  { id: "stock-lots", label: "Партии и сроки", href: "/stock/lots", iconKey: "stock-lots", roles: ["owner"], sidebar: false },
  { id: "stock-inventory", label: "Инвентаризация", href: "/stock/inventory", iconKey: "stock-inventory", roles: ["owner"], sidebar: false },
  { id: "suppliers", label: "Поставщики", href: "/suppliers", iconKey: "suppliers", roles: ["owner"], sidebar: false },
  { id: "history-cash", label: "История кассы", href: "/history", iconKey: "history", roles: ["owner", "manager"] },
  { id: "history", label: "История склада", href: "/history/stock", iconKey: "history", roles: ["owner"], sidebar: false },
  { id: "shifts", label: "Смены", href: "/shifts", iconKey: "shifts", roles: ["owner"] },
  { id: "settings", label: "Настройки", href: "/settings", iconKey: "settings", roles: ["owner"] },
  { id: "users", label: "Пользователи", href: "/users", iconKey: "users", roles: ["owner"] },
]

export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "Обзор", ids: ["dashboard"] },
  { id: "crm", label: "CRM", ids: ["deals", "clients", "bouquets"] },
  { id: "work", label: "Работа", ids: ["sales", "orders", "order-drafts", "ready-orders", "history-cash"] },
  { id: "stock", label: "Склад", ids: ["stock", "stock-report", "stock-acts", "stock-lots", "stock-inventory", "suppliers", "history"] },
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
// owner — всё; manager — все его разделы из NAV; florist — "orders" и "order-drafts",
// плюс "sales" при любой открытой смене (canAccessCash).
export function canAccessSection(
  section: NavSectionId,
  role: UserRole,
  canAccessCash: boolean
): boolean {
  if (role === "owner") {
    return true
  }

  if (role === "florist") {
    if (section === "orders" || section === "order-drafts") {
      return true
    }

    return section === "sales" && canAccessCash
  }

  return NAV_BY_ID[section]?.roles.includes(role) ?? false
}

// Видимые в сайдбаре разделы для роли. florist при открытой ночной смене
// получает дополнительно "Касса" (sales), иначе — только "orders". Разделы с
// sidebar:false в сайдбар не попадают (они — вкладки внутри родительского раздела).
export function getNavForRole(
  role: UserRole,
  { canAccessCash }: { canAccessCash: boolean }
): NavItem[] {
  return NAV.filter((item) => item.sidebar !== false && canAccessSection(item.id, role, canAccessCash))
}

export type SubTab = { id: NavSectionId; label: string; href: string }

// Вкладки раздела «Склад» — единая подшапка на всех складских страницах вместо 7 пунктов
// сайдбара. Порядок = порядок вкладок. Доступ по-прежнему через canAccessSection.
export const STOCK_SUBNAV: SubTab[] = [
  { id: "stock", label: "Товары", href: "/stock" },
  { id: "stock-report", label: "Остатки", href: "/stock/report" },
  { id: "stock-acts", label: "Акты", href: "/stock/acts" },
  { id: "stock-lots", label: "Партии", href: "/stock/lots" },
  { id: "stock-inventory", label: "Инвентаризация", href: "/stock/inventory" },
  { id: "suppliers", label: "Поставщики", href: "/suppliers" },
  { id: "history", label: "История склада", href: "/history/stock" },
]

// Вкладки раздела «Стол заказов»: сам стол + черновики. Оба раздела доступны всем ролям,
// включая флориста.
export const ORDERS_SUBNAV: SubTab[] = [
  { id: "orders", label: "Стол заказов", href: "/orders" },
  { id: "order-drafts", label: "Черновики", href: "/orders/drafts" },
]

const SUBNAVS: Array<{ parent: NavSectionId; tabs: SubTab[] }> = [
  { parent: "stock", tabs: STOCK_SUBNAV },
  { parent: "orders", tabs: ORDERS_SUBNAV },
]

// Подшапка-вкладки для раздела, которому принадлежит active (или null, если раздел без вкладок).
// parent — пункт сайдбара, который надо подсветить для всех вкладок этого раздела.
export function getSubnav(active: NavSectionId): { parent: NavSectionId; tabs: SubTab[] } | null {
  return SUBNAVS.find((entry) => entry.tabs.some((tab) => tab.id === active)) ?? null
}
