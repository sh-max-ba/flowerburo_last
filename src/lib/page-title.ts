// Заголовки/контексты топбара. Ключи синхронизированы с href из @/lib/nav.
// "/cash" — куда normalizePath сводит "/". Детальные маршруты (/deals/[id],
// /suppliers/[id], /stock/inventory/[id], /warehouse/imports/[id] и т.п.)
// разбираются регулярками в getPageTitle/getPageContext ниже.
const routeTitles: Record<string, string> = {
  "/dashboard": "Дашборд",
  "/analytics": "Аналитика",
  "/cash": "Касса",
  "/orders": "Стол заказов",
  "/orders/drafts": "Черновики",
  "/ready-orders": "Готовые заказы",
  "/stock": "Склад",
  "/stock/report": "Остатки",
  "/stock/acts": "Акты склада",
  "/stock/lots": "Партии и сроки",
  "/stock/inventory": "Инвентаризация",
  "/suppliers": "Поставщики",
  "/warehouse/imports": "Импорты склада",
  "/history": "История кассы",
  "/history/stock": "История склада",
  "/shifts": "Смены",
  "/chats": "Чаты",
  "/clients": "Клиенты",
  "/deals": "Сделки",
  "/bouquets": "Букеты",
  "/settings": "Настройки",
  "/users": "Пользователи",
  "/guides": "Руководства",
}

const routeContexts: Record<string, string> = {
  "/dashboard": "Сводка по магазину",
  "/analytics": "Склад и продажи",
  "/cash": "Продажи и заказы смены",
  "/orders": "Заказы в работе",
  "/orders/drafts": "Несогласованные заказы",
  "/ready-orders": "Выдача и доставка",
  "/stock": "Остатки и движения",
  "/stock/report": "Остатки и себестоимость",
  "/stock/acts": "Складские документы",
  "/stock/lots": "Себестоимость по партиям",
  "/stock/inventory": "Пересчёт остатков",
  "/suppliers": "Справочник поставщиков",
  "/warehouse/imports": "Импорт остатков из файла",
  "/history": "Кассовые операции",
  "/history/stock": "Движения товаров",
  "/shifts": "История смен",
  "/chats": "Переписка с клиентами",
  "/clients": "База клиентов",
  "/deals": "Воронка продаж",
  "/bouquets": "Шаблоны букетов",
  "/settings": "Администрирование",
  "/users": "Доступ и роли",
  "/guides": "Как работать в FlowerBuro",
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

  if (/^\/stock\/products\/[^/]+$/.test(path)) {
    return "Карточка товара"
  }

  if (/^\/suppliers\/[^/]+$/.test(path)) {
    return "Поставщик"
  }

  if (/^\/stock\/inventory\/[^/]+$/.test(path)) {
    return "Инвентаризация"
  }

  if (/^\/warehouse\/imports\/[^/]+$/.test(path)) {
    return "Импорт"
  }

  if (/^\/guides\/[^/]+\/[^/]+$/.test(path)) {
    return "Инструкция"
  }

  return routeTitles[path] ?? "FlowerBuro | sellz"
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

  if (/^\/stock\/products\/[^/]+$/.test(path)) {
    return "Движения и поставщики"
  }

  if (/^\/suppliers\/[^/]+$/.test(path)) {
    return "Карточка поставщика"
  }

  if (/^\/stock\/inventory\/[^/]+$/.test(path)) {
    return "Лист пересчёта"
  }

  if (/^\/warehouse\/imports\/[^/]+$/.test(path)) {
    return "Отчёт импорта"
  }

  if (/^\/guides\/[^/]+\/[^/]+$/.test(path)) {
    return "Пошаговая инструкция"
  }

  return routeContexts[path] ?? ""
}

function normalizePath(pathname: string) {
  const path = pathname.split("?")[0]?.replace(/\/+$/, "") || "/"
  return path === "/" ? "/cash" : path
}
