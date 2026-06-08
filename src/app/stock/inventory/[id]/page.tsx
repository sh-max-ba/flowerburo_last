import { redirect } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { InventoryDetailClient } from "@/components/stock/inventory-detail-client"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getStockDocument } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function StockInventoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const documentId = Number(id)
  if (!Number.isInteger(documentId) || documentId <= 0) {
    redirect("/stock/inventory")
  }

  let doc
  try {
    doc = getStockDocument(documentId)
  } catch {
    redirect("/stock/inventory")
  }
  if (doc.type !== "count") {
    redirect("/stock/inventory")
  }

  return (
    <CrmShell
      user={user}
      active="stock-inventory"
      title={`Инвентаризация ${doc.number}`}
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <InventoryDetailClient doc={doc} />
    </CrmShell>
  )
}
