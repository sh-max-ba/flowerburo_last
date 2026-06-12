import { cookies } from "next/headers"
import { canCloseShift } from "@/lib/auth"
import {
  getActiveCashUsers,
  getActiveFlorists,
  getShiftShellData,
  type CurrentUser,
  type DashboardData,
} from "@/lib/db"

export type ShiftShellContext = {
  defaultOpeningCash: number
  activeFlorists: CurrentUser[]
  // Кандидаты в ответственные за смену (для выбора при открытии владельцем/менеджером).
  activeCashUsers: CurrentUser[]
  openShift: DashboardData["stats"]["openShift"]
  openShiftDetails: DashboardData["shiftDetails"][number] | null
  canManageShift: boolean
}

export function getShiftShellContext(user: CurrentUser): ShiftShellContext {
  const { defaultOpeningCash, openShift, openShiftDetails } = getShiftShellData()

  return {
    defaultOpeningCash,
    activeFlorists: getActiveFlorists(),
    activeCashUsers: getActiveCashUsers(),
    openShift,
    openShiftDetails,
    // Нет открытой смены → показываем кнопку «Открыть смену» всем, кто работает на кассе
    // (owner/manager/florist). Открытие защищено единственной-открытой-сменой; флорист открывает
    // свою дневную. Закрытие чужой смены отсекает server-side canCloseShift.
    canManageShift: openShift
      ? canCloseShift(user, openShift.id)
      : user.role === "owner" || user.role === "manager" || user.role === "florist",
  }
}

export function buildShiftShellContext(
  user: CurrentUser,
  data: DashboardData,
  activeFlorists = getActiveFlorists()
): ShiftShellContext {
  const openShift = data.stats.openShift

  return {
    defaultOpeningCash: data.stats.defaultOpeningCash,
    activeFlorists,
    activeCashUsers: getActiveCashUsers(),
    openShift,
    openShiftDetails: openShift
      ? data.shiftDetails.find((detail) => detail.shift.id === openShift.id) ?? null
      : null,
    // Нет открытой смены → показываем кнопку «Открыть смену» всем, кто работает на кассе
    // (owner/manager/florist). Открытие защищено единственной-открытой-сменой; флорист открывает
    // свою дневную. Закрытие чужой смены отсекает server-side canCloseShift.
    canManageShift: openShift
      ? canCloseShift(user, openShift.id)
      : user.role === "owner" || user.role === "manager" || user.role === "florist",
  }
}

export async function getSidebarDefaultOpen() {
  return (await cookies()).get("sidebar_state")?.value !== "false"
}
