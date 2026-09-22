import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { ProductCard } from "@/components/stock/product-card"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getProductCardData } from "@/lib/db"

export const dynamic = "force-dynamic"

// Карточка товара: движения, поставщики и продажи за период (период — как в аналитике).
export default async function ProductCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { code } = await params
  const query = await searchParams
  const data = getProductCardData(decodeURIComponent(code), {
    preset: typeof query.preset === "string" ? query.preset : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
  })
  if (!data) {
    notFound()
  }

  return (
    <CrmShell
      user={user}
      active="stock"
      title={data.product.name}
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <ProductCard data={data} />
    </CrmShell>
  )
}
