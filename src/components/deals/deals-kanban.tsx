"use client"

import type React from "react"
import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  ClockIcon,
  MoveRightIcon,
  PlusIcon,
} from "lucide-react"
import { toast } from "sonner"
import { createDealAction, updateDealStageAction } from "@/app/actions"
import type { Customer, Deal, DealBoardData, DealSource, DealStage } from "@/lib/crm"
import type { CurrentUser } from "@/lib/db"
import { sourceLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type ActionResult = Awaited<ReturnType<typeof createDealAction>>
type StageActionResult = Awaited<ReturnType<typeof updateDealStageAction>>

const activeOrderStatuses = new Set(["Новый", "В работе", "Готов", "Передан курьеру", "new", "in_progress", "ready"])
const stageDroppableId = (stageId: number) => `stage:${stageId}`
const dealDraggableId = (dealId: number) => `deal:${dealId}`
type OptimisticStage = Pick<Deal, "stageId" | "stageName" | "stagePosition">

const allFilterValue = "all"
const sourceOptions: Array<{ value: DealSource; label: string }> = [
  { value: "manual", label: "Ручная" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
  { value: "site", label: "Сайт" },
  { value: "phone", label: "Телефон" },
]

export function DealsKanban({
  board,
  customers,
  users,
  currentUser,
}: {
  board: DealBoardData
  customers: Customer[]
  users: CurrentUser[]
  currentUser: CurrentUser
}) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [optimisticStages, setOptimisticStages] = useState<Record<number, OptimisticStage>>({})
  const [activeDealId, setActiveDealId] = useState<number | null>(null)
  const [overStageId, setOverStageId] = useState<number | null>(null)
  const [responsibleFilter, setResponsibleFilter] = useState(allFilterValue)
  const [sourceFilter, setSourceFilter] = useState(allFilterValue)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const stages = board.stages

  const visibleDeals = useMemo(
    () =>
      board.deals.map((deal) => {
        const optimisticStage = optimisticStages[deal.id]
        if (!optimisticStage || optimisticStage.stageId === deal.stageId) {
          return deal
        }

        return { ...deal, ...optimisticStage }
      }),
    [board.deals, optimisticStages]
  )
  const activeDeal = activeDealId ? visibleDeals.find((deal) => deal.id === activeDealId) : null
  const filteredDeals = useMemo(
    () =>
      visibleDeals.filter((deal) => {
        if (responsibleFilter !== allFilterValue && String(deal.responsibleUserId ?? "") !== responsibleFilter) {
          return false
        }
        if (sourceFilter !== allFilterValue && deal.source !== sourceFilter) {
          return false
        }
        return true
      }),
    [visibleDeals, responsibleFilter, sourceFilter]
  )

  useEffect(() => {
    if (activeDealId !== null) {
      document.body.dataset.dndActive = "true"
    } else {
      delete document.body.dataset.dndActive
    }

    return () => {
      delete document.body.dataset.dndActive
    }
  }, [activeDealId])

  // Once a refreshed board reflects an optimistic move (or the deal is gone), drop the stale overlay.
  useEffect(() => {
    setOptimisticStages((current) => {
      const dealStageById = new Map(board.deals.map((deal) => [deal.id, deal.stageId]))
      let changed = false
      const next: Record<number, OptimisticStage> = {}
      for (const [id, optimistic] of Object.entries(current)) {
        const dealId = Number(id)
        const serverStageId = dealStageById.get(dealId)
        if (serverStageId === undefined || serverStageId === optimistic.stageId) {
          changed = true
          continue
        }
        next[dealId] = optimistic
      }
      return changed ? next : current
    })
  }, [board.deals])

  const dealsByStage = useMemo(() => {
    const map = new Map<number, Deal[]>()
    for (const stage of stages) {
      map.set(stage.id, [])
    }
    for (const deal of filteredDeals) {
      if (deal.stageId) {
        map.set(deal.stageId, [...(map.get(deal.stageId) ?? []), deal])
      }
    }
    // Anchor the most time-critical deals to the top of each column.
    for (const [stageId, stageDeals] of map) {
      map.set(stageId, [...stageDeals].sort(byDueUrgency))
    }
    return map
  }, [filteredDeals, stages])

  const hasStages = stages.length > 0
  const hasFilters = responsibleFilter !== allFilterValue || sourceFilter !== allFilterValue
  const boardIsEmpty = visibleDeals.length === 0
  const filteredBoardIsEmpty = !boardIsEmpty && filteredDeals.length === 0

  function resetFilters() {
    setResponsibleFilter(allFilterValue)
    setSourceFilter(allFilterValue)
  }

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(result.message)
        after?.()
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function submitDeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    run(() => createDealAction(formData), () => setDialogOpen(false))
  }

  function moveDealToStage(deal: Deal, stageId: number) {
    if (deal.stageId === stageId) {
      return
    }

    const targetStage = stages.find((stage) => stage.id === stageId)

    // Optimistic move so the card lands instantly, then persist via the server action.
    setOptimisticStages((current) => ({
      ...current,
      [deal.id]: {
        stageId,
        stageName: targetStage?.name ?? deal.stageName,
        stagePosition: targetStage?.position ?? deal.stagePosition,
      },
    }))

    startTransition(async () => {
      let result: StageActionResult
      try {
        result = await updateDealStageAction(deal.id, stageId)
      } catch {
        result = { ok: false, message: "Не удалось переместить сделку. Попробуйте еще раз." }
      }

      if (result.ok) {
        toast.success(targetStage ? `Перемещено в «${targetStage.name}»` : result.message)
        // Keep the optimistic stage until the refreshed board reflects the new stage,
        // so the card doesn't flicker back to its old column during the round-trip.
        router.refresh()
      } else {
        // Roll back the optimistic move on failure.
        setOptimisticStages((current) => {
          const next = { ...current }
          delete next[deal.id]
          return next
        })
        toast.error(result.message)
      }
    })
  }

  function handleDragStart(event: DragStartEvent) {
    const dealId = getDealIdFromDndId(event.active.id)
    if (!dealId) {
      return
    }
    setActiveDealId(dealId)
  }

  function handleDragOver(event: DragOverEvent) {
    setOverStageId(getStageIdFromOver(event.over))
  }

  function clearDragState() {
    setActiveDealId(null)
    setOverStageId(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const dealId = getDealIdFromDndId(event.active.id)
    const targetStageId = getStageIdFromOver(event.over)
    const deal = dealId ? visibleDeals.find((item) => item.id === dealId) : null

    clearDragState()

    if (!deal || !targetStageId || deal.stageId === targetStageId) {
      return
    }

    moveDealToStage(deal, targetStageId)
  }

  return (
    <>
      <div className="-mx-4 -mt-4 -mb-4 flex min-h-[calc(100svh-3.5rem)] min-w-0 flex-col gap-0 md:-mx-5 md:-mt-5 md:-mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 md:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select value={responsibleFilter} onValueChange={(value) => setResponsibleFilter(value ?? allFilterValue)}>
              <SelectTrigger className="h-9 w-[210px] bg-white text-sm">
                <SelectValue>{(value) => responsibleFilterLabel(String(value ?? allFilterValue), users)}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value={allFilterValue}>Все ответственные</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={String(user.id)}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value ?? allFilterValue)}>
              <SelectTrigger className="h-9 w-[170px] bg-white text-sm">
                <SelectValue>{(value) => sourceFilterLabel(String(value ?? allFilterValue))}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value={allFilterValue}>Все источники</SelectItem>
                {sourceOptions.map((source) => (
                  <SelectItem key={source.value} value={source.value}>
                    {source.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="h-9 bg-zinc-950 text-white hover:bg-zinc-800" onClick={() => setDialogOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Новая сделка
          </Button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragCancel={clearDragState}
          onDragEnd={handleDragEnd}
        >
          <div
            data-kanban-board
            className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden border-y border-zinc-200 bg-white"
          >
            {!hasStages ? (
              <div className="flex h-full items-center justify-center p-6">
                <Empty className="max-w-md">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CalendarClockIcon />
                    </EmptyMedia>
                    <EmptyTitle>Воронка не настроена</EmptyTitle>
                    <EmptyDescription>
                      В выбранной воронке пока нет этапов. Настройте этапы, чтобы вести сделки на доске.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : boardIsEmpty ? (
              <div className="flex h-full items-center justify-center p-6">
                <Empty className="max-w-md">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PlusIcon />
                    </EmptyMedia>
                    <EmptyTitle>Сделок пока нет</EmptyTitle>
                    <EmptyDescription>
                      Создайте первую сделку — новые входящие из чатов тоже появятся здесь автоматически.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button onClick={() => setDialogOpen(true)}>
                      <PlusIcon data-icon="inline-start" />
                      Новая сделка
                    </Button>
                  </EmptyContent>
                </Empty>
              </div>
            ) : filteredBoardIsEmpty ? (
              <div className="flex h-full items-center justify-center p-6">
                <Empty className="max-w-md">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CalendarClockIcon />
                    </EmptyMedia>
                    <EmptyTitle>Ничего не найдено</EmptyTitle>
                    <EmptyDescription>
                      Под выбранные фильтры нет ни одной сделки. Сбросьте фильтры, чтобы увидеть все сделки.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" onClick={resetFilters}>
                      Сбросить фильтры
                    </Button>
                  </EmptyContent>
                </Empty>
              </div>
            ) : (
            <div className="flex h-full min-w-max">
              {stages.map((stage) => {
                const deals = dealsByStage.get(stage.id) ?? []
                const total = deals.reduce((sum, deal) => sum + deal.total, 0)

                return (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    deals={deals}
                    total={total}
                    isOver={overStageId === stage.id}
                  >
                    {deals.length ? (
                      deals.map((deal) => (
                        <DraggableDealCard
                          key={deal.id}
                          deal={deal}
                          pending={pending}
                          stages={stages}
                          onMoveToStage={moveDealToStage}
                        />
                      ))
                    ) : (
                      <Empty className="mx-3 min-h-28 rounded-lg border border-dashed border-zinc-300 bg-white/70">
                        <EmptyHeader>
                          <EmptyTitle className="text-sm">Сделок нет</EmptyTitle>
                          <EmptyDescription className="text-xs text-zinc-600">
                            Перетащите сделку сюда или используйте «Переместить» на карточке
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </KanbanColumn>
                )
              })}
            </div>
            )}
          </div>
          <DragOverlay>
            {activeDeal ? (
              <div className="w-[300px] md:w-[320px]">
                <DealCard deal={activeDeal} pending dragOverlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={submitDeal}>
            <DialogHeader>
              <DialogTitle>Новая сделка</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Field>
                <FieldLabel>Клиент</FieldLabel>
                <FieldContent>
                  <Select name="customerId" defaultValue="">
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder="Выбрать клиента">{(value) => customers.find((c) => String(c.id) === String(value))?.name ?? "Без выбранного клиента"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Без выбранного клиента</SelectItem>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={String(customer.id)}>
                          {customer.name} {customer.phone ? `· ${customer.phone}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Новый клиент</FieldLabel>
                  <FieldContent>
                    <Input name="customerName" placeholder="Имя, если нет в списке" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Телефон</FieldLabel>
                  <FieldContent>
                    <Input name="customerPhone" />
                  </FieldContent>
                </Field>
              </div>
              <Field>
                <FieldLabel>Название</FieldLabel>
                <FieldContent>
                  <Input name="title" placeholder="Например: Свадебный букет" />
                </FieldContent>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Этап</FieldLabel>
                  <FieldContent>
                    <Select name="stageId" defaultValue={String(stages[0]?.id ?? "")}>
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue>{(value) => stages.find((s) => String(s.id) === String(value))?.name ?? ""}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((stage) => (
                          <SelectItem key={stage.id} value={String(stage.id)}>
                            {stage.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Ответственный</FieldLabel>
                  <FieldContent>
                    <Select name="responsibleUserId" defaultValue={String(currentUser.id)}>
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue>{(value) => users.find((u) => String(u.id) === String(value))?.name ?? ""}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={String(user.id)}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Дата</FieldLabel>
                  <FieldContent>
                    <Input name="dueAt" type="datetime-local" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Источник</FieldLabel>
                  <FieldContent>
                    <Select name="source" defaultValue="manual">
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue>{(value) => sourceLabel(String(value ?? "manual"))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Ручная</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="instagram">Instagram</SelectItem>
                        <SelectItem value="telegram">Telegram</SelectItem>
                        <SelectItem value="site">Сайт</SelectItem>
                        <SelectItem value="phone">Телефон</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Получение</FieldLabel>
                  <FieldContent>
                    <Input name="deliveryType" placeholder="pickup / delivery" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Адрес</FieldLabel>
                  <FieldContent>
                    <Input name="address" />
                  </FieldContent>
                </Field>
              </div>
              <Field>
                <FieldLabel>Комментарий</FieldLabel>
                <FieldContent>
                  <Textarea name="comment" rows={3} />
                </FieldContent>
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={pending} className="bg-zinc-950 text-white hover:bg-zinc-800">
                Создать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function KanbanColumn({
  stage,
  deals,
  total,
  isOver,
  children,
}: {
  stage: DealStage
  deals: Deal[]
  total: number
  isOver: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver: droppableIsOver } = useDroppable({
    id: stageDroppableId(stage.id),
    data: { type: "stage", stageId: stage.id },
  })
  const highlighted = isOver || droppableIsOver

  return (
    <section className="h-full w-[300px] shrink-0 border-r border-zinc-200 last:border-r-0 md:w-[clamp(292px,calc((100vw-16rem)/4),360px)]">
      <div
        ref={setNodeRef}
        className={cn(
          "flex h-full min-h-[32rem] flex-col bg-zinc-50/70 transition-colors",
          highlighted && "bg-zinc-100 ring-2 ring-inset ring-zinc-300"
        )}
      >
        <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/95 px-3 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-zinc-950">{stage.name}</h2>
                <span className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs font-medium text-zinc-600">
                  {deals.length}
                </span>
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                Сумма: <span className="font-semibold text-zinc-950">{formatMoney(total)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">{children}</div>
      </div>
    </section>
  )
}

function DraggableDealCard(props: {
  deal: Deal
  pending: boolean
  stages: DealStage[]
  onMoveToStage: (deal: Deal, stageId: number) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dealDraggableId(props.deal.id),
    disabled: props.pending,
    data: {
      type: "deal",
      dealId: props.deal.id,
      stageId: props.deal.stageId,
    },
  })

  const moveMenu = (
    <DealStageMenu
      deal={props.deal}
      stages={props.stages}
      pending={props.pending}
      onMoveToStage={props.onMoveToStage}
    />
  )

  return (
    <div
      data-deal-card
      ref={setNodeRef}
      className={cn("touch-manipulation", props.pending ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing")}
      {...attributes}
      {...listeners}
    >
      <a
        data-deal-card
        href={`/deals/${props.deal.id}`}
        className="block rounded-lg focus-visible:ring-3 focus-visible:ring-zinc-300 focus-visible:outline-none"
        onClickCapture={(event) => event.stopPropagation()}
      >
        <DealCard deal={props.deal} pending={props.pending} isDragging={isDragging} headerAction={moveMenu} />
      </a>
    </div>
  )
}

// A touch/keyboard alternative to drag-and-drop: pick the target stage from a menu.
function DealStageMenu({
  deal,
  stages,
  pending,
  onMoveToStage,
}: {
  deal: Deal
  stages: DealStage[]
  pending: boolean
  onMoveToStage: (deal: Deal, stageId: number) => void
}) {
  const otherStages = stages.filter((stage) => stage.id !== deal.stageId)

  // The trigger lives inside a draggable <a>; stop drag/navigation from intercepting the tap.
  const stopBubble = (event: React.SyntheticEvent) => event.stopPropagation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label="Переместить сделку в другой этап"
          />
        }
        onPointerDown={stopBubble}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <MoveRightIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onPointerDown={stopBubble}
        onClick={stopBubble}
      >
        <DropdownMenuLabel>Переместить в…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {otherStages.length ? (
          otherStages.map((stage) => (
            <DropdownMenuItem
              key={stage.id}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onMoveToStage(deal, stage.id)
              }}
            >
              {stage.name}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>Других этапов нет</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DealCard({
  deal,
  pending,
  isDragging = false,
  dragOverlay = false,
  headerAction,
}: {
  deal: Deal
  pending: boolean
  isDragging?: boolean
  dragOverlay?: boolean
  headerAction?: React.ReactNode
}) {
  const due = getDueStatus(deal.dueAt)
  const note = getCardNote(deal)
  const status = getDealStatusLabel(deal)
  const nextAction = getNextAction(deal)

  return (
    <div
      className={cn(
        "w-full rounded-lg border border-zinc-200 bg-white p-3 text-left text-sm shadow-xs transition-[border-color,box-shadow,opacity,transform] hover:border-zinc-300 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-zinc-300 focus-visible:outline-none",
        pending && !dragOverlay && "pointer-events-none opacity-60",
        isDragging && "scale-[0.99] opacity-45",
        dragOverlay && "shadow-xl ring-2 ring-zinc-300",
        due.level === "overdue" && "border-destructive/40"
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <DueDateBadge due={due} />
        {headerAction ? <div className="-mr-1 -my-1 shrink-0">{headerAction}</div> : null}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-zinc-950">{deal.title || deal.customerName || "Без названия"}</div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {deal.number || `#${deal.id}`}
            {deal.customerName ? ` · ${deal.customerName}` : ""}
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-zinc-500">{sourceLabel(deal.source)}</span>
      </div>

      <div className="mt-3 grid gap-1.5 text-xs text-zinc-600">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate">Ответственный</span>
          <span className="truncate font-medium text-zinc-900">{deal.responsibleUserName || "Не назначен"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="truncate">Следующее действие</span>
          <span className="truncate font-medium text-zinc-900">{nextAction}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="truncate">Статус</span>
          <span className="truncate font-medium text-zinc-900">{status}</span>
        </div>
      </div>

      {note ? <div className="mt-3 line-clamp-2 border-t border-zinc-100 pt-2 text-xs text-zinc-600">{note}</div> : null}
    </div>
  )
}

function DueDateBadge({ due }: { due: DueStatus }) {
  if (due.level === "overdue") {
    return (
      <Badge variant="destructive" className="min-w-0">
        <AlertTriangleIcon data-icon="inline-start" />
        <span className="truncate">{due.pillLabel}</span>
      </Badge>
    )
  }

  if (due.level === "today") {
    return (
      <Badge variant="secondary" className="min-w-0 font-semibold">
        <ClockIcon data-icon="inline-start" />
        <span className="truncate">{due.pillLabel}</span>
      </Badge>
    )
  }

  if (due.level === "soon") {
    return (
      <Badge variant="outline" className="min-w-0 text-zinc-600">
        <CalendarClockIcon data-icon="inline-start" />
        <span className="truncate">{due.pillLabel}</span>
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="min-w-0 border-dashed text-zinc-500">
      <CalendarClockIcon data-icon="inline-start" />
      <span className="truncate">{due.pillLabel}</span>
    </Badge>
  )
}

function responsibleFilterLabel(value: string, users: CurrentUser[]) {
  if (value === allFilterValue) {
    return "Все ответственные"
  }

  return users.find((user) => String(user.id) === value)?.name ?? "Ответственный"
}

function sourceFilterLabel(value: string) {
  if (value === allFilterValue) {
    return "Все источники"
  }

  return sourceLabel(value)
}

function getDealIdFromDndId(id: unknown) {
  const value = String(id)
  if (!value.startsWith("deal:")) {
    return null
  }

  const dealId = Number(value.slice("deal:".length))
  return Number.isFinite(dealId) ? dealId : null
}

function getStageIdFromOver(over: DragEndEvent["over"] | DragOverEvent["over"]) {
  const stageId = over?.data.current?.stageId
  return typeof stageId === "number" ? stageId : null
}

function getNextAction(deal: Deal) {
  if (deal.lastMessageText) {
    return "Ответить клиенту"
  }
  if (deal.orderId && activeOrderStatuses.has(deal.orderStatus ?? "")) {
    return "Вести заказ"
  }
  if (!deal.dueAt) {
    return "Уточнить срок"
  }
  if (deal.total > 0 && deal.paid < deal.total) {
    return "Проверить оплату"
  }
  if (!deal.customerPhone && !deal.recipientPhone) {
    return "Уточнить контакт"
  }
  return "Продвинуть этап"
}

function getDealStatusLabel(deal: Deal) {
  if (deal.orderStatus) {
    return deal.orderStatus
  }
  if (deal.status === "won") {
    return "Выиграна"
  }
  if (deal.status === "cancelled") {
    return "Отменена"
  }
  if (deal.status === "lost") {
    return "Проиграна"
  }
  return "Открыта"
}

function getCardNote(deal: Deal) {
  return compactText(deal.comment) || compactText(deal.lastMessageText)
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

type DueLevel = "overdue" | "today" | "soon" | "none"

const dueLevelOrder: Record<DueLevel, number> = { overdue: 0, today: 1, soon: 2, none: 3 }

// Sort overdue/today deals to the top of a column; within the same urgency keep the earliest due first.
function byDueUrgency(a: Deal, b: Deal) {
  const aDue = getDueStatus(a.dueAt)
  const bDue = getDueStatus(b.dueAt)
  if (aDue.level !== bDue.level) {
    return dueLevelOrder[aDue.level] - dueLevelOrder[bDue.level]
  }

  const aTime = parseDueTime(a.dueAt)
  const bTime = parseDueTime(b.dueAt)
  if (aTime !== bTime) {
    return aTime - bTime
  }

  return 0
}

function parseDueTime(value: string) {
  if (!value) {
    return Number.POSITIVE_INFINITY
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

type DueStatus = {
  /** Short label for the top pill, e.g. "Просрочено · 31.05 14:00". */
  pillLabel: string
  level: DueLevel
}

function getDueStatus(value: string): DueStatus {
  if (!value) {
    return { pillLabel: "Срок не указан", level: "none" }
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { pillLabel: value, level: "none" }
  }

  const now = new Date()
  const formatted = formatDateTime(value)
  if (date.getTime() < now.getTime()) {
    return { pillLabel: `Просрочено · ${formatted}`, level: "overdue" }
  }

  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isSameDay) {
    return { pillLabel: `Сегодня · ${formatted}`, level: "today" }
  }

  return { pillLabel: `Срок · ${formatted}`, level: "soon" }
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
