"use client"

import type React from "react"
import { createContext, useContext, useRef, useState } from "react"
import {
  AlertCircleIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ForwardIcon,
  ImageOffIcon,
  ImagePlusIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  ReceiptTextIcon,
  ReplyIcon,
  ShoppingCartIcon,
  WandSparklesIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { WazzupMessage } from "@/lib/db"
import { wazzupMessageTypeLabel } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatTime } from "./chat-shared"

// Пузырь сообщения единого окна чатов: входящие слева (белые), наши справа (тёмные). Цитата,
// пометки «переслано»/«изменено»/«удалено», вложения (фото → лайтбокс, видео, документ, голосовое
// с расшифровкой), статус доставки с причиной ошибки. Действия — контекстное меню (правая кнопка /
// долгое нажатие) и та же выпадашка по «⋯» при наведении.

export type BubbleMessage = Pick<
  WazzupMessage,
  | "id"
  | "messageId"
  | "direction"
  | "messageType"
  | "text"
  | "contentUri"
  | "status"
  | "authorName"
  | "quotedText"
  | "transcript"
  | "isEdited"
  | "isDeleted"
  | "forwarded"
  | "errorText"
  | "fileName"
> & {
  key: string
  dateTime: string
  // Локальная (ещё не подтверждённая сервером) отправка: без messageId, статус sending/error.
  pending?: boolean
  bouquetId?: number | null
}

export type MessageAction = "reply" | "forward" | "copy" | "open" | "download" | "transcribe" | "toOrderPhoto" | "toOrderReceipt"

export function MessageBubble({
  message,
  onAction,
  onOpenImage,
  onAddToCart,
  addBusy,
}: {
  message: BubbleMessage
  onAction: (action: MessageAction, message: BubbleMessage) => void
  onOpenImage: (message: BubbleMessage) => void
  onAddToCart?: (bouquetId: number) => void
  addBusy?: number | null
}) {
  const outbound = message.direction === "outbound"
  const hasMedia = Boolean(message.contentUri) && message.id > 0
  const canTranscribe = message.messageType === "audio" && hasMedia && !message.transcript
  const canAct = !message.pending && message.id > 0

  const items = (
    <>
      <MenuItemRow icon={ReplyIcon} label="Ответить" onSelect={() => onAction("reply", message)} />
      <MenuItemRow icon={ForwardIcon} label="Переслать" onSelect={() => onAction("forward", message)} />
      {message.text ? <MenuItemRow icon={CopyIcon} label="Копировать текст" onSelect={() => onAction("copy", message)} /> : null}
      {hasMedia && message.messageType === "image" ? (
        <>
          <MenuSeparatorRow />
          <MenuItemRow icon={ImagePlusIcon} label="В заказ как фото" onSelect={() => onAction("toOrderPhoto", message)} />
          <MenuItemRow icon={ReceiptTextIcon} label="В заказ как чек" onSelect={() => onAction("toOrderReceipt", message)} />
        </>
      ) : null}
      {hasMedia ? (
        <>
          <MenuSeparatorRow />
          <MenuItemRow icon={ExternalLinkIcon} label="Открыть в новой вкладке" onSelect={() => onAction("open", message)} />
          <MenuItemRow icon={DownloadIcon} label="Скачать" onSelect={() => onAction("download", message)} />
        </>
      ) : null}
      {canTranscribe ? <MenuItemRow icon={WandSparklesIcon} label="Расшифровать" onSelect={() => onAction("transcribe", message)} /> : null}
    </>
  )

  const bubble = (
    <div
      className={cn(
        "group/bubble relative max-w-[min(85%,36rem)] rounded-lg px-3 py-2 text-sm shadow-xs",
        outbound ? "rounded-br-sm bg-zinc-900 text-zinc-50" : "rounded-bl-sm bg-background text-foreground",
        message.status === "error" && "ring-1 ring-destructive/40"
      )}
    >
      {message.forwarded ? (
        <div className={cn("mb-1 flex items-center gap-1 text-[11px] italic", outbound ? "text-zinc-400" : "text-muted-foreground")}>
          <ForwardIcon className="size-3" aria-hidden />
          Переслано
        </div>
      ) : null}
      {!outbound && message.authorName ? (
        <div className="mb-0.5 text-xs font-medium text-emerald-700">{message.authorName}</div>
      ) : null}
      {message.quotedText ? (
        <div
          className={cn(
            "mb-1.5 rounded-sm border-l-2 px-2 py-1 text-xs",
            outbound ? "border-zinc-500 bg-white/10 text-zinc-300" : "border-brand bg-muted/60 text-muted-foreground"
          )}
        >
          <span className="line-clamp-2">{message.quotedText}</span>
        </div>
      ) : null}
      {message.isDeleted ? (
        <div className={cn("italic", outbound ? "text-zinc-400" : "text-muted-foreground")}>Сообщение удалено</div>
      ) : (
        <>
          <MessageMedia message={message} outbound={outbound} onOpenImage={onOpenImage} />
          {message.messageType === "audio" && hasMedia ? (
            <VoiceTranscript messageId={message.id} initial={message.transcript} outbound={outbound} />
          ) : null}
          {message.text ? <div className="whitespace-pre-wrap break-words">{linkify(message.text)}</div> : null}
          {!message.text && !message.contentUri ? (
            <div className={cn("italic", outbound ? "text-zinc-400" : "text-muted-foreground")}>
              {wazzupMessageTypeLabel(message.messageType)}
            </div>
          ) : null}
        </>
      )}
      {message.bouquetId != null && onAddToCart ? (
        <button
          type="button"
          onClick={() => message.bouquetId != null && onAddToCart(message.bouquetId)}
          disabled={addBusy === message.bouquetId}
          className={cn(
            "mt-1.5 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition",
            outbound ? "bg-white/15 hover:bg-white/25" : "bg-zinc-100 hover:bg-zinc-200"
          )}
        >
          <ShoppingCartIcon className="size-3.5" />В заказ
        </button>
      ) : null}
      <div
        className={cn(
          "mt-1 flex items-center justify-end gap-1 text-[10px] leading-none",
          outbound ? "text-zinc-400" : "text-muted-foreground"
        )}
      >
        {message.isEdited ? <span className="italic">изменено ·</span> : null}
        {outbound && message.authorName ? <span className="truncate">{message.authorName} ·</span> : null}
        <span className="tabular-nums">{formatTime(message.dateTime)}</span>
        {outbound ? <StatusTicks status={message.status} errorText={message.errorText} /> : null}
      </div>
      {message.status === "error" && message.errorText ? (
        <div className="mt-1 flex items-start gap-1 text-[11px] text-red-300">
          <AlertCircleIcon className="mt-px size-3 shrink-0" aria-hidden />
          <span className="break-words">{message.errorText}</span>
        </div>
      ) : null}
    </div>
  )

  const hoverActions = canAct ? (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:hidden",
        outbound ? "order-first" : ""
      )}
    >
      <button
        type="button"
        onClick={() => onAction("reply", message)}
        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
        aria-label="Ответить"
        title="Ответить"
      >
        <ReplyIcon className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 data-popup-open:bg-zinc-200 data-popup-open:opacity-100"
              aria-label="Действия с сообщением"
              title="Действия"
            />
          }
        >
          <EllipsisIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={outbound ? "end" : "start"} className="w-56">
          <MenuKindContext.Provider value="dropdown">{items}</MenuKindContext.Provider>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null

  return (
    <div className={cn("group/row flex items-end gap-1", outbound ? "justify-end" : "justify-start")}>
      {hoverActions}
      {canAct ? (
        <ContextMenu>
          <ContextMenuTrigger className="flex max-w-full">{bubble}</ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <MenuKindContext.Provider value="context">{items}</MenuKindContext.Provider>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        bubble
      )}
    </div>
  )
}

// Один и тот же набор пунктов рендерится и в контекстном меню, и в выпадашке «⋯» — компонент
// строки выбирает примитив по контексту.
const MenuKindContext = createContext<"context" | "dropdown">("context")

function MenuItemRow({ icon: Icon, label, onSelect }: { icon: React.ComponentType<{ className?: string }>; label: string; onSelect: () => void }) {
  const kind = useContext(MenuKindContext)
  if (kind === "dropdown") {
    return (
      <DropdownMenuItem onClick={onSelect}>
        <Icon className="size-4" />
        {label}
      </DropdownMenuItem>
    )
  }
  return (
    <ContextMenuItem onClick={onSelect}>
      <Icon className="size-4" />
      {label}
    </ContextMenuItem>
  )
}

function MenuSeparatorRow() {
  const kind = useContext(MenuKindContext)
  return kind === "dropdown" ? <DropdownMenuSeparator /> : <ContextMenuSeparator />
}

export function mediaUrl(message: Pick<BubbleMessage, "id">) {
  return `/api/wazzup/media?id=${message.id}`
}

export function guessFileName(message: Pick<BubbleMessage, "fileName" | "contentUri" | "messageType">) {
  if (message.fileName) {
    return message.fileName
  }
  try {
    const name = decodeURIComponent(new URL(message.contentUri).pathname.split("/").pop() ?? "")
    if (name && name.includes(".")) {
      return name
    }
  } catch {
    // не URL — ниже подпись по типу
  }
  return wazzupMessageTypeLabel(message.messageType)
}

function MessageMedia({
  message,
  outbound,
  onOpenImage,
}: {
  message: BubbleMessage
  outbound: boolean
  onOpenImage: (message: BubbleMessage) => void
}) {
  if (!message.contentUri || message.id <= 0) {
    return null
  }
  const src = mediaUrl(message)

  if (message.messageType === "image") {
    return <ImageAttachment src={src} alt={message.fileName || "Фото"} outbound={outbound} onOpen={() => onOpenImage(message)} />
  }
  if (message.messageType === "video") {
    return (
      <video src={src} controls preload="metadata" className="mb-1 max-h-72 w-full rounded-md bg-black">
        Видео не поддерживается браузером.
      </video>
    )
  }
  if (message.messageType === "audio") {
    return <VoiceMessagePlayer src={src} outbound={outbound} />
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        outbound ? "bg-white/10 hover:bg-white/15" : "bg-muted/60 hover:bg-muted"
      )}
    >
      <FileTextIcon className="size-5 shrink-0 opacity-80" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{guessFileName(message)}</span>
        <span className={cn("block text-[11px]", outbound ? "text-zinc-400" : "text-muted-foreground")}>
          {wazzupMessageTypeLabel(message.messageType)} · открыть
        </span>
      </span>
    </a>
  )
}

// Фото в пузыре: пока грузится — серый блок фиксированной высоты (без прыжков ленты), при ошибке
// (ссылка Wazzup протухла) — заглушка вместо битой картинки.
function ImageAttachment({ src, alt, outbound, onOpen }: { src: string; alt: string; outbound: boolean; onOpen: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  if (state === "error") {
    return (
      <div className={cn("mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-xs", outbound ? "bg-white/10 text-zinc-300" : "bg-muted/60 text-muted-foreground")}>
        <ImageOffIcon className="size-4 shrink-0" />
        Фото недоступно — ссылка устарела
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "mb-1 block w-full overflow-hidden rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
        state === "loading" && "h-40 w-56 max-w-full animate-pulse bg-zinc-200/70"
      )}
      aria-label="Открыть фото"
    >
      {/* Контент Wazzup протухает — рендерим через серверный прокси /api/wazzup/media. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={cn("max-h-72 w-full bg-zinc-100 object-cover", state === "loading" && "invisible h-0")}
        loading="lazy"
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
      />
    </button>
  )
}

// Кастомный плеер голосовых: play/pause, кликабельная дорожка, таймер. webm от MediaRecorder
// часто без длительности в заголовке — досчитываем её «перемоткой» в конец, без автоплея.
export function VoiceMessagePlayer({ src, outbound }: { src: string; outbound: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const resolvingRef = useRef(false)

  function toggle() {
    const audio = audioRef.current
    if (!audio) {
      return
    }
    if (audio.paused) {
      void audio.play().catch(() => undefined)
    } else {
      audio.pause()
    }
  }

  function seek(event: React.MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(duration) || duration <= 0) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
    setCurrent(audio.currentTime)
  }

  const safeDuration = Number.isFinite(duration) ? duration : 0
  const progress = safeDuration > 0 ? Math.min(100, (current / safeDuration) * 100) : 0

  return (
    <div className="mb-1 flex w-60 max-w-full items-center gap-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget
          if (Number.isFinite(audio.duration)) {
            setDuration(audio.duration)
          } else {
            resolvingRef.current = true
            audio.currentTime = 1e7
          }
        }}
        onDurationChange={(event) => {
          const audio = event.currentTarget
          if (!Number.isFinite(audio.duration)) {
            return
          }
          setDuration(audio.duration)
          if (resolvingRef.current) {
            resolvingRef.current = false
            audio.currentTime = 0
            setCurrent(0)
          }
        }}
        onTimeUpdate={(event) => {
          if (!resolvingRef.current) {
            setCurrent(event.currentTarget.currentTime)
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrent(0)
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition",
          outbound ? "bg-white/20 text-white hover:bg-white/30" : "bg-zinc-900 text-white hover:bg-zinc-700"
        )}
      >
        {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4 translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={seek}
          aria-label="Перемотать"
          className={cn("block h-1.5 w-full cursor-pointer rounded-full", outbound ? "bg-white/25" : "bg-zinc-200")}
        >
          <div className={cn("h-full rounded-full", outbound ? "bg-white" : "bg-zinc-900")} style={{ width: `${progress}%` }} />
        </button>
        <div className={cn("mt-1 text-[10px] tabular-nums", outbound ? "text-zinc-400" : "text-muted-foreground")}>
          {formatSeconds(Math.floor(current))} / {formatSeconds(Math.floor(safeDuration))}
        </div>
      </div>
    </div>
  )
}

// Расшифровка голосового (STT на сервере, результат кэшируется на строке сообщения).
export function VoiceTranscript({ messageId, initial, outbound }: { messageId: number; initial: string; outbound: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(initial ? "done" : "idle")
  const [text, setText] = useState(initial)
  const [error, setError] = useState("")
  const [trackedInitial, setTrackedInitial] = useState(initial)
  if (initial !== trackedInitial) {
    setTrackedInitial(initial)
    if (initial) {
      setText(initial)
      setState("done")
    }
  }

  async function run() {
    if (state === "loading") {
      return
    }
    setState("loading")
    setError("")
    try {
      const response = await fetch("/api/wazzup/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      })
      const data = (await response.json()) as { ok?: boolean; text?: string; message?: string }
      if (!response.ok || !data.ok || !data.text) {
        throw new Error(data.message || "Не удалось расшифровать.")
      }
      setText(data.text)
      setState("done")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось расшифровать.")
      setState("error")
    }
  }

  if (state === "done") {
    return (
      <div className={cn("mt-1 border-t pt-1.5 text-xs leading-snug whitespace-pre-wrap break-words", outbound ? "border-white/20 text-zinc-300" : "border-border/60 text-muted-foreground")}>
        {text}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === "loading"}
      className={cn("mt-1 flex items-center gap-1 text-[11px] underline-offset-2 hover:underline disabled:opacity-70", outbound ? "text-zinc-300" : "text-brand-strong")}
    >
      {state === "loading" ? <Loader2Icon className="size-3 animate-spin" /> : <FileTextIcon className="size-3" />}
      {state === "loading" ? "Расшифровываем…" : state === "error" ? error || "Ошибка — повторить" : "Расшифровать"}
    </button>
  )
}

function StatusTicks({ status, errorText }: { status: string; errorText: string }) {
  if (status === "sending") {
    return <ClockIcon className="size-3" aria-label="Отправка" />
  }
  if (status === "error") {
    return <AlertCircleIcon className="size-3.5 text-red-400" aria-label={errorText ? `Ошибка: ${errorText}` : "Ошибка отправки"} />
  }
  if (status === "read") {
    return <CheckCheckIcon className="size-3.5 text-sky-400" aria-label="Прочитано" />
  }
  if (status === "delivered") {
    return <CheckCheckIcon className="size-3.5" aria-label="Доставлено" />
  }
  return <CheckIcon className="size-3.5" aria-label="Отправлено" />
}

export function formatSeconds(total: number) {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

// Ссылки в тексте кликабельны (в переписке часто шлют адреса и ссылки на каталог).
const urlPattern = /(https?:\/\/[^\s<>"']+)/g
const urlTest = /^https?:\/\//

function linkify(text: string): React.ReactNode {
  const parts = text.split(urlPattern)
  if (parts.length === 1) {
    return text
  }
  return parts.map((part, index) =>
    urlTest.test(part) ? (
      <a key={index} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-all">
        {part}
      </a>
    ) : (
      <span key={index}>{part}</span>
    )
  )
}

export async function copyMessageText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("Текст скопирован")
  } catch {
    toast.error("Не удалось скопировать")
  }
}
