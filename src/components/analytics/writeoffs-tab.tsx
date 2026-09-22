"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { AnalyticsWriteOffs, WriteOffDocRow, WriteOffProductRow } from "@/lib/db"
import { formatMoney } from "@/lib/utils"
import { DataView, type DataViewColumn } from "@/components/data-view"
import { FilterChips } from "@/components/screen-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { BarList, Panel } from "./bar-list"
import { ColumnChart } from "./charts"
import { DOCS_FORMS, formatCompactMoney, formatInstantShort, formatPercent, formatQty, percentOf, plural, POSITIONS_FORMS, SERIES_COLORS } from "./format"
import { operationsHref, productCardHref } from "./links"
import { moneyValue } from "./overview-tab"
import { StatTile } from "./stat-tile"
import { OpenInWindowLink, Pagination, TableToolbar, usePagination } from "./table-chrome"

type View = "docs" | "products"

export function WriteOffsTab({ data, query }: { data: AnalyticsWriteOffs; query: string }) {
  const router = useRouter()
  const { totals, previous, series, inventory, range } = data
  const [view, setView] = useState<View>("docs")
  const days = series.map((point) => point.day)
  const q = query.trim().toLowerCase()

  const docs = useMemo(
    () => (q ? data.documents.filter((row) => `${row.number} ${row.reason} ${row.postedByName}`.toLowerCase().includes(q)) : data.documents),
    [data.documents, q]
  )
  const products = useMemo(
    () => (q ? data.byProduct.filter((row) => `${row.productName} ${row.productCode} ${row.categoryPath}`.toLowerCase().includes(q)) : data.byProduct),
    [data.byProduct, q]
  )
  const docsPaging = usePagination(docs)
  const productsPaging = usePagination(products)

  const docColumns = useMemo<DataViewColumn<WriteOffDocRow>[]>(
    () => [
      {
        key: "date",
        header: "Дата",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.operationAt,
        defaultDirection: "desc",
        cell: (row) => formatInstantShort(row.operationAt),
      },
      {
        key: "number",
        header: "Акт",
        className: "whitespace-nowrap",
        sortValue: (row) => row.number,
        cell: (row) => (
          <Link href={`/stock/acts/${row.id}`} className="font-medium underline-offset-4 hover:underline">
            {row.number}
          </Link>
        ),
      },
      {
        key: "reason",
        header: "Причина",
        grow: true,
        sortValue: (row) => row.reason,
        cell: (row) => <span className="block truncate">{row.reason}</span>,
      },
      {
        key: "by",
        header: "Провёл",
        hideBelow: "5xl",
        sortValue: (row) => row.postedByName,
        cell: (row) => <span className="block max-w-32 truncate text-muted-foreground">{row.postedByName || "—"}</span>,
      },
      {
        key: "items",
        header: "Позиций",
        align: "right",
        hideBelow: "4xl",
        className: "tabular-nums",
        sortValue: (row) => row.itemsCount,
        defaultDirection: "desc",
        cell: (row) => row.itemsCount,
      },
      {
        key: "qty",
        header: "Кол-во",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.qty,
        defaultDirection: "desc",
        cell: (row) => formatQty(row.qty),
      },
      {
        key: "cost",
        header: "Сумма",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.cost,
        defaultDirection: "desc",
        cell: (row) => <span className="font-medium">{formatMoney(row.cost)}</span>,
      },
    ],
    []
  )

  const productColumns = useMemo<DataViewColumn<WriteOffProductRow>[]>(
    () => [
      {
        key: "product",
        header: "Товар",
        grow: true,
        sortValue: (row) => row.productName,
        cell: (row) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.productName}</div>
            <div className="truncate text-xs text-muted-foreground">{row.categoryPath.split("/")[0] || "Без категории"}</div>
          </div>
        ),
      },
      {
        key: "docs",
        header: "Актов",
        align: "right",
        hideBelow: "4xl",
        className: "tabular-nums",
        sortValue: (row) => row.docsCount,
        defaultDirection: "desc",
        cell: (row) => row.docsCount,
      },
      {
        key: "qty",
        header: "Кол-во",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.qty,
        defaultDirection: "desc",
        cell: (row) => formatQty(row.qty),
      },
      {
        key: "cost",
        header: "Сумма",
        align: "right",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.cost,
        defaultDirection: "desc",
        cell: (row) => <span className="font-medium">{formatMoney(row.cost)}</span>,
      },
      {
        key: "share",
        header: "Доля",
        align: "right",
        hideBelow: "3xl",
        className: "tabular-nums whitespace-nowrap",
        sortValue: (row) => row.cost,
        defaultDirection: "desc",
        cell: (row) => <span className="text-muted-foreground">{formatPercent(percentOf(row.cost, totals.cost), 1)}</span>,
      },
    ],
    [totals.cost]
  )

  const inventoryNet = inventory.surplusCost - inventory.shortageCost

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
      <StatTile
        className="xl:col-span-3"
        label="Списано"
        value={moneyValue(totals.cost)}
        unit="сом"
        delta={{ current: totals.cost, previous: previous.cost, upIsGood: false }}
        spark={series.map((point) => point.writeOffs)}
        sparkColor={SERIES_COLORS.writeOffs}
        hint={`${totals.docsCount} ${plural(totals.docsCount, DOCS_FORMS)} · ${totals.positionsCount} ${plural(totals.positionsCount, POSITIONS_FORMS)} → операции`}
        href={operationsHref(range, { type: "writeoff" })}
      />
      <StatTile
        className="xl:col-span-3"
        label="Списано, шт"
        value={formatQty(totals.qty)}
        unit="шт"
        delta={{ current: totals.qty, previous: previous.qty, upIsGood: false }}
        hint={totals.docsCount > 0 ? `в среднем ${formatQty(totals.qty / totals.docsCount, 0)} шт на акт` : "актов списания нет"}
      />
      <StatTile
        className="xl:col-span-3"
        label="Доля от закупок"
        value={formatPercent(percentOf(totals.cost, totals.purchases), 1).replace(" %", "")}
        unit="%"
        hint={`закупки за период ${formatCompactMoney(totals.purchases)}`}
      />
      <StatTile
        className="xl:col-span-3"
        label="Инвентаризация"
        value={inventory.docsCount > 0 ? `${inventoryNet >= 0 ? "+" : "−"}${moneyValue(Math.abs(inventoryNet))}` : "—"}
        unit={inventory.docsCount > 0 ? "сом" : undefined}
        hint={
          inventory.docsCount > 0
            ? `недостача ${formatQty(inventory.shortageQty)} шт · излишки ${formatQty(inventory.surplusQty)} шт · ${inventory.docsCount} ${plural(inventory.docsCount, DOCS_FORMS)}`
            : "проведённых пересчётов за период нет"
        }
        href="/stock/inventory"
      />

      <Panel title="Списания по дням" subtitle="По закупочной цене строк актов" className="md:col-span-2 xl:col-span-7">
        <ColumnChart
          days={days}
          values={series.map((point) => point.writeOffs)}
          label="Списано"
          color={SERIES_COLORS.writeOffs}
          formatValue={formatMoney}
          formatTick={formatCompactMoney}
          heightClassName="h-48 sm:h-60"
        />
      </Panel>

      <Panel title="По причинам" subtitle="Комментарий акта списания · клик — акты с причиной" className="xl:col-span-5">
        <BarList
          items={data.byReason.slice(0, 8).map((row) => ({
            key: row.key,
            label: row.label,
            value: row.value,
            meta: `${row.count} ${plural(row.count, DOCS_FORMS)}`,
            href: operationsHref(range, { type: "writeoff", reason: row.label }),
          }))}
          formatValue={formatCompactMoney}
          scale="total"
          color={SERIES_COLORS.writeOffs}
          empty="Списаний за период нет"
        />
      </Panel>

      <Panel title="По категориям" subtitle="Клик — акты списания с товарами категории" className="xl:col-span-5">
        <BarList
          items={data.byCategory.slice(0, 8).map((row) => ({
            key: row.key,
            label: row.label,
            value: row.value,
            meta: `${formatQty(row.count)} шт`,
            href: operationsHref(range, { type: "writeoff", category: row.label }),
          }))}
          formatValue={formatCompactMoney}
          scale="total"
          color={SERIES_COLORS.writeOffs}
          empty="Списаний за период нет"
        />
      </Panel>

      <section className="flex min-w-0 flex-col rounded-2xl bg-background shadow-xs md:col-span-2 xl:col-span-7">
        <TableToolbar
          left={
            <FilterChips
              value={view}
              options={[
                { value: "docs", label: "Акты", count: docs.length },
                { value: "products", label: "Товары", count: products.length },
              ]}
              onValueChange={setView}
            />
          }
          right={<OpenInWindowLink />}
        />
        {view === "docs" ? (
          <DataView
            rows={docsPaging.pageRows}
            columns={docColumns}
            getRowKey={(row) => row.id}
            defaultSort={{ key: "date", direction: "desc" }}
            stickyHeader={false}
            onRowSelect={(row) => router.push(`/stock/acts/${row.id}`)}
            renderCard={(row) => (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {row.number} · {row.reason}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {formatInstantShort(row.operationAt)} · {formatQty(row.qty)} шт
                  </div>
                </div>
                <div className="shrink-0 font-medium tabular-nums">{formatMoney(row.cost)}</div>
              </div>
            )}
            empty={<WriteOffsEmpty />}
          />
        ) : (
          <DataView
            rows={productsPaging.pageRows}
            columns={productColumns}
            getRowKey={(row) => row.productCode}
            defaultSort={{ key: "cost", direction: "desc" }}
            stickyHeader={false}
            onRowSelect={(row) => router.push(operationsHref(range, { type: "writeoff", product: row.productCode }))}
            rowActions={(row) => (
              <a href={productCardHref(row.productCode, range)} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground" title="Карточка товара">
                карточка
              </a>
            )}
            renderCard={(row) => (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.productName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {formatQty(row.qty)} шт · {row.docsCount} {plural(row.docsCount, DOCS_FORMS)}
                  </div>
                </div>
                <div className="shrink-0 font-medium tabular-nums">{formatMoney(row.cost)}</div>
              </div>
            )}
            empty={<WriteOffsEmpty />}
          />
        )}
        {view === "docs" ? (
          <Pagination page={docsPaging.page} pageCount={docsPaging.pageCount} total={docsPaging.total} pageSize={docsPaging.pageSize} onPageChange={docsPaging.setPage} />
        ) : (
          <Pagination page={productsPaging.page} pageCount={productsPaging.pageCount} total={productsPaging.total} pageSize={productsPaging.pageSize} onPageChange={productsPaging.setPage} />
        )}
      </section>

      <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-12">
        Списания — проведённые расходные акты по дате операции, сумма — количество × закупочная цена строки
        (без цены — текущая себестоимость товара). Инвентаризация показана отдельно: разница факта и учёта по
        проведённым пересчётам, по текущей себестоимости.
      </p>
    </div>
  )
}

function WriteOffsEmpty() {
  return (
    <Empty className="min-h-40">
      <EmptyHeader>
        <EmptyTitle>Списаний не найдено</EmptyTitle>
        <EmptyDescription>Измените период или поиск. Учитываются только проведённые расходные акты.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
