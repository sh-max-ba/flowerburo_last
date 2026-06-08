import { cookies } from "next/headers"
import { canCloseShift } from "@/lib/auth"
import { getActiveFlorists, getShiftShellData, type CurrentUser, type DashboardData } from "@/lib/db"

export type ShiftShellContext = {
  defaultOpeningCash: number
  activeFlorists: CurrentUser[]
  openShift: DashboardData["stats"]["openShift"]
  openShiftDetails: DashboardData["shiftDetails"][number] | null
  canManageShift: boolean
}

export function getShiftShellContext(user: CurrentUser): ShiftShellContext {
  const { defaultOpeningCash, openShift, openShiftDetails } = getShiftShellData()

  return {
    defaultOpeningCash,
    activeFlorists: getActiveFlorists(),
    openShift,
    openShiftDetails,
    canManageShift: openShift ? canCloseShift(user, openShift.id) : user.role === "owner" || user.role === "manager",
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
    openShift,
    openShiftDetails: openShift
      ? data.shiftDetails.find((detail) => detail.shift.id === openShift.id) ?? null
      : null,
    canManageShift: openShift ? canCloseShift(user, openShift.id) : user.role === "owner" || user.role === "manager",
  }
}

export async function getSidebarDefaultOpen() {
  return (await cookies()).get("sidebar_state")?.value !== "false"
}
