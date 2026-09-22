import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { UsersPage } from "@/components/users/users-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { listUsers } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const users = listUsers()

  return (
    <CrmShell
      user={user}
      active="settings"
      title="Пользователи"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <UsersPage users={users} currentUserId={user.id} />
    </CrmShell>
  )
}
