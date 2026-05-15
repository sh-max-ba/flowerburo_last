import Link from "next/link"
import { AccessDenied } from "@/components/access-denied"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { listWarehouseImports } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function WarehouseImportsPage() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const imports = listWarehouseImports()

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">История импортов склада</h1>
            <p className="text-sm text-muted-foreground">Предпросмотры и примененные XLSX-импорты</p>
          </div>
          <Link href="/stock" className={buttonVariants({ variant: "outline" })}>
            Вернуться на склад
          </Link>
        </div>

        <Card className="rounded-2xl border bg-white">
          <CardHeader>
            <CardTitle>Импорты</CardTitle>
            <CardDescription>Отчеты сохраняются при предпросмотре и после применения.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Файл</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Строк</TableHead>
                    <TableHead>Создано</TableHead>
                    <TableHead>Обновлено</TableHead>
                    <TableHead>Без изменений</TableHead>
                    <TableHead>Ошибок</TableHead>
                    <TableHead>Провел</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                        Импортов пока нет
                      </TableCell>
                    </TableRow>
                  ) : (
                    imports.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{formatDateTime(item.createdAt)}</TableCell>
                        <TableCell className="font-medium">{item.filename || "-"}</TableCell>
                        <TableCell>
                          <ImportStatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>{item.totalRows}</TableCell>
                        <TableCell>{item.createdCount}</TableCell>
                        <TableCell>{item.updatedCount}</TableCell>
                        <TableCell>{item.unchangedCount}</TableCell>
                        <TableCell>{item.errorCount}</TableCell>
                        <TableCell>{item.createdByName || "не зафиксирован"}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/warehouse/imports/${item.id}`}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            Открыть
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function ImportStatusBadge({ status }: { status: string }) {
  const label = status === "applied" ? "Применен" : status === "failed" ? "Ошибка" : "Предпросмотр"
  const variant = status === "applied" ? "secondary" : status === "failed" ? "destructive" : "outline"

  return <Badge variant={variant}>{label}</Badge>
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU")
}
