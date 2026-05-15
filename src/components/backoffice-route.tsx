import { AccessDenied } from "@/components/access-denied"
import { Backoffice, type Section } from "@/components/backoffice"
import { canUseCash, getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getActiveFlorists, getDashboardData } from "@/lib/db"

type BackofficeRouteProps = {
  section?: Section
}

export async function BackofficeRoute({ section }: BackofficeRouteProps) {
  const user = await requireUser()
  const canAccessCash = await canUseCash(user)
  const initialSection = section ?? (user.role === "florist" ? "orders" : "sales")

  if (!canAccessSection(initialSection, user.role, canAccessCash)) {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const data = getDashboardData()
  const activeFlorists = getActiveFlorists()

  return (
    <Backoffice
      data={data}
      user={user}
      initialSection={initialSection}
      canAccessCash={canAccessCash}
      activeFlorists={activeFlorists}
    />
  )
}

function canAccessSection(section: Section, role: string, canAccessCash: boolean) {
  if (role === "owner") {
    return true
  }

  if (role === "manager") {
    return (
      section === "sales" ||
      section === "ready-orders" ||
      section === "orders" ||
      section === "clients" ||
      section === "deals"
    )
  }

  if (section === "orders") {
    return true
  }

  return section === "sales" && canAccessCash
}
