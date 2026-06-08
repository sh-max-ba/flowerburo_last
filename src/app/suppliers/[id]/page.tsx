import Link from "next/link"
import { notFound } from "next/navigation"
import { AccessDenied } from "@/components/access-denied"
import { CrmShell } from "@/components/crm-shell"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getSupplier, getSupplierPurchaseHistory } from "@/lib/db"
import { stockDocumentStatusLabel } from "@/lib/labels"

export const dynamic = "force-dynamic"

export default async function SupplierCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (user.role !== "owner") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const { id } = await params
  const supplierId = Number(id)
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    notFound()
  }

  const supplier = getSupplier(supplierId)
  if (!supplier) {
    notFound()
  }
  const history = getSupplierPurchaseHistory(supplierId)
  const delay = supplier.paymentDelayDays != null ? `${supplier.paymentDelayDays} дн.` : ""

  return (
    <CrmShell
      user={user}
      active="suppliers"
      title={supplier.name}
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/suppliers" className={buttonVariants({ variant: "outline", size: "sm" })}>
          ← К списку
        </Link>
        <Link href={`/suppliers?edit=${supplier.id}`} className={buttonVariants({ size: "sm" })}>
          Редактировать
        </Link>
      </div>

      <Card className="rounded-2xl border bg-white">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-3">
            {supplier.name}
            <Badge variant={supplier.isActive ? "secondary" : "outline"}>
              {supplier.isActive ? "Активен" : "В архиве"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Group title="Реквизиты">
            <Row label="Юр. название" value={supplier.legalName} />
            <Row label="ИНН" value={supplier.inn} />
            <Row label="КПП" value={supplier.kpp} />
            <Row label="ОГРН" value={supplier.ogrn} />
            <Row label="Адрес" value={supplier.address} />
          </Group>
          <Group title="Контакты">
            <Row label="Контактное лицо" value={supplier.contactName} />
            <Row label="Телефон" value={supplier.phone} />
            <Row label="Доп. контакт" value={supplier.contactName2} />
            <Row label="Доп. телефон" value={supplier.phone2} />
            <Row label="Email" value={supplier.email} />
            <Row label="Ответственный" value={supplier.responsibleName} />
          </Group>
          <Group title="Банк">
            <Row label="Банк" value={supplier.bankName} />
            <Row label="Расчётный счёт" value={supplier.bankAccount} />
            <Row label="БИК" value={supplier.bik} />
            <Row label="Корр. счёт" value={supplier.corrAccount} />
          </Group>
          <Group title="Оплата">
            <Row label="Условия оплаты" value={supplier.paymentTerms} />
            <Row label="Отсрочка" value={delay} />
            <Row label="Комментарий" value={supplier.comment} />
          </Group>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border bg-white">
        <CardHeader>
          <CardTitle>История закупок</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length ? (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Номер</TableHead>
                    <TableHead>Дата операции</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Позиций</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="font-medium">{document.number}</TableCell>
                      <TableCell>{formatDateTime(document.operationAt ?? document.createdAt)}</TableCell>
                      <TableCell>{stockDocumentStatusLabel(document.status)}</TableCell>
                      <TableCell>{document.itemsCount}</TableCell>
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
            </div>
          ) : (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>Закупок пока нет</EmptyTitle>
                <EmptyDescription>Приходные акты с этим поставщиком появятся здесь.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </CrmShell>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-muted-foreground">{title}</div>
      <dl className="grid gap-1.5">{children}</dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={value ? "" : "text-muted-foreground"}>{value || "—"}</dd>
    </div>
  )
}

function formatDateTime(value: string) {
  const date = parseDbInstant(value)
  return date ? date.toLocaleString("ru-RU", { timeZone: SHOP_TIME_ZONE }) : value
}
