"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon } from "lucide-react"
import { toast } from "sonner"
import { createStockDocumentAction, saveStockDocumentDraftAction } from "@/app/actions"
import type { AllocationMethod, Product, StockDocument, Supplier } from "@/lib/db"
import { toDatetimeLocalValue } from "@/lib/datetime"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { StockActProductPicker } from "@/components/stock/stock-act-product-picker"
import {
  addProductToLines,
  documentLineFromItem,
  resolveDocumentLines,
  StockDocumentItemsTable,
  type DocumentLine,
} from "@/components/stock/stock-document-items-editor"
import { OverheadEditor } from "@/components/stock/overhead-editor"
import { SupplierSelect } from "@/components/stock/supplier-select"
import { Textarea } from "@/components/ui/textarea"

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
  const [negativeConfirm, setNegativeConfirm] = useState<{ formData: FormData } | null>(null)
  const [supplierId, setSupplierId] = useState(document.supplierId ? String(document.supplierId) : "none")
  const [operationAt, setOperationAt] = useState(() => toDatetimeLocalValue(document.operationAt))
  const isWriteOff = document.type === "stock_out"
  const [items, setItems] = useState<DocumentLine[]>(
    document.items.map((item) => {
      const product =
        products.find((candidate) => candidate.code === item.productCode) ??
        ({
          code: item.productCode,
          name: item.productName,
          article: "",
          categoryPath: "",
          unit: "шт",
          imagePath: "",
          stock: item.beforeStock ?? 0,
          reserved: 0,
          expected: 0,
          costPrice: 0,
          salePrice: 0,
          isActive: true,
          trackLots: false,
          vaseLifeDays: null,
          available: item.beforeStock ?? 0,
          updatedAt: "",
        } satisfies Product)
      return documentLineFromItem(item, product, isWriteOff)
    })
  )
  // Сумма и метод накладных — для живого предпросмотра себестоимости в таблице позиций.
  const [overheadState, setOverheadState] = useState<{ total: number; method: AllocationMethod }>(() => ({
    total: document.overheads.reduce((sum, overhead) => sum + overhead.amount, 0),
    method: document.allocationMethod,
  }))
  const operationAtLabel = isWriteOff ? "Дата и время списания" : "Дата и время приемки"

  const negativeLines = isWriteOff
    ? resolveDocumentLines(items, products, isWriteOff).filter((line) => line.afterStock < 0)
    : []

  function addProduct(product: Product) {
    const freshProduct = products.find((item) => item.code === product.code) ?? product
    setItems((current) => addProductToLines(current, freshProduct, isWriteOff))
  }

  function updateLine(productCode: string, patch: Partial<DocumentLine>) {
    setItems((current) =>
      current.map((item) => (item.product.code === productCode ? { ...item, ...patch } : item))
    )
  }

  function removeProduct(productCode: string) {
    setItems((current) => current.filter((item) => item.product.code !== productCode))
  }

  async function runSubmit(formData: FormData, intent: string) {
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

    if (intent === "post" && negativeLines.length > 0) {
      setNegativeConfirm({ formData })
      return
    }

    await runSubmit(formData, intent)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="documentId" value={document.id} />
      {document.correctsDocumentId != null && (
        <Alert className="border-indigo-200 bg-indigo-50 text-indigo-950">
          <AlertTriangleIcon />
          <AlertTitle>{isWriteOff ? "Корректировка акта списания" : "Корректировка приходного акта"}</AlertTitle>
          <AlertDescription>
            При проведении {isWriteOff ? "исходное списание будет откатано" : "исходный приход будет откатан"},
            а эти позиции — применены заново. Остатки в таблице уже учитывают откат исходного акта.
            {!isWriteOff && " Себестоимость при корректировке не пересчитывается автоматически."}
          </AlertDescription>
        </Alert>
      )}
      <Card className="rounded-2xl">
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
                <SupplierSelect
                  suppliers={suppliers}
                  value={supplierId}
                  onValueChange={setSupplierId}
                  disabled={pending}
                  triggerId="edit-stock-document-supplier"
                />
                {supplierId === "none" && <FieldDescription>Поставщик не указан.</FieldDescription>}
              </Field>
            )}
            {!isWriteOff && (
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="edit-stock-document-paid">Оплачено поставщику</FieldLabel>
                <Input
                  id="edit-stock-document-paid"
                  name="paidAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0"
                  defaultValue={document.paidAmount || ""}
                  disabled={pending}
                  className="tabular-nums"
                />
                <FieldDescription>
                  Долг поставщику в списке актов считается как стоимость товаров минус эта сумма.
                  Накладные расходы (доставка и т.п.) в долг не входят.
                </FieldDescription>
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
          </FieldGroup>
          {!isWriteOff && (
            <OverheadEditor
              initialOverheads={document.overheads}
              initialMethod={document.allocationMethod}
              disabled={pending}
              onStateChange={setOverheadState}
            />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Позиции акта</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Поиск — вплотную над таблицей позиций: добавленная строка появляется сразу под полем,
              иначе на ноутбуке она оказывается за сгибом. */}
          <StockActProductPicker
            products={products}
            disabled={pending}
            placeholder="Найти товар и добавить в акт"
            onSelect={addProduct}
          />
          <StockDocumentItemsTable
            items={items}
            products={products}
            isWriteOff={isWriteOff}
            pending={pending}
            overheadTotal={overheadState.total}
            allocationMethod={overheadState.method}
            emptyState={
              <div className="py-10 text-center text-sm text-muted-foreground">Позиции акта пока не добавлены</div>
            }
            onUpdate={updateLine}
            onRemove={removeProduct}
          />
          {negativeLines.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-950">
              <AlertTriangleIcon />
              <AlertTitle>После списания остаток уйдет в минус ({negativeLines.length})</AlertTitle>
              <AlertDescription>
                При проведении система запросит подтверждение. Проверьте количество перед проведением.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-zinc-50 py-3">
        <Button type="button" variant="ghost" disabled={pending} onClick={() => router.push(`/stock/acts/${document.id}`)}>
          Отмена
        </Button>
        <Button type="submit" name="intent" value="draft" variant="outline" disabled={pending}>
          Сохранить черновик
        </Button>
        <Button type="submit" name="intent" value="post" variant={isWriteOff ? "destructive" : "default"} disabled={pending}>
          Провести акт
        </Button>
      </div>

      <AlertDialog
        open={Boolean(negativeConfirm)}
        onOpenChange={(open) => {
          if (!open) {
            setNegativeConfirm(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Списать в минус?</AlertDialogTitle>
            <AlertDialogDescription>
              После проведения остаток уйдёт в минус по {negativeLines.length}{" "}
              {pluralizePositions(negativeLines.length)}. Проведённый акт необратим — отменить его можно только обратным актом.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
            <ul className="flex flex-col gap-1">
              {negativeLines.map((line) => (
                <li key={line.product.code} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{line.product.name}</span>
                  <span className="shrink-0 text-destructive">
                    {formatNumber(line.product.stock)} → {formatNumber(line.afterStock)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" disabled={pending} />}
              onClick={() => {
                if (!negativeConfirm) {
                  return
                }
                const { formData } = negativeConfirm
                setNegativeConfirm(null)
                void runSubmit(formData, "post")
              }}
            >
              Провести в минус
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

function pluralizePositions(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return "позиции"
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return "позициям"
  }

  return "позициям"
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
