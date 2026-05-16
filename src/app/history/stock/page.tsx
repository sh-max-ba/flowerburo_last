import Link from "next/link"
import { AccessDenied } from "@/components/access-denied"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getHistoryReportData, type Movement } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function StockMovementsPage() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const report = getHistoryReportData()

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
        <PageHeader
          title="Движения склада"
          description="Поступления, списания, импорт и списания по заказам"
          actions={
            <Link href="/stock" className={buttonVariants({ variant: "outline" })}>
              Вернуться на склад
            </Link>
          }
        />

        <Card className="rounded-2xl border bg-white">
          <CardHeader>
            <CardTitle>История движений</CardTitle>
            <CardDescription>Изменения количества товаров без резервов.</CardDescription>
          </CardHeader>
          <CardContent>
            {report.stockMovements.length === 0 ? (
              <Empty className="min-h-56">
                <EmptyHeader>
                  <EmptyTitle>История склада пуста</EmptyTitle>
                  <EmptyDescription>Движения появятся после продаж, актов или импорта.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Товар</TableHead>
                    <TableHead>Кол-во</TableHead>
                    <TableHead>Остаток</TableHead>
                    <TableHead>Связь</TableHead>
                    <TableHead>Провел</TableHead>
                    <TableHead>Комментарий</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.stockMovements.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell>{formatDateTime(movement.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{movementLabel(movement)}</Badge>
                        </TableCell>
                        <TableCell>{movement.productName || movement.productCode || "-"}</TableCell>
                        <TableCell>{signedNumber(movement.qty)}</TableCell>
                        <TableCell>{movementRange(movement.beforeStock, movement.afterStock)}</TableCell>
                        <TableCell>{movementSource(movement)}</TableCell>
                        <TableCell>{movement.userName || "не зафиксирован"}</TableCell>
                        <TableCell className="min-w-64">{movement.note || "-"}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function movementLabel(movement: Movement) {
  if (movement.type === "adjustment" && typeof movement.qty === "number") {
    if (movement.qty > 0) {
      return "Поступление"
    }

    if (movement.qty < 0) {
      return "Списание"
    }

    return "Корректировка"
  }

  const labels: Record<string, string> = {
    import: "Импорт",
    stock_in: "Пополнение по акту",
    stock_out: "Списание по акту",
    sale: "Реализация",
    order_fulfill: "Реализация заказа",
  }

  return labels[movement.type] ?? movement.type
}

function movementRange(beforeValue: number | null, afterValue: number | null) {
  if (beforeValue === null && afterValue === null) {
    return "-"
  }

  return `${beforeValue === null ? "-" : formatNumber(beforeValue)} -> ${
    afterValue === null ? "-" : formatNumber(afterValue)
  }`
}

function signedNumber(value: number | null) {
  if (value === null) {
    return "-"
  }

  const formatted = formatNumber(value)
  return value > 0 ? `+${formatted}` : formatted
}

function movementSource(movement: Movement) {
  if (movement.saleId !== null) {
    return `Продажа #${movement.saleId}`
  }

  if (movement.orderId !== null) {
    return `Заказ #${movement.orderId}`
  }

  if (movement.shiftId !== null) {
    return `Смена #${movement.shiftId}`
  }

  if (movement.documentId !== null) {
    const label = movement.documentNumber ? `Акт ${movement.documentNumber}` : `Акт #${movement.documentId}`

    return (
      <Link href={`/stock/acts/${movement.documentId}`} className="font-medium underline-offset-4 hover:underline">
        {label}
      </Link>
    )
  }

  return "-"
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString("ru-RU")
}
