import Link from "next/link"
import { AccessDenied } from "@/components/access-denied"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { listStockDocuments, type StockDocumentStatus, type StockDocumentType } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function StockActsPage({ searchParams }: PageProps<"/stock/acts">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const params = await searchParams
  const type = String(params.type ?? "all")
  const status = String(params.status ?? "all")
  const query = String(params.query ?? "")
  const documents = listStockDocuments({ type, status, query })

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Акты склада</h1>
            <p className="text-sm text-muted-foreground">Проведенные пополнения и списания склада.</p>
          </div>
          <Link href="/stock" className={buttonVariants({ variant: "outline" })}>
            Вернуться на склад
          </Link>
        </div>

        <Card className="rounded-2xl border bg-white">
          <CardHeader>
            <CardTitle>Список актов</CardTitle>
            <CardDescription>Поиск по номеру и комментарию, фильтр по типу и статусу.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="grid gap-2 md:grid-cols-[1fr_220px_220px_auto]">
              <Input name="query" defaultValue={query} placeholder="Номер или комментарий" />
              <Select name="type" defaultValue={type}>
                <SelectTrigger>
                  <SelectValue placeholder="Тип" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">Все типы</SelectItem>
                    <SelectItem value="stock_in">Пополнение</SelectItem>
                    <SelectItem value="stock_out">Списание</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select name="status" defaultValue={status}>
                <SelectTrigger>
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">Все статусы</SelectItem>
                    <SelectItem value="draft">Черновик</SelectItem>
                    <SelectItem value="posted">Проведен</SelectItem>
                    <SelectItem value="cancelled">Отменен</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <button className={buttonVariants()} type="submit">
                Применить
              </button>
            </form>
            <div className="flex flex-wrap gap-2">
              <Link href="/stock/acts" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Все
              </Link>
              <Link href="/stock/acts?status=draft" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Черновики
              </Link>
              <Link href="/stock/acts?status=posted" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Проведенные
              </Link>
              <Link href="/stock/acts?status=cancelled" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Отмененные
              </Link>
              <Link href="/stock/acts?type=stock_in" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Пополнение
              </Link>
              <Link href="/stock/acts?type=stock_out" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Списание
              </Link>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Номер</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Поставщик</TableHead>
                    <TableHead>Дата операции</TableHead>
                    <TableHead>Создан</TableHead>
                    <TableHead>Проведен</TableHead>
                    <TableHead>Ответственный</TableHead>
                    <TableHead>Позиций</TableHead>
                    <TableHead>Комментарий</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                        Акты склада не найдены
                      </TableCell>
                    </TableRow>
                  ) : (
                    documents.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell className="font-medium">{document.number}</TableCell>
                        <TableCell>
                          <StockDocumentTypeBadge type={document.type} />
                        </TableCell>
                        <TableCell>
                          <StockDocumentStatusBadge status={document.status} />
                        </TableCell>
                        <TableCell>{document.supplierName || "-"}</TableCell>
                        <TableCell>{formatDateTime(document.operationAt ?? document.createdAt)}</TableCell>
                        <TableCell>{formatDateTime(document.createdAt)}</TableCell>
                        <TableCell>{document.postedAt ? formatDateTime(document.postedAt) : "-"}</TableCell>
                        <TableCell>{document.postedByName || document.createdByName || "не зафиксирован"}</TableCell>
                        <TableCell>{document.itemsCount}</TableCell>
                        <TableCell className="min-w-56">{document.comment || "-"}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/stock/acts/${document.id}`}
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

function stockDocumentTypeLabel(type: StockDocumentType) {
  return type === "stock_in" ? "Пополнение" : "Списание"
}

function StockDocumentTypeBadge({ type }: { type: StockDocumentType }) {
  const className =
    type === "stock_in"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50"
      : "border-red-200 bg-red-50 text-red-800 hover:bg-red-50"

  return (
    <Badge variant="outline" className={className}>
      {stockDocumentTypeLabel(type)}
    </Badge>
  )
}

function StockDocumentStatusBadge({ status }: { status: StockDocumentStatus }) {
  const labels: Record<StockDocumentStatus, string> = {
    draft: "Черновик",
    posted: "Проведен",
    cancelled: "Отменен",
  }
  const className =
    status === "posted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50"
      : status === "draft"
        ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50"
        : ""

  return (
    <Badge variant={status === "cancelled" ? "destructive" : "outline"} className={className}>
      {labels[status]}
    </Badge>
  )
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU")
}
