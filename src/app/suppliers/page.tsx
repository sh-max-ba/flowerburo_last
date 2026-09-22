import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { SuppliersClient } from "@/components/suppliers/suppliers-client"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { listSuppliers } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function SuppliersPage() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const suppliers = listSuppliers()

  return (
    <CrmShell
      user={user}
      active="suppliers"
      title="Поставщики"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <SuppliersClient suppliers={suppliers} />
    </CrmShell>
  )
}
