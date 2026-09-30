import { CrmShell } from "@/components/crm-shell"
import { GuidesScreen } from "@/components/guides/guides-screen"
import { getSidebarDefaultOpen } from "@/lib/app-shell"
import { canUseCash, requireUser } from "@/lib/auth"
import { GUIDES } from "@/lib/guides"
import { defaultGuideForRole, guidesForRole, isGuideId } from "@/lib/guides/access"
import { buildGuideView, buildSearchIndex } from "@/lib/guides/view"

export const dynamic = "force-dynamic"

// «Руководства»: пошаговые инструкции с настоящими экранами. Роль — в URL (?role=florist|manager|admin);
// по умолчанию открывается руководство своей роли.
export default async function GuidesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser()
  const viewable = guidesForRole(user.role)
  const params = await searchParams
  const requested = typeof params.role === "string" ? params.role : undefined
  const active = isGuideId(requested) && viewable.includes(requested) ? requested : defaultGuideForRole(user.role)

  return (
    <CrmShell
      user={user}
      active="guides"
      title="Руководства"
      canAccessCash={await canUseCash(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <GuidesScreen
        key={active}
        guide={buildGuideView(active, viewable)}
        tabs={viewable.map((id) => ({ id, title: GUIDES[id].title, icon: GUIDES[id].icon }))}
        index={buildSearchIndex(viewable)}
      />
    </CrmShell>
  )
}
