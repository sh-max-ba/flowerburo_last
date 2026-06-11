"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { SearchIcon } from "lucide-react"
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

const FILTERS = [
  { value: "all", label: "Все" },
  { value: "uncounted", label: "Не сосчитано" },
  { value: "variance", label: "Расхождения" },
  { value: "counted", label: "Сосчитано" },
] as const

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

  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "uncounted" | "variance" | "counted">("all")

  // Фильтр статуса основан на СОХРАНЁННЫХ полях (item.countedQty/applied), а не на живом вводе —
  // иначе строка исчезала бы из «не сосчитано» при первом же нажатии. Поиск — по названию/коду.
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return doc.items.filter((item) => {
      if (q) {
        const haystack = `${item.productName} ${item.productCode}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (filter === "all") return true
      if (filter === "uncounted") return item.countedQty == null
      if (filter === "counted") return item.countedQty != null
      // variance
      if (isDraft) return item.countedQty != null && item.countedQty - (item.expectedQty ?? 0) !== 0
      return item.applied && item.qty !== 0
    })
  }, [doc.items, query, filter, isDraft])

  // Быстрое «факт = расчётному» для одной строки. Для отрицательного учётного остатка кнопка
  // отключена (см. рендер): физический факт не бывает отрицательным, сервер такой ввод отклонит.
  function quickFill(item: StockDocument["items"][number]) {
    setRow(item.id, { counted: String(item.expectedQty ?? 0) })
  }

  // Принять расчётный для всех несосчитанных среди ВИДИМЫХ (учёт фильтра/поиска) — как «факт=расчётный».
  // Строки с отрицательным учётным остатком пропускаем: подстановка минуса валила сохранение целиком.
  function bulkFillExpected() {
    const fillable: Array<[number, string]> = []
    let skipped = 0
    for (const item of visibleItems) {
      const fact = rows[item.id]?.counted ?? ""
      if (fact.trim() !== "") continue
      const expected = item.expectedQty ?? 0
      if (expected < 0) {
        skipped += 1
        continue
      }
      fillable.push([item.id, String(expected)])
    }
    if (fillable.length > 0) {
      setRows((current) => {
        const next = { ...current }
        for (const [id, counted] of fillable) {
          next[id] = { ...current[id], counted }
        }
        return next
      })
    }
    if (skipped > 0) {
      toast.info(
        `Пропущено позиций с отрицательным учётным остатком: ${skipped}. Введите по ним реальный факт вручную.`
      )
    }
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

  // Строка «грязная», если ввод отличается от сохранённого в БД. Отправляем только такие строки:
  // устаревшая вкладка не затирает подсчёт, сделанный в другой вкладке, а counted_at нетронутых
  // строк не сбрасывается при каждом сохранении.
  function isRowDirty(item: StockDocument["items"][number], row: RowState | undefined) {
    if (!row) return false
    const savedCounted = item.countedQty == null ? "" : String(item.countedQty)
    const savedReason = item.varianceReason ?? ""
    return row.counted.trim() !== savedCounted || row.reason !== savedReason
  }

  // Проверка до отправки: сервер откатывает сохранение целиком, поэтому называем виновную строку сразу.
  function findInvalidRow(): string | null {
    for (const item of doc.items) {
      const raw = rows[item.id]?.counted ?? ""
      if (raw.trim() === "") continue
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        return `«${item.productName || item.productCode}»: фактическое количество не может быть отрицательным.`
      }
    }
    return null
  }

  function buildSaveFormData() {
    const formData = new FormData()
    formData.set("documentId", String(doc.id))
    for (const item of doc.items) {
      const row = rows[item.id]
      if (!isRowDirty(item, row)) continue
      formData.append("itemId", String(item.id))
      formData.append("countedQty", row?.counted ?? "")
      formData.append("varianceReason", row?.reason ?? "")
    }
    return formData
  }

  function save() {
    const invalid = findInvalidRow()
    if (invalid) {
      toast.error(invalid)
      return
    }
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
    const invalid = findInvalidRow()
    if (invalid) {
      toast.error(invalid)
      return
    }
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
          <div className="mb-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:max-w-xs">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Поиск по названию или коду"
                  className="h-9 pl-8"
                />
              </div>
              {FILTERS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={filter === option.value ? "default" : "outline"}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Показано {visibleItems.length} из {doc.items.length}
              </span>
              {isDraft && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={bulkFillExpected}
                  disabled={pending}
                  title="Незаполненным позициям из показанных проставить факт = учётному остатку (они совпали с системой)"
                >
                  Остальные совпадают
                </Button>
              )}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Товар</TableHead>
                <TableHead className="text-right">Учётный</TableHead>
                {isDraft ? (
                  <>
                    <TableHead className="text-right">Текущий</TableHead>
                    <TableHead className="w-40 text-right">Факт</TableHead>
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
              {visibleItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Ничего не найдено
                  </TableCell>
                </TableRow>
              )}
              {visibleItems.map((item) => {
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
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={row.counted}
                            onChange={(event) => setRow(item.id, { counted: event.target.value })}
                            className="h-8 w-20 text-right"
                            disabled={pending}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => quickFill(item)}
                            disabled={pending || expected < 0}
                            title={
                              expected < 0
                                ? "Учётный остаток отрицательный — введите реальный остаток вручную"
                                : "Поставить факт = учётному остатку (позиция совпала)"
                            }
                          >
                            совпало
                          </Button>
                        </div>
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
            title="Подтянуть текущие остатки из системы в колонку «Учётный» — только для строк без введённого факта. У сосчитанных строк учётный остаток заморожен: их расхождение считается от снимка на момент подсчёта."
          >
            Обновить учётные остатки
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
