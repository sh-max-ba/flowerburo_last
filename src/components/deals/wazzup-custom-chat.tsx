"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  Flower2Icon,
  Loader2Icon,
  MessageCircleIcon,
  MicIcon,
  PaperclipIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShoppingCartIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  addDealBouquetAction,
  linkDealToWazzupByCustomerAction,
  sendBouquetToDealChatAction,
  sendTextToDealChatAction,
} from "@/app/actions"
import type { BouquetTemplate } from "@/lib/db"
import { getBouquetAvailability } from "@/lib/bouquet-availability"
import { wazzupMessageTypeLabel } from "@/lib/labels"
import { cn, formatMoney } from "@/lib/utils"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { BouquetThumbnail } from "@/components/bouquets/bouquet-thumbnail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

const pollIntervalMs = 3000

type ChatMessage = {
  id: number
  messageId: string
  crmMessageId: string
  direction: "inbound" | "outbound"
  messageType: string
  text: string
  contentUri: string
  status: string
  authorName: string
  quotedMessageId: string
  quotedText: string
  transcript: string
  dateTime: string
  createdAt: string
}

type ChatResponse =
  | { status: "ok"; messages: ChatMessage[]; revision: string }
  | { status: "not_configured" | "disabled" | "no_chat" | "error"; message?: string }

type ChatView = { status: "loading" } | ChatResponse

type PendingMessage = {
  tempId: number
  kind: "text" | "voice"
  text: string
  dateTime: string
  status: "sending" | "error"
}

type ReplyTarget = { messageId: string; text: string; outbound: boolean }

type RecordAction = "send" | "transcribe" | "cancel"

type RenderItem = {
  key: string
  id: number
  messageId: string
  direction: "inbound" | "outbound"
  text: string
  contentUri: string
  messageType: string
  status: string
  authorName: string
  quotedText: string
  transcript: string
  dateTime: string
  bouquetId: number | null
}

async function fetchChat(dealId: number, signal?: AbortSignal): Promise<ChatResponse> {
  const response = await fetch(`/api/wazzup/chat?dealId=${dealId}`, { cache: "no-store", signal })
  return (await response.json()) as ChatResponse
}

async function fetchChatProbe(
  dealId: number,
  signal?: AbortSignal
): Promise<{ status: string; revision?: string }> {
  const response = await fetch(`/api/wazzup/chat?dealId=${dealId}&probe=1`, { cache: "no-store", signal })
  return (await response.json()) as { status: string; revision?: string }
}

function viewSignature(data: ChatResponse): string {
  return data.status === "ok" ? data.revision : `status:${data.status}`
}

function probeSignature(data: { status: string; revision?: string }): string {
  return data.status === "ok" && data.revision ? data.revision : `status:${data.status}`
}

// Букетные отправки имеют детерминированный crmMessageId; по нему узнаём id букета, чтобы показать
// в чате кнопку «В корзину». Берём только текстовое сообщение букета (одна кнопка на букет).
function parseBouquetId(crmMessageId: string): number | null {
  const match = /^deal-\d+-bouquet-(\d+)-text$/.exec(crmMessageId)
  return match ? Number(match[1]) : null
}

function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") {
    return ""
  }
  for (const candidate of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }
  return ""
}

export function WazzupCustomChat({ dealId, bouquets }: { dealId: number; bouquets: BouquetTemplate[] }) {
  const router = useRouter()
  const [view, setView] = useState<ChatView>({ status: "loading" })
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [isLinkPending, startLinkTransition] = useTransition()
  // Запись голосового.
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  // Идёт распознавание надиктовки (запись → текст в поле ввода).
  const [transcribing, setTranscribing] = useState(false)
  // Модалка выбора букета.
  const [bouquetOpen, setBouquetOpen] = useState(false)
  const [bouquetSearch, setBouquetSearch] = useState("")
  const [bouquetBusy, setBouquetBusy] = useState<number | null>(null)

  const revisionRef = useRef<string>("")
  const tempIdRef = useRef(-1)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  // Что сделать с записью по остановке: отправить голосом / расшифровать в поле ввода / отменить.
  const recordActionRef = useRef<RecordAction>("send")

  // Сброс на "loading" при смене сделки — во время рендера (правило react-hooks/set-state-in-effect).
  const [trackedDealId, setTrackedDealId] = useState(dealId)
  if (trackedDealId !== dealId) {
    setTrackedDealId(dealId)
    setView({ status: "loading" })
    setPending([])
    setReplyTo(null)
  }

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    revisionRef.current = ""
    void fetchChat(dealId, controller.signal)
      .then((data) => {
        if (!active) {
          return
        }
        revisionRef.current = viewSignature(data)
        setView(data)
      })
      .catch(() => {
        if (active) {
          setView({ status: "error", message: "Не удалось загрузить чат." })
        }
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [dealId])

  // Realtime через поллинг (websocket-инфры в проекте нет): дешёвый probe каждые 3с, полную ленту
  // тянем только при смене revision — ловит и новые сообщения, и смену статусов.
  useEffect(() => {
    let active = true
    let controller: AbortController | null = null

    async function poll() {
      if (document.visibilityState !== "visible") {
        return
      }
      controller?.abort()
      controller = new AbortController()
      try {
        const probe = await fetchChatProbe(dealId, controller.signal)
        if (!active || probeSignature(probe) === revisionRef.current) {
          return
        }
        const fresh = await fetchChat(dealId, controller.signal)
        if (!active) {
          return
        }
        revisionRef.current = viewSignature(fresh)
        setView(fresh)
      } catch {
        // временную ошибку игнорируем
      }
    }

    const intervalId = window.setInterval(poll, pollIntervalMs)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(intervalId)
    }
  }, [dealId])

  // Таймер записи.
  useEffect(() => {
    if (!recording) {
      return
    }
    const id = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [recording])

  // Останавливаем микрофон при размонтировании.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const messages = view.status === "ok" ? view.messages : []

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, pending.length, view.status])

  const filteredBouquets = useMemo(() => {
    const query = bouquetSearch.trim().toLowerCase()
    if (!query) {
      return bouquets
    }
    return bouquets.filter((bouquet) =>
      [bouquet.name, bouquet.description, String(bouquet.price)].join(" ").toLowerCase().includes(query)
    )
  }, [bouquetSearch, bouquets])

  async function refreshFeed() {
    try {
      const fresh = await fetchChat(dealId)
      revisionRef.current = viewSignature(fresh)
      setView(fresh)
    } catch {
      // поллинг подтянет позже
    }
  }

  async function sendText() {
    const text = input.trim()
    if (!text || sending || view.status !== "ok") {
      return
    }
    const reply = replyTo
    const tempId = tempIdRef.current--
    setPending((current) => [
      ...current,
      { tempId, kind: "text", text, dateTime: new Date().toISOString(), status: "sending" },
    ])
    setInput("")
    setReplyTo(null)
    setSending(true)
    try {
      const result = await sendTextToDealChatAction(
        dealId,
        text,
        reply ? { refMessageId: reply.messageId, quotedText: reply.text } : {}
      )
      setPending((current) => current.filter((item) => item.tempId !== tempId))
      if (result.ok) {
        await refreshFeed()
      } else {
        toast.error(result.message)
        setInput((value) => value || text)
        if (reply) {
          setReplyTo(reply)
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Сообщение не отправлено.")
      setPending((current) => current.filter((item) => item.tempId !== tempId))
      setInput((value) => value || text)
      if (reply) {
        setReplyTo(reply)
      }
    } finally {
      setSending(false)
    }
  }

  async function sendVoice(blob: Blob) {
    if (view.status !== "ok") {
      return
    }
    const reply = replyTo
    const tempId = tempIdRef.current--
    setPending((current) => [
      ...current,
      { tempId, kind: "voice", text: "🎤 Голосовое…", dateTime: new Date().toISOString(), status: "sending" },
    ])
    setReplyTo(null)
    setSending(true)
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : "webm"
      const form = new FormData()
      form.append("file", blob, `voice.${ext}`)
      const upload = await fetch("/api/wazzup/voice", { method: "POST", body: form })
      const uploadData = (await upload.json()) as { ok?: boolean; path?: string; message?: string }
      if (!upload.ok || !uploadData.ok || !uploadData.path) {
        throw new Error(uploadData.message || "Не удалось загрузить голосовое.")
      }
      const result = await sendTextToDealChatAction(dealId, "", {
        contentUri: uploadData.path,
        messageType: "audio",
        ...(reply ? { refMessageId: reply.messageId, quotedText: reply.text } : {}),
      })
      setPending((current) => current.filter((item) => item.tempId !== tempId))
      if (result.ok) {
        await refreshFeed()
      } else {
        toast.error(result.message)
        if (reply) {
          setReplyTo(reply)
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Голосовое не отправлено.")
      setPending((current) => current.filter((item) => item.tempId !== tempId))
      if (reply) {
        setReplyTo(reply)
      }
    } finally {
      setSending(false)
    }
  }

  async function startRecording() {
    if (recording || sending || view.status !== "ok") {
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Запись голосовых не поддерживается в этом браузере.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickAudioMime()
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recordActionRef.current = "send"
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || mime || "audio/webm" })
        chunksRef.current = []
        const action = recordActionRef.current
        setRecording(false)
        setRecordSeconds(0)
        if (blob.size <= 0) {
          return
        }
        if (action === "send") {
          void sendVoice(blob)
        } else if (action === "transcribe") {
          void transcribeToInput(blob)
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setRecordSeconds(0)
    } catch {
      toast.error("Нет доступа к микрофону.")
    }
  }

  function stopRecording(action: RecordAction) {
    recordActionRef.current = action
    recorderRef.current?.stop()
    recorderRef.current = null
  }

  // Надиктовка: распознаём запись на сервере (OpenAI, ключ только там) и подставляем текст в поле —
  // НЕ отправляем, пользователь может отредактировать. Существующую логику отправки не трогаем.
  async function transcribeToInput(blob: Blob) {
    setTranscribing(true)
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : "webm"
      const form = new FormData()
      form.append("file", blob, `voice.${ext}`)
      const response = await fetch("/api/wazzup/transcribe", { method: "POST", body: form })
      const data = (await response.json()) as { ok?: boolean; text?: string; message?: string }
      if (!response.ok || !data.ok || !data.text) {
        throw new Error(data.message || "Не удалось распознать речь.")
      }
      const recognized = data.text.trim()
      setInput((value) => (value.trim() ? `${value.trim()} ${recognized}` : recognized))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось распознать речь.")
    } finally {
      setTranscribing(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void sendText()
    }
  }

  function linkByCustomer() {
    startLinkTransition(async () => {
      const result = await linkDealToWazzupByCustomerAction(dealId)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
      await refreshFeed()
    })
  }

  async function sendBouquet(bouquet: BouquetTemplate) {
    if (!getBouquetAvailability(bouquet).available) {
      toast.warning("На складе сейчас не хватает компонентов для этого букета.")
    }
    setBouquetBusy(bouquet.id)
    try {
      const result = await sendBouquetToDealChatAction(dealId, bouquet.id)
      if (result.ok) {
        toast.success("Букет отправлен в чат")
        setBouquetOpen(false)
        await refreshFeed()
      } else {
        toast.error(result.message)
      }
    } finally {
      setBouquetBusy(null)
    }
  }

  async function addBouquetToCart(bouquetId: number) {
    setBouquetBusy(bouquetId)
    try {
      const result = await addDealBouquetAction(dealId, bouquetId)
      if (result.ok) {
        toast.success("Букет добавлен в корзину")
        router.refresh()
      } else {
        toast.error(result.message)
      }
    } finally {
      setBouquetBusy(null)
    }
  }

  function onReply(item: RenderItem) {
    setReplyTo({
      messageId: item.messageId,
      text: item.text || wazzupMessageTypeLabel(item.messageType),
      outbound: item.direction === "outbound",
    })
  }

  if (view.status === "loading") {
    return (
      <div className="flex h-full min-h-[420px] flex-col gap-3 p-4">
        <div className="text-sm font-medium text-muted-foreground">Загружаем чат…</div>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="min-h-32 flex-1 w-full" />
      </div>
    )
  }

  if (view.status === "not_configured") {
    return (
      <ChatEmpty icon={<SettingsIcon />} title="Wazzup не настроен" description="Wazzup API key не настроен на сервере." />
    )
  }

  if (view.status === "disabled") {
    return (
      <ChatEmpty
        icon={<SettingsIcon />}
        title="Wazzup отключен в настройках"
        description="Включите интеграцию в настройках CRM."
      />
    )
  }

  if (view.status === "no_chat") {
    return (
      <ChatEmpty
        icon={<MessageCircleIcon />}
        title="Чат нельзя открыть"
        description={view.message || "У сделки нет телефона клиента, поэтому чат открыть нельзя."}
        action={
          <Button type="button" variant="outline" onClick={linkByCustomer} disabled={isLinkPending}>
            <SearchIcon data-icon="inline-start" />
            {isLinkPending ? "Проверяем..." : "Проверить чат по клиенту"}
          </Button>
        }
      />
    )
  }

  if (view.status === "error") {
    return (
      <ChatEmpty
        icon={<MessageCircleIcon />}
        title="Не удалось открыть чат"
        description={view.message}
        action={
          <Button type="button" variant="outline" onClick={() => void refreshFeed()}>
            <RefreshCwIcon data-icon="inline-start" />
            Повторить
          </Button>
        }
      />
    )
  }

  const items: RenderItem[] = [
    ...messages.map((message) => ({
      key: `m-${message.id}`,
      id: message.id,
      messageId: message.messageId,
      direction: message.direction,
      text: message.text,
      contentUri: message.contentUri,
      messageType: message.messageType,
      status: message.status,
      authorName: message.authorName,
      quotedText: message.quotedText,
      transcript: message.transcript,
      dateTime: message.dateTime || message.createdAt,
      bouquetId: message.direction === "outbound" ? parseBouquetId(message.crmMessageId) : null,
    })),
    ...pending.map((item) => ({
      key: `p-${item.tempId}`,
      id: item.tempId,
      messageId: "",
      direction: "outbound" as const,
      text: item.text,
      contentUri: "",
      messageType: "text",
      status: item.status,
      authorName: "",
      quotedText: "",
      transcript: "",
      dateTime: item.dateTime,
      bouquetId: null,
    })),
  ]

  let lastDay = ""

  return (
    <div className="flex h-full min-h-[420px] flex-col bg-zinc-50">
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="m-auto max-w-xs text-center text-sm text-muted-foreground">
            Сообщений пока нет. Напишите клиенту первым — оно появится здесь и в Wazzup.
          </div>
        ) : (
          items.map((item) => {
            const day = formatDay(item.dateTime)
            const showDay = day && day !== lastDay
            lastDay = day || lastDay
            return (
              <div key={item.key} className="flex flex-col gap-2">
                {showDay ? (
                  <div className="mx-auto rounded-full bg-zinc-200/70 px-3 py-0.5 text-xs text-zinc-600">{day}</div>
                ) : null}
                <MessageBubble
                  item={item}
                  onReply={onReply}
                  onAddToCart={addBouquetToCart}
                  addBusy={bouquetBusy}
                />
              </div>
            )
          })
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-zinc-200 bg-white p-3">
        {replyTo ? (
          <div className="flex items-start gap-2 rounded-lg border-l-2 border-emerald-500 bg-zinc-100 px-3 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-emerald-700">В ответ на сообщение</div>
              <div className="truncate text-zinc-600">{replyTo.text || "Вложение"}</div>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="text-zinc-400 hover:text-zinc-700"
              aria-label="Отменить ответ"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ) : null}

        {recording ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-700">
              <span className="size-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
              Идёт запись
              <span className="tabular-nums text-zinc-500">{formatSeconds(recordSeconds)}</span>
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => stopRecording("cancel")}>
                Отмена
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => stopRecording("transcribe")}
                title="Распознать речь и вставить текст в поле ввода"
              >
                <WandSparklesIcon data-icon="inline-start" />
                В текст
              </Button>
              <Button type="button" onClick={() => stopRecording("send")}>
                <SendIcon data-icon="inline-start" />
                Голосом
              </Button>
            </div>
          </div>
        ) : transcribing ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            <Loader2Icon className="size-4 animate-spin" />
            Распознаём голос…
          </div>
        ) : (
          <>
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setBouquetOpen(true)} disabled={sending}>
                <Flower2Icon data-icon="inline-start" />
                Предложить букет
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Сообщение… (Enter — отправить, Shift+Enter — перенос)"
                rows={1}
                className="max-h-32 min-h-10 flex-1 resize-none"
                disabled={sending}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void startRecording()}
                disabled={sending}
                aria-label="Голосовое: записать"
                title="Записать — потом выбрать «В текст» или «Голосом»"
              >
                <MicIcon />
              </Button>
              <Button type="button" onClick={() => void sendText()} disabled={sending || !input.trim()} aria-label="Отправить">
                <SendIcon data-icon="inline-start" />
                {sending ? "Отправляем…" : "Отправить"}
              </Button>
            </div>
          </>
        )}
      </div>

      <BouquetPickerDialog
        open={bouquetOpen}
        onOpenChange={setBouquetOpen}
        bouquets={filteredBouquets}
        search={bouquetSearch}
        onSearch={setBouquetSearch}
        busyId={bouquetBusy}
        onSend={sendBouquet}
        onAddToCart={addBouquetToCart}
      />
    </div>
  )
}

function MessageBubble({
  item,
  onReply,
  onAddToCart,
  addBusy,
}: {
  item: RenderItem
  onReply: (item: RenderItem) => void
  onAddToCart: (bouquetId: number) => void
  addBusy: number | null
}) {
  const outbound = item.direction === "outbound"
  const replyButton =
    item.messageId ? (
      <button
        type="button"
        onClick={() => onReply(item)}
        className="mb-1 shrink-0 self-center rounded-full p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100"
        aria-label="Ответить"
      >
        <ReplyIcon className="size-4" />
      </button>
    ) : null

  return (
    <div className={cn("group flex items-end gap-1", outbound ? "justify-end" : "justify-start")}>
      {outbound ? replyButton : null}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          outbound ? "bg-emerald-600 text-white" : "border border-zinc-200 bg-white text-zinc-900"
        )}
      >
        {!outbound && item.authorName ? (
          <div className="mb-0.5 text-xs font-medium text-emerald-700">{item.authorName}</div>
        ) : null}
        {item.quotedText ? (
          <div
            className={cn(
              "mb-1 border-l-2 pl-2 text-xs",
              outbound ? "border-white/60 text-emerald-50/90" : "border-zinc-300 text-muted-foreground"
            )}
          >
            <span className="line-clamp-2">{item.quotedText}</span>
          </div>
        ) : null}
        <MessageMedia item={item} />
        {item.messageType === "audio" && item.id > 0 ? (
          <VoiceTranscript messageId={item.id} initial={item.transcript} outbound={outbound} />
        ) : null}
        {item.text ? <div className="whitespace-pre-wrap break-words">{item.text}</div> : null}
        {!item.text && !item.contentUri ? (
          <div className="italic opacity-80">{wazzupMessageTypeLabel(item.messageType)}</div>
        ) : null}
        {item.bouquetId != null ? (
          <button
            type="button"
            onClick={() => item.bouquetId != null && onAddToCart(item.bouquetId)}
            disabled={addBusy === item.bouquetId}
            className={cn(
              "mt-1.5 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition",
              outbound ? "bg-white/15 hover:bg-white/25" : "bg-zinc-100 hover:bg-zinc-200"
            )}
          >
            <ShoppingCartIcon className="size-3.5" />
            В корзину
          </button>
        ) : null}
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            outbound ? "text-emerald-100" : "text-muted-foreground"
          )}
        >
          <span>{formatTime(item.dateTime)}</span>
          {outbound ? <StatusTicks status={item.status} /> : null}
        </div>
      </div>
      {!outbound ? replyButton : null}
    </div>
  )
}

function MessageMedia({ item }: { item: RenderItem }) {
  if (!item.contentUri || item.id <= 0) {
    return null
  }

  const src = `/api/wazzup/media?id=${item.id}`
  if (item.messageType === "image") {
    return (
      // Контент Wazzup может протухать — рендерим через серверный прокси /api/wazzup/media.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={wazzupMessageTypeLabel(item.messageType)}
        className="mb-1 max-h-64 w-full rounded-lg object-cover"
      />
    )
  }
  if (item.messageType === "audio") {
    return <VoiceMessagePlayer src={src} outbound={item.direction === "outbound"} />
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-2 underline underline-offset-2"
    >
      <PaperclipIcon className="size-4" />
      {wazzupMessageTypeLabel(item.messageType)}
    </a>
  )
}

// Кастомный плеер голосовых вместо нативного <audio controls>: play/pause, кликабельная дорожка
// прогресса, таймер «текущее/общее». Темизация под пузырь: белое на зелёном исходящем, emerald на
// светлом входящем. Источник — серверный медиа-прокси (тот же, что у MessageMedia).
function VoiceMessagePlayer({ src, outbound }: { src: string; outbound: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  // webm от MediaRecorder часто без длительности в заголовке (duration === Infinity), пока не
  // «перемотать» в конец — тогда браузер досчитает её. Делаем это один раз, без автоплея.
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
    <div className="mb-1 flex w-56 max-w-full items-center gap-2">
      {/* Кастомный UI вместо нативного controls; источник — серверный медиа-прокси. */}
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
          if (resolvingRef.current) {
            return
          }
          setCurrent(event.currentTarget.currentTime)
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
          "flex size-8 shrink-0 items-center justify-center rounded-full transition",
          outbound ? "bg-white/20 text-white hover:bg-white/30" : "bg-emerald-600 text-white hover:bg-emerald-700"
        )}
      >
        {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4 translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={seek}
          aria-label="Перемотать"
          className={cn(
            "block h-1.5 w-full cursor-pointer rounded-full",
            outbound ? "bg-white/25" : "bg-zinc-200"
          )}
        >
          <div
            className={cn("h-full rounded-full", outbound ? "bg-white" : "bg-emerald-600")}
            style={{ width: `${progress}%` }}
          />
        </button>
        <div className={cn("mt-1 text-[10px] tabular-nums", outbound ? "text-emerald-100" : "text-muted-foreground")}>
          {formatSeconds(Math.floor(current))} / {formatSeconds(Math.floor(safeDuration))}
        </div>
      </div>
    </div>
  )
}

// Расшифровка голосового в текст (Фича 4): ненавязчивая ссылка под плеером. Результат кэшируется на
// сервере (колонка transcript) и приходит готовым в ленте — повторный клик API не дёргает.
function VoiceTranscript({
  messageId,
  initial,
  outbound,
}: {
  messageId: number
  initial: string
  outbound: boolean
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(initial ? "done" : "idle")
  const [text, setText] = useState(initial)
  const [error, setError] = useState("")
  // Если расшифровка приехала из ленты позже (закэширована другим окном) — отражаем её (в рендере,
  // правило react-hooks/set-state-in-effect, как trackedDealId выше).
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
      <div
        className={cn(
          "mt-1.5 border-t pt-1.5 text-xs leading-snug whitespace-pre-wrap break-words",
          outbound ? "border-white/20 text-emerald-50/90" : "border-zinc-200 text-zinc-600"
        )}
      >
        {text}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === "loading"}
      className={cn(
        "mt-1.5 flex items-center gap-1 text-[11px] underline-offset-2 hover:underline disabled:opacity-70",
        outbound ? "text-emerald-100" : "text-emerald-700"
      )}
    >
      {state === "loading" ? <Loader2Icon className="size-3 animate-spin" /> : <FileTextIcon className="size-3" />}
      {state === "loading" ? "Расшифровываем…" : state === "error" ? error || "Ошибка — повторить" : "Расшифровать"}
    </button>
  )
}

function BouquetPickerDialog({
  open,
  onOpenChange,
  bouquets,
  search,
  onSearch,
  busyId,
  onSend,
  onAddToCart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bouquets: BouquetTemplate[]
  search: string
  onSearch: (value: string) => void
  busyId: number | null
  onSend: (bouquet: BouquetTemplate) => void
  onAddToCart: (bouquetId: number) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] gap-3 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Букеты</DialogTitle>
          <DialogDescription>Отправьте букет в чат клиенту или добавьте в корзину сделки.</DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          placeholder="Поиск: название, описание или цена"
          onChange={(event) => onSearch(event.target.value)}
        />
        <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
          {bouquets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-sm text-muted-foreground">
              Активные букеты не найдены.
            </div>
          ) : (
            bouquets.map((bouquet) => {
              const availability = getBouquetAvailability(bouquet)
              const busy = busyId === bouquet.id
              return (
                <div key={bouquet.id} className="flex gap-3 rounded-lg border border-zinc-200 p-2.5">
                  <BouquetThumbnail name={bouquet.name} imagePath={bouquet.imagePath} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-950">{bouquet.name}</div>
                        <div className="text-sm font-semibold text-zinc-950">{formatMoney(bouquet.price)}</div>
                      </div>
                      {!availability.available ? (
                        <Badge className="border-amber-200 bg-amber-50 text-amber-800">Не хватает</Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" size="sm" disabled={busy} onClick={() => onSend(bouquet)}>
                        <SendIcon data-icon="inline-start" />
                        В чат
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onAddToCart(bouquet.id)}
                      >
                        <ShoppingCartIcon data-icon="inline-start" />
                        В корзину
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusTicks({ status }: { status: string }) {
  if (status === "sending") {
    return <ClockIcon className="size-3" aria-label="Отправка" />
  }
  if (status === "error") {
    return <AlertCircleIcon className="size-3 text-red-200" aria-label="Ошибка отправки" />
  }
  if (status === "read") {
    return <CheckCheckIcon className="size-3.5 text-sky-200" aria-label="Прочитано" />
  }
  if (status === "delivered") {
    return <CheckCheckIcon className="size-3.5" aria-label="Доставлено" />
  }
  return <CheckIcon className="size-3.5" aria-label="Отправлено" />
}

function ChatEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Empty className="h-full min-h-[420px] rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

const timeFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: SHOP_TIME_ZONE, hour: "2-digit", minute: "2-digit" })
const dayFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: SHOP_TIME_ZONE, day: "2-digit", month: "long", year: "numeric" })

function parseDate(value: string) {
  return parseDbInstant(value)
}

function formatTime(value: string) {
  const date = parseDate(value)
  return date ? timeFormatter.format(date) : ""
}

function formatDay(value: string) {
  const date = parseDate(value)
  return date ? dayFormatter.format(date) : ""
}

function formatSeconds(total: number) {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
