import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { SettingsPage } from "@/components/settings/settings-page"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { listSuppliers } from "@/lib/db"
import { getWazzupSettingsStatus } from "@/lib/wazzup"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  // SEC-5: полный статус Wazzup (webhook URL, маскированные ключи, диагностика)
  // считается ЛЕНИВО только здесь, после owner-guard, и не уходит другим ролям.
  const suppliers = listSuppliers()
  const wazzupStatus = getWazzupSettingsStatus()

  return (
    <CrmShell
      user={user}
      active="settings"
      title="Настройки"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <SettingsPage suppliers={suppliers} wazzupStatus={wazzupStatus} />
    </CrmShell>
  )
}
