import Link from "next/link"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { CashLedger } from "@/components/history/cash-ledger"
import { buttonVariants } from "@/components/ui/button"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getCashLedger } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function CashHistoryPage() {
  const user = await requireUser()
  if (user.role !== "owner" && user.role !== "manager") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const entries = getCashLedger()

  return (
    <CrmShell
      user={user}
      active="history-cash"
      title="История кассы"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      {user.role === "owner" ? (
        <div className="flex justify-end">
          <Link href="/history/stock" className={buttonVariants({ variant: "outline", size: "sm" })}>
            История склада
          </Link>
        </div>
      ) : null}

      <CashLedger entries={entries} />
    </CrmShell>
  )
}
