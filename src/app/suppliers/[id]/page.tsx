import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { SupplierCard } from "@/components/suppliers/supplier-card"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import {
  getSupplier,
  getSupplierPurchaseHistory,
  getSupplierSettlement,
  listSupplierDebtDocuments,
  listSupplierPayments,
} from "@/lib/db"

export const dynamic = "force-dynamic"

// Карточка поставщика: реквизиты, расчёты (закуплено / оплачено / долг), погашение долга, журнал
// оплат и история приходов с суммами.
export default async function SupplierCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const supplierId = Number(id)
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    notFound()
  }

  const supplier = getSupplier(supplierId)
  if (!supplier) {
    notFound()
  }
  const shiftContext = getShiftShellContext(user)

  return (
    <CrmShell
      user={user}
      active="suppliers"
      title={supplier.name}
      shiftContext={shiftContext}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <SupplierCard
        supplier={supplier}
        settlement={getSupplierSettlement(supplierId)}
        debtDocuments={listSupplierDebtDocuments(supplierId)}
        payments={listSupplierPayments({ supplierId })}
        purchases={getSupplierPurchaseHistory(supplierId)}
        hasOpenShift={Boolean(shiftContext.openShift)}
      />
    </CrmShell>
  )
}
