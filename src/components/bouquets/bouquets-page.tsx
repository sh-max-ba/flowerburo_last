"use client"

import { useMemo, useState, useTransition } from "react"
import { AlertTriangleIcon, PencilIcon, PlusIcon, PowerIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  createBouquetTemplateAction,
  toggleBouquetTemplateActiveAction,
  updateBouquetTemplateAction,
} from "@/app/actions"
import type { BouquetTemplate, Product } from "@/lib/db"
import { getBouquetAvailability } from "@/lib/bouquet-availability"
import { cn, formatMoney } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { BouquetThumbnail } from "@/components/bouquets/bouquet-thumbnail"
import { ProductCombobox } from "@/components/products/product-combobox"
import { ProductThumbnail } from "@/components/products/product-thumbnail"

type BouquetDraftItem = {
  productCode: string
  productName: string
  imagePath: string
  stock: number
  qty: number
}

export function BouquetsPage({
  products,
  bouquets,
}: {
  products: Product[]
  bouquets: BouquetTemplate[]
}) {
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<BouquetTemplate | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [price, setPrice] = useState(0)
  const [isActive, setIsActive] = useState(true)
  const [items, setItems] = useState<BouquetDraftItem[]>([])
  const [imagePath, setImagePath] = useState("")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageVersion, setImageVersion] = useState(0)
  const [pending, startTransition] = useTransition()
  const productByCode = useMemo(() => new Map(products.map((product) => [product.code, product])), [products])
  const activeBouquets = useMemo(() => bouquets.filter((bouquet) => bouquet.isActive), [bouquets])
  const inactiveBouquets = useMemo(() => bouquets.filter((bouquet) => !bouquet.isActive), [bouquets])
  const draftAvailability = useMemo(() => getBouquetAvailability({ items }), [items])

  function openCreate() {
    setEditing(null)
    setName("")
    setDescription("")
    setPrice(0)
    setIsActive(true)
    setItems([])
    setImagePath("")
    setImageFile(null)
    setImageVersion(0)
    setSheetOpen(true)
  }

  function openEdit(bouquet: BouquetTemplate) {
    setEditing(bouquet)
    setName(bouquet.name)
    setDescription(bouquet.description)
    setPrice(bouquet.price)
    setIsActive(bouquet.isActive)
    setImagePath(bouquet.imagePath)
    setImageFile(null)
    setImageVersion(0)
    setItems(
      bouquet.items.map((item) => {
        const product = productByCode.get(item.productCode)
        return {
          productCode: item.productCode,
          productName: item.productName,
          imagePath: product?.imagePath ?? item.imagePath,
          stock: product?.stock ?? item.stock,
          qty: item.qty,
        }
      })
    )
    setSheetOpen(true)
  }

  async function uploadBouquetImage() {
    if (!editing || !imageFile) {
      return
    }

    const formData = new FormData()
    formData.set("file", imageFile)
    setUploadingImage(true)

    try {
      const response = await fetch(`/api/bouquets/${editing.id}/image`, {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json()) as { ok?: boolean; message?: string; imagePath?: string }
      if (!response.ok || !payload.ok || !payload.imagePath) {
        throw new Error(payload.message || "Фото букета не загружено.")
      }

      setImagePath(payload.imagePath)
      setImageFile(null)
      setImageVersion(Date.now())
      toast.success("Фото букета обновлено")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Фото букета не загружено.")
    } finally {
      setUploadingImage(false)
    }
  }

  function addProduct(product: Product) {
    setItems((current) => {
      const existing = current.find((item) => item.productCode === product.code)
      if (existing) {
        const updated = { ...existing, qty: existing.qty + 1 }
        return [updated, ...current.filter((item) => item.productCode !== product.code)]
      }

      return [
        {
          productCode: product.code,
          productName: product.name,
          imagePath: product.imagePath,
          stock: product.stock,
          qty: 1,
        },
        ...current,
      ]
    })
  }

  function updateQty(productCode: string, qty: number) {
    setItems((current) =>
      current.map((item) => (item.productCode === productCode ? { ...item, qty } : item))
    )
  }

  function removeItem(productCode: string) {
    setItems((current) => current.filter((item) => item.productCode !== productCode))
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) {
      toast.error("Укажите название букета.")
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Цена букета не может быть отрицательной.")
      return
    }
    if (!items.length) {
      toast.error("Добавьте хотя бы одну позицию в состав букета.")
      return
    }
    if (items.some((item) => !Number.isFinite(item.qty) || item.qty < 1 || !Number.isInteger(item.qty))) {
      toast.error("Количество в составе букета должно быть целым числом от 1.")
      return
    }

    const formData = new FormData(event.currentTarget)
    formData.set("name", normalizedName)
    formData.set("description", description.trim())
    formData.set("price", String(price))
    if (isActive) {
      formData.set("isActive", "on")
    } else {
      formData.delete("isActive")
    }

    startTransition(async () => {
      const result = editing
        ? await updateBouquetTemplateAction(editing.id, formData)
        : await createBouquetTemplateAction(formData)

      if (result.ok) {
        toast.success(result.message)
        setSheetOpen(false)
        setEditing(null)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function toggleActive(bouquet: BouquetTemplate) {
    startTransition(async () => {
      const result = await toggleBouquetTemplateActiveAction(bouquet.id)
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
      <div className="flex justify-end">
        <Button type="button" onClick={openCreate}>
          <PlusIcon data-icon="inline-start" />
          Новый букет
        </Button>
      </div>

      <Card className="rounded-2xl border bg-white">
        <CardHeader className="pb-3">
          <CardTitle>Список букетов</CardTitle>
          <CardDescription>Букет хранит состав и цену, но не является складской позицией.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs defaultValue="active" className="gap-3">
            <TabsList className="h-10 w-full justify-start rounded-xl bg-muted p-1 sm:w-fit">
              <TabsTrigger value="active">
                Активные
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-200/80 px-1 text-[11px] font-medium tabular-nums text-zinc-700">
                  {activeBouquets.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="inactive">
                Неактивные
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-200/80 px-1 text-[11px] font-medium tabular-nums text-zinc-700">
                  {inactiveBouquets.length}
                </span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="active">
              <BouquetsTable
                bouquets={activeBouquets}
                emptyTitle="Активных букетов пока нет"
                emptyDescription="Включите существующий букет или создайте новый шаблон."
                pending={pending}
                onEdit={openEdit}
                onToggleActive={toggleActive}
              />
            </TabsContent>
            <TabsContent value="inactive">
              <BouquetsTable
                bouquets={inactiveBouquets}
                emptyTitle="Неактивных букетов пока нет"
                emptyDescription="Выключенные букеты будут появляться здесь."
                pending={pending}
                onEdit={openEdit}
                onToggleActive={toggleActive}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-4xl">
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <SheetHeader>
              <SheetTitle>{editing ? "Редактировать букет" : "Новый букет"}</SheetTitle>
              <SheetDescription>Состав букета сохраняется как шаблон, склад при этом не меняется.</SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 px-4">
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                  <Field>
                    <FieldLabel htmlFor="bouquet-name">Название</FieldLabel>
                    <Input
                      id="bouquet-name"
                      name="name"
                      value={name}
                      disabled={pending}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="bouquet-price">Цена букета</FieldLabel>
                    <Input
                      id="bouquet-price"
                      name="price"
                      type="number"
                      min="0"
                      step="1"
                      value={Number.isFinite(price) ? price : ""}
                      disabled={pending}
                      onChange={(event) => setPrice(Number(event.target.value))}
                      required
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="bouquet-description">Описание</FieldLabel>
                  <Textarea
                    id="bouquet-description"
                    name="description"
                    rows={3}
                    value={description}
                    disabled={pending}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                <Field orientation="horizontal">
                  <Checkbox checked={isActive} disabled={pending} onCheckedChange={(checked) => setIsActive(Boolean(checked))} />
                  <FieldLabel>Активен</FieldLabel>
                </Field>

                <FieldSet>
                  <FieldLegend>Фото букета</FieldLegend>
                  <div className="flex items-start gap-3">
                    <BouquetThumbnail
                      name={name || editing?.name || "Букет"}
                      imagePath={imagePath}
                      size="xl"
                      cacheKey={imageVersion}
                    />
                    <Field className="min-w-0 flex-1">
                      <FieldLabel htmlFor="bouquet-image">Файл</FieldLabel>
                      <Input
                        id="bouquet-image"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={!editing || pending || uploadingImage}
                        onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                      />
                      <FieldDescription>
                        {editing ? "JPG, PNG или WEBP до 5 MB." : "Сначала сохраните букет, затем загрузите фото."}
                      </FieldDescription>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-fit"
                        disabled={!editing || !imageFile || pending || uploadingImage}
                        onClick={uploadBouquetImage}
                      >
                        <UploadIcon data-icon="inline-start" />
                        Загрузить фото
                      </Button>
                    </Field>
                  </div>
                </FieldSet>

                <FieldSet>
                  <FieldLegend>Состав букета</FieldLegend>
                  <ProductCombobox products={products} disabled={pending} portalDropdown onSelect={addProduct} />
                  {!draftAvailability.available && (
                    <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                      <AlertTriangleIcon />
                      <AlertTitle>Не хватает позиций</AlertTitle>
                      <AlertDescription className="text-amber-900">
                        <div className="mt-2 grid gap-1.5">
                          {draftAvailability.missingItems.map((item) => (
                            <div
                              key={item.productCode}
                              className="grid gap-1 rounded-md bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"
                            >
                              <span className="min-w-0 truncate font-medium">{item.productName}</span>
                              <span>нужно {formatNumber(item.requiredQty)}</span>
                              <span>остаток {formatNumber(item.stock)}</span>
                              <span>не хватает {formatNumber(item.missingQty)}</span>
                            </div>
                          ))}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                  {items.length === 0 ? (
                    <Empty className="min-h-32 rounded-lg border py-5">
                      <EmptyHeader>
                        <EmptyTitle>Состав пуст</EmptyTitle>
                        <EmptyDescription>Добавьте товары из поиска склада.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <ScrollArea className="rounded-lg border" style={{ height: Math.min(items.length * 78 + 16, 430) }}>
                      <div className="flex flex-col gap-2 p-2">
                        {items.map((item) => {
                          const qtyInvalid = item.qty < 1 || !Number.isInteger(item.qty)
                          const missingQty = Math.max(0, item.qty - item.stock)
                          return (
                            <div
                              key={item.productCode}
                              className={cn(
                                "grid gap-3 rounded-lg bg-background p-2 sm:grid-cols-[minmax(0,1fr)_120px_40px] sm:items-center",
                                missingQty > 0 && "border border-amber-200 bg-amber-50/60"
                              )}
                            >
                              <input type="hidden" name="itemProductCode" value={item.productCode} />
                              <div className="flex min-w-0 items-center gap-3">
                                <ProductThumbnail name={item.productName} imagePath={item.imagePath} size="sm" />
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{item.productName}</div>
                                  <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                    <span>{item.productCode}</span>
                                    <span>Остаток {formatNumber(item.stock)}</span>
                                    {missingQty > 0 && (
                                      <span className="font-medium text-amber-700">
                                        Не хватает {formatNumber(missingQty)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <Input
                                name="itemQty"
                                type="number"
                                min="1"
                                step="1"
                                value={Number.isFinite(item.qty) ? item.qty : ""}
                                disabled={pending}
                                aria-invalid={qtyInvalid}
                                className={cn("text-right", qtyInvalid && "border-destructive")}
                                onChange={(event) => updateQty(item.productCode, Number(event.target.value))}
                                required
                              />
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => removeItem(item.productCode)}
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </FieldSet>
              </FieldGroup>
            </div>

            <SheetFooter>
              <Button type="submit" disabled={pending || !items.length}>
                Сохранить
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function BouquetsTable({
  bouquets,
  emptyTitle,
  emptyDescription,
  pending,
  onEdit,
  onToggleActive,
}: {
  bouquets: BouquetTemplate[]
  emptyTitle: string
  emptyDescription: string
  pending: boolean
  onEdit: (bouquet: BouquetTemplate) => void
  onToggleActive: (bouquet: BouquetTemplate) => void
}) {
  if (!bouquets.length) {
    return (
      <Empty className="min-h-36 rounded-lg border py-6">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Фото</TableHead>
            <TableHead>Название</TableHead>
            <TableHead className="w-32">Цена</TableHead>
            <TableHead className="w-44">Статус</TableHead>
            <TableHead className="w-28">Компоненты</TableHead>
            <TableHead>Описание</TableHead>
            <TableHead className="w-36">Обновлен</TableHead>
            <TableHead className="w-40 text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bouquets.map((bouquet) => {
            const availability = getBouquetAvailability(bouquet)

            return (
              <TableRow key={bouquet.id}>
                <TableCell>
                  <BouquetThumbnail name={bouquet.name} imagePath={bouquet.imagePath} size="lg" />
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate">{bouquet.name}</span>
                    {!availability.available && (
                      <span className="text-xs font-medium text-amber-700">
                        Не хватает: {availability.missingItems.length} поз.
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{formatMoney(bouquet.price)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    <BouquetStatusBadge isActive={bouquet.isActive} />
                    {!availability.available && (
                      <Badge className="border-amber-200 bg-amber-50 text-amber-800">
                        Не хватает позиций
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{bouquet.itemsCount}</TableCell>
                <TableCell className="max-w-80">
                  <span className="line-clamp-2 text-sm text-muted-foreground">
                    {bouquet.description || "-"}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDateTime(bouquet.updatedAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button type="button" size="icon-sm" variant="ghost" disabled={pending} onClick={() => onEdit(bouquet)}>
                      <PencilIcon />
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onToggleActive(bouquet)}>
                      <PowerIcon data-icon="inline-start" />
                      {bouquet.isActive ? "Выключить" : "Включить"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function BouquetStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        isActive
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }
    >
      {isActive ? "Активен" : "Выключен"}
    </Badge>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function formatDateTime(value: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
