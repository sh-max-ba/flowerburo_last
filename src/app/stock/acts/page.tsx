import Link from "next/link"
import { BanIcon, CheckCircle2Icon, ClipboardCheckIcon, FileEditIcon, MinusCircleIcon, PlusCircleIcon, RotateCcwIcon } from "lucide-react"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { listStockDocuments, listSuppliers, type StockDocumentStatus, type StockDocumentType } from "@/lib/db"
import { stockDocumentStatusLabel, stockDocumentTypeLabel } from "@/lib/labels"
import { StockActsSupplierFilter } from "@/components/stock/stock-acts-supplier-filter"

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
  const supplier = String(params.supplier ?? "all")
  const documents = listStockDocuments({ type, status, query, supplierId: supplier })
  const suppliers = listSuppliers()

  function buildHref(overrides: { status?: string; type?: string; supplier?: string }) {
    const next = new URLSearchParams()
    if (query) {
      next.set("query", query)
    }
    const nextStatus = overrides.status ?? status
    const nextType = overrides.type ?? type
    const nextSupplier = overrides.supplier ?? supplier
    if (nextStatus && nextStatus !== "all") {
      next.set("status", nextStatus)
    }
    if (nextType && nextType !== "all") {
      next.set("type", nextType)
    }
    if (nextSupplier && nextSupplier !== "all") {
      next.set("supplier", nextSupplier)
    }
    const queryString = next.toString()
    return queryString ? `/stock/acts?${queryString}` : "/stock/acts"
  }

  const statusChips = [
    { value: "all", label: "Все статусы" },
    { value: "draft", label: "Черновики" },
    { value: "posted", label: "Проведенные" },
    { value: "corrected", label: "Скорректированные" },
    { value: "cancelled", label: "Отмененные" },
  ]
  const typeChips = [
    { value: "all", label: "Все типы" },
    { value: "stock_in", label: "Пополнение" },
    { value: "stock_out", label: "Списание" },
  ]

  return (
    <CrmShell
      user={user}
      active="stock-acts"
      title="Акты склада"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/stock?new=stock_in" className={buttonVariants({ size: "sm" })}>
          <PlusCircleIcon data-icon="inline-start" />
          Пополнение
        </Link>
        <Link href="/stock?new=stock_out" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <MinusCircleIcon data-icon="inline-start" />
          Списание
        </Link>
        <Link href="/stock" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          На склад
        </Link>
      </div>

        <Card className="rounded-2xl border bg-white">
          <CardContent className="flex flex-col gap-4">
            <form className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="status" value={status} />
              {supplier !== "all" && <input type="hidden" name="supplier" value={supplier} />}
              <Input
                name="query"
                defaultValue={query}
                placeholder="Номер или комментарий"
                className="h-9 w-full sm:max-w-xs"
              />
              <button className={buttonVariants({ size: "sm" })} type="submit">
                Найти
              </button>
              {(query || type !== "all" || status !== "all" || supplier !== "all") && (
                <Link href="/stock/acts" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Сбросить
                </Link>
              )}
            </form>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Статус:</span>
                {statusChips.map((chip) => {
                  const isActive = status === chip.value
                  return (
                    <Link
                      key={chip.value}
                      href={buildHref({ status: chip.value })}
                      className={buttonVariants({ variant: isActive ? "default" : "outline", size: "sm" })}
                    >
                      {chip.label}
                    </Link>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Тип:</span>
                {typeChips.map((chip) => {
                  const isActive = type === chip.value
                  return (
                    <Link
                      key={chip.value}
                      href={buildHref({ type: chip.value })}
                      className={buttonVariants({ variant: isActive ? "default" : "outline", size: "sm" })}
                    >
                      {chip.label}
                    </Link>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Поставщик:</span>
                <StockActsSupplierFilter
                  suppliers={suppliers}
                  value={supplier}
                  query={query}
                  type={type}
                  status={status}
                />
              </div>
            </div>

            {documents.length === 0 ? (
              <Empty className="min-h-56">
                <EmptyHeader>
                  <EmptyTitle>Акты склада не найдены</EmptyTitle>
                  <EmptyDescription>Измените фильтры или создайте акт кнопками выше.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
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
                  {documents.map((document) => (
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
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
    </CrmShell>
  )
}

function StockDocumentTypeBadge({ type }: { type: StockDocumentType }) {
  // Инвентаризация — не расход: красный бейдж с минусом вводил в заблуждение
  // (а её проведённая дельта может быть и плюсом).
  const className =
    type === "stock_in"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50"
      : type === "count"
        ? "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-50"
        : "border-red-200 bg-red-50 text-red-800 hover:bg-red-50"

  return (
    <Badge variant="outline" className={className}>
      {type === "stock_in" ? (
        <PlusCircleIcon data-icon="inline-start" />
      ) : type === "count" ? (
        <ClipboardCheckIcon data-icon="inline-start" />
      ) : (
        <MinusCircleIcon data-icon="inline-start" />
      )}
      {stockDocumentTypeLabel(type)}
    </Badge>
  )
}

function StockDocumentStatusBadge({ status }: { status: StockDocumentStatus }) {
  const className =
    status === "posted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50"
      : status === "draft"
        ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50"
        : status === "corrected"
          ? "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-50"
          : ""

  return (
    <Badge variant={status === "cancelled" ? "destructive" : "outline"} className={className}>
      {status === "posted" ? (
        <CheckCircle2Icon data-icon="inline-start" />
      ) : status === "draft" ? (
        <FileEditIcon data-icon="inline-start" />
      ) : status === "corrected" ? (
        <RotateCcwIcon data-icon="inline-start" />
      ) : (
        <BanIcon data-icon="inline-start" />
      )}
      {stockDocumentStatusLabel(status)}
    </Badge>
  )
}

function formatDateTime(value: string) {
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}
