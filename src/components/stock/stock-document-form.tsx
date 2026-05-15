"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { createStockDocumentAction, saveStockDocumentDraftAction } from "@/app/actions"
import type { Product, StockDocument, Supplier } from "@/lib/db"
import { toDatetimeLocalValue } from "@/lib/datetime"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { StockActProductPicker } from "@/components/stock/stock-act-product-picker"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

type Line = {
  product: Product
  qty: string
  comment: string
}

type Result = Awaited<ReturnType<typeof saveStockDocumentDraftAction>>

export function StockDocumentForm({
  document,
  products,
  suppliers,
}: {
  document: StockDocument
  products: Product[]
  suppliers: Supplier[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [supplierId, setSupplierId] = useState(document.supplierId ? String(document.supplierId) : "none")
  const [operationAt, setOperationAt] = useState(() => toDatetimeLocalValue(document.operationAt))
  const [items, setItems] = useState<Line[]>(
    document.items.map((item) => ({
      product:
        products.find((product) => product.code === item.productCode) ??
        ({
          code: item.productCode,
          name: item.productName,
          article: "",
          categoryPath: "",
          unit: "шт",
          stock: item.beforeStock ?? 0,
          reserved: 0,
          expected: 0,
          costPrice: 0,
          salePrice: 0,
          available: item.beforeStock ?? 0,
          updatedAt: "",
        } satisfies Product),
      qty: String(item.qty),
      comment: item.comment,
    }))
  )
  const isWriteOff = document.type === "stock_out"
  const operationAtLabel = isWriteOff ? "Дата и время списания" : "Дата и время приемки"

  function addProduct(product: Product) {
    const freshProduct = products.find((item) => item.code === product.code) ?? product
    setItems((current) => {
      const existing = current.find((item) => item.product.code === freshProduct.code)
      if (existing) {
        return current.map((item) =>
          item.product.code === freshProduct.code
            ? { ...item, product: freshProduct, qty: String(Number(item.qty || 0) + 1) }
            : item
        )
      }

      return [...current, { product: freshProduct, qty: "1", comment: "" }]
    })
  }

  function updateQty(productCode: string, qty: string) {
    setItems((current) =>
      current.map((item) => (item.product.code === productCode ? { ...item, qty } : item))
    )
  }

  function updateComment(productCode: string, comment: string) {
    setItems((current) =>
      current.map((item) => (item.product.code === productCode ? { ...item, comment } : item))
    )
  }

  function removeProduct(productCode: string) {
    setItems((current) => current.filter((item) => item.product.code !== productCode))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const intent = submitter instanceof HTMLButtonElement ? submitter.value : "post"

    if (!items.length) {
      toast.error("Добавьте в акт хотя бы один товар.")
      return
    }

    for (const item of items) {
      const qty = Number(item.qty)
      if (!Number.isInteger(qty) || qty < 1) {
        toast.error("Количество должно быть целым числом от 1.")
        return
      }
    }

    const formData = new FormData(event.currentTarget)
    setPending(true)
    const result: Result =
      intent === "draft"
        ? await saveStockDocumentDraftAction(document.type, formData)
        : await createStockDocumentAction(document.type, formData)
    setPending(false)

    if (result.ok) {
      toast.success(result.message)
      router.push(`/stock/acts/${document.id}`)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="documentId" value={document.id} />
      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <CardTitle>Редактирование черновика</CardTitle>
          <CardDescription>Перед проведением остатки будут пересчитаны по актуальному остатку из базы.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Info label="Номер" value={document.number} />
            <Info label="Тип" value={isWriteOff ? "Списание" : "Пополнение"} />
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="edit-stock-document-operation-at">{operationAtLabel}</FieldLabel>
              <Input
                id="edit-stock-document-operation-at"
                name="operationAt"
                type="datetime-local"
                value={operationAt}
                disabled={pending}
                onChange={(event) => setOperationAt(event.target.value)}
              />
            </Field>
            {!isWriteOff && (
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="edit-stock-document-supplier">Поставщик</FieldLabel>
                <input type="hidden" name="supplierId" value={supplierId === "none" ? "" : supplierId} />
                <Select value={supplierId} onValueChange={(value) => setSupplierId(value ?? "none")}>
                  <SelectTrigger id="edit-stock-document-supplier" className="w-full" disabled={pending}>
                    <SelectValue placeholder="Без поставщика" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">Без поставщика</SelectItem>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={String(supplier.id)}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {supplierId === "none" && <FieldDescription>Поставщик не указан.</FieldDescription>}
              </Field>
            )}
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-stock-document-comment">Комментарий / основание</FieldLabel>
              <Textarea
                id="edit-stock-document-comment"
                name="comment"
                defaultValue={document.comment}
                disabled={pending}
              />
            </Field>
            <Field>
              <FieldLabel>Поиск товара</FieldLabel>
              <StockActProductPicker
                products={products}
                disabled={pending}
                placeholder="Найти товар и добавить в акт"
                onSelect={addProduct}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <CardTitle>Позиции акта</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Позиции акта пока не добавлены</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <ScrollArea style={{ height: Math.min(items.length * 90 + 48, 420) }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-64">Товар</TableHead>
                      <TableHead className="w-28">Остаток</TableHead>
                      <TableHead className="w-32">Qty</TableHead>
                      <TableHead className="w-36">После</TableHead>
                      <TableHead className="min-w-44">Комментарий</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const product = products.find((candidate) => candidate.code === item.product.code) ?? item.product
                      const qty = Number(item.qty || 0)
                      const afterStock = product.stock + (isWriteOff ? -qty : qty)

                      return (
                        <TableRow key={product.code}>
                          <TableCell>
                            <input type="hidden" name="itemProductCode" value={product.code} />
                            <div className="font-medium">{product.name}</div>
                            <div className="text-xs text-muted-foreground">{product.code}</div>
                          </TableCell>
                          <TableCell>{formatNumber(product.stock)}</TableCell>
                          <TableCell>
                            <Input
                              name="itemQty"
                              type="number"
                              min="1"
                              step="1"
                              value={item.qty}
                              disabled={pending}
                              onChange={(event) => updateQty(product.code, event.target.value)}
                              required
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span>{formatNumber(afterStock)}</span>
                              {isWriteOff && afterStock < 0 && (
                                <Badge className="border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50">
                                  Будет минус
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              name="itemComment"
                              value={item.comment}
                              disabled={pending}
                              onChange={(event) => updateComment(product.code, event.target.value)}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={pending}
                              onClick={() => removeProduct(product.code)}
                            >
                              <Trash2Icon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
          {isWriteOff && items.some((item) => item.product.stock - Number(item.qty || 0) < 0) && (
            <Alert className="mt-4 border-amber-200 bg-amber-50 text-amber-950">
              <AlertTriangleIcon />
              <AlertTitle>После списания остаток уйдет в минус</AlertTitle>
              <AlertDescription>Операция разрешена, но проверьте количество перед проведением.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-zinc-50 py-3">
        <Button type="button" variant="outline" disabled={pending} onClick={() => router.push(`/stock/acts/${document.id}`)}>
          Отмена
        </Button>
        <Button type="submit" name="intent" value="draft" variant="outline" disabled={pending}>
          Сохранить черновик
        </Button>
        <Button type="submit" name="intent" value="post" variant={isWriteOff ? "destructive" : "default"} disabled={pending}>
          Провести акт
        </Button>
      </div>
    </form>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}
