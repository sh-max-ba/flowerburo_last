"use client"

import { useRouter } from "next/navigation"
import type { Supplier } from "@/lib/db"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Фильтр актов склада по поставщику. Серверная страница RSC, поэтому навигацию делаем
// клиентским компонентом: на выбор поставщика собираем тот же query-string, что и чипы,
// сохраняя текущие query/type/status.
export function StockActsSupplierFilter({
  suppliers,
  value,
  query,
  type,
  status,
}: {
  suppliers: Supplier[]
  value: string
  query: string
  type: string
  status: string
}) {
  const router = useRouter()

  function navigate(nextSupplier: string) {
    const params = new URLSearchParams()
    if (query) params.set("query", query)
    if (type && type !== "all") params.set("type", type)
    if (status && status !== "all") params.set("status", status)
    if (nextSupplier && nextSupplier !== "all") params.set("supplier", nextSupplier)
    const qs = params.toString()
    router.push(qs ? `/stock/acts?${qs}` : "/stock/acts")
  }

  const selected = suppliers.find((supplier) => String(supplier.id) === value)

  return (
    <Select
      items={[
        { label: "Все поставщики", value: "all" },
        ...suppliers.map((supplier) => ({ label: supplier.name, value: String(supplier.id) })),
      ]}
      value={value || "all"}
      onValueChange={(next) => navigate(next ?? "all")}
    >
      <SelectTrigger className="h-9 w-full min-w-52 sm:w-64">
        <SelectValue placeholder="Все поставщики">
          {value === "all" || !selected ? "Все поставщики" : selected.name}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectGroup>
          <SelectItem value="all">Все поставщики</SelectItem>
          {suppliers.map((supplier) => (
            <SelectItem key={supplier.id} value={String(supplier.id)}>
              <span className="max-w-64 truncate">{supplier.name}</span>
              {!supplier.isActive && (
                <span className="ml-auto text-xs text-muted-foreground">в архиве</span>
              )}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
