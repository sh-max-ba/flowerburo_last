"use client"

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckCheckIcon,
  CheckIcon,
  MessageSquareDashedIcon,
  UserRoundCheckIcon,
  UserRoundXIcon,
} from "lucide-react"
import type { ChatSummary } from "@/lib/db"
import { cn } from "@/lib/utils"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ChatAvatar, formatListTime, messagePreview } from "./chat-shared"

// Колонка диалогов: аватар с каналом, имя, время, превью последнего сообщения, счётчик
// неотвеченных: яркий — клиенту не отвечали вообще, бледно-серый — разговор уже идёт (отвечали с
// телефона или из CRM). Контекстное меню строки (правая кнопка / долгое нажатие) — «Отметить
// отвеченным», «Взять себе», «В архив».

export function ChatList({
  chats,
  selectedId,
  currentUserId,
  loading,
  emptyHint,
  onSelect,
  onMarkAnswered,
  onAssignToMe,
  onUnassign,
  onArchive,
}: {
  chats: ChatSummary[]
  selectedId: number | null
  currentUserId: number
  loading: boolean
  emptyHint: string
  onSelect: (chat: ChatSummary) => void
  onMarkAnswered: (chat: ChatSummary) => void
  onAssignToMe: (chat: ChatSummary) => void
  onUnassign: (chat: ChatSummary) => void
  onArchive: (chat: ChatSummary, archived: boolean) => void
}) {
  if (!chats.length) {
    return (
      <Empty className="min-h-56 border-0">
        <EmptyHeader>
          <MessageSquareDashedIcon className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <EmptyTitle>{loading ? "Загружаем диалоги…" : "Диалогов нет"}</EmptyTitle>
          {!loading ? <EmptyDescription>{emptyHint}</EmptyDescription> : null}
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul role="listbox" aria-label="Диалоги" className="flex flex-col gap-px px-1.5 py-1.5">
      {chats.map((chat) => {
        const active = chat.id === selectedId
        const mine = chat.assignedUserId === currentUserId
        // Яркое выделение — только там, где клиенту ещё не отвечали.
        const urgent = chat.unansweredCount > 0 && !chat.repliedRecently
        return (
          <li key={chat.id}>
            <ContextMenu>
              <ContextMenuTrigger>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onSelect(chat)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left outline-none transition-colors focus-visible:bg-muted/70",
                    active ? "bg-muted" : "hover:bg-muted/50"
                  )}
                >
                  <ChatAvatar chatId={chat.id} name={chat.name} hasAvatar={chat.hasAvatar} chatType={chat.chatType} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-[15px]", urgent ? "font-semibold" : "font-medium")}>
                        {chat.name || chat.phone || chat.chatId}
                      </span>
                      <span className={cn("shrink-0 text-[11px] tabular-nums", urgent ? "font-medium text-brand-strong" : "text-muted-foreground")}>
                        {formatListTime(chat.lastMessageAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "flex min-w-0 items-center gap-1 truncate text-[13px]",
                          urgent ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {chat.lastMessageDirection === "outbound" ? (
                          <span className="shrink-0 text-sky-500" aria-label="Наш ответ">
                            <CheckCheckIcon className="size-3.5" />
                          </span>
                        ) : null}
                        <span className="truncate">{messagePreview(chat.lastMessageText, chat.lastMessageType) || "Нет сообщений"}</span>
                      </span>
                      {chat.unansweredCount > 0 ? (
                        <span
                          className={cn(
                            "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                            urgent ? "bg-brand text-brand-foreground" : "bg-zinc-200/80 font-medium text-zinc-500"
                          )}
                          aria-label={urgent ? `${chat.unansweredCount} без ответа` : `${chat.unansweredCount} после нашего ответа`}
                          title={urgent ? undefined : "Клиенту уже отвечали — новые сообщения после ответа"}
                        >
                          {chat.unansweredCount > 99 ? "99+" : chat.unansweredCount}
                        </span>
                      ) : mine ? (
                        <UserRoundCheckIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Мой диалог" />
                      ) : null}
                    </div>
                  </div>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {chat.unansweredCount > 0 ? (
                  <ContextMenuItem onClick={() => onMarkAnswered(chat)}>
                    <CheckIcon />
                    Отметить отвеченным
                  </ContextMenuItem>
                ) : null}
                {mine ? (
                  <ContextMenuItem onClick={() => onUnassign(chat)}>
                    <UserRoundXIcon />
                    Снять с себя
                  </ContextMenuItem>
                ) : (
                  <ContextMenuItem onClick={() => onAssignToMe(chat)}>
                    <UserRoundCheckIcon />
                    Взять себе
                  </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onArchive(chat, !chat.archived)}>
                  {chat.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                  {chat.archived ? "Вернуть из архива" : "В архив"}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </li>
        )
      })}
    </ul>
  )
}
