import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { CustomersPage } from "@/components/clients/customers-page"
import { CustomerDatesPage } from "@/components/clients/customer-dates-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { listCustomers } from "@/lib/crm"
import { parseDatesWindow } from "@/lib/customer-dates"
import { listUpcomingCustomerDates } from "@/lib/db"
import { canAccessSection } from "@/lib/nav"

export const dynamic = "force-dynamic"

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; view?: string; days?: string }>
}) {
  const user = await requireUser()
  if (!canAccessSection("clients", user.role, false)) {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { search = "", view, days } = await searchParams
  // Счётчик вкладки «Даты» — сколько дат в ближайшие 7 дней.
  const weekCount = listUpcomingCustomerDates({ days: 7 }).length
  const datesWindow = view === "dates" ? parseDatesWindow(days) : null

  return (
    <CrmShell
      user={user}
      active="clients"
      title={datesWindow ? "Важные даты клиентов" : "Клиенты"}
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      {datesWindow ? (
        <CustomerDatesPage
          dates={listUpcomingCustomerDates({ days: datesWindow === "all" ? null : Number(datesWindow) })}
          window={datesWindow}
          weekCount={weekCount}
        />
      ) : (
        <CustomersPage customers={listCustomers({ search })} search={search} weekCount={weekCount} />
      )}
    </CrmShell>
  )
}
