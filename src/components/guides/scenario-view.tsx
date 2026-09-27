import type { ReactNode } from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  CircleCheckBigIcon,
  ClipboardListIcon,
  LightbulbIcon,
  ListChecksIcon,
  TimerIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { GUIDE_ICONS } from "@/components/guides/guide-icons"
import { GuideShot } from "@/components/guides/guide-shot"
import { GuideText, MINUTE_FORMS, plural, STEP_FORMS } from "@/components/guides/guide-text"
import type { ResolvedShot } from "@/lib/guides"
import { guideHref, scenarioHref } from "@/lib/guides/links"
import type { Guide, GuideScenario } from "@/lib/guides/types"
import { cn } from "@/lib/utils"

type ScenarioViewProps = {
  guide: Guide
  scenario: GuideScenario
  groupTitle: string | null
  shots: Record<string, ResolvedShot>
  neighbors: { prev: GuideScenario | null; next: GuideScenario | null; position: number; total: number }
}

// Страница инструкции: что и когда, шаги с экранами (подсвечено, куда нажимать), как понять,
// что получилось, и что делать, если нет.
export function ScenarioView({ guide, scenario, groupTitle, shots, neighbors }: ScenarioViewProps) {
  const RoleIcon = GUIDE_ICONS[guide.icon]

  return (
    <>
      <nav aria-label="Навигация по руководству" className="flex h-11 shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" render={<Link href={guideHref(guide.id)} />}>
          <ArrowLeftIcon data-icon="inline-start" />
          {guide.heading}
        </Button>
        <span className="text-muted-foreground/60" aria-hidden>
          /
        </span>
        <span className="truncate px-1 text-sm font-medium" aria-current="page">
          {scenario.title}
        </span>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <article className="@container/guide mx-auto flex w-full max-w-5xl flex-col gap-3 pb-8">
          <header className="rounded-2xl bg-background p-5 shadow-xs sm:p-7">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5 rounded-full bg-brand-subtle py-1 pr-3 pl-2 font-medium text-brand-strong">
                <RoleIcon className="size-4" aria-hidden />
                {guide.title}
              </span>
              {groupTitle ? <span>{groupTitle}</span> : null}
            </div>
            <h1 className="mt-3 font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{scenario.title}</h1>
            <p className="mt-2 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">{scenario.summary}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Meta icon={ListChecksIcon}>
                {scenario.steps.length} {plural(scenario.steps.length, STEP_FORMS)}
              </Meta>
              <Meta icon={TimerIcon}>
                ≈ {scenario.minutes} {plural(scenario.minutes, MINUTE_FORMS)}
              </Meta>
              <Meta icon={ClipboardListIcon}>
                {neighbors.position} из {neighbors.total} в руководстве
              </Meta>
              {scenario.where ? (
                <Link href={scenario.where.href} className={cn(buttonVariants({ variant: "outline" }), "ml-auto max-sm:w-full")}>
                  Открыть «{scenario.where.label}»
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Link>
              ) : null}
            </div>

            {scenario.before?.length ? (
              <div className="mt-5 rounded-xl bg-muted/50 p-4">
                <h2 className="text-sm font-semibold">Перед началом</h2>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {scenario.before.map((item) => (
                    <li key={item} className="flex gap-2 text-base leading-relaxed">
                      <CircleCheckBigIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </header>

          <ol className="flex flex-col gap-3" aria-label="Шаги">
            {scenario.steps.map((step, index) => {
              const shot = step.shot ? shots[step.shot.id] : undefined
              return (
                <li key={index} id={`step-${index + 1}`} className="scroll-mt-4 rounded-2xl bg-background p-4 shadow-xs sm:p-6">
                  <div className="flex gap-3 sm:gap-4">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-strong text-base font-semibold text-white"
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                      <h2 className="pt-1 font-heading text-lg leading-snug font-semibold text-balance">
                        <span className="sr-only">Шаг {index + 1}. </span>
                        {step.title}
                      </h2>
                      <p className="max-w-3xl text-base leading-[1.7] text-pretty text-foreground/85">
                        <GuideText text={step.body} />
                      </p>
                      {step.legend?.length ? (
                        <ol className="grid gap-2 @2xl/guide:grid-cols-2">
                          {step.legend.map((item, legendIndex) => (
                            <li key={item.title} className="flex gap-2.5 rounded-xl bg-muted/45 p-3">
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-strong text-xs font-semibold text-white">
                                {legendIndex + 1}
                              </span>
                              <span className="min-w-0 text-sm leading-relaxed">
                                <span className="font-semibold">{item.title}</span>
                                {item.text ? <span className="text-muted-foreground"> — {item.text}</span> : null}
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {step.tip ? (
                        <Callout tone="tip">
                          <GuideText text={step.tip} />
                        </Callout>
                      ) : null}
                      {step.warn ? (
                        <Callout tone="warn">
                          <GuideText text={step.warn} />
                        </Callout>
                      ) : null}
                    </div>
                  </div>
                  {step.shot && shot ? (
                    <GuideShot
                      className="mt-4"
                      shot={step.shot}
                      meta={shot.meta}
                      src={shot.src}
                      step={step.shot.focus ? index + 1 : undefined}
                      eager={index === 0}
                    />
                  ) : null}
                </li>
              )
            })}
          </ol>

          {scenario.result ? (
            <section aria-labelledby="scenario-result" className="flex gap-3 rounded-2xl bg-emerald-50 p-5 text-emerald-950 shadow-xs sm:p-6">
              <CircleCheckBigIcon className="mt-0.5 size-6 shrink-0 text-emerald-600" aria-hidden />
              <div>
                <h2 id="scenario-result" className="font-heading text-base font-semibold">
                  Готово, если…
                </h2>
                <p className="mt-1 text-base leading-relaxed">{scenario.result}</p>
              </div>
            </section>
          ) : null}

          {scenario.problems?.length ? (
            <section aria-labelledby="scenario-problems" className="rounded-2xl bg-background p-5 shadow-xs sm:p-6">
              <h2 id="scenario-problems" className="flex items-center gap-2 font-heading text-lg font-semibold">
                <TriangleAlertIcon className="size-5 text-amber-600" aria-hidden />
                Если что-то не получается
              </h2>
              <div className="mt-2 divide-y divide-border/50">
                {scenario.problems.map((problem) => (
                  <details key={problem.q} className="group py-1">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-base font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/35 [&::-webkit-details-marker]:hidden">
                      {problem.q}
                      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="pb-3 text-base leading-relaxed text-muted-foreground">
                      <GuideText text={problem.a} />
                    </p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          <nav aria-label="Другие инструкции" className="grid gap-3 sm:grid-cols-2">
            {neighbors.prev ? (
              <NeighborLink guide={guide} scenario={neighbors.prev} direction="prev" />
            ) : (
              <span className="max-sm:hidden" />
            )}
            {neighbors.next ? (
              <NeighborLink guide={guide} scenario={neighbors.next} direction="next" />
            ) : (
              <Link
                href={guideHref(guide.id)}
                className="flex min-h-20 flex-col justify-center gap-1 rounded-2xl bg-background p-4 text-right shadow-xs outline-none transition-all hover:-translate-y-px hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/35 motion-reduce:transform-none"
              >
                <span className="text-sm text-muted-foreground">Это последняя инструкция</span>
                <span className="font-medium">Ко всем инструкциям</span>
              </Link>
            )}
          </nav>
        </article>
      </div>
    </>
  )
}

function Meta({ icon: Icon, children }: { icon: typeof TimerIcon; children: ReactNode }) {
  return (
    <span className="flex h-8 items-center gap-1.5 rounded-full bg-muted/60 px-3 text-sm text-foreground/80">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {children}
    </span>
  )
}

function Callout({ tone, children }: { tone: "tip" | "warn"; children: ReactNode }) {
  const Icon = tone === "tip" ? LightbulbIcon : TriangleAlertIcon
  return (
    <div
      className={cn(
        "flex max-w-3xl gap-2.5 rounded-xl px-3.5 py-3 text-base leading-relaxed",
        tone === "tip" ? "bg-brand-subtle text-foreground" : "bg-amber-50 text-amber-950"
      )}
    >
      <Icon className={cn("mt-1 size-4 shrink-0", tone === "tip" ? "text-brand-strong" : "text-amber-600")} aria-hidden />
      <p>
        <span className="sr-only">{tone === "tip" ? "Совет: " : "Внимание: "}</span>
        {children}
      </p>
    </div>
  )
}

function NeighborLink({ guide, scenario, direction }: { guide: Guide; scenario: GuideScenario; direction: "prev" | "next" }) {
  const Icon = GUIDE_ICONS[scenario.icon]
  return (
    <Link
      href={scenarioHref(guide.id, scenario.slug)}
      className={cn(
        "flex min-h-20 items-center gap-3 rounded-2xl bg-background p-4 shadow-xs outline-none transition-all hover:-translate-y-px hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/35 motion-reduce:transform-none",
        direction === "next" && "flex-row-reverse text-right"
      )}
    >
      {direction === "prev" ? (
        <ArrowLeftIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <ArrowRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">{direction === "prev" ? "Назад" : "Дальше"}</span>
        <span className="flex items-center gap-1.5 font-medium leading-snug">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {scenario.title}
        </span>
      </span>
    </Link>
  )
}
