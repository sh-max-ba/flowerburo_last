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
import { formatTime, messagePreview } from "./chat-shared"

// Пузырь сообщения единого окна чатов: входящие слева (белые), наши справа (голубые). Цитата,
// пометки «переслано»/«изменено»/«удалено», вложения (фото → лайтбокс, видео, документ, голосовое
// с расшифровкой), статус доставки с причиной ошибки. Время и галочки для текста «вплывают» в
// последнюю строку, как в мессенджерах. Подряд идущие сообщения одного автора склеиваются в
// группу (groupStart/groupEnd): имя автора — над первым, «хвостик» — у последнего. Действия —
// контекстное меню (правая кнопка / долгое нажатие) и «ответить»/«⋯» при наведении со стороны
// центра ленты (для входящих — справа от пузыря, для наших — слева).

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
  groupStart = true,
  groupEnd = true,
}: {
  message: BubbleMessage
  onAction: (action: MessageAction, message: BubbleMessage) => void
  onOpenImage: (message: BubbleMessage) => void
  onAddToCart?: (bouquetId: number) => void
  addBusy?: number | null
  groupStart?: boolean
  groupEnd?: boolean
}) {
  const outbound = message.direction === "outbound"
  const hasMedia = Boolean(message.contentUri) && message.id > 0
  const canTranscribe = message.messageType === "audio" && hasMedia && !message.transcript
  const canAct = !message.pending && message.id > 0
  // Фото/видео заполняют пузырь почти до края — у него узкие поля, а подписи получают свои.
  const tight = hasMedia && (message.messageType === "image" || message.messageType === "video")
  const inset = tight ? "px-1.5" : ""
  const showAuthor = groupStart && Boolean(message.authorName)
  const showText = !message.isDeleted && Boolean(message.text)

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

  // Время + статус. Для текста — плавающий блок в конце последней строки, для вложений и
  // заглушек — отдельной строкой справа.
  const meta = (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] leading-none whitespace-nowrap tabular-nums select-none",
        outbound ? "text-blue-900/55" : "text-muted-foreground"
      )}
    >
      {message.isEdited ? <span className="italic">изменено</span> : null}
      <span>{formatTime(message.dateTime)}</span>
      {outbound ? <StatusTicks status={message.status} errorText={message.errorText} /> : null}
    </span>
  )

  const bubble = (
    <div
      className={cn(
        "group/bubble relative w-fit max-w-full rounded-2xl text-[15px] leading-snug shadow-xs",
        tight ? "p-1.5" : "px-3.5 py-2",
        outbound ? "bg-blue-100 text-foreground" : "bg-white text-foreground",
        groupEnd && (outbound ? "rounded-br-md" : "rounded-bl-md"),
        message.status === "error" && "ring-1 ring-destructive/40"
      )}
    >
      {message.forwarded ? (
        <div className={cn("mb-1 flex items-center gap-1 text-[11px] text-muted-foreground italic", inset, tight && "pt-1")}>
          <ForwardIcon className="size-3" aria-hidden />
          Переслано
        </div>
      ) : null}
      {showAuthor ? (
        <div className={cn("mb-0.5 text-xs font-semibold", outbound ? "text-brand-strong" : "text-emerald-700", inset, tight && "pt-1")}>
          {message.authorName}
        </div>
      ) : null}
      {message.quotedText ? (
        <div
          className={cn(
            "mb-1.5 rounded-md border-l-2 px-2.5 py-1.5 text-[13px] leading-snug",
            outbound ? "border-brand-strong bg-white/60 text-blue-950/70" : "border-brand bg-zinc-100 text-muted-foreground",
            tight && "mx-1.5 mt-1"
          )}
        >
          {/* Цитата вложения приходит как «[image]» — показываем подпись типа, как в списке диалогов. */}
          <span className="line-clamp-2">{messagePreview(message.quotedText, "") || message.quotedText}</span>
        </div>
      ) : null}
      {message.isDeleted ? (
        <div className={cn("text-muted-foreground italic", inset)}>Сообщение удалено</div>
      ) : (
        <>
          <MessageMedia message={message} onOpenImage={onOpenImage} />
          {message.messageType === "audio" && hasMedia ? <VoiceTranscript messageId={message.id} initial={message.transcript} /> : null}
          {showText ? (
            <div className={cn("whitespace-pre-wrap break-words", tight && "px-1.5 pt-1 pb-0.5")}>
              {linkify(message.text)}
              <span className="float-right mt-[7px] ml-2.5">{meta}</span>
            </div>
          ) : null}
          {!message.text && !message.contentUri ? (
            <div className={cn("text-muted-foreground italic", inset)}>{wazzupMessageTypeLabel(message.messageType)}</div>
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
            outbound ? "bg-white/60 hover:bg-white" : "bg-zinc-100 hover:bg-zinc-200",
            tight && "mx-1.5"
          )}
        >
          <ShoppingCartIcon className="size-3.5" />В заказ
        </button>
      ) : null}
      {!showText ? <div className={cn("mt-1 flex justify-end", inset, tight && "pb-0.5")}>{meta}</div> : null}
      {message.status === "error" && message.errorText ? (
        <div className={cn("mt-1 flex items-start gap-1 text-[11px] text-destructive", inset)}>
          <AlertCircleIcon className="mt-px size-3 shrink-0" aria-hidden />
          <span className="break-words">{message.errorText}</span>
        </div>
      ) : null}
    </div>
  )

  const hoverActions = canAct ? (
    <div className="flex shrink-0 items-center self-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:hidden">
      <button type="button" onClick={() => onAction("reply", message)} className={hoverActionClass} aria-label="Ответить" title="Ответить">
        <ReplyIcon className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(hoverActionClass, "data-popup-open:bg-zinc-200/80 data-popup-open:text-zinc-700")}
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

  // Ширина пузыря ограничена от ленты (85% / 36rem), а сам он — по содержимому: иначе обёртка
  // ужималась до минимума и «тест» переносился по буквам.
  const body = canAct ? (
    <ContextMenu>
      <ContextMenuTrigger className="flex min-w-0 max-w-[min(85%,36rem)]">{bubble}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <MenuKindContext.Provider value="context">{items}</MenuKindContext.Provider>
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    <div className="flex min-w-0 max-w-[min(85%,36rem)]">{bubble}</div>
  )

  return (
    <div className={cn("group/row flex items-end gap-1", outbound ? "justify-end" : "justify-start")}>
      {outbound ? hoverActions : null}
      {body}
      {outbound ? null : hoverActions}
    </div>
  )
}

const hoverActionClass =
  "flex size-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-200/80 hover:text-zinc-700"

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

function MessageMedia({ message, onOpenImage }: { message: BubbleMessage; onOpenImage: (message: BubbleMessage) => void }) {
  if (!message.contentUri || message.id <= 0) {
    return null
  }
  const src = mediaUrl(message)

  if (message.messageType === "image") {
    return <ImageAttachment src={src} alt={message.fileName || "Фото"} onOpen={() => onOpenImage(message)} />
  }
  if (message.messageType === "video") {
    return (
      <video src={src} controls preload="metadata" className="max-h-72 w-full rounded-xl bg-black">
        Видео не поддерживается браузером.
      </video>
    )
  }
  if (message.messageType === "audio") {
    return <VoiceMessagePlayer src={src} />
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-2.5 rounded-lg bg-black/5 px-2.5 py-2 text-sm hover:bg-black/10"
    >
      <FileTextIcon className="size-5 shrink-0 opacity-80" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{guessFileName(message)}</span>
        <span className="block text-[11px] text-muted-foreground">{wazzupMessageTypeLabel(message.messageType)} · открыть</span>
      </span>
    </a>
  )
}

// Фото в пузыре: пока грузится — серый блок фиксированной высоты (без прыжков ленты), при ошибке
// (ссылка Wazzup протухла) — заглушка вместо битой картинки.
function ImageAttachment({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  if (state === "error") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-black/5 px-2.5 py-2 text-xs text-muted-foreground">
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
        "block w-full overflow-hidden rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
        state === "loading" && "h-40 w-56 max-w-full animate-pulse bg-zinc-200/70"
      )}
      aria-label="Открыть фото"
    >
      {/* Контент Wazzup протухает — рендерим через серверный прокси /api/wazzup/media. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={cn("max-h-80 w-full bg-zinc-100 object-cover", state === "loading" && "invisible h-0")}
        loading="lazy"
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
      />
    </button>
  )
}

// Кастомный плеер голосовых: play/pause, кликабельная дорожка, таймер. webm от MediaRecorder
// часто без длительности в заголовке — досчитываем её «перемоткой» в конец, без автоплея.
export function VoiceMessagePlayer({ src }: { src: string }) {
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
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-white transition hover:bg-brand-strong"
      >
        {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4 translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={seek}
          aria-label="Перемотать"
          className="block h-1.5 w-full cursor-pointer rounded-full bg-black/10"
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
        </button>
        <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
          {formatSeconds(Math.floor(current))} / {formatSeconds(Math.floor(safeDuration))}
        </div>
      </div>
    </div>
  )
}

// Расшифровка голосового (STT на сервере, результат кэшируется на строке сообщения).
export function VoiceTranscript({ messageId, initial }: { messageId: number; initial: string }) {
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
      <div className="mt-1 border-t border-black/10 pt-1.5 text-[13px] leading-snug whitespace-pre-wrap break-words text-muted-foreground">
        {text}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === "loading"}
      className="mt-1 flex items-center gap-1 text-[11px] text-brand-strong underline-offset-2 hover:underline disabled:opacity-70"
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
    return <AlertCircleIcon className="size-3.5 text-destructive" aria-label={errorText ? `Ошибка: ${errorText}` : "Ошибка отправки"} />
  }
  if (status === "read") {
    return <CheckCheckIcon className="size-3.5 text-sky-500" aria-label="Прочитано" />
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
