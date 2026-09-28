import type { UserRole } from "@/lib/db"

// Руководство = роль в магазине. URL-ключ «admin» — так роль называют в магазине;
// в приложении это пользователь с ролью owner («Управляющий»).
export type GuideId = "florist" | "manager" | "admin"

// Прямоугольник в долях кадра: [x, y, ширина, высота], всё от 0 до 1.
export type ShotBox = [number, number, number, number]

export type ShotMeta = {
  // Размер кадра в CSS-пикселях (снимается в 2x — файл вдвое больше).
  width: number
  height: number
  // Именованные области кадра — их подсвечивают шаги (focus) и по ним кадрируют (crop).
  targets: Record<string, ShotBox>
}

export type ShotRef = {
  id: string
  // Подписанный текст для скринридера и при незагруженной картинке — что на экране.
  alt: string
  // Область, на которую смотреть: остальное затемняется.
  focus?: string
  // Показать только часть экрана вокруг области (с полями) — крупнее и читаемее. Несколько
  // областей — общая рамка вокруг всех.
  crop?: string | string[]
  // Нумерованные метки на экране; подписи — в legend шага.
  marks?: string[]
}

export type GuideStep = {
  title: string
  // Текст шага. **Надпись** — подпись кнопки/поля/вкладки, как на экране.
  body: string
  shot?: ShotRef
  // Подписи к меткам (marks), по порядку.
  legend?: Array<{ title: string; text?: string }>
  tip?: string
  warn?: string
}

export type GuideScenario = {
  slug: string
  title: string
  // Одна строка на карточке: когда и зачем.
  summary: string
  icon: GuideIconKey
  minutes: number
  // Экран, где это делается, — кнопка «Открыть экран».
  where?: { label: string; href: string }
  // Что должно быть готово до начала.
  before?: string[]
  steps: GuideStep[]
  // Как понять, что всё получилось.
  result?: string
  problems?: Array<{ q: string; a: string }>
  // Слова, по которым сценарий находится в поиске, кроме заголовка и текста.
  keywords?: string[]
}

export type GuideFlowNode = {
  slug: string
  label: string
  caption: string
  // Шаг делает другая роль (передача заказа): ссылка ведёт в её руководство.
  guide?: GuideId
}

export type Guide = {
  id: GuideId
  // Название вкладки: «Флорист».
  title: string
  // Заголовок руководства: «Руководство флориста».
  heading: string
  intro: string
  icon: GuideIconKey
  // Главный экран роли — с него начинается работа.
  home: { label: string; href: string }
  // Путь за смену — схема на главной руководства.
  flowTitle: string
  flow: GuideFlowNode[]
  // Ответвления от пути: делаются по ситуации.
  branches?: GuideFlowNode[]
  groups: Array<{ id: string; title: string; description?: string; slugs: string[] }>
  scenarios: GuideScenario[]
  faq: Array<{ q: string; a: string }>
}

export type GuideIconKey =
  | "florist"
  | "manager"
  | "admin"
  | "login"
  | "shift"
  | "shift-close"
  | "orders"
  | "work"
  | "photo"
  | "ready"
  | "drafts"
  | "cash"
  | "refund"
  | "chats"
  | "quick"
  | "order-new"
  | "client"
  | "dates"
  | "recipients"
  | "bouquet"
  | "issue"
  | "history"
  | "dashboard"
  | "analytics"
  | "stock-in"
  | "stock-out"
  | "inventory"
  | "supplier"
  | "shifts"
  | "users"
  | "settings"
  | "product"
  | "phone"
  | "help"

export const GUIDE_ROLE_OF: Record<GuideId, UserRole> = {
  florist: "florist",
  manager: "manager",
  admin: "owner",
}
