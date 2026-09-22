import Link from "next/link"
import { notFound } from "next/navigation"
import { AlertTriangleIcon } from "lucide-react"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getWarehouseImport, type WarehouseImportAction } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function WarehouseImportDetailsPage({ params }: PageProps<"/warehouse/imports/[id]">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const importId = Number(id)
  if (!Number.isInteger(importId) || importId <= 0) {
    notFound()
  }

  const report = getImportOrNull(importId)
  if (!report) {
    notFound()
  }

  const errorItems = report.items.filter((item) => item.action === "error")

  return (
    <CrmShell
      user={user}
      active="stock"
      title={`Импорт #${report.id}`}
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {report.filename || "Файл не указан"} · {formatDateTime(report.createdAt)}
        </p>
        <Link href="/warehouse/imports" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Все импорты
        </Link>
      </div>

      {errorItems.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>
            В импорте {errorItems.length} {pluralizeErrors(errorItems.length)} — импорт нельзя применить
          </AlertTitle>
          <AlertDescription>
            <p>Исправьте перечисленные строки в XLSX и загрузите файл снова.</p>
            <ul className="mt-2 flex w-full flex-col gap-1">
              {errorItems.map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5 rounded-md bg-destructive/5 px-2 py-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium">
                    Строка {item.rowNumber ?? "—"}
                    {item.code ? ` · ${item.code}` : ""}
                  </span>
                  <span className="min-w-0 break-words">{item.error || "Неизвестная ошибка"}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Создано" value={report.createdCount} />
        <SummaryCard label="Обновлено" value={report.updatedCount} />
        <SummaryCard label="Без изменений" value={report.unchangedCount} />
        <SummaryCard label="Ошибок" value={report.errorCount} highlight={report.errorCount > 0} />
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Отчет изменений</CardTitle>
          <CardDescription>
            Статус: {report.status === "applied" ? "применен" : report.status === "failed" ? "ошибка" : "предпросмотр"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Строка</TableHead>
                  <TableHead>Код</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead className="hidden lg:table-cell">Категория</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Было</TableHead>
                  <TableHead>Будет</TableHead>
                  <TableHead>Изменение</TableHead>
                  <TableHead className="hidden xl:table-cell">Старая цена</TableHead>
                  <TableHead className="hidden xl:table-cell">Новая цена</TableHead>
                  <TableHead className="hidden xl:table-cell">Старая закупка</TableHead>
                  <TableHead className="hidden xl:table-cell">Новая закупка</TableHead>
                  <TableHead>Ошибка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.items.map((item) => {
                  const isError = item.action === "error"
                  return (
                    <TableRow
                      key={item.id}
                      className={isError ? "border-l-2 border-l-destructive bg-destructive/5" : undefined}
                    >
                      <TableCell>{item.rowNumber ?? "-"}</TableCell>
                      <TableCell className="font-medium">{item.code || "-"}</TableCell>
                      <TableCell>{item.name || "-"}</TableCell>
                      <TableCell className="hidden max-w-64 truncate lg:table-cell" title={categoryLabel(item.categoryPath)}>
                        {categoryLabel(item.categoryPath)}
                      </TableCell>
                      <TableCell>
                        <ActionBadge action={item.action} />
                      </TableCell>
                      <TableCell>{formatNumber(item.oldStock)}</TableCell>
                      <TableCell>{formatNumber(item.newStock)}</TableCell>
                      <TableCell>
                        <Delta value={item.stockDelta} />
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">{formatNumber(item.oldSalePrice)}</TableCell>
                      <TableCell className="hidden xl:table-cell">{formatNumber(item.newSalePrice)}</TableCell>
                      <TableCell className="hidden xl:table-cell">{formatNumber(item.oldCostPrice)}</TableCell>
                      <TableCell className="hidden xl:table-cell">{formatNumber(item.newCostPrice)}</TableCell>
                      <TableCell className="min-w-48 break-words font-medium text-destructive">{item.error || ""}</TableCell>
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

function getImportOrNull(importId: number) {
  try {
    return getWarehouseImport(importId)
  } catch {
    return null
  }
}

function SummaryCard({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card className={highlight ? "rounded-2xl bg-destructive/5 ring-1 ring-destructive/30" : "rounded-2xl"}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={highlight ? "text-2xl text-destructive" : "text-2xl"}>{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function ActionBadge({ action }: { action: WarehouseImportAction }) {
  const labels: Record<WarehouseImportAction, string> = {
    create: "Новый товар",
    update: "Обновлен",
    unchanged: "Без изменений",
    error: "Ошибка",
  }
  const variant = action === "error" ? "destructive" : action === "unchanged" ? "outline" : "secondary"

  return <Badge variant={variant}>{labels[action]}</Badge>
}

function Delta({ value }: { value: number | null }) {
  if (!value) {
    return <span className="text-muted-foreground">0</span>
  }

  return (
    <span className={value > 0 ? "font-medium text-emerald-700" : "font-medium text-destructive"}>
      {value > 0 ? `+${formatNumber(value)}` : formatNumber(value)}
    </span>
  )
}

function formatNumber(value: number | null) {
  if (value === null) {
    return "-"
  }

  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function categoryLabel(value: string) {
  return value.trim() || "Без категории"
}

function pluralizeErrors(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return "ошибка"
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return "ошибки"
  }

  return "ошибок"
}

function formatDateTime(value: string) {
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}
