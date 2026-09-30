import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { ScenarioView } from "@/components/guides/scenario-view"
import { getSidebarDefaultOpen } from "@/lib/app-shell"
import { canUseCash, getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getGuide, getScenario, groupOfScenario, resolveShot, scenarioNeighbors, type ResolvedShot } from "@/lib/guides"
import { canViewGuide, isGuideId } from "@/lib/guides/access"

export const dynamic = "force-dynamic"

type Params = Promise<{ role: string; slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { role, slug } = await params
  const scenario = isGuideId(role) ? getScenario(role, slug) : null
  return { title: scenario ? `${scenario.title} · Руководства · FlowerBuro` : "Руководства · FlowerBuro" }
}

// Одна инструкция: шаги с настоящими экранами, результат и частые проблемы.
export default async function GuideScenarioPage({ params }: { params: Params }) {
  const user = await requireUser()
  const { role, slug } = await params
  if (!isGuideId(role)) {
    notFound()
  }
  if (!canViewGuide(user.role, role)) {
    return <AccessDenied role={user.role} homeHref={getDefaultPathForRole(user.role)} />
  }

  const guide = getGuide(role)
  const scenario = getScenario(role, slug)
  if (!scenario) {
    notFound()
  }

  const shots: Record<string, ResolvedShot> = {}
  for (const step of scenario.steps) {
    const resolved = step.shot ? resolveShot(step.shot.id) : null
    if (step.shot && resolved) {
      shots[step.shot.id] = resolved
    }
  }

  return (
    <CrmShell
      user={user}
      active="guides"
      title={scenario.title}
      canAccessCash={await canUseCash(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <ScenarioView
        guide={guide}
        scenario={scenario}
        groupTitle={groupOfScenario(guide, slug)?.title ?? null}
        shots={shots}
        neighbors={scenarioNeighbors(guide, slug)}
      />
    </CrmShell>
  )
}
