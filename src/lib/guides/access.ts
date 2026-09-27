import type { UserRole } from "@/lib/db"
import type { GuideId } from "@/lib/guides/types"

export const GUIDE_IDS: GuideId[] = ["florist", "manager", "admin"]

// Кто какие руководства видит. Управляющий — все (обучает команду); менеджер и флорист — своё и
// друг друга: они вместе работают со столом заказов, кассой и чатами, и флорист подменяет
// менеджера (выдача, ответы клиентам). Экраны руководства администратора содержат выручку и
// долги поставщикам — только управляющему. Первое в списке — руководство по умолчанию.
const VISIBLE: Record<UserRole, GuideId[]> = {
  owner: ["admin", "manager", "florist"],
  manager: ["manager", "florist"],
  florist: ["florist", "manager"],
}

export function guidesForRole(role: UserRole): GuideId[] {
  return VISIBLE[role] ?? []
}

export function canViewGuide(role: UserRole, guide: GuideId) {
  return guidesForRole(role).includes(guide)
}

export function defaultGuideForRole(role: UserRole): GuideId {
  return guidesForRole(role)[0] ?? "florist"
}

export function isGuideId(value: unknown): value is GuideId {
  return typeof value === "string" && (GUIDE_IDS as string[]).includes(value)
}

// Файл кадра начинается с руководства, к которому он относится: «florist-orders.webp».
export function guideOfShotFile(file: string): GuideId | null {
  const prefix = file.split("-")[0]
  return isGuideId(prefix) ? prefix : null
}
