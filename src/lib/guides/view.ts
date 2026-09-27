import { coverShot, GUIDES, resolveShot, scenarioSearchText } from "@/lib/guides"
import { scenarioHref } from "@/lib/guides/links"
import type { Guide, GuideFlowNode, GuideIconKey, GuideId, ShotMeta } from "@/lib/guides/types"

// Данные главной руководства для клиентского экрана: только то, что рисуется, без текстов шагов.
export type ShotView = { meta: ShotMeta; src: string; area?: string | string[] }

export type ScenarioCardView = {
  guide: GuideId
  slug: string
  href: string
  title: string
  summary: string
  icon: GuideIconKey
  minutes: number
  steps: number
  cover: ShotView | null
  // Нормализованный текст сценария для поиска (нижний регистр, ё → е).
  search: string
}

export type FlowNodeView = GuideFlowNode & {
  icon: GuideIconKey
  // null — шаг другой роли, чьё руководство зрителю недоступно: показываем без ссылки.
  href: string | null
  // Кто делает шаг, если не эта роль: «Делает менеджер».
  owner?: string
}

export type GuideView = {
  id: GuideId
  title: string
  heading: string
  intro: string
  icon: GuideIconKey
  home: Guide["home"]
  flowTitle: string
  flow: FlowNodeView[]
  branches: FlowNodeView[]
  groups: Array<{ id: string; title: string; description?: string; scenarios: ScenarioCardView[] }>
  faq: Guide["faq"]
  count: number
  minutes: number
  firstHref: string | null
}

const OWNER_LABEL: Record<GuideId, string> = {
  florist: "Делает флорист",
  manager: "Делает менеджер",
  admin: "Делает администратор",
}

export function buildGuideView(id: GuideId, viewable: GuideId[]): GuideView {
  const guide = GUIDES[id]
  const cards = new Map(guide.scenarios.map((scenario) => [scenario.slug, toCard(id, scenario.slug)]))

  const toNode = (node: GuideFlowNode): FlowNodeView => {
    const nodeGuide = node.guide ?? id
    const target = GUIDES[nodeGuide].scenarios.find((scenario) => scenario.slug === node.slug)
    const visible = viewable.includes(nodeGuide)
    return {
      ...node,
      icon: target?.icon ?? "help",
      href: target && visible ? scenarioHref(nodeGuide, node.slug) : null,
      owner: node.guide && node.guide !== id ? OWNER_LABEL[node.guide] : undefined,
    }
  }

  const groups = guide.groups.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    scenarios: group.slugs.map((slug) => cards.get(slug)).filter((card): card is ScenarioCardView => Boolean(card)),
  }))
  const first = groups[0]?.scenarios[0]

  return {
    id,
    title: guide.title,
    heading: guide.heading,
    intro: guide.intro,
    icon: guide.icon,
    home: guide.home,
    flowTitle: guide.flowTitle,
    flow: guide.flow.map(toNode),
    branches: (guide.branches ?? []).map(toNode),
    groups,
    faq: guide.faq,
    count: guide.scenarios.length,
    minutes: guide.scenarios.reduce((sum, scenario) => sum + scenario.minutes, 0),
    firstHref: first ? first.href : null,
  }
}

function toCard(id: GuideId, slug: string): ScenarioCardView | null {
  const scenario = GUIDES[id].scenarios.find((item) => item.slug === slug)
  if (!scenario) {
    return null
  }
  const shot = coverShot(scenario)
  const resolved = shot ? resolveShot(shot.id) : null
  return {
    guide: id,
    slug,
    href: scenarioHref(id, slug),
    title: scenario.title,
    summary: scenario.summary,
    icon: scenario.icon,
    minutes: scenario.minutes,
    steps: scenario.steps.length,
    cover: resolved ? { meta: resolved.meta, src: resolved.thumb, area: shot?.crop ?? shot?.focus } : null,
    search: scenarioSearchText(scenario),
  }
}

// Поиск по всем доступным руководствам — плоский список карточек.
export function buildSearchIndex(viewable: GuideId[]): ScenarioCardView[] {
  return viewable.flatMap((id) =>
    GUIDES[id].scenarios.map((scenario) => toCard(id, scenario.slug)).filter((card): card is ScenarioCardView => Boolean(card))
  )
}
