import Link from "next/link"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { ScreenBody } from "@/components/screen-body"
import { StockHistoryToolbar } from "@/components/stock/stock-history-toolbar"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import {
  getSalesReport,
  listStockMovements,
  listTopCategories,
  type Movement,
  type SalesReport,
} from "@/lib/db"
import { cn, formatMoney } from "@/lib/utils"

export const dynamic = "force-dynamic"

const HISTORY_LIMIT = 1000

export default async function StockMovementsPage({ searchParams }: PageProps<"/history/stock">) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const params = await searchParams
  // Две вкладки: «Продажи» (отчёт по фактическим чекам и выданным заказам, по умолчанию)
  // и «Журнал движений» (полный складской журнал).
  const view = String(params.view ?? "") === "moves" ? "moves" : "sales"
  const query = String(params.query ?? "")
  const direction = String(params.direction ?? "all")
  const type = String(params.type ?? "all")
  const category = String(params.category ?? "all")
  const dateFrom = String(params.dateFrom ?? "")
  const dateTo = String(params.dateTo ?? "")
  const categories = listTopCategories()

  const exportHref = buildExportHref({ view, query, direction, type, category, dateFrom, dateTo })

  return (
    <CrmShell
      user={user}
      active="history"
      title="История склада"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <StockHistoryToolbar
        view={view}
        query={query}
        direction={direction}
        type={type}
        category={category}
        categories={categories}
        dateFrom={dateFrom}
        dateTo={dateTo}
        exportHref={exportHref}
      />

      <ScreenBody className="p-4">
        {view === "sales" ? (
          <SalesView report={getSalesReport({ dateFrom, dateTo, category, query })} />
        ) : (
          <MovementsView filters={{ query, direction, type, category, dateFrom, dateTo }} />
        )}
      </ScreenBody>
    </CrmShell>
  )
}

// ── Вкладка «Продажи» ────────────────────────────────────────────────────────

function SalesView({ report }: { report: SalesReport }) {
  const { totals } = report
  if (totals.qty === 0 && totals.refundedCount === 0) {
    return (
      <Empty className="min-h-56">
        <EmptyHeader>
          <EmptyTitle>Продаж не найдено</EmptyTitle>
          <EmptyDescription>Измените период или фильтры. Учитываются чеки кассы и выданные заказы.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Продано, шт" value={formatNumber(totals.qty)} accent />
        <SummaryTile label="Выручка" value={formatMoney(totals.revenue)} accent />
        <SummaryTile label="Себестоимость" value={formatMoney(totals.cost)} />
        <SummaryTile label="Наценка" value={formatMoney(totals.margin)} />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span>
          Чеки кассы <b className="font-medium tabular-nums text-foreground">{totals.salesCount}</b> ·{" "}
          <span className="tabular-nums">{formatMoney(totals.salesRevenue)}</span>
        </span>
        <span>
          Выданные заказы <b className="font-medium tabular-nums text-foreground">{totals.ordersCount}</b> ·{" "}
          <span className="tabular-nums">{formatMoney(totals.ordersRevenue)}</span>
        </span>
        {totals.refundedCount > 0 ? (
          <span className="text-orange-700">
            Возвраты <b className="font-medium tabular-nums">{totals.refundedCount}</b> ·{" "}
            <span className="tabular-nums">−{formatMoney(totals.refundedAmount)}</span> (не входят в выручку)
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <Th>Товар</Th>
              <Th>Категория</Th>
              <Th className="text-right">Кол-во</Th>
              <Th className="text-right">Выручка</Th>
              <Th className="text-right">Себестоимость</Th>
              <Th className="text-right">Наценка</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.byProduct.map((row) => (
              <TableRow key={row.productCode || `custom:${row.productName}`}>
                <TableCell className="max-w-64">
                  <div className="truncate font-medium">{row.productName}</div>
                  {row.productCode ? (
                    <div className="text-xs text-muted-foreground">{row.productCode}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">нетоварная позиция</div>
                  )}
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">{row.category}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.qty)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(row.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(row.cost)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", row.margin < 0 ? "text-red-600" : "")}>
                  {formatMoney(row.margin)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-zinc-50/80 font-semibold">
              <TableCell colSpan={2}>Итого</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(totals.qty)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(totals.revenue)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(totals.cost)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(totals.margin)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {report.byCategory.length > 1 ? (
        <div className="max-w-3xl overflow-x-auto rounded-xl bg-muted/30">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50/80 text-left text-[11px] font-medium text-muted-foreground uppercase">
                <th className="px-3 py-2">По категориям</th>
                <th className="px-3 py-2 text-right">Кол-во</th>
                <th className="px-3 py-2 text-right">Выручка</th>
                <th className="px-3 py-2 text-right">Себестоимость</th>
                <th className="px-3 py-2 text-right">Наценка</th>
              </tr>
            </thead>
            <tbody>
              {report.byCategory.map((row) => (
                <tr key={row.category} className="border-b last:border-b-0">
                  <td className="max-w-64 truncate px-3 py-1.5">{row.category}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(row.qty)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatMoney(row.revenue)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatMoney(row.cost)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(row.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Выручка — фактические суммы чеков кассы и выданных заказов (со всеми скидками, без доставки), как в
        кассе. Себестоимость и наценка рассчитаны по текущей себестоимости карточек товаров.
      </p>
    </div>
  )
}

// ── Вкладка «Журнал движений» ────────────────────────────────────────────────

function MovementsView({
  filters,
}: {
  filters: { query: string; direction: string; type: string; category: string; dateFrom: string; dateTo: string }
}) {
  const { movements, truncated } = listStockMovements(filters, HISTORY_LIMIT)

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3 text-sm">
        <span className="text-muted-foreground">
          Движений <span className="font-semibold tabular-nums text-foreground">{movements.length}</span>
        </span>
        {truncated ? (
          <span className="text-xs text-muted-foreground">
            показаны последние {HISTORY_LIMIT} — уточните период или фильтр
          </span>
        ) : null}
      </div>

      {movements.length === 0 ? (
        <Empty className="min-h-56">
          <EmptyHeader>
            <EmptyTitle>Движения не найдены</EmptyTitle>
            <EmptyDescription>
              Измените фильтры или период. Движения появятся после продаж, актов или импорта.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <Th>Дата</Th>
              <Th>Тип</Th>
              <Th>Товар</Th>
              <Th className="text-right">Кол-во</Th>
              <Th className="text-right">Остаток</Th>
              <Th>Связь</Th>
              <Th>Провёл</Th>
              <Th className="hidden 2xl:table-cell">Комментарий</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell className="tabular-nums whitespace-nowrap">{formatDateTime(movement.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant={movementTone(movement)}>{movementLabel(movement)}</Badge>
                </TableCell>
                <TableCell className="max-w-48 truncate">
                  {movement.productName || movement.productCode || "—"}
                </TableCell>
                <TableCell className="text-right">
                  <QtyValue value={movement.qty} />
                </TableCell>
                <TableCell className="text-right">
                  <StockRange before={movement.beforeStock} after={movement.afterStock} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{movementSource(movement)}</TableCell>
                <TableCell>
                  <Responsible name={movement.userName} />
                </TableCell>
                <TableCell className="hidden 2xl:table-cell">
                  <span className="block max-w-64 truncate text-muted-foreground">{movement.note || "—"}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

// Ссылка на выгрузку отчёта с теми же фильтрами, что применены на странице.
function buildExportHref(filters: Record<string, string>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== "all" && !(key === "view" && value === "sales")) {
      params.set(key, value)
    }
  }
  const qs = params.toString()
  return qs ? `/history/stock/export?${qs}` : "/history/stock/export"
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", accent ? "text-emerald-700" : "text-zinc-950")}>
        {value}
      </div>
    </div>
  )
}

function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <TableHead className={cn("text-[11px] font-medium text-muted-foreground uppercase", className)}>
      {children}
    </TableHead>
  )
}

function Responsible({ name }: { name?: string | null }) {
  const clean = (name ?? "").trim()
  const initial = clean ? clean[0]?.toUpperCase() : "—"
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-medium text-zinc-600">
        {initial}
      </span>
      <span className="max-w-28 truncate">{clean || "не зафиксирован"}</span>
    </div>
  )
}

function QtyValue({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground">—</span>
  }
  const formatted = formatNumber(value)
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value > 0 ? "text-emerald-700" : value < 0 ? "text-orange-600" : "text-zinc-900"
      )}
    >
      {value > 0 ? `+${formatted}` : formatted}
    </span>
  )
}

function StockRange({ before, after }: { before: number | null; after: number | null }) {
  if (before === null && after === null) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span className="tabular-nums whitespace-nowrap">
      <span className="text-muted-foreground">{before === null ? "—" : formatNumber(before)}</span>
      <span className="mx-1 text-muted-foreground">→</span>
      <span className="font-medium text-zinc-900">{after === null ? "—" : formatNumber(after)}</span>
    </span>
  )
}

function movementTone(movement: Movement): "success" | "orange" | "violet" | "neutral" {
  if (movement.type === "import") {
    return "violet"
  }
  if (movement.type === "sale" || movement.type === "order_fulfill") {
    return "neutral"
  }
  if (typeof movement.qty === "number" && movement.qty > 0) {
    return "success"
  }
  if (typeof movement.qty === "number" && movement.qty < 0) {
    return "orange"
  }
  return "neutral"
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
      <Link
        href={`/stock/acts/${movement.documentId}`}
        className="font-medium text-violet-700 underline-offset-4 hover:underline"
      >
        {label}
      </Link>
    )
  }
  return <span className="text-muted-foreground">—</span>
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
}

function formatDateTime(value: string) {
  const date = parseDbInstant(value)
  return date
    ? date.toLocaleString("ru-RU", {
        timeZone: SHOP_TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : value
}
