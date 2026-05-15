import Link from "next/link"
import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { StockDocumentForm } from "@/components/stock/stock-document-form"
import { buttonVariants } from "@/components/ui/button"
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
    <main className="min-h-screen bg-zinc-50 p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Редактировать акт {document.number}</h1>
            <p className="text-sm text-muted-foreground">Черновик можно сохранить или провести.</p>
          </div>
          <Link href={`/stock/acts/${document.id}`} className={buttonVariants({ variant: "outline" })}>
            К акту
          </Link>
        </div>
        <StockDocumentForm document={document} products={data.products} suppliers={suppliers} />
      </div>
    </main>
  )
}

function getStockDocumentOrNull(documentId: number) {
  try {
    return getStockDocument(documentId)
  } catch {
    return null
  }
}
