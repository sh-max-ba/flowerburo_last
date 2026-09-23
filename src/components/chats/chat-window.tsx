"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  CheckIcon,
  ClipboardListIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Flower2Icon,
  ImagePlusIcon,
  Loader2Icon,
  MicIcon,
  PaperclipIcon,
  ReceiptTextIcon,
  SendIcon,
  UserRoundIcon,
  UserRoundCheckIcon,
  WandSparklesIcon,
  XIcon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"
import { markChatAnsweredAction, markQuickReplyUsedAction, sendBouquetToChatAction, sendChatMessageAction } from "@/app/actions"
import type { BouquetTemplate, ChatSummary, QuickReply, WazzupMessage } from "@/lib/db"
import { chatUploadTypes, maxChatUploadSize } from "@/lib/chat-uploads"
import { parseDbInstant } from "@/lib/datetime"
import { wazzupMessageTypeLabel } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { useIsPhone } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { BouquetPickerDialog } from "./bouquet-picker"
import { ChatAvatar, channelMeta, formatDayLabel, formatPhone, formatWaiting, sameDay } from "./chat-shared"
import { copyMessageText, formatSeconds, guessFileName, mediaUrl, MessageBubble, type BubbleMessage, type MessageAction } from "./message-bubble"
import {
  applyQuickReply,
  filterQuickReplies,
  parseSlashQuery,
  QuickRepliesPanel,
  QuickReplyDialog,
  type QuickReplyDraft,
} from "./quick-replies"

// Окно диалога: шапка с контактом и действиями (позвонить, контакт, заказы, ответственный),
// лента сообщений с поллингом по revision, композер (текст, вложения перетаскиванием/вставкой/
// скрепкой, голосовое, букет из каталога, быстрые ответы, ответ на сообщение). Монтируется с key=chat.id —
// смена диалога = свежее состояние без ручных сбросов.

const pollIntervalMs = 3000

type FeedResponse =
  | { status: "ok"; chat: ChatSummary; messages: WazzupMessage[]; revision: string }
  | { status: "not_found" | "error"; message?: string }

type FeedView = { status: "loading" } | FeedResponse

type Attachment = {
  id: number
  file: File
  previewUrl: string | null
  messageType: "image" | "video" | "audio" | "document"
}

type PendingMessage = { tempId: number; kind: "text" | "file" | "voice"; text: string; fileName: string; dateTime: string }

type ReplyTarget = { messageId: string; text: string }

type RecordAction = "send" | "transcribe" | "cancel"

async function fetchFeed(chatId: number, probe: boolean, signal?: AbortSignal) {
  const response = await fetch(`/api/chats/${chatId}/messages${probe ? "?probe=1" : ""}`, { cache: "no-store", signal })
  return (await response.json()) as FeedResponse & { revision?: string }
}

function signature(data: { status: string; revision?: string }) {
  return data.status === "ok" && data.revision ? data.revision : `status:${data.status}`
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

// Букетные отправки: id букета не кодируется в crmMessageId у чатов, поэтому «В заказ» у них нет —
// заказ создаётся из панели «Заказы» с полным составом.

export function ChatWindow({
  chat,
  currentUser,
  users,
  bouquets,
  quickReplies,
  onQuickRepliesChange,
  panel,
  showBack,
  onTogglePanel,
  onAssign,
  onBack,
  onForward,
  onAttachToOrder,
  onActivity,
}: {
  chat: ChatSummary
  currentUser: { id: number; name: string }
  users: Array<{ id: number; name: string }>
  bouquets: BouquetTemplate[]
  // Быстрые ответы живут на экране: окно диалога пересоздаётся при смене чата, а правки должны остаться.
  quickReplies: QuickReply[]
  onQuickRepliesChange: (replies: QuickReply[]) => void
  panel: "contact" | "orders" | null
  showBack: boolean
  onTogglePanel: (panel: "contact" | "orders") => void
  onAssign: (userId: number | null) => void
  onBack: () => void
  onForward: (message: BubbleMessage) => void
  // Фото из чата — к новому заказу (как фото или чек); тянет экран, у него список вложений.
  onAttachToOrder: (message: BubbleMessage, kind: "photo" | "receipt") => void
  // Что-то изменилось в диалоге (отправка, отметка) — экран обновит список.
  onActivity: () => void
}) {
  const phone = useIsPhone()
  const [view, setView] = useState<FeedView>({ status: "loading" })
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [lightbox, setLightbox] = useState<BubbleMessage | null>(null)
  const [bouquetOpen, setBouquetOpen] = useState(false)
  const [bouquetBusy, setBouquetBusy] = useState<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  // Быстрые ответы: «/» в начале поля или кнопка ⚡ (browse — со своим поиском).
  const [quickBrowse, setQuickBrowse] = useState(false)
  const [quickSearch, setQuickSearch] = useState("")
  const [quickIndex, setQuickIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null)
  const [quickDraft, setQuickDraft] = useState<QuickReplyDraft | null>(null)

  const revisionRef = useRef("")
  const tempIdRef = useRef(-1)
  const attachmentIdRef = useRef(1)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recordActionRef = useRef<RecordAction>("send")
  const stickToBottomRef = useRef(true)
  // Позиция курсора в поле на момент открытия ⚡ — туда и вставим выбранный ответ.
  const caretRef = useRef<{ start: number; end: number } | null>(null)

  const chatId = chat.id
  const liveChat = view.status === "ok" ? view.chat : chat
  const channel = channelMeta(liveChat.chatType)
  const phoneDigits = liveChat.phone.replace(/\D/g, "")

  const refreshFeed = useCallback(async () => {
    try {
      const fresh = await fetchFeed(chatId, false)
      revisionRef.current = signature(fresh)
      setView(fresh)
    } catch {
      // поллинг подтянет позже
    }
  }, [chatId])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void fetchFeed(chatId, false, controller.signal)
      .then((data) => {
        if (active) {
          revisionRef.current = signature(data)
          setView(data)
        }
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
  }, [chatId])

  // Realtime через поллинг: дешёвый probe каждые 3с, полная лента — только при смене revision.
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
        const probe = await fetchFeed(chatId, true, controller.signal)
        if (!active || signature(probe) === revisionRef.current) {
          return
        }
        const fresh = await fetchFeed(chatId, false, controller.signal)
        if (active) {
          revisionRef.current = signature(fresh)
          setView(fresh)
        }
      } catch {
        // временную ошибку игнорируем
      }
    }
    const id = window.setInterval(poll, pollIntervalMs)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(id)
    }
  }, [chatId])

  useEffect(() => {
    if (!recording) {
      return
    }
    const id = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [recording])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // Превью вложений — object URL, освобождаем при удалении/размонтировании.
  useEffect(() => {
    return () => {
      attachments.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const messages = useMemo(() => (view.status === "ok" ? view.messages : []), [view])

  // Автопрокрутка вниз при новых сообщениях, но только если пользователь и так был внизу.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, pending.length, view.status])

  // Контент ленты подрастает уже после первого рендера (подгрузка шрифта, фото) — пока
  // пользователь внизу, держим низ и при изменении высоты содержимого.
  useEffect(() => {
    const el = scrollRef.current
    const content = el?.firstElementChild
    if (!el || !content || typeof ResizeObserver === "undefined") {
      return
    }
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [view.status])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) {
      return
    }
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function addFiles(files: FileList | File[]) {
    const next: Attachment[] = []
    for (const file of Array.from(files)) {
      const mime = file.type.split(";")[0]?.trim().toLowerCase() ?? ""
      const kind = chatUploadTypes.get(mime)
      if (!kind) {
        toast.error(`«${file.name}»: такой тип файла отправить нельзя.`)
        continue
      }
      if (file.size > maxChatUploadSize) {
        toast.error(`«${file.name}»: файл больше 10 MB.`)
        continue
      }
      next.push({
        id: attachmentIdRef.current++,
        file,
        previewUrl: kind.messageType === "image" ? URL.createObjectURL(file) : null,
        messageType: kind.messageType,
      })
    }
    if (next.length) {
      setAttachments((current) => [...current, ...next])
      textareaRef.current?.focus()
    }
  }

  function removeAttachment(id: number) {
    setAttachments((current) => {
      const target = current.find((item) => item.id === id)
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
      }
      return current.filter((item) => item.id !== id)
    })
  }

  async function uploadAttachment(attachment: Attachment) {
    const form = new FormData()
    form.append("file", attachment.file, attachment.file.name)
    const response = await fetch("/api/wazzup/upload", { method: "POST", body: form })
    const data = (await response.json()) as { ok?: boolean; path?: string; messageType?: string; name?: string; message?: string }
    if (!response.ok || !data.ok || !data.path) {
      throw new Error(data.message || "Не удалось загрузить файл.")
    }
    return { path: data.path, messageType: data.messageType || attachment.messageType, name: data.name || attachment.file.name }
  }

  // Отправка: сначала вложения (каждое — отдельным сообщением, у Wazzup text и contentUri
  // взаимоисключающи), затем текст. Ответ (цитата) прикрепляется к первому сообщению.
  async function send() {
    const text = input.trim()
    const files = attachments
    if ((!text && !files.length) || sending || view.status !== "ok") {
      return
    }
    const reply = replyTo
    setSending(true)
    setInput("")
    setAttachments([])
    setReplyTo(null)
    stickToBottomRef.current = true

    const queue: Array<{ tempId: number; run: () => Promise<Awaited<ReturnType<typeof sendChatMessageAction>>> }> = []
    let replyUsed = false
    const replyOptions = () => {
      if (!reply || replyUsed) {
        return {}
      }
      replyUsed = true
      return { refMessageId: reply.messageId, quotedText: reply.text }
    }
    for (const attachment of files) {
      const tempId = tempIdRef.current--
      setPending((current) => [
        ...current,
        { tempId, kind: "file", text: "", fileName: attachment.file.name, dateTime: new Date().toISOString() },
      ])
      queue.push({
        tempId,
        run: async () => {
          const uploaded = await uploadAttachment(attachment)
          return sendChatMessageAction(chatId, {
            contentUri: uploaded.path,
            messageType: uploaded.messageType,
            fileName: uploaded.name,
            ...replyOptions(),
          })
        },
      })
    }
    if (text) {
      const tempId = tempIdRef.current--
      setPending((current) => [...current, { tempId, kind: "text", text, fileName: "", dateTime: new Date().toISOString() }])
      queue.push({ tempId, run: () => sendChatMessageAction(chatId, { text, ...replyOptions() }) })
    }

    let failed = false
    for (const item of queue) {
      try {
        const result = await item.run()
        if (!result.ok) {
          failed = true
          toast.error(result.message)
        }
      } catch (error) {
        failed = true
        toast.error(error instanceof Error ? error.message : "Сообщение не отправлено.")
      } finally {
        setPending((current) => current.filter((entry) => entry.tempId !== item.tempId))
      }
      if (failed) {
        break
      }
    }
    if (failed && text) {
      setInput((value) => value || text)
    }
    files.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
    setSending(false)
    await refreshFeed()
    onActivity()
    // Фокус остаётся в поле — менеджер печатает следующий ответ без лишнего тапа.
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  async function sendVoice(blob: Blob) {
    if (view.status !== "ok") {
      return
    }
    const reply = replyTo
    const tempId = tempIdRef.current--
    setPending((current) => [...current, { tempId, kind: "voice", text: "", fileName: "", dateTime: new Date().toISOString() }])
    setReplyTo(null)
    setSending(true)
    stickToBottomRef.current = true
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : "webm"
      const form = new FormData()
      form.append("file", blob, `voice.${ext}`)
      const upload = await fetch("/api/wazzup/voice", { method: "POST", body: form })
      const uploadData = (await upload.json()) as { ok?: boolean; path?: string; message?: string }
      if (!upload.ok || !uploadData.ok || !uploadData.path) {
        throw new Error(uploadData.message || "Не удалось загрузить голосовое.")
      }
      const result = await sendChatMessageAction(chatId, {
        contentUri: uploadData.path,
        messageType: "audio",
        ...(reply ? { refMessageId: reply.messageId, quotedText: reply.text } : {}),
      })
      if (!result.ok) {
        toast.error(result.message)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Голосовое не отправлено.")
    } finally {
      setPending((current) => current.filter((item) => item.tempId !== tempId))
      setSending(false)
    }
    await refreshFeed()
    onActivity()
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
      textareaRef.current?.focus()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось распознать речь.")
    } finally {
      setTranscribing(false)
    }
  }

  async function sendBouquet(bouquet: BouquetTemplate) {
    setBouquetBusy(bouquet.id)
    try {
      const result = await sendBouquetToChatAction(chatId, bouquet.id)
      if (result.ok) {
        toast.success("Букет отправлен в чат")
        setBouquetOpen(false)
        stickToBottomRef.current = true
        await refreshFeed()
        onActivity()
      } else {
        toast.error(result.message)
      }
    } finally {
      setBouquetBusy(null)
    }
  }

  async function markAnswered() {
    const result = await markChatAnsweredAction(chatId)
    if (result.ok) {
      toast.success(result.message)
      await refreshFeed()
      onActivity()
    } else {
      toast.error(result.message)
    }
  }

  function handleAction(action: MessageAction, message: BubbleMessage) {
    switch (action) {
      case "reply":
        setReplyTo({ messageId: message.messageId, text: message.text || wazzupMessageTypeLabel(message.messageType) })
        textareaRef.current?.focus()
        return
      case "forward":
        onForward(message)
        return
      case "toOrderPhoto":
        onAttachToOrder(message, "photo")
        return
      case "toOrderReceipt":
        onAttachToOrder(message, "receipt")
        return
      case "copy":
        void copyMessageText(message.text)
        return
      case "saveQuickReply":
        setQuickDraft({ id: null, title: "", text: message.text })
        return
      case "open":
        window.open(mediaUrl(message), "_blank", "noopener")
        return
      case "download": {
        const link = document.createElement("a")
        link.href = mediaUrl(message)
        link.download = guessFileName(message)
        link.rel = "noopener"
        document.body.appendChild(link)
        link.click()
        link.remove()
        return
      }
      case "transcribe":
        // Расшифровка запускается кнопкой под плеером; из меню просто подсказываем.
        toast.message("Нажмите «Расшифровать» под голосовым сообщением.")
        return
    }
  }

  const slashQuery = parseSlashQuery(input)
  const quickMode: "slash" | "browse" | null = quickBrowse ? "browse" : slashQuery !== null && input !== slashDismissed ? "slash" : null
  const quickQuery = quickMode === "browse" ? quickSearch : (slashQuery ?? "")
  const quickFiltered = useMemo(
    () => (quickMode ? filterQuickReplies(quickReplies, quickQuery) : []),
    [quickMode, quickReplies, quickQuery]
  )
  const quickActive = Math.min(quickIndex, Math.max(quickFiltered.length - 1, 0))

  const closeQuick = useCallback(() => {
    setQuickBrowse(false)
    setQuickSearch("")
    setQuickIndex(0)
    // «/запрос» остаётся в поле как текст — панель не всплывает снова, пока его не изменят.
    setSlashDismissed(input)
  }, [input])

  function toggleQuickBrowse() {
    if (quickBrowse) {
      closeQuick()
      textareaRef.current?.focus()
      return
    }
    const el = textareaRef.current
    caretRef.current = el ? { start: el.selectionStart, end: el.selectionEnd } : null
    setQuickSearch("")
    setQuickIndex(0)
    setQuickBrowse(true)
  }

  // Выбор ответа: из «/» — заменяет запрос в поле; из ⚡ — вставляется в место курсора.
  function pickQuickReply(reply: QuickReply) {
    const text = applyQuickReply(reply.text, liveChat.name)
    let next = text
    let caret = text.length
    if (quickMode === "browse" && parseSlashQuery(input) === null && input.trim()) {
      const start = Math.min(caretRef.current?.start ?? input.length, input.length)
      const end = Math.min(caretRef.current?.end ?? input.length, input.length)
      const before = input.slice(0, start)
      const after = input.slice(end)
      const lead = before && !/\s$/.test(before) ? " " : ""
      const trail = after && !/^\s/.test(after) ? " " : ""
      next = `${before}${lead}${text}${trail}${after}`
      caret = before.length + lead.length + text.length
    }
    setInput(next)
    setQuickBrowse(false)
    setQuickSearch("")
    setQuickIndex(0)
    setSlashDismissed(null)
    void markQuickReplyUsedAction(reply.id)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  function handleQuickSaved(replies: QuickReply[]) {
    onQuickRepliesChange(replies)
    setQuickIndex(0)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (quickMode === "slash") {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && quickFiltered.length) {
        event.preventDefault()
        const delta = event.key === "ArrowDown" ? 1 : -1
        setQuickIndex((quickActive + delta + quickFiltered.length) % quickFiltered.length)
        return
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && quickFiltered[quickActive]) {
        event.preventDefault()
        pickQuickReply(quickFiltered[quickActive])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        closeQuick()
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
    if (event.key === "Escape" && replyTo) {
      setReplyTo(null)
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (files.length) {
      event.preventDefault()
      addFiles(files)
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    if (event.dataTransfer?.files?.length) {
      addFiles(event.dataTransfer.files)
    }
  }

  const items: BubbleMessage[] = useMemo(
    () => [
      ...messages.map((message) => ({
        key: `m-${message.id}`,
        id: message.id,
        messageId: message.messageId,
        direction: message.direction,
        messageType: message.messageType,
        text: message.text,
        contentUri: message.contentUri,
        status: message.status,
        authorName: message.authorName,
        quotedText: message.quotedText,
        transcript: message.transcript,
        isEdited: message.isEdited,
        isDeleted: message.isDeleted,
        forwarded: message.forwarded,
        errorText: message.errorText,
        fileName: message.fileName,
        dateTime: message.dateTime || message.createdAt,
      })),
      ...pending.map((item) => ({
        key: `p-${item.tempId}`,
        id: item.tempId,
        messageId: "",
        direction: "outbound" as const,
        messageType: item.kind === "voice" ? "audio" : item.kind === "file" ? "document" : "text",
        text: item.kind === "text" ? item.text : item.kind === "voice" ? "🎤 Голосовое…" : `📎 ${item.fileName}…`,
        contentUri: "",
        status: "sending",
        authorName: currentUser.name,
        quotedText: "",
        transcript: "",
        isEdited: false,
        isDeleted: false,
        forwarded: false,
        errorText: "",
        fileName: item.fileName,
        dateTime: item.dateTime,
        pending: true,
      })),
    ],
    [messages, pending, currentUser.name]
  )

  const waitingSince = liveChat.unansweredCount > 0 ? formatWaiting(liveChat.lastInboundAt) : ""
  const assigned = users.find((user) => user.id === liveChat.assignedUserId)
  const assignedLabel = assigned?.name ?? liveChat.assignedUserName ?? ""

  return (
    <div
      className={cn("@container/chat relative flex h-full min-h-0 min-w-0 flex-1 flex-col", dragOver && "ring-2 ring-brand/50 ring-inset")}
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes("Files")) {
          event.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOver(false)
        }
      }}
      onDrop={handleDrop}
    >
      {/* Шапка диалога */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-2 sm:px-3">
        {showBack ? (
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" onClick={onBack} aria-label="К списку">
            <ArrowLeftIcon />
          </Button>
        ) : null}
        <ChatAvatar chatId={liveChat.id} name={liveChat.name} hasAvatar={liveChat.hasAvatar} chatType={liveChat.chatType} size="sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[15px] font-semibold">{liveChat.name || liveChat.phone || liveChat.chatId}</div>
          <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            <span className={channel.className}>{channel.label}</span>
            {phoneDigits ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate tabular-nums">{formatPhone(liveChat.phone)}</span>
              </>
            ) : liveChat.username ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">@{liveChat.username}</span>
              </>
            ) : null}
            {waitingSince ? (
              // Считается от текущего времени — на границе минуты сервер и клиент расходятся.
              <span suppressHydrationWarning className="ml-1 shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[11px] font-medium text-amber-800">
                ждёт {waitingSince}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ChatHeaderAction
            icon={UserRoundIcon}
            label="Контакт"
            active={panel === "contact"}
            onClick={() => onTogglePanel("contact")}
          />
          <ChatHeaderAction
            icon={ClipboardListIcon}
            label="Заказы"
            count={liveChat.activeOrdersCount || liveChat.ordersCount}
            active={panel === "orders"}
            onClick={() => onTogglePanel("orders")}
          />
          {!phone ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-10 min-w-10 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground",
                    assigned && "text-foreground"
                  )}
                  aria-label={assignedLabel ? `Ответственный: ${assignedLabel}` : "Ответственный не назначен"}
                  title={assignedLabel ? `Ответственный: ${assignedLabel}` : "Назначить ответственного"}
                />
              }
            >
              <UserRoundCheckIcon className="size-4 shrink-0" aria-hidden />
              <span className="hidden max-w-32 truncate text-sm @3xl/chat:inline">{assignedLabel || "Не назначен"}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Ответственный</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={liveChat.assignedUserId ? String(liveChat.assignedUserId) : "none"}
                  onValueChange={(value) => onAssign(value === "none" ? null : Number(value))}
                >
                  <DropdownMenuRadioItem value="none">Не назначен</DropdownMenuRadioItem>
                  {users.map((user) => (
                    <DropdownMenuRadioItem key={user.id} value={String(user.id)}>
                      {user.name}
                      {user.id === currentUser.id ? " (я)" : ""}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="ghost" size="icon-lg" className="size-10 text-muted-foreground" aria-label="Ещё" />}
            >
              <EllipsisVerticalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {liveChat.unansweredCount > 0 ? (
                <DropdownMenuItem onClick={() => void markAnswered()}>
                  <CheckIcon />
                  Отметить отвеченным
                </DropdownMenuItem>
              ) : null}
              {liveChat.customerId ? (
                <DropdownMenuItem render={<Link href={`/clients/${liveChat.customerId}`} />}>
                  <ExternalLinkIcon />
                  Карточка клиента
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => void refreshFeed()}>
                <Loader2Icon />
                Обновить ленту
              </DropdownMenuItem>
              {phone ? (
                // На телефоне в шапке нет места под «Ответственного» — выбор здесь.
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Ответственный</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={liveChat.assignedUserId ? String(liveChat.assignedUserId) : "none"}
                      onValueChange={(value) => onAssign(value === "none" ? null : Number(value))}
                    >
                      <DropdownMenuRadioItem value="none">Не назначен</DropdownMenuRadioItem>
                      {users.map((user) => (
                        <DropdownMenuRadioItem key={user.id} value={String(user.id)}>
                          {user.name}
                          {user.id === currentUser.id ? " (я)" : ""}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Лента на всю ширину: входящие у левого края, наши — у правого. */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-zinc-100/80 px-3 py-4 sm:px-5">
        {view.status === "loading" ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-2/3 rounded-2xl bg-zinc-200/70" />
            <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl bg-zinc-200/70" />
            <Skeleton className="h-16 w-3/4 rounded-2xl bg-zinc-200/70" />
          </div>
        ) : view.status !== "ok" ? (
          <div className="m-auto max-w-xs text-center text-sm text-muted-foreground">
            {view.message || "Не удалось открыть диалог."}
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={() => void refreshFeed()}>
                Повторить
              </Button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="m-auto max-w-xs text-center text-sm text-muted-foreground">
            Сообщений пока нет. Напишите клиенту первым — сообщение появится здесь и в мессенджере.
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map((item, index) => {
              const previous = items[index - 1]
              const next = items[index + 1]
              const showDay = !previous || !sameDay(previous.dateTime, item.dateTime)
              const groupStart = showDay || !previous || !sameGroup(previous, item)
              const groupEnd = !next || !sameDay(item.dateTime, next.dateTime) || !sameGroup(item, next)
              return (
                <div key={item.key} className={cn("flex flex-col", index > 0 && (groupStart ? "mt-3" : "mt-0.5"))}>
                  {showDay ? (
                    <div className="sticky top-0 z-10 mx-auto mb-3 rounded-full bg-background/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-xs backdrop-blur">
                      {formatDayLabel(item.dateTime)}
                    </div>
                  ) : null}
                  <MessageBubble message={item} groupStart={groupStart} groupEnd={groupEnd} onAction={handleAction} onOpenImage={setLightbox} />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Композер */}
      <div className="relative flex shrink-0 flex-col bg-background px-3 py-2.5 sm:px-4">
        {quickMode ? (
          <QuickRepliesPanel
            replies={quickReplies}
            filtered={quickFiltered}
            mode={quickMode}
            query={quickQuery}
            activeIndex={quickActive}
            draftText={slashQuery === null ? input : ""}
            onQueryChange={(value) => {
              setQuickSearch(value)
              setQuickIndex(0)
            }}
            onActiveIndexChange={setQuickIndex}
            onPick={pickQuickReply}
            onEdit={setQuickDraft}
            onClose={closeQuick}
          />
        ) : null}
        <div className="flex flex-col gap-2">
          {replyTo ? (
            <div className="flex items-start gap-2 rounded-xl border-l-2 border-brand bg-zinc-100 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-brand-strong">В ответ на сообщение</div>
                <div className="truncate text-muted-foreground">{replyTo.text || "Вложение"}</div>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground" aria-label="Отменить ответ">
                <XIcon className="size-4" />
              </button>
            </div>
          ) : null}

          {attachments.length ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="relative flex items-center gap-2 rounded-lg bg-muted/60 p-1.5 pr-8 text-xs">
                  {attachment.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={attachment.previewUrl} alt="" className="size-12 rounded-md object-cover" />
                  ) : (
                    <span className="flex size-12 items-center justify-center rounded-md bg-background text-muted-foreground">
                      <FileTextIcon className="size-5" />
                    </span>
                  )}
                  <span className="max-w-40 truncate font-medium">{attachment.file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="absolute top-1 right-1 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                    aria-label="Убрать вложение"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {recording ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
                Идёт запись
                <span className="tabular-nums text-muted-foreground">{formatSeconds(recordSeconds)}</span>
              </span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" onClick={() => stopRecording("cancel")}>
                  Отмена
                </Button>
                <Button type="button" variant="ghost" className="bg-muted/60" onClick={() => stopRecording("transcribe")} title="Распознать речь и вставить текст в поле">
                  <WandSparklesIcon data-icon="inline-start" />В текст
                </Button>
                <Button type="button" onClick={() => stopRecording("send")}>
                  <SendIcon data-icon="inline-start" />
                  Голосом
                </Button>
              </div>
            </div>
          ) : transcribing ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Распознаём голос…
            </div>
          ) : (
            <div className="flex items-end gap-1 rounded-2xl bg-zinc-100 p-1.5 transition-shadow focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/15">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={Array.from(chatUploadTypes.keys()).join(",")}
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) {
                    addFiles(event.target.files)
                  }
                  event.target.value = ""
                }}
              />
              <ComposerButton icon={PaperclipIcon} label="Прикрепить файл" onClick={() => fileInputRef.current?.click()} disabled={sending} />
              <ComposerButton icon={Flower2Icon} label="Предложить букет" onClick={() => setBouquetOpen(true)} disabled={sending} />
              <ComposerButton
                icon={ZapIcon}
                label="Быстрые ответы"
                onClick={toggleQuickBrowse}
                disabled={sending || view.status !== "ok"}
                active={quickMode !== null}
                toggle
              />
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value)
                  setQuickIndex(0)
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={quickReplies.length ? "Сообщение… «/» — быстрые ответы" : "Сообщение…"}
                rows={1}
                className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-base shadow-none field-sizing-content focus-visible:ring-0 sm:text-sm"
                disabled={sending || view.status !== "ok"}
                aria-label="Текст сообщения"
              />
              {input.trim() || attachments.length ? (
                <Button
                  type="button"
                  size="icon-lg"
                  className="size-10 shrink-0 rounded-full"
                  onClick={() => void send()}
                  disabled={sending || view.status !== "ok"}
                  aria-label="Отправить"
                  title="Отправить (Enter)"
                >
                  {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                </Button>
              ) : (
                <ComposerButton icon={MicIcon} label="Записать голосовое" onClick={() => void startRecording()} disabled={sending || view.status !== "ok"} />
              )}
            </div>
          )}
        </div>
      </div>

      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-background/70 text-sm font-medium backdrop-blur-sm">
          <span className="flex items-center gap-2 rounded-lg bg-background px-4 py-2 shadow-xs">
            <PaperclipIcon className="size-4" />
            Отпустите, чтобы прикрепить
          </span>
        </div>
      ) : null}

      <QuickReplyDialog
        draft={quickDraft}
        onOpenChange={(open) => {
          if (!open) {
            setQuickDraft(null)
          }
        }}
        onSaved={handleQuickSaved}
      />

      <BouquetPickerDialog open={bouquetOpen} onOpenChange={setBouquetOpen} bouquets={bouquets} busyId={bouquetBusy} onSend={sendBouquet} />

      <Dialog open={Boolean(lightbox)} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-h-[92vh] gap-3 overflow-hidden p-3 sm:max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{lightbox ? guessFileName(lightbox) : "Фото"}</DialogTitle>
            <DialogDescription>Просмотр вложения</DialogDescription>
          </DialogHeader>
          {lightbox ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(lightbox)} alt={guessFileName(lightbox)} className="max-h-[78vh] w-full rounded-lg object-contain" />
              <div className="flex flex-wrap items-center justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => handleAction("toOrderPhoto", lightbox)}>
                  <ImagePlusIcon data-icon="inline-start" />В заказ как фото
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleAction("toOrderReceipt", lightbox)}>
                  <ReceiptTextIcon data-icon="inline-start" />
                  Как чек
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleAction("forward", lightbox)}>
                  Переслать
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleAction("open", lightbox)}>
                  <ExternalLinkIcon data-icon="inline-start" />
                  Открыть
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleAction("download", lightbox)}>
                  <DownloadIcon data-icon="inline-start" />
                  Скачать
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Сообщения одного направления и автора с разницей до 5 минут — одна группа: между ними
// минимальный зазор, имя автора только над первым, «хвостик» только у последнего.
const groupGapMs = 5 * 60_000

function sameGroup(a: BubbleMessage, b: BubbleMessage) {
  if (a.direction !== b.direction || a.authorName !== b.authorName) {
    return false
  }
  const left = parseDbInstant(a.dateTime)?.getTime()
  const right = parseDbInstant(b.dateTime)?.getTime()
  return left != null && right != null && Math.abs(right - left) <= groupGapMs
}

function ChatHeaderAction({
  icon: Icon,
  label,
  href,
  onClick,
  active = false,
  count,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  href?: string
  onClick?: () => void
  active?: boolean
  count?: number
}) {
  const className = cn(
    "h-10 min-w-10 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground",
    active && "bg-muted text-foreground"
  )
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="hidden text-sm @3xl/chat:inline">{label}</span>
      {count ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
    </>
  )
  if (href) {
    return (
      <Button type="button" variant="ghost" className={className} render={<a href={href} />} aria-label={label} title={label}>
        {content}
      </Button>
    )
  }
  return (
    <Button type="button" variant="ghost" className={className} onClick={onClick} aria-pressed={active} aria-label={label} title={label}>
      {content}
    </Button>
  )
}

function ComposerButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  toggle = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  // Кнопка-переключатель панели: помечается для «клика мимо» и держит aria-pressed.
  toggle?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      className={cn("size-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground", active && "bg-background text-foreground shadow-xs")}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...(toggle ? { "data-quick-replies-toggle": "", "aria-pressed": Boolean(active) } : {})}
    >
      <Icon className="size-5" />
    </Button>
  )
}
