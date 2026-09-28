"use client"

import type React from "react"
import { createContext, useContext, useRef, useState } from "react"
import {
  AlertCircleIcon,
  AtSignIcon,
  CameraIcon,
  CheckCheckIcon,
  CheckIcon,
  ClapperboardIcon,
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
  MicIcon,
  PauseIcon,
  PlayIcon,
  ReceiptTextIcon,
  ReplyIcon,
  ShoppingCartIcon,
  WandSparklesIcon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { WazzupMessage, WazzupQuotedMessage } from "@/lib/db"
import { parseSpecialMessage, specialMessagePreview, type SpecialMessage } from "@/lib/chat-message-kinds"
import { wazzupMessageTypeLabel } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatTime } from "./chat-shared"
import { FloristMark } from "@/components/florist-mark"

// Пузырь сообщения единого окна чатов: входящие слева (белые), наши справа (голубые). Цитата,
// пометки «переслано»/«изменено»/«удалено», вложения (фото → лайтбокс, видео, документ, голосовое
// с расшифровкой), статус доставки с причиной ошибки. Время и галочки для текста «вплывают» в
// последнюю строку, как в мессенджерах. Подряд идущие сообщения одного автора склеиваются в
// группу (groupStart/groupEnd): имя автора — над первым, «хвостик» — у последнего. Действия —
// контекстное меню (правая кнопка / долгое нажатие) и «ответить»/«⋯» при наведении со стороны
// центра ленты (для входящих — справа от пузыря, для наших — слева).
// Цитата показывает оригинал (имя, текст, миниатюра фото/видео) и по нажатию прокручивает к нему;
// служебные тексты Instagram (ответ на историю, отметка в истории, рилс) — отдельными блоками.

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
  | "authorRole"
  | "quotedText"
  | "quoted"
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

export type MessageAction =
  | "reply"
  | "forward"
  | "copy"
  | "saveQuickReply"
  | "open"
  | "download"
  | "transcribe"
  | "toOrderPhoto"
  | "toOrderReceipt"

export function MessageBubble({
  message,
  contactName,
  onAction,
  onOpenMedia,
  onJumpToQuote,
  onAddToCart,
  addBusy,
  highlighted = false,
  groupStart = true,
  groupEnd = true,
}: {
  message: BubbleMessage
  // Имя клиента — подпись цитаты его сообщения.
  contactName: string
  onAction: (action: MessageAction, message: BubbleMessage) => void
  // Фото или видео на весь экран (фото из ленты, история из ответа на неё).
  onOpenMedia: (message: BubbleMessage) => void
  // Нажатие на цитату — прокрутить к оригиналу (Wazzup messageId).
  onJumpToQuote?: (messageId: string) => void
  onAddToCart?: (bouquetId: number) => void
  addBusy?: number | null
  // Короткая подсветка после перехода по цитате.
  highlighted?: boolean
  groupStart?: boolean
  groupEnd?: boolean
}) {
  const outbound = message.direction === "outbound"
  const hasMedia = Boolean(message.contentUri) && message.id > 0
  const canTranscribe = message.messageType === "audio" && hasMedia && !message.transcript
  const canAct = !message.pending && message.id > 0
  const special = parseSpecialMessage(message.text)
  const storyReply = special?.kind === "storyReply" && hasMedia
  // Фото/видео заполняют пузырь почти до края — у него узкие поля, а подписи получают свои. История,
  // на которую ответили, — миниатюра в обычном пузыре.
  const tight = hasMedia && !storyReply && (message.messageType === "image" || message.messageType === "video")
  const inset = tight ? "px-1.5" : ""
  const authorLabel = displayAuthorName(message.authorName)
  const showAuthor = groupStart && Boolean(authorLabel)
  const bodyText = special ? special.body : message.text
  const showText = !message.isDeleted && Boolean(bodyText)

  const items = (
    <>
      <MenuItemRow icon={ReplyIcon} label="Ответить" onSelect={() => onAction("reply", message)} />
      <MenuItemRow icon={ForwardIcon} label="Переслать" onSelect={() => onAction("forward", message)} />
      {bodyText ? <MenuItemRow icon={CopyIcon} label="Копировать текст" onSelect={() => onAction("copy", message)} /> : null}
      {message.text && !message.isDeleted ? (
        <MenuItemRow icon={ZapIcon} label="Сохранить как быстрый ответ" onSelect={() => onAction("saveQuickReply", message)} />
      ) : null}
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
        "group/bubble relative w-fit max-w-full rounded-2xl text-[15px] leading-snug shadow-xs transition-shadow duration-300",
        tight ? "p-1.5" : "px-3.5 py-2",
        outbound ? "bg-blue-100 text-foreground" : "bg-white text-foreground",
        groupEnd && (outbound ? "rounded-br-md" : "rounded-bl-md"),
        message.status === "error" && "ring-1 ring-destructive/40",
        highlighted && "ring-2 ring-brand/70 ring-offset-2 ring-offset-zinc-100"
      )}
    >
      {message.forwarded ? (
        <div className={cn("mb-1 flex items-center gap-1 text-[11px] text-muted-foreground italic", inset, tight && "pt-1")}>
          <ForwardIcon className="size-3" aria-hidden />
          Переслано
        </div>
      ) : null}
      {showAuthor ? (
        <div
          className={cn(
            "mb-0.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold",
            outbound ? "text-brand-strong" : "text-emerald-700",
            inset,
            tight && "pt-1"
          )}
        >
          {authorLabel}
          {outbound ? <FloristMark role={message.authorRole} name={message.authorName} action="Написал" compact /> : null}
        </div>
      ) : null}
      {message.quoted ? (
        <QuoteCard
          quote={message.quoted}
          contactName={contactName}
          tone={outbound ? "outbound" : "inbound"}
          onClick={onJumpToQuote && message.quoted.id > 0 ? () => onJumpToQuote(message.quoted!.messageId) : undefined}
          className={cn("mb-1.5", tight && "mt-0.5")}
        />
      ) : null}
      {message.isDeleted ? (
        <div className={cn("text-muted-foreground italic", inset)}>Сообщение удалено</div>
      ) : (
        <>
          {special && special.kind !== "share" ? (
            <SpecialHeader special={special} outbound={outbound} className={cn(inset, tight && "pt-1")} />
          ) : null}
          {storyReply ? (
            <StoryThumb message={message} onOpen={() => onOpenMedia(message)} className="mb-1.5 w-[5.5rem]" />
          ) : (
            <MessageMedia message={message} onOpenImage={onOpenMedia} />
          )}
          {special?.kind === "share" ? <ShareCard special={special} outbound={outbound} /> : null}
          {message.messageType === "audio" && hasMedia ? <VoiceTranscript messageId={message.id} initial={message.transcript} /> : null}
          {showText ? (
            <div className={cn("whitespace-pre-wrap break-words", tight && "px-1.5 pt-1 pb-0.5")}>
              {linkify(bodyText)}
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

// Wazzup подписывает сообщения, отправленные из приложения на телефоне магазина, как «Phone».
export function displayAuthorName(name: string) {
  return name.trim().toLowerCase() === "phone" ? "С телефона" : name
}

export type QuoteView = WazzupQuotedMessage

// Цитата из сообщения ленты — для панели «Ответ» над полем ввода.
export function quoteFromMessage(message: BubbleMessage): QuoteView {
  return {
    id: message.id,
    messageId: message.messageId,
    direction: message.direction,
    messageType: message.messageType,
    text: message.text,
    hasMedia: Boolean(message.contentUri) && message.id > 0,
    authorName: message.authorName,
    isDeleted: message.isDeleted,
    fileName: message.fileName,
  }
}

// Снимок текста цитаты, который уходит на сервер вместе с ответом (quotedText).
export function quoteSnapshotText(quote: QuoteView) {
  return specialMessagePreview(quote.text) || quote.text || wazzupMessageTypeLabel(quote.messageType)
}

function quoteAuthor(quote: QuoteView, contactName: string) {
  if (quote.direction === "inbound") {
    return quote.authorName || contactName || "Клиент"
  }
  if (quote.direction === "outbound") {
    return "Вы"
  }
  return "Ответ на сообщение"
}

const quoteTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  image: CameraIcon,
  video: ClapperboardIcon,
  audio: MicIcon,
  document: FileTextIcon,
}

// Текст цитаты; иконка типа — только когда нет миниатюры (голосовое, документ, протухшее медиа).
function quoteBody(quote: QuoteView, withThumb: boolean): { text: string; icon: React.ComponentType<{ className?: string }> | null; muted: boolean } {
  if (quote.isDeleted) {
    return { text: "Сообщение удалено", icon: null, muted: true }
  }
  // У ответа на историю миниатюра и так показывает историю — в тексте оставляем слова клиента.
  const special = parseSpecialMessage(quote.text)
  const raw = special?.kind === "storyReply" ? special.body || "Ответ на историю" : specialMessagePreview(quote.text) || quote.text
  const text = raw.replace(/\s+/g, " ").trim()
  const icon = withThumb ? null : (quoteTypeIcons[quote.messageType] ?? null)
  if (text) {
    return { text, icon: quote.messageType === "text" ? null : icon, muted: false }
  }
  if (quote.messageType === "audio") {
    return { text: "Голосовое сообщение", icon, muted: false }
  }
  if (quote.messageType === "document") {
    return { text: quote.fileName || "Документ", icon, muted: false }
  }
  if (quote.messageType === "text") {
    return { text: "Сообщение", icon: null, muted: true }
  }
  return { text: wazzupMessageTypeLabel(quote.messageType), icon, muted: false }
}

// Цитата: полоска цвета автора (клиент — зелёная, мы — фирменная), имя, до двух строк текста и
// миниатюра фото/видео справа. В пузыре не раздвигает его шире текста ответа ([contain:inline-size]),
// но и не бывает уже min-w-56 — иначе короткое «Да» превращало цитату в обрубок.
export function QuoteCard({
  quote,
  contactName,
  tone,
  onClick,
  className,
}: {
  quote: QuoteView
  contactName: string
  tone: "inbound" | "outbound" | "composer"
  onClick?: () => void
  className?: string
}) {
  const fromClient = quote.direction === "inbound"
  const showThumb = quote.id > 0 && quote.hasMedia && !quote.isDeleted && (quote.messageType === "image" || quote.messageType === "video")
  const body = quoteBody(quote, showThumb)
  const content = (
    <>
      <span
        aria-hidden
        className={cn("w-[3px] shrink-0", fromClient ? "bg-emerald-500" : quote.direction === "outbound" ? "bg-brand" : "bg-zinc-400")}
      />
      <span className="min-w-0 flex-1 px-2.5 py-1.5">
        <span
          className={cn(
            "block truncate text-[12.5px] leading-4 font-semibold",
            fromClient ? "text-emerald-700" : quote.direction === "outbound" ? "text-brand-strong" : "text-muted-foreground"
          )}
        >
          {quoteAuthor(quote, contactName)}
        </span>
        <span className={cn("mt-0.5 flex min-w-0 items-start gap-1 text-[13px] leading-[1.125rem]", body.muted ? "text-muted-foreground italic" : "text-foreground/70")}>
          {body.icon ? <body.icon className="mt-0.5 size-3.5 shrink-0 opacity-70" /> : null}
          <span className="line-clamp-2 min-w-0 break-words">{body.text}</span>
        </span>
      </span>
      {showThumb ? <QuoteThumb id={quote.id} messageType={quote.messageType} /> : null}
    </>
  )
  const frame = cn(
    "flex w-full min-w-56 items-stretch overflow-hidden rounded-lg text-left [contain:inline-size]",
    tone === "outbound" ? "bg-white/55" : tone === "inbound" ? "bg-zinc-100" : "bg-zinc-100/90",
    className
  )
  if (!onClick) {
    return <div className={frame}>{content}</div>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Показать сообщение"
      className={cn(
        frame,
        "cursor-pointer transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
        tone === "outbound" ? "hover:bg-white/85" : "hover:bg-zinc-200/70"
      )}
    >
      {content}
    </button>
  )
}

function QuoteThumb({ id, messageType }: { id: number; messageType: string }) {
  const [failed, setFailed] = useState(false)
  const src = mediaUrl({ id })
  return (
    <span className="relative flex w-11 shrink-0 items-center justify-center self-stretch overflow-hidden bg-zinc-200 text-zinc-500">
      {failed ? (
        <ImageOffIcon className="size-4" aria-hidden />
      ) : messageType === "video" ? (
        <>
          <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />
          <PlayIcon className="relative size-3.5 fill-white text-white drop-shadow" aria-hidden />
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />
      )}
    </span>
  )
}

// Подпись над служебным сообщением Instagram: ответ на нашу историю / отметка в истории клиента.
function SpecialHeader({ special, outbound, className }: { special: SpecialMessage; outbound: boolean; className?: string }) {
  const story = special.kind === "storyReply"
  const Icon = story ? ReplyIcon : AtSignIcon
  const label = story
    ? outbound
      ? "Ответ на историю"
      : "Ответ на вашу историю"
    : outbound
      ? "Отметка в истории"
      : "Отметил(а) вас в своей истории"
  return (
    <div className={cn("mb-1 flex items-center gap-1 text-[12.5px] font-medium text-pink-600", className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </div>
  )
}

// Миниатюра истории (вертикальная 9:16), на которую ответил клиент; по нажатию — просмотр.
function StoryThumb({ message, onOpen, className }: { message: BubbleMessage; onOpen: () => void; className?: string }) {
  const [failed, setFailed] = useState(false)
  const src = mediaUrl(message)
  const video = message.messageType === "video"
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={failed}
      aria-label="Открыть историю"
      title="Открыть историю"
      className={cn(
        "group/story relative block aspect-[9/16] overflow-hidden rounded-xl bg-zinc-800 outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
        className
      )}
    >
      {failed ? (
        <span className="flex size-full flex-col items-center justify-center gap-1.5 p-2 text-center text-[11px] leading-tight text-white/70">
          <ImageOffIcon className="size-4" aria-hidden />
          История недоступна
        </span>
      ) : video ? (
        <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      )}
      {!failed ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/story:bg-black/15">
          {video ? (
            <span className="flex size-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
              <PlayIcon className="size-4 translate-x-px fill-current" aria-hidden />
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  )
}

// Рилс/публикация, присланные ссылкой: карточка вместо «You got reel https://…».
function ShareCard({ special, outbound }: { special: Extract<SpecialMessage, { kind: "share" }>; outbound: boolean }) {
  let path = special.url
  try {
    const url = new URL(special.url)
    path = `${url.hostname.replace(/^www\./, "")}${url.pathname}`.replace(/\/$/, "")
  } catch {
    // оставим как есть
  }
  return (
    <a
      href={special.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mb-1 flex min-w-56 items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
        outbound ? "bg-white/55 hover:bg-white/85" : "bg-zinc-100 hover:bg-zinc-200/70"
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pink-100 text-pink-600">
        <ClapperboardIcon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{special.label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{path}</span>
      </span>
      <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  )
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
