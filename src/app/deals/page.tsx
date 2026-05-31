import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { DealsAutoRefresh } from "@/components/deals/deals-auto-refresh"
import { DealsKanban } from "@/components/deals/deals-kanban"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDealBoardData, listCustomers } from "@/lib/crm"
import { listUsers } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function DealsPage() {
  const user = await requireUser()
  if (user.role === "florist") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  return (
    <CrmShell
      user={user}
      active="deals"
      title="Сделки"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      fullBleed
    >
      <DealsAutoRefresh />
      <DealsKanban
        board={getDealBoardData()}
        customers={listCustomers()}
        users={listUsers().filter((item) => item.isActive)}
        currentUser={user}
      />
    </CrmShell>
  )
}
