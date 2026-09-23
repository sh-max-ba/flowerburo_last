"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { Loader2Icon, PencilIcon, PlusIcon, SaveIcon, SearchIcon, XIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"
import { deleteQuickReplyAction, saveQuickReplyAction } from "@/app/actions"
import type { QuickReply } from "@/lib/db"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

// Быстрые ответы в композере чата. Два входа в один список: «/» в начале поля (фильтр по набранному,
// стрелки + Enter) и кнопка ⚡ (свой поиск). Выбор вставляет текст в поле — менеджер может поправить
// его перед отправкой. Создать ответ можно из панели, из текста в поле или из меню любого сообщения.

// «{имя}» в тексте заменяется именем клиента; если имени нет — вместе с запятой/пробелом перед ним,
// чтобы «Здравствуйте, {имя}!» стало «Здравствуйте!».
const namePlaceholder = /\{\s*имя\s*\}/giu
const namePlaceholderWithLead = /[\s,]*\{\s*имя\s*\}/giu

export function applyQuickReply(text: string, chatName: string) {
  const name = firstName(chatName)
  return name ? text.replace(namePlaceholder, name) : text.replace(namePlaceholderWithLead, "")
}

function firstName(value: string) {
  const token = value.trim().split(/\s+/)[0] ?? ""
  if (!token || /\d/.test(token)) {
    return ""
  }
  const letters = token.replace(/[^\p{L}'-]/gu, "")
  return letters.length >= 2 ? letters : ""
}

// Строка поля считается запросом быстрого ответа: «/» в начале, одна строка, короткая.
export function parseSlashQuery(input: string): string | null {
  const match = /^\/([^\n/]{0,40})$/.exec(input)
  return match ? match[1] : null
}

export function filterQuickReplies(replies: QuickReply[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) {
    return replies
  }
  const scored: Array<{ reply: QuickReply; score: number }> = []
  for (const reply of replies) {
    const title = reply.title.toLowerCase()
    const haystack = `${title}\n${reply.text.toLowerCase()}`
    if (!words.every((word) => haystack.includes(word))) {
      continue
    }
    // Совпадение с началом названия — выше, затем по названию, затем по тексту.
    const score = title.startsWith(words[0]) ? 0 : words.every((word) => title.includes(word)) ? 1 : 2
    scored.push({ reply, score })
  }
  return scored.sort((a, b) => a.score - b.score).map((item) => item.reply)
}

export type QuickReplyDraft = { id: number | null; title: string; text: string }

export function QuickRepliesPanel({
  replies,
  filtered,
  mode,
  query,
  activeIndex,
  draftText,
  onQueryChange,
  onActiveIndexChange,
  onPick,
  onEdit,
  onClose,
}: {
  replies: QuickReply[]
  filtered: QuickReply[]
  // slash — фильтр берётся из поля сообщения; browse — открыто кнопкой, свой поиск.
  mode: "slash" | "browse"
  query: string
  activeIndex: number
  // Текст из поля сообщения — его можно сохранить как новый ответ (только в режиме browse).
  draftText: string
  onQueryChange: (value: string) => void
  onActiveIndexChange: (index: number) => void
  onPick: (reply: QuickReply) => void
  onEdit: (draft: QuickReplyDraft) => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Поиск получает фокус только с мышью/клавиатурой: на планшете экранная клавиатура закрыла бы список.
  useEffect(() => {
    if (mode === "browse" && window.matchMedia("(pointer: fine)").matches) {
      searchRef.current?.focus()
    }
  }, [mode])

  // Клик мимо панели закрывает её (кнопка ⚡ сама переключает состояние — её не считаем «мимо»).
  useEffect(() => {
    function handlePointer(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      // Окно правки ответа открывается поверх панели — работа в нём панель не закрывает.
      if (
        !target ||
        panelRef.current?.contains(target) ||
        target.closest("[data-quick-replies-toggle], [data-slot=dialog-content], [data-slot=dialog-overlay]")
      ) {
        return
      }
      // В режиме «/» панель живёт, пока в поле запрос; клик в поле не должен её закрывать.
      if (mode === "slash" && target.closest("textarea")) {
        return
      }
      onClose()
    }
    document.addEventListener("pointerdown", handlePointer)
    return () => document.removeEventListener("pointerdown", handlePointer)
  }, [mode, onClose])

  // Esc закрывает панель, где бы ни был фокус (кроме открытого окна правки — его Esc закроет само окно).
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return
      }
      if ((event.target as HTMLElement | null)?.closest?.("[data-slot=dialog-content]") || document.querySelector("[data-slot=dialog-content]")) {
        return
      }
      onClose()
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [onClose])

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    active?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (filtered.length) {
        const delta = event.key === "ArrowDown" ? 1 : -1
        onActiveIndexChange((activeIndex + delta + filtered.length) % filtered.length)
      }
    } else if (event.key === "Enter") {
      event.preventDefault()
      const reply = filtered[activeIndex]
      if (reply) {
        onPick(reply)
      }
    } else if (event.key === "Escape") {
      event.preventDefault()
      onClose()
    }
  }

  const draft = draftText.trim()

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Быстрые ответы"
      className="absolute inset-x-2 bottom-full z-30 mb-2 flex max-h-[min(26rem,55dvh)] flex-col overflow-hidden rounded-2xl bg-background shadow-xl ring-1 ring-zinc-900/10 sm:inset-x-3"
    >
      <div className="flex shrink-0 items-center gap-1 p-2 pb-1">
        {mode === "browse" ? (
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Поиск по быстрым ответам"
              aria-label="Поиск по быстрым ответам"
              className="h-10 border-0 bg-muted/50 pl-9 text-base shadow-none focus-visible:ring-0 sm:text-sm"
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm font-medium">
            <ZapIcon className="size-4 shrink-0 text-amber-500" aria-hidden />
            <span className="truncate">Быстрые ответы</span>
          </div>
        )}
        {mode === "browse" && draft ? (
          <Button
            type="button"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            onClick={() => onEdit({ id: null, title: "", text: draft })}
            title="Сохранить текст из поля сообщения как быстрый ответ"
          >
            <SaveIcon data-icon="inline-start" />
            <span className="hidden @xl/chat:inline">Сохранить текст из поля</span>
            <span className="@xl/chat:hidden">Из поля</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="shrink-0"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onEdit({ id: null, title: mode === "slash" ? query.trim() : "", text: "" })}
          aria-label="Новый быстрый ответ"
        >
          <PlusIcon data-icon="inline-start" />
          Новый
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onClose}
          aria-label="Закрыть быстрые ответы"
        >
          <XIcon />
        </Button>
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-2 pt-1" role="listbox" aria-label="Список быстрых ответов">
        {replies.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <div className="max-w-sm text-sm text-muted-foreground">
              Сохраните то, что пишете клиентам чаще всего: реквизиты для оплаты, условия доставки, приветствие. Ответ
              вставляется одним нажатием — или наберите «/» в начале сообщения.
            </div>
            <Button type="button" onClick={() => onEdit({ id: null, title: "", text: draft })}>
              <PlusIcon data-icon="inline-start" />
              Добавить первый ответ
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-5 text-center text-sm text-muted-foreground">
            Ничего не нашлось{query.trim() ? ` по «${query.trim()}»` : ""}.
            <Button
              type="button"
              variant="outline"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onEdit({ id: null, title: query.trim(), text: mode === "browse" ? draft : "" })}
            >
              <PlusIcon data-icon="inline-start" />
              Создать ответ
            </Button>
          </div>
        ) : (
          filtered.map((reply, index) => (
            <div
              key={reply.id}
              data-index={index}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "group/reply flex items-stretch gap-1 rounded-xl transition-colors",
                index === activeIndex ? "bg-muted" : "hover:bg-muted/60"
              )}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") {
                  onActiveIndexChange(index)
                }
              }}
            >
              <button
                type="button"
                // Не уводим фокус из поля сообщения: после вставки менеджер сразу жмёт Enter.
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onPick(reply)}
                className="flex min-h-12 min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2 text-left outline-none"
              >
                {reply.title ? <span className="truncate text-sm font-medium">{reply.title}</span> : null}
                <span className={cn("line-clamp-2 text-sm whitespace-pre-line", reply.title ? "text-muted-foreground" : "text-foreground")}>
                  {reply.text}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="my-auto mr-1 shrink-0 text-muted-foreground"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onEdit({ id: reply.id, title: reply.title, text: reply.text })}
                aria-label={`Изменить «${reply.title || reply.text.slice(0, 30)}»`}
                title="Изменить"
              >
                <PencilIcon />
              </Button>
            </div>
          ))
        )}
      </div>

      {filtered.length ? (
        <div className="shrink-0 px-4 pt-1 pb-2 text-[11px] text-muted-foreground pointer-coarse:hidden">
          ↑↓ — выбрать · Enter — вставить · Esc — закрыть
        </div>
      ) : null}
    </div>
  )
}

export function QuickReplyDialog({
  draft,
  onOpenChange,
  onSaved,
}: {
  draft: QuickReplyDraft | null
  onOpenChange: (open: boolean) => void
  onSaved: (replies: QuickReply[], savedId: number | null) => void
}) {
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [pending, setPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  // Каждое открытие — свежая форма из черновика.
  const [loadedDraft, setLoadedDraft] = useState<QuickReplyDraft | null>(null)
  if (draft !== loadedDraft) {
    setLoadedDraft(draft)
    if (draft) {
      setTitle(draft.title)
      setText(draft.text)
      setConfirmDelete(false)
    }
  }

  const editing = Boolean(draft?.id)

  async function submit(event?: { preventDefault: () => void }) {
    event?.preventDefault()
    if (!draft || pending) {
      return
    }
    if (!text.trim()) {
      toast.error("Введите текст ответа.")
      textRef.current?.focus()
      return
    }
    setPending(true)
    try {
      const result = await saveQuickReplyAction(draft.id, { title, text })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      onSaved(result.data.replies, result.data.id)
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!draft?.id || pending) {
      return
    }
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setPending(true)
    try {
      const result = await deleteQuickReplyAction(draft.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      onSaved(result.data.replies, null)
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  function insertName() {
    const el = textRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = `${text.slice(0, start)}{имя}${text.slice(end)}`
    setText(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + 5, start + 5)
    })
  }

  return (
    <Dialog open={Boolean(draft)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Быстрый ответ" : "Новый быстрый ответ"}</DialogTitle>
            <DialogDescription>Общий для всей команды — появится у всех в чатах.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="quick-reply-text">Текст</FieldLabel>
              <Textarea
                id="quick-reply-text"
                ref={textRef}
                autoFocus={!draft?.text}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    void submit(event)
                  }
                }}
                rows={4}
                maxLength={4000}
                placeholder="Здравствуйте, {имя}! Спасибо за заказ…"
                className="max-h-[36dvh] min-h-28 text-base sm:text-sm"
              />
              <FieldDescription className="flex flex-wrap items-center gap-x-1.5">
                <button
                  type="button"
                  onClick={insertName}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-muted px-2 text-xs font-medium text-foreground hover:bg-zinc-200 pointer-coarse:h-9"
                  title="Вставить в текст"
                >
                  <PlusIcon className="size-3" aria-hidden />
                  {"{имя}"}
                </button>
                — в чате подставится имя клиента.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="quick-reply-title">Название (необязательно)</FieldLabel>
              <Input
                id="quick-reply-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={60}
                placeholder="Например: Реквизиты"
                autoFocus={Boolean(draft?.text)}
                className="text-base sm:text-sm"
              />
              <FieldDescription>Короткое слово для поиска: «/реквизиты» в поле сообщения.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="sm:justify-between">
            {editing ? (
              <Button type="button" variant="destructive" onClick={() => void remove()} disabled={pending}>
                {confirmDelete ? "Точно удалить?" : "Удалить"}
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                Отмена
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
                Сохранить
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
