"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { createInventoryAction } from "@/app/actions"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export function NewInventoryButton({ categories, disabled }: { categories: string[]; disabled?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<"all" | "category">("all")
  const [category, setCategory] = useState(categories[0] ?? "")
  const [comment, setComment] = useState("")
  const [pending, startTransition] = useTransition()

  function create() {
    const formData = new FormData()
    formData.set("scope", scope)
    if (scope === "category") {
      if (!category) {
        toast.error("Выберите категорию.")
        return
      }
      formData.set("category", category)
    }
    formData.set("comment", comment)
    startTransition(async () => {
      const result = await createInventoryAction(formData)
      if (result.ok && "data" in result && result.data) {
        toast.success(result.message)
        setOpen(false)
        router.push(`/stock/inventory/${result.data.documentId}`)
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)} disabled={disabled} size="sm">
        Новая инвентаризация
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая инвентаризация</DialogTitle>
          <DialogDescription>
            Будет зафиксирован учётный остаток выбранных товаров. Затем введёте фактические количества.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Охват</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value === "category" ? "category" : "all")}
              disabled={pending}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="all">Весь склад (активные товары)</option>
              <option value="category" disabled={categories.length === 0}>
                По категории
              </option>
            </select>
          </div>
          {scope === "category" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Категория</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="inventory-comment" className="text-sm font-medium">
              Комментарий
            </label>
            <Input
              id="inventory-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="необязательно"
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: "outline" })} disabled={pending} type="button">
            Отмена
          </DialogClose>
          <Button type="button" onClick={create} disabled={pending}>
            Начать пересчёт
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
