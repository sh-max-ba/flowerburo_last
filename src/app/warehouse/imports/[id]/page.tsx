import Link from "next/link"
import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Импорт #{report.id}</h1>
            <p className="text-sm text-muted-foreground">
              {report.filename || "Файл не указан"} · {formatDateTime(report.createdAt)}
            </p>
          </div>
          <Link href="/warehouse/imports" className={buttonVariants({ variant: "outline" })}>
            Все импорты
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard label="Создано" value={report.createdCount} />
          <SummaryCard label="Обновлено" value={report.updatedCount} />
          <SummaryCard label="Без изменений" value={report.unchangedCount} />
          <SummaryCard label="Ошибок" value={report.errorCount} />
        </div>

        <Card className="rounded-2xl border bg-white">
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
                    <TableHead>Категория</TableHead>
                    <TableHead>Действие</TableHead>
                    <TableHead>Было</TableHead>
                    <TableHead>Будет</TableHead>
                    <TableHead>Изменение</TableHead>
                    <TableHead>Старая цена</TableHead>
                    <TableHead>Новая цена</TableHead>
                    <TableHead>Старая закупка</TableHead>
                    <TableHead>Новая закупка</TableHead>
                    <TableHead>Ошибка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.rowNumber ?? "-"}</TableCell>
                      <TableCell className="font-medium">{item.code || "-"}</TableCell>
                      <TableCell>{item.name || "-"}</TableCell>
                      <TableCell className="max-w-64 truncate" title={categoryLabel(item.categoryPath)}>
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
                      <TableCell>{formatNumber(item.oldSalePrice)}</TableCell>
                      <TableCell>{formatNumber(item.newSalePrice)}</TableCell>
                      <TableCell>{formatNumber(item.oldCostPrice)}</TableCell>
                      <TableCell>{formatNumber(item.newCostPrice)}</TableCell>
                      <TableCell className="min-w-48 text-destructive">{item.error || ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function getImportOrNull(importId: number) {
  try {
    return getWarehouseImport(importId)
  } catch {
    return null
  }
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="rounded-2xl border bg-white">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
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

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU")
}
