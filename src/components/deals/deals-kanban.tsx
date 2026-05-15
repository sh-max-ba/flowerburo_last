"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { createDealAction, updateDealStageAction } from "@/app/actions"
import type { Customer, Deal, DealBoardData, DealStage } from "@/lib/crm"
import type { CurrentUser } from "@/lib/db"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
              <section key={stage.id} className="w-[320px] shrink-0">
                <div className="mb-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-zinc-950">{stage.name}</h2>
                      <div className="mt-1 text-xs text-zinc-600">
                        {deals.length} сделок · <span className="font-semibold">{formatMoney(total)}</span>
                      </div>
                    </div>
                    <span className="size-3 rounded-full" style={{ backgroundColor: stage.color || "#64748b" }} />
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {deals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      stages={stages}
                      pending={pending}
                      onMove={moveDeal}
                    />
                  ))}
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
                        <SelectItem value="manual">manual</SelectItem>
                        <SelectItem value="whatsapp">whatsapp</SelectItem>
                        <SelectItem value="instagram">instagram</SelectItem>
                        <SelectItem value="site">site</SelectItem>
                        <SelectItem value="phone">phone</SelectItem>
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
}: {
  deal: Deal
  stages: DealStage[]
  pending: boolean
  onMove: (deal: Deal, direction: -1 | 1) => void
}) {
  const currentIndex = stages.findIndex((stage) => stage.id === deal.stageId)
  const balance = Math.max(0, deal.total - deal.paid)

  return (
    <Card className="rounded-lg border-zinc-200 bg-white shadow-sm">
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
          <div className="text-zinc-600">{deal.customerPhone || "Телефон не указан"}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-xs text-zinc-500">Итог</div>
            <div className="font-semibold text-zinc-950">{formatMoney(deal.total)}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Оплачено</div>
            <div className="font-semibold text-zinc-950">{formatMoney(deal.paid)}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {balance > 0 && <Badge className="bg-amber-100 text-amber-900">Есть остаток оплаты</Badge>}
          {deal.dealDiscountType === "percent" && deal.dealDiscountValue > 0 && (
            <Badge className="bg-green-100 text-green-900">Клиентская скидка</Badge>
          )}
          {deal.source === "whatsapp" && <Badge className="bg-slate-200 text-slate-950">WhatsApp</Badge>}
          <Badge className="bg-slate-100 text-slate-900">{deal.source}</Badge>
        </div>
        <div className="text-xs text-zinc-600">
          {deal.dueAt ? formatDateTime(deal.dueAt) : "Дата не указана"} · {deal.responsibleUserName || "Без ответственного"}
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
