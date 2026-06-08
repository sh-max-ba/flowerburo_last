import Link from "next/link"
import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { StockDocumentActions } from "@/components/stock/stock-document-actions"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { formatMoney } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getStockDocument, type StockDocumentStatus, type StockDocumentType } from "@/lib/db"
import { stockDocumentStatusLabel, stockDocumentTypeLabel } from "@/lib/labels"

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

        <Card className="rounded-2xl border bg-white">
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

        {document.status === "posted" && (
          <Card className="rounded-2xl border bg-white">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Проведенный акт нельзя редактировать. Для исправления создайте обратный акт.
            </CardContent>
          </Card>
        )}

        {document.status === "draft" && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/stock/acts/${document.id}/edit`} className={buttonVariants({ variant: "outline" })}>
              Редактировать
            </Link>
            <StockDocumentActions documentId={document.id} />
          </div>
        )}

        <Card className="rounded-2xl border bg-white">
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
                    const row = stockDocumentItemDisplay(document, item)

                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-xs text-muted-foreground">{item.productCode}</div>
                        </TableCell>
                        <TableCell>{formatNumber(item.qty)}</TableCell>
                        {isStockIn && (
                          <TableCell>
                            {item.unitCost > 0 ? formatMoney(item.unitCost) : "—"}
                            {item.costAfter != null && (
                              <div className="text-xs text-muted-foreground">
                                себест.: {formatMoney(item.costAfter)}
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

function stockDocumentOperationDateLabel(type: StockDocumentType) {
  return type === "stock_in" ? "Дата приемки" : "Дата списания"
}

function stockDocumentItemsDescription(status: StockDocumentStatus) {
  if (status === "posted") {
    return "Остатки зафиксированы на момент проведения акта."
  }

  if (status === "cancelled") {
    return "Акт отменен, склад не менялся. Значения рассчитаны по текущему остатку."
  }

  return "Для черновика значения рассчитаны по текущему остатку. При проведении акт пересчитает остатки заново."
}

function stockDocumentQuantityHeaders(status: StockDocumentStatus) {
  if (status === "posted") {
    return { before: "Было", after: "Стало" }
  }

  return { before: "Сейчас", after: "Ожидается" }
}

function stockDocumentItemDisplay(
  document: ReturnType<typeof getStockDocument>,
  item: ReturnType<typeof getStockDocument>["items"][number]
) {
  const delta = document.type === "stock_in" ? item.qty : -item.qty

  if (document.status === "posted") {
    return {
      delta,
      before: formatPostedNumber(item.beforeStock),
      after: formatPostedNumber(item.afterStock),
      afterClassName: "",
      willBeNegative: false,
    }
  }

  const currentStock = item.currentStock
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

function StockDocumentStatusBadge({ status }: { status: StockDocumentStatus }) {
  const className =
    status === "posted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50"
      : status === "draft"
        ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50"
        : ""

  return (
    <Badge variant={status === "cancelled" ? "destructive" : "outline"} className={className}>
      {stockDocumentStatusLabel(status)}
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
