import Link from "next/link"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { NewInventoryButton } from "@/components/stock/new-inventory-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { getInventoryEnabled, listStockDocuments } from "@/lib/db"
import { listProducts } from "@/lib/crm"
import { stockDocumentStatusLabel } from "@/lib/labels"

export const dynamic = "force-dynamic"

function formatDate(value: string | null) {
  if (!value) return "—"
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}

export default async function StockInventoryPage() {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const enabled = getInventoryEnabled()
  const documents = listStockDocuments({ type: "count" })
  const categories = Array.from(
    new Set(listProducts().map((product) => product.categoryPath).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "ru"))

  return (
    <CrmShell
      user={user}
      active="stock-inventory"
      title="Инвентаризация"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <div className="flex flex-col gap-4">
        {!enabled && (
          <Alert>
            <AlertTitle>Инвентаризация выключена</AlertTitle>
            <AlertDescription>
              Создание новых инвентаризаций недоступно. Включите её в{" "}
              <Link href="/settings" className="font-medium underline">
                Настройках
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Пересчёт фактических остатков. На старте фиксируется учётный остаток, при проведении остаток
            выравнивается к факту.
          </p>
          <NewInventoryButton categories={categories} disabled={!enabled} />
        </div>

        <Card className="rounded-2xl border bg-white">
          <CardContent>
            {documents.length === 0 ? (
              <Empty className="min-h-40">
                <EmptyHeader>
                  <EmptyTitle>Инвентаризаций пока нет</EmptyTitle>
                  <EmptyDescription>Создайте первую кнопкой «Новая инвентаризация».</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Номер</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Создан</TableHead>
                    <TableHead>Проведён</TableHead>
                    <TableHead className="text-right">Позиций</TableHead>
                    <TableHead>Комментарий</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="font-medium">{document.number}</TableCell>
                      <TableCell>
                        <StatusBadge status={document.status} />
                      </TableCell>
                      <TableCell>{formatDate(document.createdAt)}</TableCell>
                      <TableCell>{document.postedAt ? formatDate(document.postedAt) : "—"}</TableCell>
                      <TableCell className="text-right">{document.itemsCount}</TableCell>
                      <TableCell className="min-w-48">{document.comment || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/stock/inventory/${document.id}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          Открыть
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </CrmShell>
  )
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "posted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "draft"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-muted bg-muted text-muted-foreground"
  return (
    <Badge variant={status === "cancelled" ? "destructive" : "outline"} className={className}>
      {stockDocumentStatusLabel(status)}
    </Badge>
  )
}
