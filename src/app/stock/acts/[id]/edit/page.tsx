import Link from "next/link"
import { notFound, redirect } from "next/navigation"
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
  // Черновик инвентаризации редактируется только в своём разделе: общий редактор актов
  // открыл бы его как «Пополнение», а сохранение всё равно отбито серверным гейтом.
  if (document.type === "count") {
    redirect(`/stock/inventory/${document.id}`)
  }

  const data = getDashboardData()
  const suppliers = data.suppliers.filter(
    (supplier) => supplier.isActive || supplier.id === document.supplierId
  )
  // Для черновика корректировки предпросмотр «остаток → станет» считаем от остатка с учётом отката
  // исходного акта — именно так проведение и пересчитает склад. Без поправки редактирование списания
  // почти всегда ложно пугало бы «уйдёт в минус» (текущий остаток уже уменьшен исходным актом).
  const products = applyCorrectionRevert(data.products, document.correctsDocumentId)

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
        <StockDocumentForm document={document} products={products} suppliers={suppliers} />
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

// Остатки товаров «как будто исходный акт откатан» — базовая линия для формы корректировки.
// Приход заносил годное (qty − брак) → снимаем его; списание уводило qty → возвращаем.
function applyCorrectionRevert(
  products: ReturnType<typeof getDashboardData>["products"],
  correctsDocumentId: number | null
) {
  if (correctsDocumentId == null) {
    return products
  }
  const original = getStockDocumentOrNull(correctsDocumentId)
  if (!original || original.status !== "posted") {
    return products
  }
  const deltas = new Map<string, number>()
  for (const item of original.items) {
    const delta = original.type === "stock_in" ? -(item.qty - item.defectQty) : item.qty
    deltas.set(item.productCode, (deltas.get(item.productCode) ?? 0) + delta)
  }

  return products.map((product) => {
    const delta = deltas.get(product.code)
    if (!delta) {
      return product
    }
    return { ...product, stock: product.stock + delta, available: product.available + delta }
  })
}
