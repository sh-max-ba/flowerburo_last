import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { DealDetailPage } from "@/components/deals/deal-detail-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext } from "@/lib/app-shell"
import { getDeal, listCustomers, listDealStages, listProducts } from "@/lib/crm"
import { getOpenShift, listBouquetTemplates, listDealBouquetMessages, listUsers } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function DealDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (user.role === "florist") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const dealId = Number(id)
  if (!Number.isInteger(dealId) || dealId <= 0) {
    notFound()
  }

  const deal = getDeal(dealId)
  if (!deal) {
    notFound()
  }

  return (
    <CrmShell
      user={user}
      active="deals"
      title={`Сделка ${deal.number || `#${deal.id}`}`}
      shiftContext={getShiftShellContext(user)}
    >
      <DealDetailPage
        deal={deal}
        stages={listDealStages()}
        customers={listCustomers()}
        users={listUsers().filter((item) => item.isActive)}
        products={listProducts()}
        bouquets={listBouquetTemplates({ activeOnly: true })}
        bouquetMessages={listDealBouquetMessages(deal.id)}
        openShift={getOpenShift() ?? null}
      />
    </CrmShell>
  )
}
