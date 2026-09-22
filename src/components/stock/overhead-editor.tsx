"use client"

import { useEffect, useState } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import type { AllocationMethod, StockDocumentOverhead, StockOverheadKind } from "@/lib/db"
import { allocationMethodLabel, stockOverheadKindLabel } from "@/lib/labels"
import { formatMoney } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Row = { id: number; kind: StockOverheadKind; label: string; amount: string }

const KINDS: StockOverheadKind[] = ["delivery", "customs", "commission", "packaging", "other"]
const METHODS: AllocationMethod[] = ["by_value", "by_qty"]

// Редактор накладных расходов приходного акта. Эмитит поля формы overheadKind/overheadLabel/
// overheadAmount (по строке) и allocationMethod; сервер распределяет расходы на себестоимость при
// проведении. Показывать только для прихода (stock_in).
export function OverheadEditor({
  initialOverheads = [],
  initialMethod = "by_value",
  disabled,
  onStateChange,
}: {
  initialOverheads?: StockDocumentOverhead[]
  initialMethod?: AllocationMethod
  disabled?: boolean
  // Живой предпросмотр себестоимости в форме акта: сообщаем сумму расходов и метод распределения.
  onStateChange?: (state: { total: number; method: AllocationMethod }) => void
}) {
  const [method, setMethod] = useState<AllocationMethod>(initialMethod)
  const [rows, setRows] = useState<Row[]>(
    initialOverheads.map((overhead, index) => ({
      id: index,
      kind: overhead.kind,
      label: overhead.label,
      amount: String(overhead.amount),
    }))
  )

  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)

  useEffect(() => {
    onStateChange?.({ total, method })
    // Родитель передаёт стабильный setState-колбэк; зависимость только от значений.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, method])

  function addRow() {
    setRows((current) => {
      const nextId = current.reduce((max, row) => Math.max(max, row.id), -1) + 1
      return [...current, { id: nextId, kind: "delivery", label: "", amount: "" }]
    })
  }
  function updateRow(id: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }
  function removeRow(id: number) {
    setRows((current) => current.filter((row) => row.id !== id))
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <input type="hidden" name="allocationMethod" value={method} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Накладные расходы</span>
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={disabled}>
          <PlusIcon data-icon="inline-start" />
          Добавить расход
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Доставка, таможня, комиссия и т.п. — распределятся на себестоимость позиций при проведении.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="overheadKind" value={row.kind} />
                <Select value={row.kind} onValueChange={(value) => updateRow(row.id, { kind: (value as StockOverheadKind) ?? "other" })}>
                  <SelectTrigger className="h-9 w-40" disabled={disabled}>
                    <SelectValue>{stockOverheadKindLabel(row.kind)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {stockOverheadKindLabel(kind)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Input
                  name="overheadLabel"
                  className="h-9 min-w-40 flex-1"
                  placeholder="Описание (необязательно)"
                  value={row.label}
                  disabled={disabled}
                  onChange={(event) => updateRow(row.id, { label: event.target.value })}
                />
                <Input
                  name="overheadAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="h-9 w-32"
                  placeholder="Сумма"
                  value={row.amount}
                  disabled={disabled}
                  onChange={(event) => updateRow(row.id, { amount: event.target.value })}
                />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeRow(row.id)} disabled={disabled}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Распределить:</span>
            <Select value={method} onValueChange={(value) => setMethod((value as AllocationMethod) ?? "by_value")}>
              <SelectTrigger className="h-9 w-48" disabled={disabled}>
                <SelectValue>{allocationMethodLabel(method)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {METHODS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {allocationMethodLabel(value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className="ml-auto font-semibold">Итого расходов: {formatMoney(total)}</span>
          </div>
        </>
      )}
    </div>
  )
}
