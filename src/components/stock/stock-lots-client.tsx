"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { AlertTriangleIcon, CalendarClockIcon, FlameIcon } from "lucide-react"
import { toast } from "sonner"
import { writeOffLotAction } from "@/app/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import type { ExpiringLot, StockLot } from "@/lib/db"
import { stockLotWriteOffReasonLabel } from "@/lib/labels"

const WRITE_OFF_REASONS = ["spoilage", "markdown", "shrinkage", "other"] as const

function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number)
  const [ty, tm, td] = toISO.split("-").map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  return `${d}.${m}.${y}`
}

function formatReceived(value: string): string {
  const date = parseDbInstant(value)
  return date ? date.toLocaleDateString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}

function ExpiryBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft == null) {
    return <span className="text-muted-foreground">бессрочно</span>
  }
  if (daysLeft < 0) {
    return (
      <Badge variant="destructive">
        <FlameIcon data-icon="inline-start" />
        Просрочено {Math.abs(daysLeft)} дн.
      </Badge>
    )
  }
  if (daysLeft <= 2) {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
        <AlertTriangleIcon data-icon="inline-start" />
        {daysLeft === 0 ? "Истекает сегодня" : `Истекает через ${daysLeft} дн.`}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
      Через {daysLeft} дн.
    </Badge>
  )
}

export function StockLotsClient({
  enabled,
  expiring,
  lots,
  todayISO,
}: {
  enabled: boolean
  expiring: ExpiringLot[]
  lots: StockLot[]
  todayISO: string
}) {
  const router = useRouter()
  const [target, setTarget] = useState<StockLot | null>(null)
  const [qty, setQty] = useState("")
  const [reason, setReason] = useState<string>("spoilage")
  const [comment, setComment] = useState("")
  const [pending, startTransition] = useTransition()

  function openWriteOff(lot: StockLot) {
    setTarget(lot)
    setQty(String(lot.qtyRemaining))
    setReason("spoilage")
    setComment("")
  }

  function submitWriteOff() {
    if (!target) return
    const formData = new FormData()
    formData.set("lotId", String(target.id))
    formData.set("qty", qty)
    formData.set("reason", reason)
    formData.set("comment", comment)
    startTransition(async () => {
      const result = await writeOffLotAction(formData)
      if (result.ok) {
        toast.success(result.message)
        setTarget(null)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  const expiredCount = expiring.filter((lot) => lot.bucket === "expired").length
  const soonCount = expiring.length - expiredCount

  return (
    <div className="flex flex-col gap-4">
      {!enabled && (
        <Alert>
          <CalendarClockIcon />
          <AlertTitle>Учёт по партиям выключен</AlertTitle>
          <AlertDescription>
            Новые приходы не создают партии. Включите учёт в{" "}
            <Link href="/settings" className="font-medium underline">
              Настройках
            </Link>{" "}
            и отметьте «Вести по партиям» у нужных товаров на странице склада.
          </AlertDescription>
        </Alert>
      )}

      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Контроль свежести</CardTitle>
              <CardDescription>Партии, истекающие в ближайшие 7 дней или просроченные</CardDescription>
            </div>
            <div className="flex gap-2">
              {expiredCount > 0 && (
                <Badge variant="destructive">
                  <FlameIcon data-icon="inline-start" />
                  Просрочено: {expiredCount}
                </Badge>
              )}
              {soonCount > 0 && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                  <AlertTriangleIcon data-icon="inline-start" />
                  Скоро истекает: {soonCount}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {expiring.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет партий, истекающих в ближайшие 7 дней.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Товар</TableHead>
                  <TableHead>Поставщик</TableHead>
                  <TableHead>Годен до</TableHead>
                  <TableHead className="text-right">Остаток</TableHead>
                  <TableHead>Срок</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiring.map((lot) => (
                  <TableRow key={lot.id} className={lot.bucket === "expired" ? "bg-red-50/50" : undefined}>
                    <TableCell className="font-medium">{lot.productName || lot.productCode}</TableCell>
                    <TableCell>{lot.supplierName || "—"}</TableCell>
                    <TableCell>{formatExpiry(lot.expiryDate)}</TableCell>
                    <TableCell className="text-right">{lot.qtyRemaining}</TableCell>
                    <TableCell>
                      <ExpiryBadge daysLeft={lot.daysLeft} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => openWriteOff(lot)}>
                        Списать
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <CardTitle>Активные партии</CardTitle>
          <CardDescription>
            Порядок FEFO (раньше истекает — раньше уходит). Себестоимость партии — справочно.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lots.length === 0 ? (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>Активных партий нет</EmptyTitle>
                <EmptyDescription>
                  Партии создаются при проведении прихода для товаров с включённым учётом по партиям.{" "}
                  <Link href="/stock/acts" className={buttonVariants({ variant: "link", size: "sm" })}>
                    Акты склада
                  </Link>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Товар</TableHead>
                  <TableHead>Поставщик</TableHead>
                  <TableHead>Получено</TableHead>
                  <TableHead>Годен до</TableHead>
                  <TableHead className="text-right">Остаток</TableHead>
                  <TableHead className="text-right">Себест.</TableHead>
                  <TableHead>Срок</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lots.map((lot) => {
                  const daysLeft = lot.expiryDate ? daysBetween(todayISO, lot.expiryDate) : null
                  return (
                    <TableRow key={lot.id}>
                      <TableCell className="font-medium">{lot.productName || lot.productCode}</TableCell>
                      <TableCell>{lot.supplierName || "—"}</TableCell>
                      <TableCell>{formatReceived(lot.receivedAt)}</TableCell>
                      <TableCell>{formatExpiry(lot.expiryDate)}</TableCell>
                      <TableCell className="text-right">{lot.qtyRemaining}</TableCell>
                      <TableCell className="text-right">
                        {lot.unitCost == null ? "—" : lot.unitCost.toLocaleString("ru-RU")}
                      </TableCell>
                      <TableCell>
                        <ExpiryBadge daysLeft={daysLeft} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => openWriteOff(lot)}>
                          Списать
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Списание партии</DialogTitle>
            <DialogDescription>
              {target ? `${target.productName || target.productCode} · остаток ${target.qtyRemaining}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="write-off-qty" className="text-sm font-medium">
                Количество к списанию
              </label>
              <Input
                id="write-off-qty"
                type="number"
                min={1}
                step={1}
                max={target?.qtyRemaining}
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Причина</span>
              <Select value={reason} onValueChange={(next) => setReason(next ?? "spoilage")}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue>{stockLotWriteOffReasonLabel(reason)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {WRITE_OFF_REASONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {stockLotWriteOffReasonLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="write-off-comment" className="text-sm font-medium">
                Комментарий
              </label>
              <Input
                id="write-off-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="необязательно"
                disabled={pending}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Списание уменьшит и остаток партии, и остаток товара (реальная потеря).
            </p>
          </div>
          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={pending}
              type="button"
            >
              Отмена
            </DialogClose>
            <Button type="button" onClick={submitWriteOff} disabled={pending}>
              Списать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
