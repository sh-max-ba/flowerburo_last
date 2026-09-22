"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { saveSupplierAction } from "@/app/actions"
import type { Supplier } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Выпадающий список поставщиков для приходного акта с возможностью завести нового поставщика прямо
// здесь. Эмитит скрытое поле supplierId (как и раньше), значение контролируется родителем.
// Создание идёт через owner-only saveSupplierAction (страницы складских актов owner-only), после чего
// список обновляется router.refresh() и только что созданный поставщик выбирается по имени.
export function SupplierSelect({
  suppliers,
  value,
  onValueChange,
  disabled,
  triggerId,
}: {
  suppliers: Supplier[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  triggerId?: string
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [pending, startTransition] = useTransition()
  // Имя только что созданного поставщика держим в ref: его выставляет handleAdd, а эффект ниже срабатывает,
  // когда router.refresh() пришлёт обновлённый список suppliers — без локального setState внутри эффекта.
  const pendingNameRef = useRef<string | null>(null)

  // После создания список придёт обновлённым через refresh — выбираем нового поставщика по имени
  // (берём последнего с таким именем на случай совпадений). saveSupplierAction id не возвращает.
  useEffect(() => {
    if (!pendingNameRef.current) {
      return
    }
    const target = pendingNameRef.current.trim().toLowerCase()
    const match = [...suppliers].reverse().find((supplier) => supplier.name.trim().toLowerCase() === target)
    if (match) {
      pendingNameRef.current = null
      onValueChange(String(match.id))
    }
  }, [suppliers, onValueChange])

  function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Введите название поставщика.")
      return
    }
    const formData = new FormData()
    formData.set("name", trimmed)
    startTransition(async () => {
      const result = await saveSupplierAction(formData)
      if (result.ok) {
        toast.success(result.message)
        pendingNameRef.current = trimmed
        setName("")
        setAdding(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  const busy = disabled || pending

  return (
    <>
      <input type="hidden" name="supplierId" value={value === "none" ? "" : value} />
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={(next) => onValueChange(next ?? "none")}>
          <SelectTrigger id={triggerId} className="w-full" disabled={busy}>
            <SelectValue placeholder="Без поставщика">
              {(current) =>
                !current || current === "none"
                  ? "Без поставщика"
                  : suppliers.find((s) => String(s.id) === String(current))?.name ?? "Без поставщика"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="none">Без поставщика</SelectItem>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={String(supplier.id)}>
                  {supplier.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={() => setAdding((current) => !current)}
        >
          <PlusIcon data-icon="inline-start" />
          Новый
        </Button>
      </div>
      {adding && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
          <Input
            value={name}
            placeholder="Название нового поставщика"
            disabled={pending}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                handleAdd()
              }
            }}
          />
          <Button type="button" size="sm" className="shrink-0" disabled={pending} onClick={handleAdd}>
            {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Добавить
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={pending}
            onClick={() => {
              setAdding(false)
              setName("")
            }}
          >
            Отмена
          </Button>
        </div>
      )}
    </>
  )
}
