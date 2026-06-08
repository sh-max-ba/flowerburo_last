"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  cancelInventoryAction,
  postInventoryAction,
  recalcInventoryExpectedAction,
  saveInventoryDraftAction,
} from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import type { StockDocument } from "@/lib/db"
import { stockDocumentStatusLabel, stockVarianceReasonLabel } from "@/lib/labels"

const REASONS = ["spoilage", "shrinkage", "admin_error", "other"] as const

function formatDateTime(value: string | null) {
  if (!value) return "—"
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}

type RowState = { counted: string; reason: string }

export function InventoryDetailClient({ doc }: { doc: StockDocument }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const isDraft = doc.status === "draft"

  const [rows, setRows] = useState<Record<number, RowState>>(() => {
    const initial: Record<number, RowState> = {}
    for (const item of doc.items) {
      initial[item.id] = {
        counted: item.countedQty == null ? "" : String(item.countedQty),
        reason: item.varianceReason ?? "",
      }
    }
    return initial
  })

  function setRow(id: number, patch: Partial<RowState>) {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  // Сводка расхождений (по введённому факту против расчётного — что видит кладовщик).
  const summary = useMemo(() => {
    let surplus = 0
    let shortage = 0
    let counted = 0
    for (const item of doc.items) {
      const raw = rows[item.id]?.counted ?? ""
      if (raw.trim() === "") continue
      counted += 1
      const diff = Number(raw) - (item.expectedQty ?? 0)
      if (diff > 0) surplus += 1
      else if (diff < 0) shortage += 1
    }
    return { surplus, shortage, counted, total: doc.items.length }
  }, [rows, doc.items])

  function buildSaveFormData() {
    const formData = new FormData()
    formData.set("documentId", String(doc.id))
    for (const item of doc.items) {
      const row = rows[item.id]
      formData.append("itemId", String(item.id))
      formData.append("countedQty", row?.counted ?? "")
      formData.append("varianceReason", row?.reason ?? "")
    }
    return formData
  }

  function save() {
    startTransition(async () => {
      const result = await saveInventoryDraftAction(buildSaveFormData())
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  // Проведение всегда сначала сохраняет текущий ввод (чтобы не провести устаревший факт), затем проводит.
  function saveThenPost() {
    startTransition(async () => {
      const saved = await saveInventoryDraftAction(buildSaveFormData())
      if (!saved.ok) {
        toast.error(saved.message)
        return
      }
      const result = await postInventoryAction(doc.id)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function runAction(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await fn()
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Инвентаризация {doc.number}</CardTitle>
              <p className="text-sm text-muted-foreground">
                Создан: {formatDateTime(doc.createdAt)} · Снимок: {formatDateTime(doc.countStartedAt)}
                {doc.postedAt ? ` · Проведён: ${formatDateTime(doc.postedAt)}` : ""}
              </p>
            </div>
            <StatusBadge status={doc.status} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Позиций: {summary.total}</Badge>
          <Badge variant="outline">Сосчитано: {summary.counted}</Badge>
          {summary.surplus > 0 && (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
              Излишки: {summary.surplus}
            </Badge>
          )}
          {summary.shortage > 0 && (
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
              Недостачи: {summary.shortage}
            </Badge>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border bg-white">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Товар</TableHead>
                <TableHead className="text-right">Расчётный</TableHead>
                {isDraft ? (
                  <>
                    <TableHead className="text-right">Текущий</TableHead>
                    <TableHead className="w-28 text-right">Факт</TableHead>
                    <TableHead className="text-right">Разница</TableHead>
                    <TableHead className="w-44">Причина</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="text-right">Факт</TableHead>
                    <TableHead className="text-right">Было</TableHead>
                    <TableHead className="text-right">Стало</TableHead>
                    <TableHead className="text-right">Применено</TableHead>
                    <TableHead>Причина</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {doc.items.map((item) => {
                const expected = item.expectedQty ?? 0
                if (isDraft) {
                  const row = rows[item.id] ?? { counted: "", reason: "" }
                  const hasFact = row.counted.trim() !== ""
                  const diff = hasFact ? Number(row.counted) - expected : null
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.productName || item.productCode}</TableCell>
                      <TableCell className="text-right">{expected}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{item.currentStock ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={row.counted}
                          onChange={(event) => setRow(item.id, { counted: event.target.value })}
                          className="h-8 w-24 text-right"
                          disabled={pending}
                        />
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${diffColor(diff)}`}>
                        {diff == null ? "—" : diff > 0 ? `+${diff}` : diff}
                      </TableCell>
                      <TableCell>
                        <select
                          value={row.reason}
                          onChange={(event) => setRow(item.id, { reason: event.target.value })}
                          disabled={pending || !hasFact || diff === 0}
                          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
                        >
                          <option value="">—</option>
                          {REASONS.map((value) => (
                            <option key={value} value={value}>
                              {stockVarianceReasonLabel(value)}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                    </TableRow>
                  )
                }
                const applied = item.applied
                const delta = item.qty
                return (
                  <TableRow key={item.id} className={!applied && item.countedQty != null ? "bg-amber-50/50" : undefined}>
                    <TableCell className="font-medium">
                      {item.productName || item.productCode}
                      {!applied && item.countedQty != null && (
                        <span className="ml-2 text-xs text-amber-700">не применено</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{expected}</TableCell>
                    <TableCell className="text-right">{item.countedQty ?? "—"}</TableCell>
                    <TableCell className="text-right">{item.beforeStock ?? "—"}</TableCell>
                    <TableCell className="text-right">{item.afterStock ?? "—"}</TableCell>
                    <TableCell className={`text-right tabular-nums ${diffColor(applied ? delta : null)}`}>
                      {!applied ? "—" : delta > 0 ? `+${delta}` : delta}
                    </TableCell>
                    <TableCell>{item.varianceReason ? stockVarianceReasonLabel(item.varianceReason) : "—"}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isDraft && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={save} disabled={pending}>
            Сохранить
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => runAction(() => recalcInventoryExpectedAction(doc.id))}
            disabled={pending}
          >
            Пересчитать расчётный
          </Button>
          <Button
            type="button"
            onClick={saveThenPost}
            disabled={pending || summary.counted === 0}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            Провести (выровнять остатки)
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => runAction(() => cancelInventoryAction(doc.id))}
            disabled={pending}
          >
            Отменить
          </Button>
        </div>
      )}
    </div>
  )
}

function diffColor(diff: number | null) {
  if (diff == null || diff === 0) return "text-muted-foreground"
  return diff > 0 ? "text-emerald-700" : "text-red-700"
}

function StatusBadge({ status }: { status: StockDocument["status"] }) {
  const className =
    status === "posted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "draft"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-muted bg-muted text-muted-foreground"
  return (
    <Badge variant={status === "cancelled" ? "destructive" : "outline"} className={className}>
      {stockDocumentStatusLabel(status)}
    </Badge>
  )
}
