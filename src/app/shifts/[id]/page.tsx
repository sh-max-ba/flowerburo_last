import { notFound } from "next/navigation"
import { ShiftDetailPage } from "@/components/shifts/shift-pages"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftDetails } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function Page({ params }: PageProps<"/shifts/[id]">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const shiftId = Number(id)

  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    notFound()
  }

  const detail = getShiftDetailsOrNull(shiftId)
  if (!detail) {
    notFound()
  }

  return (
    <CrmShell
      user={user}
      active="shifts"
      title={`Смена #${detail.shift.id}`}
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <ShiftDetailPage detail={detail} />
    </CrmShell>
  )
}

function getShiftDetailsOrNull(shiftId: number) {
  try {
    return getShiftDetails(shiftId)
  } catch {
    return null
  }
}
