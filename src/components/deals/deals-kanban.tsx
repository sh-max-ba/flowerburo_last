"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { createDealAction, updateDealStageAction } from "@/app/actions"
import type { Customer, Deal, DealBoardData, DealStage } from "@/lib/crm"
import type { CurrentUser } from "@/lib/db"
import { sourceLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
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

const activeOrderStatuses = new Set(["Новый", "В работе", "Готов", "Передан курьеру", "new", "in_progress", "ready"])

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
  const stages = board.stages

  const dealsByStage = useMemo(() => {
    const map = new Map<number, Deal[]>()
    for (const stage of stages) {
      map.set(stage.id, [])
    }
    for (const deal of board.deals) {
      if (deal.stageId) {
        map.set(deal.stageId, [...(map.get(deal.stageId) ?? []), deal])
      }
    }
    return map
  }, [board.deals, stages])

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

  function moveDeal(deal: Deal, direction: -1 | 1) {
    const currentIndex = stages.findIndex((stage) => stage.id === deal.stageId)
    const nextStage = stages[currentIndex + direction]
    if (!nextStage) {
      return
    }
    run(() => updateDealStageAction(deal.id, nextStage.id))
  }

  return (
    <>
      <div className="flex justify-end">
        <Button className="h-10 bg-zinc-950 text-white hover:bg-zinc-800" onClick={() => setDialogOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Новая сделка
        </Button>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {stages.map((stage) => {
            const deals = dealsByStage.get(stage.id) ?? []
            const total = deals.reduce((sum, deal) => sum + deal.total, 0)

            return (
              <section key={stage.id} className="w-[360px] shrink-0">
                <div className="sticky top-0 z-10 mb-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-zinc-950">{stage.name}</h2>
                        <Badge variant="secondary">{deals.length}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-zinc-500">
                        Сумма: <span className="font-semibold text-zinc-950">{formatMoney(total)}</span>
                      </div>
                    </div>
                    <span className="size-3 rounded-full" style={{ backgroundColor: stage.color || "#64748b" }} />
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {deals.length ? (
                    deals.map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        stages={stages}
                        pending={pending}
                        onMove={moveDeal}
                        onMoveToStage={(stageId) => run(() => updateDealStageAction(deal.id, stageId))}
                      />
                    ))
                  ) : (
                    <Empty className="min-h-28 rounded-lg border border-dashed border-zinc-200 bg-white">
                      <EmptyHeader>
                        <EmptyTitle className="text-sm">Сделок нет</EmptyTitle>
                        <EmptyDescription className="text-xs">Переместите сюда сделку или создайте новую.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </div>
              </section>
            )
          })}
        </div>
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
                      <SelectValue placeholder="Выбрать клиента" />
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
                        <SelectValue />
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
                        <SelectValue />
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
                        <SelectValue />
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

function DealCard({
  deal,
  stages,
  pending,
  onMove,
  onMoveToStage,
}: {
  deal: Deal
  stages: DealStage[]
  pending: boolean
  onMove: (deal: Deal, direction: -1 | 1) => void
  onMoveToStage: (stageId: number) => void
}) {
  const currentIndex = stages.findIndex((stage) => stage.id === deal.stageId)
  const balance = Math.max(0, deal.total - deal.paid)
  const isPaid = deal.total > 0 && deal.paid >= deal.total
  const hasActiveOrder = Boolean(deal.orderId && activeOrderStatuses.has(deal.orderStatus ?? ""))

  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm font-semibold text-zinc-950">
              {deal.number || `#${deal.id}`}
            </CardTitle>
            <CardDescription className="line-clamp-2">
              {deal.title || deal.customerName || "Без названия"}
            </CardDescription>
          </div>
          <Button size="icon-sm" variant="outline" render={<Link href={`/deals/${deal.id}`} />}>
            <ExternalLinkIcon />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-sm">
          <div className="font-medium text-zinc-950">{deal.customerName || "Клиент не указан"}</div>
          <div className="text-zinc-500">{deal.customerPhone || "Телефон не указан"}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-zinc-500">Итог</div>
            <div className="font-semibold text-zinc-950">{formatMoney(deal.total)}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Оплачено</div>
            <div className="font-semibold text-zinc-950">{formatMoney(deal.paid)}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Остаток</div>
            <div className={cn("font-semibold", balance > 0 ? "text-amber-700" : "text-emerald-700")}>
              {formatMoney(balance)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hasActiveOrder && <Badge className="bg-sky-100 text-sky-900">Есть заказ</Badge>}
          {deal.orderId && deal.orderStatus === "Отменен" && <Badge variant="destructive">Заказ отменен</Badge>}
          {deal.orderId && deal.orderStatus === "Выдан" && <Badge variant="outline">Заказ завершен</Badge>}
          {deal.orderId && deal.orderStatus && !["Отменен", "Выдан"].includes(deal.orderStatus) && (
            <Badge variant="outline">{deal.orderStatus}</Badge>
          )}
          {balance > 0 && <Badge className="bg-amber-100 text-amber-900">Остаток {formatMoney(balance)}</Badge>}
          {isPaid && <Badge className="bg-emerald-100 text-emerald-900">Оплачено</Badge>}
          {deal.dealDiscountType === "percent" && deal.dealDiscountValue > 0 && (
            <Badge className="bg-green-100 text-green-900">Клиентская скидка</Badge>
          )}
          <Badge className="bg-slate-100 text-slate-900">{sourceLabel(deal.source)}</Badge>
        </div>
        {deal.lastMessageText ? (
          <div className="line-clamp-2 rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-600">
            {deal.lastMessageText}
          </div>
        ) : null}
        <div className="text-xs text-zinc-600">
          Готовность: {deal.dueAt ? formatDateTime(deal.dueAt) : "не указана"} ·{" "}
          {deal.responsibleUserName || "Без ответственного"}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || currentIndex <= 0}
            onClick={() => onMove(deal, -1)}
          >
            <ArrowLeftIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || currentIndex < 0 || currentIndex >= stages.length - 1}
            onClick={() => onMove(deal, 1)}
          >
            <ArrowRightIcon />
            Переместить
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" size="icon-sm" disabled={pending}>
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {stages.map((stage) => (
                  <DropdownMenuItem
                    key={stage.id}
                    disabled={stage.id === deal.stageId}
                    onClick={() => onMoveToStage(stage.id)}
                  >
                    {stage.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  )
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}
