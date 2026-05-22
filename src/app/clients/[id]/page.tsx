import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { CustomerDetailPage } from "@/components/clients/customer-detail-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext } from "@/lib/app-shell"
import { getCustomer, listCustomerOrders, listCustomerSales, listDeals } from "@/lib/crm"

export const dynamic = "force-dynamic"

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (user.role === "florist") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const customerId = Number(id)
  if (!Number.isInteger(customerId) || customerId <= 0) {
    notFound()
  }

  const customer = getCustomer(customerId)
  if (!customer) {
    notFound()
  }

  return (
    <CrmShell user={user} active="clients" title={`Клиент: ${customer.name}`} shiftContext={getShiftShellContext(user)}>
      <CustomerDetailPage
        customer={customer}
        deals={listDeals({ customerId })}
        orders={listCustomerOrders(customerId)}
        sales={listCustomerSales(customerId)}
      />
    </CrmShell>
  )
}
