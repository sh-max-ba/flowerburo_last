import { adminGuide } from "@/lib/guides/content/admin"
import { floristGuide } from "@/lib/guides/content/florist"
import { managerGuide } from "@/lib/guides/content/manager"
import { SHOTS } from "@/lib/guides/shots"
import type { Guide, GuideId, GuideScenario, ShotMeta } from "@/lib/guides/types"

export { guideHref, scenarioHref } from "@/lib/guides/links"

export const GUIDES: Record<GuideId, Guide> = {
  florist: floristGuide,
  manager: managerGuide,
  admin: adminGuide,
}

export function getGuide(id: GuideId): Guide {
  return GUIDES[id]
}

export function getScenario(id: GuideId, slug: string): GuideScenario | null {
  return GUIDES[id].scenarios.find((scenario) => scenario.slug === slug) ?? null
}

// Порядок чтения — как в группах на главной руководства: «Далее» ведёт к следующему сценарию.
export function orderedScenarios(guide: Guide): GuideScenario[] {
  const bySlug = new Map(guide.scenarios.map((scenario) => [scenario.slug, scenario]))
  const ordered = guide.groups.flatMap((group) => group.slugs.map((slug) => bySlug.get(slug))).filter(Boolean)
  const rest = guide.scenarios.filter((scenario) => !ordered.includes(scenario))
  return [...(ordered as GuideScenario[]), ...rest]
}

export function scenarioNeighbors(guide: Guide, slug: string) {
  const list = orderedScenarios(guide)
  const index = list.findIndex((scenario) => scenario.slug === slug)
  return {
    prev: index > 0 ? list[index - 1] : null,
    next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
    position: index + 1,
    total: list.length,
  }
}

export function groupOfScenario(guide: Guide, slug: string) {
  return guide.groups.find((group) => group.slugs.includes(slug)) ?? null
}

export type ResolvedShot = { meta: ShotMeta; src: string; thumb: string }

// Кадр по id: размер, области и адреса (полный в 2x и облегчённый для обложек). Версия в адресе
// меняется при пересъёмке — кэш браузера не мешает.
export function resolveShot(id: string): ResolvedShot | null {
  const shot = SHOTS[id]
  if (!shot) {
    return null
  }
  return {
    meta: { width: shot.width, height: shot.height, targets: shot.targets },
    src: `/api/guides/shots/${id}.webp?v=${shot.v}`,
    thumb: `/api/guides/shots/${id}-sm.webp?v=${shot.v}`,
  }
}

// Первый кадр сценария — обложка карточки.
export function coverShot(scenario: GuideScenario) {
  const step = scenario.steps.find((item) => item.shot && SHOTS[item.shot.id])
  return step?.shot ?? null
}

export function stepCount(scenario: GuideScenario) {
  return scenario.steps.length
}

// Плоский текст сценария для поиска: заголовок, описание, шаги, вопросы и ключевые слова.
export function scenarioSearchText(scenario: GuideScenario) {
  return [
    scenario.title,
    scenario.summary,
    ...(scenario.keywords ?? []),
    ...scenario.steps.flatMap((step) => [step.title, step.body, step.tip ?? "", step.warn ?? ""]),
    ...(scenario.problems ?? []).flatMap((problem) => [problem.q, problem.a]),
  ]
    .join(" ")
    .replace(/\*\*/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
}
