// Заголовки/контексты топбара. Ключи синхронизированы с href из @/lib/nav
// (NAV_BY_HREF), плюс маршруты без записи в NAV: "/history/stock" (его NAV-href,
// но иной заголовок) и "/cash" (куда normalizePath сводит "/"). Осиротевший
// "/history" удалён вместе с маршрутом (канон — "/history/stock").
const routeTitles: Record<string, string> = {
  "/cash": "Касса",
  "/orders": "Стол заказов",
  "/ready-orders": "Готовые заказы",
  "/stock": "Склад",
  "/stock/acts": "Акты склада",
  "/history/stock": "История склада",
  "/shifts": "Смены",
  "/clients": "Клиенты",
  "/deals": "Сделки",
  "/bouquets": "Букеты",
  "/settings": "Настройки",
  "/users": "Пользователи",
}

const routeContexts: Record<string, string> = {
  "/cash": "Продажи и заказы смены",
  "/orders": "Заказы в работе",
  "/ready-orders": "Выдача и доставка",
  "/stock": "Остатки и движения",
  "/stock/acts": "Складские документы",
  "/history/stock": "Движения товаров",
  "/shifts": "История смен",
  "/clients": "База клиентов",
  "/deals": "Воронка продаж",
  "/bouquets": "Шаблоны букетов",
  "/settings": "Администрирование",
  "/users": "Доступ и роли",
}

export function getPageTitle(pathname: string) {
  const path = normalizePath(pathname)

  if (/^\/deals\/[^/]+$/.test(path)) {
    return "Сделка"
  }

  if (/^\/clients\/[^/]+$/.test(path)) {
    return "Клиент"
  }

  if (/^\/shifts\/[^/]+$/.test(path)) {
    return "Детали смены"
  }

  if (/^\/stock\/acts\/[^/]+(?:\/edit)?$/.test(path)) {
    return "Акт склада"
  }

  return routeTitles[path] ?? "Flower Buro"
}

export function getPageContext(pathname: string) {
  const path = normalizePath(pathname)

  if (/^\/deals\/[^/]+$/.test(path)) {
    return "Карточка сделки"
  }

  if (/^\/clients\/[^/]+$/.test(path)) {
    return "Карточка клиента"
  }

  if (/^\/shifts\/[^/]+$/.test(path)) {
    return "Сверка смены"
  }

  if (/^\/stock\/acts\/[^/]+(?:\/edit)?$/.test(path)) {
    return "Детали документа"
  }

  return routeContexts[path] ?? ""
}

function normalizePath(pathname: string) {
  const path = pathname.split("?")[0]?.replace(/\/+$/, "") || "/"
  return path === "/" ? "/cash" : path
}
