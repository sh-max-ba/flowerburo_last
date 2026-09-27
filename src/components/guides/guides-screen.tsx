"use client"

import { useDeferredValue, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRightIcon, ChevronDownIcon, ChevronRightIcon, SearchXIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { ScreenBody } from "@/components/screen-body"
import { ScreenHeader } from "@/components/screen-header"
import { GUIDE_ICONS } from "@/components/guides/guide-icons"
import { MINUTE_FORMS, plural, SCENARIO_FORMS, STEP_FORMS } from "@/components/guides/guide-text"
import { ShotCover } from "@/components/guides/shot-cover"
import { guideHref } from "@/lib/guides/links"
import type { GuideIconKey, GuideId } from "@/lib/guides/types"
import type { FlowNodeView, GuideView, ScenarioCardView } from "@/lib/guides/view"
import { cn } from "@/lib/utils"

type GuidesScreenProps = {
  guide: GuideView
  tabs: Array<{ id: GuideId; title: string; icon: GuideIconKey }>
  index: ScenarioCardView[]
}

const SUGGESTIONS = ["смена", "заказ", "возврат", "доставка", "фото"]

// Главная раздела «Руководства»: вкладки ролей, путь за смену схемой, карточки инструкций и
// частые вопросы. Поиск ищет по всем доступным руководствам сразу.
export function GuidesScreen({ guide, tabs, index }: GuidesScreenProps) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const results = useMemo(() => search(index, deferredQuery), [index, deferredQuery])
  const searching = deferredQuery.trim().length > 0
  const tabTitles = Object.fromEntries(tabs.map((tab) => [tab.id, tab.title])) as Record<GuideId, string>

  return (
    <>
      <ScreenHeader
        title="Руководства"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Найти инструкцию: смена, возврат, доставка…",
        }}
        meta={searching ? `${results.length} ${plural(results.length, SCENARIO_FORMS)}` : undefined}
        tabs={
          tabs.length > 1 ? (
            <SegmentedTabs
              aria-label="Руководство для роли"
              value={guide.id}
              fill
              items={tabs.map((tab) => ({
                value: tab.id,
                label: tab.title,
                icon: GUIDE_ICONS[tab.icon],
                href: guideHref(tab.id),
              }))}
            />
          ) : null
        }
      />
      <ScreenBody surface={false}>
        <div className="@container/guide flex flex-col gap-3 pb-6">
          {searching ? (
            <SearchResults query={deferredQuery} results={results} tabTitles={tabs.length > 1 ? tabTitles : null} onPick={setQuery} />
          ) : (
            <GuideOverview guide={guide} />
          )}
        </div>
      </ScreenBody>
    </>
  )
}

function GuideOverview({ guide }: { guide: GuideView }) {
  const Icon = GUIDE_ICONS[guide.icon]

  return (
    <>
      <section className="rounded-2xl bg-background p-5 shadow-xs sm:p-6" aria-labelledby="guide-heading">
        <div className="flex flex-col gap-5 @4xl/guide:flex-row @4xl/guide:items-end @4xl/guide:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-subtle text-brand-strong">
                <Icon className="size-5" aria-hidden />
              </span>
              <span>
                {guide.count} {plural(guide.count, SCENARIO_FORMS)} · ≈ {guide.minutes} {plural(guide.minutes, MINUTE_FORMS)} на всё
              </span>
            </div>
            <h2 id="guide-heading" className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
              {guide.heading}
            </h2>
            <p className="mt-2 text-base leading-relaxed text-pretty text-muted-foreground">{guide.intro}</p>
          </div>
          <div className="flex flex-wrap gap-2 @4xl/guide:shrink-0 @4xl/guide:justify-end">
            {guide.firstHref ? (
              <Link href={guide.firstHref} className={buttonVariants({ size: "lg" })}>
                Начать с первого шага
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            ) : null}
            <Link href={guide.home.href} className={buttonVariants({ variant: "outline", size: "lg" })}>
              Открыть «{guide.home.label}»
            </Link>
          </div>
        </div>
      </section>

      <FlowCard guide={guide} />

      {guide.groups.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`} className="flex flex-col gap-3 pt-3">
          <div className="px-1">
            <h2 id={`group-${group.id}`} className="font-heading text-lg font-semibold">
              {group.title}
            </h2>
            {group.description ? <p className="text-sm text-muted-foreground">{group.description}</p> : null}
          </div>
          <ul className="grid gap-3 @2xl/guide:grid-cols-2 @5xl/guide:grid-cols-3">
            {group.scenarios.map((scenario) => (
              <li key={scenario.slug} className="flex">
                <ScenarioCard scenario={scenario} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {guide.faq.length ? (
        <section aria-labelledby="guide-faq" className="mt-3 rounded-2xl bg-background p-5 shadow-xs sm:p-6">
          <h2 id="guide-faq" className="font-heading text-lg font-semibold">
            Частые вопросы
          </h2>
          <div className="mt-2 divide-y divide-border/50">
            {guide.faq.map((item) => (
              <details key={item.q} className="group py-1">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-base font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/35 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="pb-3 text-base leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}

// Путь за смену: пронумерованные шаги со стрелками. Узкий экран — вертикальная линия,
// широкий — ряд карточек. Шаги другой роли (передача заказа) — пунктиром с подписью, кто делает.
function FlowCard({ guide }: { guide: GuideView }) {
  return (
    <section aria-labelledby="guide-flow" className="rounded-2xl bg-background p-5 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="guide-flow" className="font-heading text-lg font-semibold">
          {guide.flowTitle}
        </h2>
        <p className="text-sm text-muted-foreground">Нажмите на шаг — откроется инструкция с экранами</p>
      </div>
      <ol className="mt-4 grid gap-1 @4xl/guide:grid-cols-6 @4xl/guide:gap-6">
        {guide.flow.map((node, index) => (
          <FlowNode key={`${node.guide ?? guide.id}-${node.slug}`} node={node} number={index + 1} last={index === guide.flow.length - 1} />
        ))}
      </ol>
      {guide.branches.length ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
          <span className="mr-1 text-sm text-muted-foreground">По ситуации:</span>
          {guide.branches.map((node) => {
            const Icon = GUIDE_ICONS[node.icon]
            return node.href ? (
              <Link
                key={node.slug}
                href={node.href}
                className="flex min-h-10 items-center gap-2 rounded-full bg-muted/60 py-1.5 pr-3.5 pl-3 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/35"
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {node.label}
                <span className="font-normal text-muted-foreground">· {node.caption}</span>
              </Link>
            ) : null
          })}
        </div>
      ) : null}
    </section>
  )
}

function FlowNode({ node, number, last }: { node: FlowNodeView; number: number; last: boolean }) {
  const Icon = GUIDE_ICONS[node.icon]
  const handoff = Boolean(node.owner)
  const body = (
    <>
      <span
        className={cn(
          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          handoff ? "bg-background text-muted-foreground ring-1 ring-border ring-dashed" : "bg-foreground text-background"
        )}
      >
        {number}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 font-medium leading-snug">
          <Icon className="size-4 shrink-0 text-muted-foreground @4xl/guide:hidden" aria-hidden />
          {node.label}
        </span>
        <span className="text-sm text-muted-foreground">{node.caption}</span>
        {node.owner ? <span className="text-xs font-medium text-brand-strong">{node.owner}</span> : null}
      </span>
      <Icon className="absolute top-3.5 right-3.5 hidden size-4 text-muted-foreground/70 @4xl/guide:block" aria-hidden />
    </>
  )
  const boxClass = cn(
    "relative flex items-start gap-3 rounded-xl p-2.5 outline-none @4xl/guide:h-full @4xl/guide:flex-col @4xl/guide:gap-2.5 @4xl/guide:p-3.5",
    handoff ? "@4xl/guide:outline-1 @4xl/guide:outline-dashed @4xl/guide:outline-border @4xl/guide:-outline-offset-1" : "@4xl/guide:bg-muted/45"
  )

  return (
    <li className="relative">
      {node.href ? (
        <Link
          href={node.href}
          className={cn(boxClass, "transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/35")}
        >
          {body}
        </Link>
      ) : (
        <div className={boxClass}>{body}</div>
      )}
      {!last ? (
        <>
          <span aria-hidden className="absolute top-11 bottom-[-6px] left-[25px] w-px bg-border @4xl/guide:hidden" />
          <ChevronRightIcon
            aria-hidden
            className="absolute top-1/2 -right-5 hidden size-4 -translate-y-1/2 text-muted-foreground/60 @4xl/guide:block"
          />
        </>
      ) : null}
    </li>
  )
}

function ScenarioCard({ scenario, guideTitle }: { scenario: ScenarioCardView; guideTitle?: string }) {
  const Icon = GUIDE_ICONS[scenario.icon]
  return (
    <Link
      href={scenario.href}
      className="group flex w-full flex-col overflow-hidden rounded-2xl bg-background shadow-xs outline-none transition-all duration-200 hover:-translate-y-px hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/35 motion-reduce:transform-none"
    >
      {scenario.cover ? (
        <ShotCover meta={scenario.cover.meta} src={scenario.cover.src} area={scenario.cover.area} />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-muted/60 text-muted-foreground/60">
          <Icon className="size-10" aria-hidden />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
          <span>
            {scenario.steps} {plural(scenario.steps, STEP_FORMS)} · {scenario.minutes} мин
          </span>
          {guideTitle ? <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80">{guideTitle}</span> : null}
        </div>
        <h3 className="font-heading text-base leading-snug font-semibold text-balance">{scenario.title}</h3>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{scenario.summary}</p>
        <span className="mt-auto flex items-center gap-1 pt-2 text-sm font-medium text-brand-strong">
          Открыть инструкцию
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  )
}

function SearchResults({
  query,
  results,
  tabTitles,
  onPick,
}: {
  query: string
  results: ScenarioCardView[]
  tabTitles: Record<GuideId, string> | null
  onPick: (value: string) => void
}) {
  if (!results.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-background px-6 py-12 text-center shadow-xs">
        <SearchXIcon className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-medium">Ничего не нашли по «{query.trim()}»</p>
          <p className="mt-1 text-sm text-muted-foreground">Попробуйте другое слово:</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => onPick(word)}
              className="min-h-10 rounded-full bg-muted/60 px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/35"
            >
              {word}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section aria-label="Результаты поиска" className="flex flex-col gap-3">
      <p className="px-1 text-sm text-muted-foreground" role="status">
        Найдено {results.length} {plural(results.length, SCENARIO_FORMS)} по «{query.trim()}»
      </p>
      <ul className="grid gap-3 @2xl/guide:grid-cols-2 @5xl/guide:grid-cols-3">
        {results.map((scenario) => (
          <li key={`${scenario.guide}-${scenario.slug}`} className="flex">
            <ScenarioCard scenario={scenario} guideTitle={tabTitles ? tabTitles[scenario.guide] : undefined} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// Все слова запроса должны встретиться в тексте сценария; выше — совпадения в заголовке.
// Окончания отрезаем грубо («смену» → «смен»), чтобы находилось в любом падеже.
function search(index: ScenarioCardView[], rawQuery: string) {
  const words = rawQuery
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[\s,.;:!?«»"]+/)
    .filter(Boolean)
    .map((word) => (word.length >= 7 ? word.slice(0, -2) : word.length >= 5 ? word.slice(0, -1) : word))
  if (!words.length) {
    return []
  }
  return index
    .filter((scenario) => words.every((word) => scenario.search.includes(word)))
    .map((scenario) => {
      const title = scenario.title.toLowerCase().replace(/ё/g, "е")
      const score = words.reduce((sum, word) => sum + (title.includes(word) ? 2 : 0), 0)
      return { scenario, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.scenario)
}
