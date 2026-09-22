"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { ClipboardCheckIcon, SaveIcon, SearchIcon, XIcon } from "lucide-react"
import {
  createInventoryAction,
  createInventoryCategoryTemplateAction,
  deleteInventoryCategoryTemplateAction,
} from "@/app/actions"
import type { InventoryCategoryTemplate } from "@/lib/db"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { HeaderPrimaryAction } from "@/components/screen-header"

export function NewInventoryButton({
  categories,
  templates,
  disabled,
  trigger = "button",
}: {
  categories: string[]
  templates: InventoryCategoryTemplate[]
  disabled?: boolean
  // "header" — главное действие в поле шапки экрана.
  trigger?: "button" | "header"
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<"all" | "category">("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [templateName, setTemplateName] = useState("")
  const [comment, setComment] = useState("")
  const [pending, startTransition] = useTransition()

  const availableSet = useMemo(() => new Set(categories), [categories])

  const visibleCategories = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) {
      return categories
    }
    return categories.filter((category) => category.toLowerCase().includes(normalized))
  }, [categories, search])

  function toggleCategory(category: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(category)
      } else {
        next.delete(category)
      }
      return next
    })
  }

  function applyTemplate(template: InventoryCategoryTemplate) {
    // Применяем только существующие сейчас категории шаблона — устаревшие (удалённые/
    // переименованные) тихо пропускаем, чтобы чекбоксы оставались согласованными.
    const existing = template.categories.filter((category) => availableSet.has(category))
    const missing = template.categories.length - existing.length
    setSelected(new Set(existing))
    setScope("category")
    if (existing.length === 0) {
      toast.error("Категории этого шаблона больше нет на складе.")
    } else if (missing > 0) {
      toast.warning(`Часть категорий шаблона больше нет на складе (${missing}).`)
    }
  }

  function saveTemplate() {
    const name = templateName.trim()
    if (!name) {
      toast.error("Введите название шаблона.")
      return
    }
    const cats = Array.from(selected)
    if (!cats.length) {
      toast.error("Выберите хотя бы одну категорию.")
      return
    }
    const formData = new FormData()
    formData.set("name", name)
    for (const category of cats) {
      formData.append("category", category)
    }
    startTransition(async () => {
      const result = await createInventoryCategoryTemplateAction(formData)
      if (result.ok) {
        toast.success(result.message)
        setTemplateName("")
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function deleteTemplate(id: number) {
    startTransition(async () => {
      const result = await deleteInventoryCategoryTemplateAction(id)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function create() {
    const formData = new FormData()
    formData.set("scope", scope)
    if (scope === "category") {
      const cats = Array.from(selected)
      if (!cats.length) {
        toast.error("Выберите хотя бы одну категорию.")
        return
      }
      for (const category of cats) {
        formData.append("category", category)
      }
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

  const selectedCount = selected.size

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === "header" ? (
        <HeaderPrimaryAction icon={ClipboardCheckIcon} label="Новая инвентаризация" onClick={() => setOpen(true)} disabled={disabled} />
      ) : (
        <Button type="button" onClick={() => setOpen(true)} disabled={disabled} size="sm">
          Новая инвентаризация
        </Button>
      )}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
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
                По категориям
              </option>
            </select>
          </div>

          {scope === "category" && (
            <>
              {templates.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Шаблоны</span>
                  <div className="flex flex-wrap gap-2">
                    {templates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-3 pr-1 text-sm"
                      >
                        <button
                          type="button"
                          className="font-medium hover:underline disabled:opacity-50"
                          onClick={() => applyTemplate(template)}
                          disabled={pending}
                          title={`Применить: ${template.categories.join(", ")}`}
                        >
                          {template.name}
                          <span className="ml-1 text-xs text-muted-foreground">{template.categories.length}</span>
                        </button>
                        <button
                          type="button"
                          className="rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          onClick={() => deleteTemplate(template.id)}
                          disabled={pending}
                          title="Удалить шаблон"
                          aria-label={`Удалить шаблон «${template.name}»`}
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Категории</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Выбрано: {selectedCount}</span>
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-50"
                      onClick={() => setSelected(new Set(categories))}
                      disabled={pending || categories.length === 0}
                    >
                      Все
                    </button>
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-50"
                      onClick={() => setSelected(new Set())}
                      disabled={pending || selectedCount === 0}
                    >
                      Сбросить
                    </button>
                  </div>
                </div>
                {categories.length > 8 && (
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-9 pl-8"
                      placeholder="Найти категорию"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      disabled={pending}
                    />
                  </div>
                )}
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  {visibleCategories.length === 0 ? (
                    <p className="px-3 py-4 text-center text-sm text-muted-foreground">Ничего не найдено.</p>
                  ) : (
                    <ul className="divide-y">
                      {visibleCategories.map((category) => {
                        const checked = selected.has(category)
                        return (
                          <li key={category}>
                            <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                              <Checkbox
                                checked={checked}
                                disabled={pending}
                                onCheckedChange={(value) => toggleCategory(category, value === true)}
                              />
                              <span className="min-w-0 flex-1 truncate" title={category}>
                                {category}
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Учитываются выбранные категории и их подкатегории (по началу пути).
                </p>
              </div>

              <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-3">
                <span className="text-sm font-medium">Сохранить выбор как шаблон</span>
                <div className="flex gap-2">
                  <Input
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="Название шаблона"
                    disabled={pending}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveTemplate}
                    disabled={pending || selectedCount === 0 || templateName.trim().length === 0}
                  >
                    <SaveIcon data-icon="inline-start" />
                    Сохранить
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Шаблон с таким же названием будет перезаписан.
                </p>
              </div>
            </>
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
