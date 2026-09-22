import Link from "next/link"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { NewInventoryButton } from "@/components/stock/new-inventory-button"
import { StockInventoryToolbar } from "@/components/stock/stock-inventory-toolbar"
import { ScreenBody } from "@/components/screen-body"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { getInventoryEnabled, listInventoryCategoryTemplates, listStockDocuments } from "@/lib/db"
import { listProducts } from "@/lib/crm"
import { stockDocumentStatusLabel } from "@/lib/labels"

export const dynamic = "force-dynamic"

function formatDate(value: string | null) {
  if (!value) return "—"
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}

export default async function StockInventoryPage({ searchParams }: PageProps<"/stock/inventory">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const params = await searchParams
  const query = String(params.query ?? "")
  const status = String(params.status ?? "all")
  const dateFrom = String(params.dateFrom ?? "")
  const dateTo = String(params.dateTo ?? "")
  const hasFilters = Boolean(query) || status !== "all" || Boolean(dateFrom) || Boolean(dateTo)

  const enabled = getInventoryEnabled()
  const documents = listStockDocuments({ type: "count", query, status, dateFrom, dateTo })
  const categories = Array.from(
    new Set(listProducts().map((product) => product.categoryPath).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "ru"))
  const categoryTemplates = listInventoryCategoryTemplates()

  return (
    <CrmShell
      user={user}
      active="stock-inventory"
      title="Инвентаризация"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <StockInventoryToolbar
        query={query}
        status={status}
        dateFrom={dateFrom}
        dateTo={dateTo}
        primaryAction={
          <NewInventoryButton categories={categories} templates={categoryTemplates} disabled={!enabled} trigger="header" />
        }
      />

      {!enabled && (
        <Alert className="shrink-0 border-0 shadow-xs">
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

      <ScreenBody>
        {documents.length === 0 ? (
          <Empty className="min-h-56">
            <EmptyHeader>
              <EmptyTitle>{hasFilters ? "Ничего не найдено" : "Инвентаризаций пока нет"}</EmptyTitle>
              <EmptyDescription>
                {hasFilters
                  ? "Измените фильтры или период."
                  : "Пересчёт фактических остатков: на старте фиксируется учётный остаток, при проведении остаток выравнивается к факту. Создайте первую кнопкой «Новая инвентаризация»."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
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
                  <TableCell className="font-medium">
                    <Link href={`/stock/inventory/${document.id}`} className="hover:underline">
                      {document.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={document.status} />
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(document.createdAt)}</TableCell>
                  <TableCell className="tabular-nums">{document.postedAt ? formatDate(document.postedAt) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{document.itemsCount}</TableCell>
                  <TableCell className="min-w-48">
                    <span className="block max-w-72 truncate text-muted-foreground">{document.comment || "—"}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/stock/inventory/${document.id}`}
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      Открыть
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScreenBody>
    </CrmShell>
  )
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "posted" ? "success" : status === "draft" ? "warning" : status === "cancelled" ? "destructive" : "neutral"
  return (
    <Badge variant={variant}>
      {stockDocumentStatusLabel(status)}
    </Badge>
  )
}
