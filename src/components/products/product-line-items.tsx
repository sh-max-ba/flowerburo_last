"use client"

import type { ReactNode } from "react"
import { AlertTriangleIcon, MinusIcon, PlusIcon, Trash2Icon } from "lucide-react"
import type { BouquetTemplate, Product } from "@/lib/db"
import { calculateLineTotal, normalizeDiscountType, type DiscountType } from "@/lib/pricing"
import { cn, formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ProductThumbnail } from "@/components/products/product-thumbnail"

export type ProductLineItem = {
  lineId?: string
  productCode: string
  name: string
  code: string
  article?: string
  categoryPath?: string
  imagePath?: string
  qty: number
  price: number
  bouquetId?: number | null
  bouquetName?: string
  bouquetGroupId?: string
  discountType?: DiscountType
  discountValue?: number
}

type ProductLineItemsProps = {
  items: ProductLineItem[]
  products?: Product[]
  disabled?: boolean
  emptyTitle?: string
  // null — без ограничения высоты (список скроллит родитель, напр. колонка кассы).
  maxHeightPx?: number | null
  onItemsChange: (items: ProductLineItem[]) => void
}

// Ширины «колонок» строки позиции. Одинаковые у шапки и у строк — за счёт этого суммы
// выстраиваются в столбцы без table-вёрстки, а в узком контейнере строка сама переносится.
// Сумма фиксированных колонок ≈ 836px (с отступами), поэтому однострочный режим включаем с 64rem
// (@5xl): на меньшей ширине на название товара не осталось бы места.
const CELL = {
  qty: "w-[9.5rem]",
  price: "w-24",
  discount: "w-[12.5rem]",
  before: "w-24",
  discountAmount: "w-20",
  total: "w-24",
  actions: "w-9",
}

export function lineFromProduct(product: Product): ProductLineItem {
  return {
    lineId: product.code,
    productCode: product.code,
    code: product.code,
    name: product.name,
    article: product.article,
    categoryPath: product.categoryPath,
    imagePath: product.imagePath,
    qty: 1,
    price: product.salePrice,
    discountType: "none",
    discountValue: 0,
  }
}

// Состав продажи/заказа. Вёрстка адаптивная по ШИРИНЕ КОНТЕЙНЕРА (@container), а не экрана:
// один и тот же компонент живёт и на кассе, и в узкой шторке заказа. Пока места хватает —
// позиция занимает одну строку-«таблицу»; как только контейнер уже 64rem (планшет), строка
// раскладывается в две: сверху товар, снизу количество/цена/скидка/итоги. Горизонтальной
// прокрутки нет ни в одном из режимов.
export function ProductLineItems({
  items,
  products,
  disabled,
  emptyTitle = "Позиции не выбраны",
  maxHeightPx = 520,
  onItemsChange,
}: ProductLineItemsProps) {
  const productByCode = new Map(products?.map((product) => [product.code, product]) ?? [])
  const groupedItems = groupProductLineItems(items)

  function updateItem(lineKey: string, patch: Partial<ProductLineItem>) {
    onItemsChange(
      items.map((item) => (getLineKey(item) === lineKey ? { ...item, ...patch } : item))
    )
  }

  function adjustQty(lineKey: string, delta: number) {
    const item = items.find((current) => getLineKey(current) === lineKey)
    if (!item) {
      return
    }
    updateItem(lineKey, { qty: clampQty(item.qty + delta) })
  }

  if (!items.length) {
    return (
      <Empty className="min-h-36 rounded-xl bg-muted/30 py-5">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>Добавьте товары из поиска склада.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="@container/lines min-w-0">
      <div
        className="min-w-0 overflow-x-hidden overflow-y-auto rounded-xl bg-muted/30"
        style={maxHeightPx === null ? undefined : { maxHeight: maxHeightPx }}
      >
        {/* Шапка колонок нужна только в однострочном режиме — в двухстрочном у полей свои подписи. */}
        <div className="sticky top-0 z-10 hidden items-center gap-2 border-b border-border/40 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground @5xl/lines:flex">
          <span className="min-w-0 flex-1">Товар</span>
          <span className={CELL.qty}>Кол-во</span>
          <span className={CELL.price}>Цена</span>
          <span className={CELL.discount}>Скидка</span>
          <span className={cn(CELL.before, "text-right")}>До скидки</span>
          <span className={cn(CELL.discountAmount, "text-right")}>Скидка</span>
          <span className={cn(CELL.total, "text-right")}>Итого</span>
          <span className={CELL.actions} />
        </div>

        <ul className="divide-y divide-border/40">
          {groupedItems.map((group) => {
            if (group.type === "bouquet") {
              const bouquetTotal = group.items.reduce((sum, item) => sum + calculateProductLineTotal(item).total, 0)
              const bouquetPrice = group.items.reduce((sum, item) => sum + item.price, 0)
              // Aggregate required qty per component code within the bouquet, then
              // compare to the on-hand stock to flag components short on stock.
              const requiredByCode = new Map<string, number>()
              for (const item of group.items) {
                const qty = Number.isFinite(item.qty) ? item.qty : 0
                requiredByCode.set(item.productCode, (requiredByCode.get(item.productCode) ?? 0) + qty)
              }
              const shortfallByCode = new Map<string, number>()
              for (const [code, requiredQty] of requiredByCode) {
                const shortfall = getShortfall(requiredQty, productByCode.get(code))
                if (shortfall > 0) {
                  shortfallByCode.set(code, shortfall)
                }
              }
              const bouquetShort = shortfallByCode.size > 0

              return (
                <li key={group.key} className="flex items-start gap-3 px-3 py-2.5">
                  {group.items.map((item) => (
                    <LineItemHiddenInputs key={getLineKey(item)} item={item} />
                  ))}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge variant="secondary">Букет</Badge>
                          <div className="truncate font-medium">
                            {group.bouquetName || "Букет"}
                          </div>
                          {bouquetShort && (
                            <InsufficientStockBadge label="Не хватает компонентов" />
                          )}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Цена букета {formatMoney(bouquetPrice)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Итого</div>
                        <div className="font-semibold tabular-nums">{formatMoney(bouquetTotal)}</div>
                      </div>
                    </div>
                    <div className="grid gap-1 rounded-lg bg-muted/50 p-2 text-sm">
                      {group.items.map((item) => {
                        const product = productByCode.get(item.productCode)
                        const componentShort = shortfallByCode.get(item.productCode) ?? 0
                        return (
                          <div key={getLineKey(item)} className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2">
                              <ProductThumbnail
                                name={item.name}
                                imagePath={product?.imagePath ?? item.imagePath}
                                size="xs"
                              />
                              <span className="min-w-0 truncate">{item.name}</span>
                              {componentShort > 0 && (
                                <InsufficientStockBadge label={`Не хватает: ${formatNumber(componentShort)}`} />
                              )}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              {formatNumber(item.qty)} шт
                              {product ? ` · остаток ${formatNumber(product.stock)}` : ""}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className={cn(CELL.actions, "shrink-0")}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Убрать букет"
                      disabled={disabled}
                      onClick={() =>
                        onItemsChange(items.filter((current) => current.bouquetGroupId !== group.key))
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              )
            }

            const item = group.item
            const product = productByCode.get(item.productCode)
            const shortfall = getShortfall(item.qty, product)
            const qtyInvalid = item.qty < 1 || !Number.isInteger(item.qty)
            const priceInvalid = item.price < 0
            const discountType = normalizeDiscountType(item.discountType)
            const discountValue = Number.isFinite(item.discountValue) ? Number(item.discountValue) : 0
            const discountInvalid = discountValue < 0
            const totals = calculateProductLineTotal({ ...item, discountType, discountValue })
            const lineKey = getLineKey(item)
            return (
              // flex-wrap + basis-full у товара: в узком контейнере товар занимает всю первую
              // строку, остальное переносится на вторую; с @5xl всё встаёт в одну линию.
              <li key={lineKey} className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5">
                {/* basis-full — товар занимает всю первую строку в узком контейнере. В широком
                    сокращение `flex-1` (flex: 1 1 0%) само сбрасывает basis, и колонка совпадает
                    по ширине с «Товар» в шапке; явный basis-auto здесь всё бы разъехал. */}
                <div className="flex min-w-0 basis-full items-start gap-2 @5xl/lines:flex-1">
                  <input type="hidden" name="itemProductCode" value={item.productCode} />
                  <input type="hidden" name="itemBouquetId" value="" />
                  <input type="hidden" name="itemBouquetName" value="" />
                  <input type="hidden" name="itemBouquetGroupId" value="" />
                  <ProductThumbnail
                    name={item.name}
                    imagePath={product?.imagePath ?? item.imagePath}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="line-clamp-2 font-medium leading-snug">{item.name}</div>
                    {item.article && (
                      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate">арт. {item.article}</span>
                      </div>
                    )}
                    {product && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Остаток {formatNumber(product.stock)}
                      </div>
                    )}
                    {shortfall > 0 && (
                      <div className="mt-1.5">
                        <InsufficientStockBadge label={`Не хватает: ${formatNumber(shortfall)}`} />
                      </div>
                    )}
                  </div>
                </div>

                <div className={cn(CELL.qty, "shrink-0")}>
                  <CellLabel>Кол-во</CellLabel>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Уменьшить количество"
                      disabled={disabled}
                      onClick={() => adjustQty(lineKey, -1)}
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
                        updateItem(lineKey, { qty: Number(event.target.value) })
                      }
                      required
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Увеличить количество"
                      disabled={disabled}
                      onClick={() => adjustQty(lineKey, 1)}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                  {qtyInvalid && <div className="mt-1 text-xs text-destructive">Кол-во от 1</div>}
                </div>

                <div className={cn(CELL.price, "shrink-0")}>
                  <CellLabel>Цена</CellLabel>
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
                      updateItem(lineKey, { price: Number(event.target.value) })
                    }
                    required
                  />
                  {item.price === 0 && (
                    <Badge className="mt-1 border-amber-200 bg-amber-50 text-amber-800">Цена 0</Badge>
                  )}
                  {priceInvalid && <div className="mt-1 text-xs text-destructive">Цена не ниже 0</div>}
                </div>

                <div className={cn(CELL.discount, "shrink-0")}>
                  <CellLabel>Скидка</CellLabel>
                  <div className="flex items-center gap-2">
                    <select
                      name="itemDiscountType"
                      aria-label="Тип скидки"
                      className="h-8 w-28 rounded-lg bg-muted/55 px-2 text-sm"
                      value={discountType}
                      disabled={disabled}
                      onChange={(event) =>
                        updateItem(lineKey, {
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
                      aria-label="Размер скидки"
                      type="number"
                      step="1"
                      min="0"
                      value={Number.isFinite(discountValue) ? discountValue : ""}
                      disabled={disabled}
                      readOnly={discountType === "none"}
                      aria-invalid={discountInvalid}
                      className={cn("w-20 text-right", discountInvalid && "border-destructive")}
                      onChange={(event) =>
                        updateItem(lineKey, { discountValue: Number(event.target.value) || 0 })
                      }
                    />
                  </div>
                  {discountInvalid && <div className="mt-1 text-xs text-destructive">Скидка не ниже 0</div>}
                </div>

                {/* Две колонки «до скидки» и «скидка» видны только в однострочном режиме: в
                    двухстрочном они не влезают во вторую строку, и та поехала бы на третью.
                    Их смысл там несёт подпись под «Итого». */}
                <div className={cn(CELL.before, "hidden shrink-0 text-right @5xl/lines:block")}>
                  <div className="font-medium tabular-nums">{formatMoney(totals.totalBeforeDiscount)}</div>
                </div>

                <div className={cn(CELL.discountAmount, "hidden shrink-0 text-right @5xl/lines:block")}>
                  <div className="tabular-nums text-muted-foreground">{formatMoney(totals.discountAmount)}</div>
                </div>

                <div className={cn(CELL.total, "ml-auto shrink-0 text-right @5xl/lines:ml-0")}>
                  <CellLabel className="text-right">Итого</CellLabel>
                  <div className="font-medium tabular-nums">{formatMoney(totals.total)}</div>
                  {totals.discountAmount > 0 && (
                    <div
                      className="text-[11px] leading-none whitespace-nowrap text-muted-foreground @5xl/lines:hidden"
                      title={`До скидки ${formatMoney(totals.totalBeforeDiscount)}`}
                    >
                      −{formatMoney(totals.discountAmount)}
                    </div>
                  )}
                </div>

                <div className={cn(CELL.actions, "shrink-0 text-right")}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Убрать позицию"
                    disabled={disabled}
                    onClick={() =>
                      onItemsChange(items.filter((current) => getLineKey(current) !== lineKey))
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// Подпись поля в двухстрочном режиме: в однострочном её заменяет шапка колонок.
function CellLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("mb-0.5 text-[11px] leading-none text-muted-foreground @5xl/lines:hidden", className)}>
      {children}
    </div>
  )
}

export function addProductToLineItems(items: ProductLineItem[], product: Product, qty = 1) {
  const existing = items.find((item) => item.productCode === product.code && !item.bouquetGroupId)
  if (existing) {
    const updated = { ...existing, qty: clampQty(existing.qty + qty) }
    return [
      updated,
      ...items.filter((item) => getLineKey(item) !== getLineKey(existing)),
    ]
  }

  return [{ ...lineFromProduct(product), qty: clampQty(qty) }, ...items]
}

export function addBouquetToLineItems(items: ProductLineItem[], bouquet: BouquetTemplate) {
  const bouquetGroupId = createBouquetGroupId(bouquet.id)
  const bouquetItems = bouquet.items.map((item, index) => ({
    lineId: `${bouquetGroupId}:${item.productCode}`,
    productCode: item.productCode,
    code: item.productCode,
    name: item.productName,
    imagePath: item.imagePath,
    qty: clampQty(item.qty),
    price: index === 0 ? bouquet.price : 0,
    bouquetId: bouquet.id,
    bouquetName: bouquet.name,
    bouquetGroupId,
    discountType: "none" as DiscountType,
    discountValue: 0,
  }))

  return [...bouquetItems, ...items]
}

export function getLineItemsTotal(items: ProductLineItem[]) {
  return items.reduce((sum, item) => sum + calculateProductLineTotal(item).total, 0)
}

export function getProductLineItemsForTotals(items: ProductLineItem[]) {
  return items.map((item) => ({
    qty: getPricingQty(item),
    price: item.price,
    discountType: item.discountType,
    discountValue: item.discountValue,
  }))
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

function LineItemHiddenInputs({
  item,
  includeEditableFields = true,
}: {
  item: ProductLineItem
  includeEditableFields?: boolean
}) {
  return (
    <>
      <input type="hidden" name="itemProductCode" value={item.productCode} />
      {includeEditableFields && (
        <>
          <input type="hidden" name="itemQty" value={item.qty} />
          <input type="hidden" name="itemPrice" value={item.price} />
          <input type="hidden" name="itemDiscountType" value={item.discountType ?? "none"} />
          <input type="hidden" name="itemDiscountValue" value={item.discountValue ?? 0} />
        </>
      )}
      <input type="hidden" name="itemBouquetId" value={item.bouquetId ?? ""} />
      <input type="hidden" name="itemBouquetName" value={item.bouquetName ?? ""} />
      <input type="hidden" name="itemBouquetGroupId" value={item.bouquetGroupId ?? ""} />
    </>
  )
}

function groupProductLineItems(items: ProductLineItem[]) {
  const groups: Array<
    | { type: "single"; key: string; item: ProductLineItem }
    | { type: "bouquet"; key: string; bouquetName: string; items: ProductLineItem[] }
  > = []
  const bouquetGroups = new Map<string, Extract<(typeof groups)[number], { type: "bouquet" }>>()

  for (const item of items) {
    const bouquetGroupId = item.bouquetGroupId
    if (!bouquetGroupId) {
      groups.push({ type: "single", key: getLineKey(item), item })
      continue
    }

    let group = bouquetGroups.get(bouquetGroupId)
    if (!group) {
      group = {
        type: "bouquet",
        key: bouquetGroupId,
        bouquetName: item.bouquetName ?? "",
        items: [],
      }
      bouquetGroups.set(bouquetGroupId, group)
      groups.push(group)
    }
    group.items.push(item)
  }

  return groups
}

function getLineKey(item: ProductLineItem) {
  return item.lineId || (item.bouquetGroupId ? `${item.bouquetGroupId}:${item.productCode}` : item.productCode)
}

function calculateProductLineTotal(item: ProductLineItem) {
  return calculateLineTotal({
    qty: getPricingQty(item),
    price: item.price,
    discountType: item.discountType,
    discountValue: item.discountValue,
  })
}

function getPricingQty(item: ProductLineItem) {
  return item.bouquetGroupId && item.price > 0 ? 1 : item.qty
}

function createBouquetGroupId(bouquetId: number) {
  return `bouquet-${bouquetId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

// Shortfall = requested qty above what is on hand. Returns 0 when there's no
// product data (we never warn on missing stock info) or stock is sufficient.
function getShortfall(requestedQty: number, product: Product | undefined) {
  if (!product) {
    return 0
  }

  const qty = Number.isFinite(requestedQty) ? requestedQty : 0
  const stock = Number.isFinite(product.stock) ? product.stock : 0
  return Math.max(0, qty - stock)
}

function InsufficientStockBadge({ label }: { label: string }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-200 bg-amber-50 text-amber-800"
    >
      <AlertTriangleIcon className="size-3" />
      {label}
    </Badge>
  )
}
