import Link from "next/link"
import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { StockDocumentActions } from "@/components/stock/stock-document-actions"
import { CreateStockCorrectionButton } from "@/components/stock/create-stock-correction-button"
import { StockDocumentStatusBadge } from "@/components/stock/document-badges"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { formatMoney } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getDraftCorrectionId, getStockDocument, type StockDocumentStatus, type StockDocumentType } from "@/lib/db"
import {
  allocationMethodLabel,
  stockDocumentTypeLabel,
  stockOverheadKindLabel,
} from "@/lib/labels"

export const dynamic = "force-dynamic"

export default async function StockActDetailsPage({ params }: PageProps<"/stock/acts/[id]">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const documentId = Number(id)
  if (!Number.isInteger(documentId) || documentId <= 0) {
    notFound()
  }

  const document = getStockDocumentOrNull(documentId)
  if (!document) {
    notFound()
  }
  const quantityHeaders = stockDocumentQuantityHeaders(document.status)
  const isStockIn = document.type === "stock_in"
  // Уже начатая корректировка этого акта: кнопка «Редактировать» ведёт в неё, а не создаёт вторую.
  const draftCorrectionId =
    document.status === "posted" && document.type !== "count" ? getDraftCorrectionId(document.id) : null
  // Для черновика корректировки предпросмотр «Сейчас/Ожидается» считает от остатка с учётом отката
  // исходного акта — именно так проведение и пересчитает склад.
  const revertDeltas = getCorrectionRevertDeltas(document)

  return (
    <CrmShell
      user={user}
      active="stock-acts"
      title={`Акт ${document.number}`}
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <div className="flex justify-end">
        <Link href="/stock/acts" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Все акты
        </Link>
      </div>

        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>Детали акта</CardTitle>
                <CardDescription>{document.comment || "Комментарий не указан"}</CardDescription>
              </div>
              <StockDocumentStatusBadge status={document.status} />
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <Info label="Тип" value={stockDocumentTypeLabel(document.type)} />
            <Info
              label={stockDocumentOperationDateLabel(document.type)}
              value={formatDateTime(document.operationAt ?? document.createdAt)}
            />
            <Info label="Дата создания" value={formatDateTime(document.createdAt)} />
            <Info label="Создал" value={document.createdByName || "не зафиксирован"} />
            <Info label="Поставщик" value={document.supplierName || "-"} />
            <Info label="Дата проведения" value={document.postedAt ? formatDateTime(document.postedAt) : "-"} />
            <Info label="Провел" value={document.postedByName || "-"} />
            <Info label="Позиций" value={String(document.itemsCount)} />
          </CardContent>
        </Card>

        {document.correctsDocumentId != null && (
          <Card className="rounded-2xl border border-indigo-200 bg-indigo-50/40">
            <CardContent className="pt-6 text-sm">
              Корректировка{" "}
              <Link href={`/stock/acts/${document.correctsDocumentId}`} className="font-medium underline">
                исходного акта
              </Link>
              . Проведение откатит {isStockIn ? "исходный приход" : "исходное списание"} и применит
              исправленные позиции.
            </CardContent>
          </Card>
        )}

        {document.status === "posted" && document.type !== "count" && document.correctedByDocumentId == null && (
          <Card className="rounded-2xl">
            <CardContent className="flex flex-col items-start gap-3 pt-6">
              <p className="text-sm text-muted-foreground">
                Изменения проведённого акта оформляются корректировкой: она откатит{" "}
                {isStockIn ? "этот приход" : "это списание"} и применит исправленные позиции, а исходный акт
                останется в истории со статусом «Скорректирован».
                {isStockIn ? " Себестоимость при корректировке не пересчитывается автоматически." : ""}
              </p>
              {draftCorrectionId != null ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/stock/acts/${draftCorrectionId}/edit`} className={buttonVariants()}>
                    Продолжить редактирование
                  </Link>
                  <span className="text-xs text-muted-foreground">Черновик корректировки уже создан.</span>
                </div>
              ) : (
                <CreateStockCorrectionButton documentId={document.id} />
              )}
            </CardContent>
          </Card>
        )}

        {document.status === "posted" && document.type === "count" && (
          <Card className="rounded-2xl">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Проведённую инвентаризацию нельзя редактировать. Если остатки посчитаны неверно — проведите
              новую инвентаризацию.
            </CardContent>
          </Card>
        )}

        {document.status === "corrected" && (
          <Card className="rounded-2xl">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Акт скорректирован.
              {document.correctedByDocumentId != null && (
                <>
                  {" "}
                  <Link
                    href={`/stock/acts/${document.correctedByDocumentId}`}
                    className="font-medium text-foreground underline"
                  >
                    Открыть корректировку
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Инвентаризация живёт в своём разделе: общий редактор/проведение актов для неё
            заблокированы на сервере, кнопки здесь были бы тупиковыми. */}
        {document.status === "draft" && document.type === "count" && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/stock/inventory/${document.id}`} className={buttonVariants({ variant: "outline" })}>
              Открыть в разделе «Инвентаризация»
            </Link>
          </div>
        )}

        {document.status === "draft" && document.type !== "count" && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/stock/acts/${document.id}/edit`} className={buttonVariants({ variant: "outline" })}>
              Редактировать
            </Link>
            <StockDocumentActions documentId={document.id} />
          </div>
        )}

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Позиции</CardTitle>
            <CardDescription>{stockDocumentItemsDescription(document.status)}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Товар</TableHead>
                    <TableHead>Кол-во</TableHead>
                    {isStockIn && <TableHead>Цена закупки</TableHead>}
                    <TableHead>Изменение</TableHead>
                    <TableHead>{quantityHeaders.before}</TableHead>
                    <TableHead>{quantityHeaders.after}</TableHead>
                    <TableHead>Комментарий</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {document.items.map((item) => {
                    const row = stockDocumentItemDisplay(document, item, revertDeltas.get(item.productCode) ?? 0)

                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-xs text-muted-foreground">{item.productCode}</div>
                        </TableCell>
                        <TableCell>
                          {formatNumber(item.qty)}
                          {isStockIn && item.defectQty > 0 && (
                            <div className="text-xs text-amber-700">брак: {formatNumber(item.defectQty)}</div>
                          )}
                        </TableCell>
                        {isStockIn && (
                          <TableCell>
                            {item.unitCost > 0 ? formatMoney(item.unitCost) : "—"}
                            {item.allocatedOverhead > 0 && (
                              <div className="text-xs text-muted-foreground">
                                + накл.: {formatMoney(item.allocatedOverhead)}
                              </div>
                            )}
                            {/* Себестоимость единицы годного (с браком и накладными) — если отличается от цены. */}
                            {item.landedUnitCost != null && formatMoney(item.landedUnitCost) !== formatMoney(item.unitCost) && (
                              <div className="text-xs font-medium text-amber-700">
                                себест. ед.: {formatMoney(item.landedUnitCost)}
                              </div>
                            )}
                            {item.costAfter != null && (
                              <div className="text-xs text-muted-foreground">
                                себест. остатка: {formatMoney(item.costAfter)}
                              </div>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <DeltaBadge value={row.delta} />
                        </TableCell>
                        <TableCell>{row.before}</TableCell>
                        <TableCell>
                          <span className={row.afterClassName}>{row.after}</span>
                          {row.willBeNegative && (
                            <Badge className="ml-2 border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50">
                              Будет минус
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="min-w-48">{item.comment || "-"}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {isStockIn && document.overheadTotal > 0 && (
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>Накладные расходы</CardTitle>
              <CardDescription>Распределение: {allocationMethodLabel(document.allocationMethod)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1 text-sm">
                {document.overheads.map((overhead) => (
                  <li key={overhead.id} className="flex items-center justify-between gap-3">
                    <span>
                      {stockOverheadKindLabel(overhead.kind)}
                      {overhead.label ? ` — ${overhead.label}` : ""}
                    </span>
                    <span className="font-medium">{formatMoney(overhead.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-1 border-t pt-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Стоимость товаров</span>
                  <span>{formatMoney(document.goodsTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Накладные расходы</span>
                  <span>{formatMoney(document.overheadTotal)}</span>
                </div>
                <div className="flex items-center justify-between font-semibold">
                  <span>Итого с расходами</span>
                  <span>{formatMoney(document.landedTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isStockIn && (
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>Расчёты с поставщиком</CardTitle>
              <CardDescription>
                Долг считается только по проведённому приходу: стоимость товаров минус оплаченное.
                Накладные расходы в долг не входят.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Стоимость товаров</span>
                  <span className="tabular-nums">{formatMoney(document.goodsTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Оплачено поставщику</span>
                  <span className="tabular-nums">{formatMoney(document.paidAmount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Сумма доставки</span>
                  <span className="tabular-nums">{formatMoney(document.deliveryTotal)}</span>
                </div>
                <div className="flex items-center justify-between border-t pt-2 font-semibold">
                  <span>Долг поставщику</span>
                  <span className={document.supplierDebt > 0 ? "tabular-nums text-orange-600" : "tabular-nums"}>
                    {formatMoney(document.supplierDebt)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
    </CrmShell>
  )
}

function getStockDocumentOrNull(documentId: number) {
  try {
    return getStockDocument(documentId)
  } catch {
    return null
  }
}

// Дельта отката исходного акта по товарам (для черновика корректировки): приход заносил годное
// (qty − брак) → откат его снимет; списание уводило qty → откат вернёт. Пустая карта — не корректировка
// или исходный уже не проведён (тогда и проведение не пройдёт, показываем без поправки).
function getCorrectionRevertDeltas(document: ReturnType<typeof getStockDocument>): Map<string, number> {
  const deltas = new Map<string, number>()
  if (document.status !== "draft" || document.correctsDocumentId == null) {
    return deltas
  }
  const original = getStockDocumentOrNull(document.correctsDocumentId)
  if (!original || original.status !== "posted") {
    return deltas
  }
  for (const item of original.items) {
    const delta = original.type === "stock_in" ? -(item.qty - item.defectQty) : item.qty
    deltas.set(item.productCode, (deltas.get(item.productCode) ?? 0) + delta)
  }

  return deltas
}

function stockDocumentOperationDateLabel(type: StockDocumentType) {
  if (type === "count") {
    return "Дата инвентаризации"
  }
  return type === "stock_in" ? "Дата приемки" : "Дата списания"
}

function stockDocumentItemsDescription(status: StockDocumentStatus) {
  if (status === "posted") {
    return "Остатки зафиксированы на момент проведения акта."
  }

  if (status === "corrected") {
    return "Остатки зафиксированы на момент проведения. Акт скорректирован — действующие позиции смотрите в корректировке."
  }

  if (status === "cancelled") {
    return "Акт отменен, склад не менялся. Значения рассчитаны по текущему остатку."
  }

  return "Для черновика значения рассчитаны по текущему остатку. При проведении акт пересчитает остатки заново."
}

function stockDocumentQuantityHeaders(status: StockDocumentStatus) {
  if (status === "posted" || status === "corrected") {
    return { before: "Было", after: "Стало" }
  }

  return { before: "Сейчас", after: "Ожидается" }
}

function stockDocumentItemDisplay(
  document: ReturnType<typeof getStockDocument>,
  item: ReturnType<typeof getStockDocument>["items"][number],
  revertDelta = 0
) {
  // У инвентаризации qty — УЖЕ подписанная дельта проведения (+излишек/−недостача),
  // негирование переворачивало знак: излишек +3 показывался красным «−3».
  // Приход: на склад заходит только годное (qty − брак) — дельта без брака.
  const delta =
    document.type === "stock_in"
      ? item.qty - (item.defectQty > 0 ? item.defectQty : 0)
      : document.type === "count"
        ? item.qty
        : -item.qty

  // Скорректированный акт был проведён — показываем его зафиксированные снимки, а не «предпросмотр»
  // от текущего остатка (тот пугал бы ложным «Будет минус» на историческом документе).
  if (document.status === "posted" || document.status === "corrected") {
    return {
      delta,
      before: formatPostedNumber(item.beforeStock),
      after: formatPostedNumber(item.afterStock),
      afterClassName: "",
      willBeNegative: false,
    }
  }

  const currentStock = item.currentStock === null ? null : item.currentStock + revertDelta
  const expectedAfterStock = currentStock === null ? null : currentStock + delta
  const willBeNegative = document.type === "stock_out" && expectedAfterStock !== null && expectedAfterStock < 0

  return {
    delta,
    before: currentStock === null ? "Товар не найден" : formatNumber(currentStock),
    after: expectedAfterStock === null ? "Товар не найден" : formatNumber(expectedAfterStock),
    afterClassName: willBeNegative ? "font-medium text-amber-700" : document.type === "stock_in" ? "font-medium text-emerald-700" : "",
    willBeNegative,
  }
}

function DeltaBadge({ value }: { value: number }) {
  const className =
    value > 0
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50"
      : value < 0
        ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-50"
        : ""

  return (
    <Badge variant="outline" className={className}>
      {value > 0 ? `+${formatNumber(value)}` : formatNumber(value)}
    </Badge>
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

function formatPostedNumber(value: number | null) {
  return value === null ? "Не зафиксировано" : formatNumber(value)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function formatDateTime(value: string) {
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}
