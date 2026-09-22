"use client"

import { useEffect, useRef } from "react"
import { Trash2Icon } from "lucide-react"
import type { AllocationMethod, Product, StockDocument } from "@/lib/db"
import { allocateOverheadShares, landedUnitCostOf } from "@/lib/stock-costing"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ProductThumbnail } from "@/components/products/product-thumbnail"

// Строка позиций акта пополнения/списания. Цену можно вводить двумя способами: за единицу
// («unit») или суммой строки («total» — цена выводится как сумма ÷ кол-во); basis помнит,
// что пользователь вводил последним, второе поле показывает вычисленное значение.
export type DocumentLine = {
  product: Product
  qty: string
  unitCost: string
  lineTotal: string
  basis: "unit" | "total"
  defect: string
  comment: string
}

export type ResolvedLine = {
  line: DocumentLine
  product: Product
  qty: number
  defect: number
  effectiveQty: number
  unitCost: number
  lineValue: number
  afterStock: number
  // Что уходит на сервер в itemUnitCost: при вводе суммой — сумма ÷ кол-во БЕЗ округления до
  // копеек, чтобы итог акта сходился с введённой суммой ровно (сервер хранит до 6 знаков).
  submittedUnitCost: string
}

export function newDocumentLine(product: Product, isWriteOff: boolean): DocumentLine {
  return {
    product,
    qty: "1",
    // Списание: по умолчанию подставляем текущую себестоимость (редактируемо).
    unitCost: isWriteOff ? String(product.costPrice || "") : "",
    lineTotal: "",
    basis: "unit",
    defect: "",
    comment: "",
  }
}

// Восстановление строки из сохранённого черновика. Если хранимая цена «некруглая» (вводили
// суммой строки: 1000 за 3 шт → 333.333333), возвращаем строке ввод суммой — так значение
// стабильно переживает цикл сохранить-открыть-сохранить.
export function documentLineFromItem(
  item: StockDocument["items"][number],
  product: Product,
  isWriteOff: boolean
): DocumentLine {
  const unitCost = item.unitCost
  const enteredByTotal = unitCost > 0 && round2(unitCost) !== unitCost

  return {
    product,
    qty: String(item.qty),
    unitCost: enteredByTotal
      ? ""
      : unitCost
        ? String(unitCost)
        : isWriteOff
          ? String(product.costPrice || "")
          : "",
    lineTotal: enteredByTotal ? String(round2(item.qty * unitCost)) : "",
    basis: enteredByTotal ? "total" : "unit",
    defect: item.defectQty ? String(item.defectQty) : "",
    comment: item.comment,
  }
}

export function addProductToLines(
  current: DocumentLine[],
  product: Product,
  isWriteOff: boolean
): DocumentLine[] {
  const existing = current.find((item) => item.product.code === product.code)
  if (existing) {
    const updated = { ...existing, product, qty: String(incrementWholeQty(existing.qty)) }
    return [updated, ...current.filter((item) => item.product.code !== product.code)]
  }

  return [newDocumentLine(product, isWriteOff), ...current]
}

// Единый пересчёт строк: и таблица, и родительские формы (минус-предупреждение списания)
// считают одинаково. Сумма строки — оплаченная (qty × цена): брак НЕ уменьшает её, а поднимает
// себестоимость единицы годного; на склад идёт только годное (qty − брак).
export function resolveDocumentLines(
  items: DocumentLine[],
  products: Product[],
  isWriteOff: boolean
): ResolvedLine[] {
  return items.map((line) => {
    const product = products.find((candidate) => candidate.code === line.product.code) ?? line.product
    const qty = Number(line.qty || 0)
    const defect = isWriteOff ? 0 : Math.min(Math.max(0, qty), Math.max(0, Number(line.defect || 0)))
    const effectiveQty = qty - defect
    const byTotal = line.basis === "total"
    const totalNum = Math.max(0, Number(line.lineTotal) || 0)
    const unitCost = byTotal ? (qty > 0 ? totalNum / qty : 0) : Math.max(0, Number(line.unitCost) || 0)
    const lineValue = byTotal ? totalNum : round2(qty * unitCost)
    const afterStock = product.stock + (isWriteOff ? -qty : effectiveQty)

    return {
      line,
      product,
      qty,
      defect,
      effectiveQty,
      unitCost,
      lineValue,
      afterStock,
      submittedUnitCost: byTotal ? String(unitCost) : line.unitCost,
    }
  })
}

export function StockDocumentItemsTable({
  items,
  products,
  isWriteOff,
  pending,
  overheadTotal = 0,
  allocationMethod = "by_value",
  emptyState = null,
  onUpdate,
  onRemove,
}: {
  items: DocumentLine[]
  products: Product[]
  isWriteOff: boolean
  pending: boolean
  overheadTotal?: number
  allocationMethod?: AllocationMethod
  /** Показывается вместо таблицы, пока позиций нет — компонент должен оставаться смонтированным
      с открытия формы, иначе не отличить «добавили первый товар» от «открыли черновик с позициями». */
  emptyState?: React.ReactNode
  onUpdate: (productCode: string, patch: Partial<DocumentLine>) => void
  onRemove: (productCode: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  // На ноутбучных экранах таблица позиций лежит ниже сгиба попапа: без прокрутки добавленный
  // товар не видно вовсе, и кажется, что таблица «показывает только одну строку». После
  // добавления (новый код или существующий всплыл наверх) доводим свежую строку до видимости.
  // Правки полей и удаление строк прокрутку не трогают.
  const prevItemsRef = useRef<{ length: number; firstCode: string | null } | null>(null)
  useEffect(() => {
    const current = { length: items.length, firstCode: items[0]?.product.code ?? null }
    const prev = prevItemsRef.current
    prevItemsRef.current = current
    if (!prev || current.length === 0) {
      return
    }

    const added =
      current.length > prev.length ||
      (current.length === prev.length && current.firstCode !== prev.firstCode)
    if (added) {
      wrapRef.current?.querySelector("tbody tr")?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }, [items])

  const resolved = resolveDocumentLines(items, products, isWriteOff)

  // Живой предпросмотр себестоимости: та же формула распределения, что применит сервер при
  // проведении (stock-costing.ts) — накладные только на строки с годным, вес — оплаченные qty/сумма.
  const shares = isWriteOff
    ? resolved.map(() => 0)
    : allocateOverheadShares(
        resolved.map((row) => ({
          qty: row.effectiveQty > 0 ? row.qty : 0,
          lineValue: row.effectiveQty > 0 ? row.lineValue : 0,
        })),
        overheadTotal,
        allocationMethod
      )

  const totals = resolved.reduce(
    (acc, row) => {
      if (Number.isFinite(row.qty) && row.qty > 0) {
        acc.qty += row.qty
        acc.defect += row.defect
        acc.value += row.lineValue
      }
      return acc
    },
    { qty: 0, defect: 0, value: 0 }
  )
  const landedTotal = round2(totals.value + (isWriteOff ? 0 : overheadTotal))

  if (items.length === 0) {
    return <div ref={wrapRef}>{emptyState}</div>
  }

  return (
    // shrink-0 обязателен: из-за overflow-x-auto у flex-ребёнка min-height становится 0, и в
    // переполненной flex-колонке попапа таблицу сплющивает до высоты одной строки.
    <div ref={wrapRef} className="shrink-0 overflow-x-auto rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-48">Товар</TableHead>
            <TableHead className="w-20">Кол-во</TableHead>
            {!isWriteOff && (
              <TableHead className="w-20" title="Брак не уменьшает сумму: оплачено всё количество, брак дорожает себестоимость годного">
                Брак
              </TableHead>
            )}
            <TableHead className="w-24" title={isWriteOff ? "Себестоимость единицы (по умолчанию текущая)" : "Цена закупки за единицу. Можно не вводить, а указать сумму строки"}>
              {isWriteOff ? "Себест./ед." : "Цена/ед."}
            </TableHead>
            <TableHead className="w-24" title="Сумма строки. Можно ввести её напрямую — цена за единицу рассчитается сама">
              Сумма
            </TableHead>
            {!isWriteOff && (
              <TableHead className="w-28" title="Себестоимость единицы годного с учётом брака и накладных расходов: (сумма строки + доля накладных) ÷ годное">
                Себест. на склад
              </TableHead>
            )}
            <TableHead className="w-28">Остаток → станет</TableHead>
            <TableHead className="min-w-32">Комментарий</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {resolved.map((row, index) => {
            const { line, product, qty, defect, effectiveQty, unitCost, lineValue, afterStock } = row
            const landed = isWriteOff
              ? null
              : landedUnitCostOf({ qty, effectiveQty, unitCost, allocatedOverhead: shares[index] })
            const roundedUnit = round2(unitCost)
            const allDefect = !isWriteOff && qty > 0 && effectiveQty <= 0

            return (
              <TableRow key={product.code}>
                <TableCell>
                  <input type="hidden" name="itemProductCode" value={product.code} />
                  <input type="hidden" name="itemUnitCost" value={row.submittedUnitCost} />
                  <div className="flex min-w-0 items-center gap-2">
                    <ProductThumbnail name={product.name} imagePath={product.imagePath} size="sm" />
                    {/* max-w ограничивает intrinsic-ширину ячейки: без него truncate не мешает
                        длинному имени распирать таблицу за край контейнера. */}
                    <div className="min-w-0 max-w-48">
                      <div className="truncate font-medium" title={product.name}>{product.name}</div>
                      <div className="text-xs text-muted-foreground">{product.code}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    name="itemQty"
                    type="number"
                    min="1"
                    step="1"
                    value={line.qty}
                    disabled={pending}
                    onChange={(event) => onUpdate(product.code, { qty: event.target.value })}
                    required
                  />
                </TableCell>
                {!isWriteOff && (
                  <TableCell>
                    <Input
                      name="itemDefectQty"
                      type="number"
                      min="0"
                      step="1"
                      max={qty > 0 ? qty : undefined}
                      placeholder="0"
                      value={line.defect}
                      disabled={pending}
                      onChange={(event) => onUpdate(product.code, { defect: event.target.value })}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0"
                    value={line.basis === "unit" ? line.unitCost : formatDecimalInput(unitCost)}
                    disabled={pending}
                    onChange={(event) => onUpdate(product.code, { unitCost: event.target.value, basis: "unit" })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0"
                    value={line.basis === "total" ? line.lineTotal : lineValue > 0 ? formatDecimalInput(lineValue) : ""}
                    disabled={pending}
                    onChange={(event) => onUpdate(product.code, { lineTotal: event.target.value, basis: "total" })}
                  />
                </TableCell>
                {!isWriteOff && (
                  <TableCell
                    className="tabular-nums"
                    title={
                      landed === null
                        ? undefined
                        : `(${formatMoney(lineValue)}${shares[index] > 0 ? ` + накладные ${formatMoney(shares[index])}` : ""}) ÷ ${formatNumber(effectiveQty)} годн.`
                    }
                  >
                    {allDefect ? (
                      <span className="text-xs text-amber-700">вся строка — брак</span>
                    ) : landed === null || unitCost <= 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : landed === roundedUnit ? (
                      formatMoney(landed)
                    ) : (
                      <span className="whitespace-nowrap">
                        <span className="text-muted-foreground">{formatMoney(roundedUnit)}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-semibold text-amber-700">{formatMoney(landed)}</span>
                      </span>
                    )}
                  </TableCell>
                )}
                <TableCell className="tabular-nums">
                  <span className="whitespace-nowrap">
                    <span className="text-muted-foreground">{formatNumber(product.stock)} → </span>
                    <span className={isWriteOff && afterStock < 0 ? "font-semibold text-amber-700" : "font-medium"}>
                      {formatNumber(afterStock)}
                    </span>
                  </span>
                  {isWriteOff && afterStock < 0 && (
                    <Badge className="ml-1.5 border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50">
                      минус
                    </Badge>
                  )}
                  {!isWriteOff && defect > 0 && (
                    <div className="text-xs text-amber-700">годное {formatNumber(effectiveQty)} из {formatNumber(qty)}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    name="itemComment"
                    placeholder="Комментарий"
                    value={line.comment}
                    disabled={pending}
                    onChange={(event) => onUpdate(product.code, { comment: event.target.value })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    onClick={() => onRemove(product.code)}
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-medium">Позиций: {items.length}</TableCell>
            <TableCell className="font-semibold tabular-nums">{formatNumber(totals.qty)}</TableCell>
            {!isWriteOff && (
              <TableCell className="tabular-nums text-amber-700">
                {totals.defect > 0 ? formatNumber(totals.defect) : ""}
              </TableCell>
            )}
            <TableCell />
            <TableCell className="font-semibold tabular-nums" title={isWriteOff ? "Сумма по строкам: кол-во × себестоимость" : "Оплачено по строкам: кол-во × цена (включая брак)"}>
              {formatMoney(totals.value)}
            </TableCell>
            <TableCell colSpan={isWriteOff ? 3 : 4} className="text-right">
              {isWriteOff ? (
                <span className="font-semibold">Стоимость списания: {formatMoney(totals.value)}</span>
              ) : overheadTotal > 0 ? (
                <span>
                  <span className="text-muted-foreground">
                    Товары {formatMoney(totals.value)} + накладные {formatMoney(overheadTotal)} ={" "}
                  </span>
                  <span className="font-semibold">Итого на склад: {formatMoney(landedTotal)}</span>
                </span>
              ) : (
                <span className="font-semibold">Стоимость прихода: {formatMoney(totals.value)}</span>
              )}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

function incrementWholeQty(value: string) {
  const next = Number(value || 0) + 1
  if (!Number.isFinite(next)) {
    return 1
  }

  return Math.max(1, Math.round(next))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

// Значение для type="number"-инпута: без локали и групп разрядов, максимум 2 знака.
function formatDecimalInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return ""
  }

  return String(Number(value.toFixed(2)))
}

function round2(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
