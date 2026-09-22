"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, BanknoteIcon, PencilIcon, ScrollTextIcon } from "lucide-react"
import type { StockDocument, Supplier, SupplierDebtDocument, SupplierPayment, SupplierSettlement } from "@/lib/db"
import { getPaymentMethodLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { Panel } from "@/components/analytics/bar-list"
import { DOCS_FORMS, formatInstantDate, formatInstantShort, plural } from "@/components/analytics/format"
import { StatTile } from "@/components/analytics/stat-tile"
import { DataView, type DataViewColumn } from "@/components/data-view"
import { ScreenBody } from "@/components/screen-body"
import { HeaderAction, ScreenHeader } from "@/components/screen-header"
import { StockDocumentStatusBadge } from "@/components/stock/document-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { SupplierPaymentDialog } from "./supplier-payment-dialog"

type SupplierCardProps = {
  supplier: Supplier
  settlement: SupplierSettlement
  debtDocuments: SupplierDebtDocument[]
  payments: SupplierPayment[]
  purchases: StockDocument[]
  hasOpenShift: boolean
}

/**
 * Карточка поставщика: расчёты (закуплено / оплачено / долг) с кнопкой «Погасить долг», журнал
 * оплат (каждая оплата — строка: дата, сумма, способ, акт, кто), история приходов с суммами и
 * долгом по каждому акту, реквизиты.
 */
export function SupplierCard({ supplier, settlement, debtDocuments, payments, purchases, hasOpenShift }: SupplierCardProps) {
  const router = useRouter()
  const [paymentOpen, setPaymentOpen] = useState(false)
  const delay = supplier.paymentDelayDays != null ? `${supplier.paymentDelayDays} дн.` : ""

  const purchaseColumns: DataViewColumn<StockDocument>[] = [
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
      key: "date",
      header: "Дата",
      className: "tabular-nums whitespace-nowrap",
      sortValue: (row) => row.operationAt ?? row.createdAt,
      defaultDirection: "desc",
      cell: (row) => formatInstantShort(row.operationAt ?? row.createdAt),
    },
    {
      key: "status",
      header: "Статус",
      hideBelow: "3xl",
      sortValue: (row) => row.status,
      cell: (row) => <StockDocumentStatusBadge status={row.status} />,
    },
    {
      key: "items",
      header: "Позиций",
      align: "right",
      hideBelow: "4xl",
      className: "tabular-nums",
      sortValue: (row) => row.itemsCount,
      cell: (row) => row.itemsCount,
    },
    {
      key: "goods",
      header: "Сумма",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      sortValue: (row) => row.goodsTotal,
      defaultDirection: "desc",
      cell: (row) => (row.status === "draft" ? <span className="text-muted-foreground">—</span> : formatMoney(row.goodsTotal)),
    },
    {
      key: "paid",
      header: "Оплачено",
      align: "right",
      hideBelow: "3xl",
      className: "tabular-nums whitespace-nowrap",
      sortValue: (row) => row.paidAmount,
      cell: (row) => <span className="text-muted-foreground">{formatMoney(row.paidAmount)}</span>,
    },
    {
      key: "debt",
      header: "Долг",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      sortValue: (row) => row.supplierDebt,
      defaultDirection: "desc",
      cell: (row) =>
        row.supplierDebt > 0 ? <span className="font-medium text-red-600">{formatMoney(row.supplierDebt)}</span> : <span className="text-muted-foreground">—</span>,
    },
  ]

  const paymentColumns: DataViewColumn<SupplierPayment>[] = [
    {
      key: "date",
      header: "Дата",
      className: "tabular-nums whitespace-nowrap",
      sortValue: (row) => row.paidAt,
      defaultDirection: "desc",
      cell: (row) => formatInstantShort(row.paidAt),
    },
    {
      key: "amount",
      header: "Сумма",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      sortValue: (row) => row.amount,
      defaultDirection: "desc",
      cell: (row) => <span className={cn("font-medium", row.amount < 0 && "text-red-600")}>{formatMoney(row.amount)}</span>,
    },
    {
      key: "method",
      header: "Способ",
      hideBelow: "3xl",
      sortValue: (row) => row.paymentMethod,
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          {getPaymentMethodLabel(row.paymentMethod)}
          {row.cashTransactionId ? <Badge variant="outline">из кассы</Badge> : null}
        </span>
      ),
    },
    {
      key: "document",
      header: "Акт",
      className: "whitespace-nowrap",
      sortValue: (row) => row.documentNumber ?? "",
      cell: (row) =>
        row.documentId ? (
          <Link href={`/stock/acts/${row.documentId}`} className="underline-offset-4 hover:underline">
            {row.documentNumber ?? `#${row.documentId}`}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "user",
      header: "Кто",
      hideBelow: "5xl",
      sortValue: (row) => row.userName,
      cell: (row) => <span className="block max-w-32 truncate text-muted-foreground">{row.userName || "—"}</span>,
    },
    {
      key: "comment",
      header: "Комментарий",
      grow: true,
      hideBelow: "4xl",
      cell: (row) => (
        <span className="block truncate text-muted-foreground">
          {row.source === "document" ? row.comment : row.comment || (row.source === "backfill" ? "Оплачено при оформлении акта" : "—")}
        </span>
      ),
    },
  ]

  return (
    <>
      <ScreenHeader
        title={supplier.name}
        leading={<HeaderAction icon={ArrowLeftIcon} label="Поставщики" href="/suppliers" />}
        meta={settlement.debt > 0 ? `долг ${formatMoney(settlement.debt)}` : "долга нет"}
        actions={
          <>
            <HeaderAction icon={ScrollTextIcon} label="Акты" href={`/stock/acts?supplier=${supplier.id}`} />
            <HeaderAction icon={PencilIcon} label="Редактировать" href={`/suppliers?edit=${supplier.id}`} />
          </>
        }
        primaryAction={
          <Button type="button" className="h-10 gap-1.5 px-3 pl-2.5" onClick={() => setPaymentOpen(true)} disabled={settlement.debt <= 0}>
            <BanknoteIcon className="size-4 shrink-0" aria-hidden />
            <span className="hidden @4xl/screen:inline">Погасить долг</span>
          </Button>
        }
        tabs={null}
      />

      <ScreenBody surface={false} className="gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-12">
          <StatTile
            className="xl:col-span-4"
            label="Закуплено всего"
            value={money(settlement.purchasedTotal)}
            unit="сом"
            hint={`${purchases.filter((row) => row.status === "posted").length} ${plural(purchases.filter((row) => row.status === "posted").length, DOCS_FORMS)} проведено`}
          />
          <StatTile
            className="xl:col-span-4"
            label="Оплачено"
            value={money(settlement.paidTotal)}
            unit="сом"
            hint={settlement.lastPaymentAt ? `последняя оплата ${formatInstantDate(settlement.lastPaymentAt)}` : "оплат ещё не было"}
          />
          <StatTile
            className="xl:col-span-4"
            label="Долг"
            value={money(settlement.debt)}
            unit="сом"
            hint={
              settlement.debt > 0
                ? `${settlement.debtDocsCount} ${plural(settlement.debtDocsCount, DOCS_FORMS)} с долгом${delay ? ` · отсрочка ${delay}` : ""}`
                : "все проведённые приходы оплачены"
            }
          />

          <Panel title="Реквизиты и контакты" className="md:col-span-3 xl:col-span-12">
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <Row label="Контактное лицо" value={supplier.contactName} />
              <Row label="Телефон" value={supplier.phone} />
              <Row label="Доп. контакт" value={supplier.contactName2} />
              <Row label="Доп. телефон" value={supplier.phone2} />
              <Row label="Email" value={supplier.email} />
              <Row label="Ответственный" value={supplier.responsibleName} />
              <Row label="Юр. название" value={supplier.legalName} />
              <Row label="ИНН" value={supplier.inn} />
              <Row label="Адрес" value={supplier.address} />
              <Row label="Банк" value={supplier.bankName} />
              <Row label="Расчётный счёт" value={supplier.bankAccount} />
              <Row label="БИК" value={supplier.bik} />
              <Row label="Условия оплаты" value={supplier.paymentTerms} />
              <Row label="Отсрочка" value={delay} />
              <Row label="Комментарий" value={supplier.comment} />
              <Row label="Статус" value={supplier.isActive ? "Активен" : "В архиве"} />
            </dl>
          </Panel>

          <section className="flex min-w-0 flex-col rounded-2xl bg-background shadow-xs md:col-span-3 xl:col-span-12">
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
              <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Оплаты</h2>
              <span className="text-xs text-muted-foreground tabular-nums">{payments.length}</span>
            </div>
            <DataView
              rows={payments}
              columns={paymentColumns}
              getRowKey={(row) => row.id}
              stickyHeader={false}
              renderCard={(row) => (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {formatInstantShort(row.paidAt)} · {getPaymentMethodLabel(row.paymentMethod)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {row.documentNumber ?? "—"}
                      {row.comment ? ` · ${row.comment}` : ""}
                    </div>
                  </div>
                  <div className={cn("shrink-0 font-medium tabular-nums", row.amount < 0 && "text-red-600")}>{formatMoney(row.amount)}</div>
                </div>
              )}
              empty={
                <Empty className="min-h-32">
                  <EmptyHeader>
                    <EmptyTitle>Оплат пока нет</EmptyTitle>
                    <EmptyDescription>Погашения долга и суммы «оплачено» из актов появятся здесь.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              }
            />
          </section>

          <section className="flex min-w-0 flex-col rounded-2xl bg-background shadow-xs md:col-span-3 xl:col-span-12">
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
              <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Приходы</h2>
              <span className="text-xs text-muted-foreground tabular-nums">{purchases.length}</span>
            </div>
            <DataView
              rows={purchases}
              columns={purchaseColumns}
              getRowKey={(row) => row.id}
              stickyHeader={false}
              onRowSelect={(row) => router.push(`/stock/acts/${row.id}`)}
              renderCard={(row) => (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{row.number}</span>
                      <StockDocumentStatusBadge status={row.status} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatInstantShort(row.operationAt ?? row.createdAt)} · {row.itemsCount} поз.
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <div className="font-medium">{formatMoney(row.goodsTotal)}</div>
                    {row.supplierDebt > 0 ? <div className="text-xs text-red-600">долг {formatMoney(row.supplierDebt)}</div> : null}
                  </div>
                </div>
              )}
              empty={
                <Empty className="min-h-32">
                  <EmptyHeader>
                    <EmptyTitle>Закупок пока нет</EmptyTitle>
                    <EmptyDescription>Приходные акты с этим поставщиком появятся здесь.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              }
            />
          </section>
        </div>
      </ScreenBody>

      {paymentOpen ? (
        <SupplierPaymentDialog
          supplierId={supplier.id}
          supplierName={supplier.name}
          debtDocuments={debtDocuments}
          hasOpenShift={hasOpenShift}
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
        />
      ) : null}
    </>
  )
}

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(value)).replace(/ /g, " ")
}

// Пустые реквизиты не показываем — у большинства поставщиков заполнены два-три поля.
function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate" title={value}>
        {value}
      </dd>
    </div>
  )
}
