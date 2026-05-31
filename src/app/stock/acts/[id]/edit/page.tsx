import Link from "next/link"
import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { StockDocumentForm } from "@/components/stock/stock-document-form"
import { buttonVariants } from "@/components/ui/button"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getDashboardData, getStockDocument } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function EditStockActPage({ params }: PageProps<"/stock/acts/[id]/edit">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const documentId = Number(id)
  if (!Number.isInteger(documentId) || documentId <= 0) {
    notFound()
  }

  const document = getStockDocumentOrNull(documentId)
  if (!document || document.status !== "draft") {
    notFound()
  }

  const data = getDashboardData()
  const suppliers = data.suppliers.filter(
    (supplier) => supplier.isActive || supplier.id === document.supplierId
  )

  return (
    <CrmShell
      user={user}
      active="stock-acts"
      title={`Редактировать акт ${document.number}`}
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <div className="flex w-full flex-col gap-4">
        <div className="flex justify-end">
          <Link href={`/stock/acts/${document.id}`} className={buttonVariants({ variant: "outline" })}>
            К акту
          </Link>
        </div>
        <StockDocumentForm document={document} products={data.products} suppliers={suppliers} />
      </div>
    </CrmShell>
  )
}

function getStockDocumentOrNull(documentId: number) {
  try {
    return getStockDocument(documentId)
  } catch {
    return null
  }
}
