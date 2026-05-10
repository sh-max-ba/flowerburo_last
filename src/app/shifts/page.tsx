import { ShiftsPage } from "@/components/shifts/shift-pages"
import { AccessDenied } from "@/components/access-denied"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getDashboardData } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()

  return <ShiftsPage data={data} />
}
