import { canCloseShift } from "@/lib/auth"
import { getActiveFlorists, getDashboardData, type CurrentUser, type DashboardData } from "@/lib/db"

export type ShiftShellContext = {
  defaultOpeningCash: number
  activeFlorists: CurrentUser[]
  openShift: DashboardData["stats"]["openShift"]
  openShiftDetails: DashboardData["shiftDetails"][number] | null
  canManageShift: boolean
}

export function getShiftShellContext(user: CurrentUser): ShiftShellContext {
  return buildShiftShellContext(user, getDashboardData(), getActiveFlorists())
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
    openShift,
    openShiftDetails: openShift
      ? data.shiftDetails.find((detail) => detail.shift.id === openShift.id) ?? null
      : null,
    canManageShift: openShift ? canCloseShift(user, openShift.id) : user.role === "owner" || user.role === "manager",
  }
}
