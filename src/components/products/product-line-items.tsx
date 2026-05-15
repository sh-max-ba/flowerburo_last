"use client"

import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react"
import type { Product } from "@/lib/db"
import { calculateLineTotal, normalizeDiscountType, type DiscountType } from "@/lib/pricing"
import { cn, formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type ProductLineItem = {
  productCode: string
  name: string
  code: string
  article?: string
  categoryPath?: string
  qty: number
  price: number
  discountType?: DiscountType
  discountValue?: number
}

type ProductLineItemsProps = {
  items: ProductLineItem[]
  products?: Product[]
  disabled?: boolean
  emptyTitle?: string
  maxHeightPx?: number
  onItemsChange: (items: ProductLineItem[]) => void
}

export function lineFromProduct(product: Product): ProductLineItem {
  return {
    productCode: product.code,
    code: product.code,
    name: product.name,
    article: product.article,
    categoryPath: product.categoryPath,
    qty: 1,
    price: product.salePrice,
    discountType: "none",
    discountValue: 0,
  }
}

export function ProductLineItems({
  items,
  products,
  disabled,
  emptyTitle = "Позиции не выбраны",
  maxHeightPx = 520,
  onItemsChange,
}: ProductLineItemsProps) {
  const productByCode = new Map(products?.map((product) => [product.code, product]) ?? [])
  const scrollHeight = Math.min(items.length * 116 + 48, maxHeightPx)

  function updateItem(productCode: string, patch: Partial<ProductLineItem>) {
    onItemsChange(
      items.map((item) => (item.productCode === productCode ? { ...item, ...patch } : item))
    )
  }

  function adjustQty(productCode: string, delta: number) {
    const item = items.find((current) => current.productCode === productCode)
    if (!item) {
      return
    }
    updateItem(productCode, { qty: clampQty(item.qty + delta) })
  }

  if (!items.length) {
    return (
      <Empty className="min-h-36 rounded-lg border py-5">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>Добавьте товары из поиска склада.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-w-0">
      <ScrollArea className="min-w-0 rounded-lg border bg-background" style={{ height: scrollHeight }}>
        <div className="min-w-0 overflow-x-auto">
          <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>Товар</TableHead>
              <TableHead className="w-32">Кол-во</TableHead>
              <TableHead className="w-32">Цена</TableHead>
              <TableHead className="w-56">Скидка</TableHead>
              <TableHead className="w-32 text-right">До скидки</TableHead>
              <TableHead className="w-28 text-right">Скидка</TableHead>
              <TableHead className="w-28 text-right">Итого</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const product = productByCode.get(item.productCode)
              const qtyInvalid = item.qty < 1 || !Number.isInteger(item.qty)
              const priceInvalid = item.price < 0
              const discountType = normalizeDiscountType(item.discountType)
              const discountValue = Number.isFinite(item.discountValue) ? Number(item.discountValue) : 0
              const discountInvalid = discountValue < 0
              const totals = calculateLineTotal({
                qty: item.qty,
                price: item.price,
                discountType,
                discountValue,
              })
              return (
                <TableRow key={item.productCode}>
                  <TableCell className="min-w-0">
                    <input type="hidden" name="itemProductCode" value={item.productCode} />
                    <div className="max-w-64 min-w-0">
                      <div className="line-clamp-2 font-medium leading-snug">{item.name}</div>
                      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        <span>{item.code}</span>
                        {item.article && <span className="truncate">арт. {item.article}</span>}
                      </div>
                      {product && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Остаток {formatNumber(product.stock)}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        disabled={disabled}
                        onClick={() => adjustQty(item.productCode, -1)}
                      >
                        <MinusIcon />
                      </Button>
                      <Input
                        name="itemQty"
                        type="number"
                        step="1"
                        min="1"
                        value={Number.isFinite(item.qty) ? item.qty : ""}
                        disabled={disabled}
                        aria-invalid={qtyInvalid}
                        className={cn("w-20 text-right", qtyInvalid && "border-destructive")}
                        onChange={(event) =>
                          updateItem(item.productCode, { qty: Number(event.target.value) })
                        }
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        disabled={disabled}
                        onClick={() => adjustQty(item.productCode, 1)}
                      >
                        <PlusIcon />
                      </Button>
                    </div>
                    {qtyInvalid && <div className="mt-1 text-xs text-destructive">Кол-во от 1</div>}
                  </TableCell>
                  <TableCell>
                    <Input
                      name="itemPrice"
                      type="number"
                      step="1"
                      min="0"
                      value={Number.isFinite(item.price) ? item.price : ""}
                      disabled={disabled}
                      aria-invalid={priceInvalid}
                      className={cn("w-24 text-right", priceInvalid && "border-destructive")}
                      onChange={(event) =>
                        updateItem(item.productCode, { price: Number(event.target.value) })
                      }
                      required
                    />
                    {item.price === 0 && (
                      <Badge className="mt-1 border-amber-200 bg-amber-50 text-amber-800">Цена 0</Badge>
                    )}
                    {priceInvalid && <div className="mt-1 text-xs text-destructive">Цена не ниже 0</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <select
                        name="itemDiscountType"
                        className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-sm"
                        value={discountType}
                        disabled={disabled}
                        onChange={(event) =>
                          updateItem(item.productCode, {
                            discountType: normalizeDiscountType(event.target.value),
                            discountValue: event.target.value === "none" ? 0 : discountValue,
                          })
                        }
                      >
                        <option value="none">Без скидки</option>
                        <option value="percent">%</option>
                        <option value="amount">Сумма</option>
                      </select>
                      <Input
                        name="itemDiscountValue"
                        type="number"
                        step="1"
                        min="0"
                        value={Number.isFinite(discountValue) ? discountValue : ""}
                        disabled={disabled}
                        readOnly={discountType === "none"}
                        aria-invalid={discountInvalid}
                        className={cn("w-24 text-right", discountInvalid && "border-destructive")}
                        onChange={(event) =>
                          updateItem(item.productCode, { discountValue: Number(event.target.value) || 0 })
                        }
                      />
                    </div>
                    {discountInvalid && <div className="mt-1 text-xs text-destructive">Скидка не ниже 0</div>}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatMoney(totals.totalBeforeDiscount)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatMoney(totals.discountAmount)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatMoney(totals.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      onClick={() =>
                        onItemsChange(items.filter((current) => current.productCode !== item.productCode))
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </div>
  )
}

export function addProductToLineItems(items: ProductLineItem[], product: Product, qty = 1) {
  const existing = items.find((item) => item.productCode === product.code)
  if (existing) {
    return items.map((item) =>
      item.productCode === product.code ? { ...item, qty: clampQty(item.qty + qty) } : item
    )
  }

  return [...items, lineFromProduct(product)]
}

export function getLineItemsTotal(items: ProductLineItem[]) {
  return items.reduce((sum, item) => {
    return sum + calculateLineTotal({
      qty: item.qty,
      price: item.price,
      discountType: item.discountType,
      discountValue: item.discountValue,
    }).total
  }, 0)
}

export function validateProductLineItems(items: ProductLineItem[]) {
  if (!items.length) {
    return "Добавьте хотя бы одну позицию."
  }

  if (items.some((item) => !item.productCode)) {
    return "У каждой позиции должен быть product_code."
  }

  if (items.some((item) => !Number.isFinite(item.qty) || item.qty < 1 || !Number.isInteger(item.qty))) {
    return "Количество в каждой позиции должно быть целым числом от 1."
  }

  if (items.some((item) => !Number.isFinite(item.price) || item.price < 0)) {
    return "Цена не может быть отрицательной."
  }

  if (items.some((item) => Number(item.discountValue ?? 0) < 0)) {
    return "Скидка не может быть отрицательной."
  }

  return null
}

function clampQty(value: number) {
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.max(1, Math.round(value))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}
