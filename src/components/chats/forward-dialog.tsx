"use client"

import { useEffect, useState } from "react"
import { Loader2Icon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { forwardChatMessageAction } from "@/app/actions"
import { wazzupMessageTypeLabel } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ChatAvatar, formatListTime, formatPhone } from "./chat-shared"
import type { BubbleMessage } from "./message-bubble"

type PickerChat = { id: number; name: string; phone: string; chatType: string; hasAvatar: boolean; lastMessageAt: string }

// Пересылка сообщения в другой диалог: поиск по имени/телефону, выбор строки — отправка.
export function ForwardDialog({
  message,
  currentChatId,
  onOpenChange,
  onForwarded,
}: {
  message: BubbleMessage | null
  currentChatId: number | null
  onOpenChange: (open: boolean) => void
  onForwarded: (targetChatId: number) => void
}) {
  const [search, setSearch] = useState("")
  const [chats, setChats] = useState<PickerChat[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const open = Boolean(message)

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetch(`/api/chats/picker?q=${encodeURIComponent(search)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json())
        .then((data: { chats?: PickerChat[] }) => {
          if (active) {
            setChats(data.chats ?? [])
          }
        })
        .catch(() => undefined)
        .finally(() => active && setLoading(false))
    }, 150)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, search])

  async function forwardTo(target: PickerChat) {
    if (!message) {
      return
    }
    setBusyId(target.id)
    try {
      const result = await forwardChatMessageAction(message.id, target.id)
      if (result.ok) {
        toast.success(`Переслано: ${target.name || formatPhone(target.phone)}`)
        onForwarded(target.id)
        onOpenChange(false)
      } else {
        toast.error(result.message)
      }
    } finally {
      setBusyId(null)
    }
  }

  const preview = message ? message.text || wazzupMessageTypeLabel(message.messageType) : ""

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSearch("")
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] gap-3 overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Переслать сообщение</DialogTitle>
          <DialogDescription className="line-clamp-2">{preview}</DialogDescription>
        </DialogHeader>
        <div className="flex h-11 items-center gap-2 rounded-xl bg-muted/55 px-3 focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/15">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Кому: имя или телефон"
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
            autoFocus
            aria-label="Поиск диалога"
          />
          {loading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <ul className="flex max-h-[55vh] flex-col overflow-y-auto">
          {chats.length === 0 && !loading ? (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">Диалоги не найдены.</li>
          ) : null}
          {chats.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void forwardTo(chat)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60 disabled:opacity-60",
                  chat.id === currentChatId && "text-muted-foreground"
                )}
              >
                <ChatAvatar chatId={chat.id} name={chat.name} hasAvatar={chat.hasAvatar} chatType={chat.chatType} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{chat.name || formatPhone(chat.phone)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {chat.phone ? formatPhone(chat.phone) : chat.chatType}
                    {chat.id === currentChatId ? " · этот диалог" : ""}
                  </span>
                </span>
                {busyId === chat.id ? (
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-[11px] text-muted-foreground tabular-nums">{formatListTime(chat.lastMessageAt)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
