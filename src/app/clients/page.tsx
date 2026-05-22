import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { CustomersPage } from "@/components/clients/customers-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext } from "@/lib/app-shell"
import { listCustomers } from "@/lib/crm"

export const dynamic = "force-dynamic"

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>
}) {
  const user = await requireUser()
  if (user.role === "florist") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { search = "" } = await searchParams
  const customers = listCustomers({ search })

  return (
    <CrmShell user={user} active="clients" title="Клиенты" shiftContext={getShiftShellContext(user)}>
      <CustomersPage customers={customers} search={search} />
    </CrmShell>
  )
}
