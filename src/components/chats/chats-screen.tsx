"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MessageSquarePlusIcon, MessagesSquareIcon, UsersRoundIcon } from "lucide-react"
import { toast } from "sonner"
import { assignChatAction, attachChatMediaToOrderAction, createOrderAction, createOrderDraftAction, markChatAnsweredAction } from "@/app/actions"
import type { BouquetTemplate, ChatCounts, ChatSummary, ChatTab, CustomerOption, OrderImage, Product } from "@/lib/db"
import { cn } from "@/lib/utils"
import { OrderDialog } from "@/components/orders/new-order-dialog"
import type { ProductLineItem } from "@/components/products/product-line-items"
import { ScreenBody } from "@/components/screen-body"
import { HeaderAction, HeaderPrimaryAction, ScreenHeader } from "@/components/screen-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ChatContextPanel, type ChatPanelKind } from "./chat-context-panel"
import { ChatList } from "./chat-list"
import { ChatWindow } from "./chat-window"
import { ForwardDialog } from "./forward-dialog"
import type { BubbleMessage } from "./message-bubble"
import { NewChatDialog } from "./new-chat-dialog"

// Единое окно чатов: карточка-шапка (поиск + вкладки Все/Ждут/Мои/Новые), слева список диалогов,
// в центре переписка, справа по кнопке — панель «Контакт» или «Заказы» (на узком экране —
// шторкой). Выбранный диалог живёт в ?chat=, список обновляется поллингом ревизии.

const inboxPollMs = 4000
const wideContainerPx = 1024
// Уже 800px (планшет портретом) — список и переписка по очереди, как в мобильном мессенджере.
const listContainerPx = 800

type InboxResponse = {
  status: string
  revision?: string
  counts?: ChatCounts
  chats?: ChatSummary[]
  message?: string
}

const tabItems: Array<{ value: ChatTab; label: string }> = [
  { value: "all", label: "Все" },
  { value: "waiting", label: "Ждут" },
  { value: "mine", label: "Мои" },
  { value: "new", label: "Новые" },
]

const emptyHints: Record<ChatTab, string> = {
  all: "Когда клиент напишет в WhatsApp или Instagram, диалог появится здесь.",
  waiting: "Все входящие отвечены.",
  mine: "Возьмите диалог себе через меню строки или ответьте клиенту — он станет вашим.",
  new: "Новых диалогов без ответа нет.",
}

export function ChatsScreen({
  currentUser,
  users,
  bouquets,
  products,
  customers,
  initialChats,
  initialCounts,
  initialRevision,
  initialChat,
  initialTab = "all",
  openNew = false,
}: {
  currentUser: { id: number; name: string }
  users: Array<{ id: number; name: string }>
  bouquets: BouquetTemplate[]
  products: Product[]
  customers: CustomerOption[]
  initialChats: ChatSummary[]
  initialCounts: ChatCounts
  initialRevision: string
  initialChat: ChatSummary | null
  initialTab?: ChatTab
  openNew?: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<ChatTab>(initialTab)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState(false)
  const [chats, setChats] = useState<ChatSummary[]>(initialChats)
  const [counts, setCounts] = useState<ChatCounts>(initialCounts)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ChatSummary | null>(initialChat)
  const [panel, setPanel] = useState<ChatPanelKind | null>(null)
  const [forwardMessage, setForwardMessage] = useState<BubbleMessage | null>(null)
  const [newChatOpen, setNewChatOpen] = useState(openNew)
  const [orderCustomer, setOrderCustomer] = useState<CustomerOption | null>(null)
  const [orderItems, setOrderItems] = useState<ProductLineItem[]>([])
  // Фото/чеки из чата, отложенные к следующему заказу этого экрана.
  const [pendingImages, setPendingImages] = useState<OrderImage[]>([])
  const [contextReloadKey, setContextReloadKey] = useState(0)
  const [containerWidth, setContainerWidth] = useState<number>(wideContainerPx)
  const [isOrderPending, startOrderTransition] = useTransition()

  const revisionRef = useRef(initialRevision)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Ширина рабочей области (а не окна): полный сайдбар съедает 256px на lg.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === "undefined") {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) {
        setContainerWidth(width)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const wide = containerWidth >= wideContainerPx
  const showList = containerWidth >= listContainerPx || !selected

  // Поиск — на сервере, с задержкой набора.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const loadInbox = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ tab, q: query })
      if (groups) {
        params.set("groups", "1")
      }
      const response = await fetch(`/api/chats/inbox?${params.toString()}`, { cache: "no-store", signal })
      const data = (await response.json()) as InboxResponse
      if (data.status !== "ok") {
        throw new Error(data.message || "Не удалось загрузить диалоги.")
      }
      revisionRef.current = data.revision ?? ""
      setChats(data.chats ?? [])
      if (data.counts) {
        setCounts(data.counts)
      }
      // Выбранный диалог держим свежим (счётчик, ответственный, последнее сообщение).
      setSelected((current) => {
        if (!current) {
          return current
        }
        return data.chats?.find((chat) => chat.id === current.id) ?? current
      })
    },
    [tab, query, groups]
  )

  // Первичная загрузка по вкладке/поиску/группам (кроме самого первого рендера — данные с сервера).
  const firstLoadRef = useRef(true)
  useEffect(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false
      return
    }
    const controller = new AbortController()
    setLoading(true)
    loadInbox(controller.signal)
      .catch(() => undefined)
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadInbox])

  // Поллинг ревизии списка: новое сообщение, назначение, отметка — список перезагружается.
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
        const params = new URLSearchParams({ probe: "1" })
        if (groups) {
          params.set("groups", "1")
        }
        const response = await fetch(`/api/chats/inbox?${params.toString()}`, { cache: "no-store", signal: controller.signal })
        const data = (await response.json()) as InboxResponse
        if (!active || data.status !== "ok") {
          return
        }
        if (data.counts) {
          setCounts(data.counts)
        }
        if ((data.revision ?? "") !== revisionRef.current) {
          await loadInbox(controller.signal)
        }
      } catch {
        // сетевые сбои поллинга игнорируем
      }
    }
    const id = window.setInterval(poll, inboxPollMs)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(id)
    }
  }, [loadInbox, groups])

  const refreshInbox = useCallback(() => {
    loadInbox().catch(() => undefined)
  }, [loadInbox])

  function syncUrl(chatId: number | null) {
    const url = new URL(window.location.href)
    if (chatId) {
      url.searchParams.set("chat", String(chatId))
    } else {
      url.searchParams.delete("chat")
    }
    // Параметры-входы (tab/customer/new) отрабатывают один раз при загрузке — дальше состояние
    // живёт на экране, в адресе остаётся только открытый диалог.
    url.searchParams.delete("new")
    url.searchParams.delete("tab")
    url.searchParams.delete("customer")
    window.history.replaceState(window.history.state, "", url.toString())
  }

  function selectChat(chat: ChatSummary | null) {
    setSelected(chat)
    syncUrl(chat?.id ?? null)
  }

  async function selectChatById(chatId: number) {
    const known = chats.find((chat) => chat.id === chatId)
    if (known) {
      selectChat(known)
      return
    }
    try {
      const response = await fetch(`/api/chats/${chatId}/messages`, { cache: "no-store" })
      const data = (await response.json()) as { status: string; chat?: ChatSummary }
      if (data.status === "ok" && data.chat) {
        selectChat(data.chat)
        refreshInbox()
      }
    } catch {
      toast.error("Не удалось открыть диалог.")
    }
  }

  async function attachToOrder(message: BubbleMessage, kind: "photo" | "receipt") {
    const result = await attachChatMediaToOrderAction(message.id, kind)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    setPendingImages((current) => (current.some((image) => image.id === result.data.image.id) ? current : [...current, result.data.image]))
    toast.success(result.message, {
      action: { label: "К заказу", onClick: () => setPanel("orders") },
    })
  }

  async function runChatAction(action: () => Promise<{ ok: boolean; message: string }>) {
    const result = await action()
    if (result.ok) {
      toast.success(result.message)
      refreshInbox()
    } else {
      toast.error(result.message)
    }
  }

  function submitOrder(event: React.FormEvent<HTMLFormElement>, after?: () => void) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const isDraft = submitter?.getAttribute("data-intent") === "draft"
    const formData = new FormData(event.currentTarget)
    startOrderTransition(async () => {
      const result = await (isDraft ? createOrderDraftAction(formData) : createOrderAction(formData))
      if (result.ok) {
        for (const message of result.messages ?? [result.message]) {
          toast.success(message)
        }
        after?.()
        setOrderCustomer(null)
        setOrderItems([])
        setPendingImages([])
        setContextReloadKey((value) => value + 1)
        refreshInbox()
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  const contextPanel =
    selected && panel ? (
      <ChatContextPanel
        key={`${selected.id}:${panel}`}
        chat={selected}
        kind={panel}
        products={products}
        bouquets={bouquets}
        reloadKey={contextReloadKey}
        pendingImages={pendingImages}
        onRemovePendingImage={(imageId) => setPendingImages((current) => current.filter((image) => image.id !== imageId))}
        onClose={() => setPanel(null)}
        onCreateOrder={(customer) => setOrderCustomer(customer)}
        onCustomerChanged={refreshInbox}
      />
    ) : null

  const tabs = useMemo(
    () =>
      tabItems.map((item) => ({
        value: item.value,
        label: item.label,
        count: counts[item.value],
      })),
    [counts]
  )

  return (
    <>
      <ScreenHeader
        className="rounded-lg"
        title="Чаты"
        search={{
          value: searchInput,
          onChange: setSearchInput,
          placeholder: "Поиск по диалогам: имя, телефон, текст",
          pending: loading && Boolean(searchInput),
          inputProps: { "aria-label": "Поиск диалогов" },
        }}
        actions={<HeaderAction icon={UsersRoundIcon} label="Группы" active={groups} onClick={() => setGroups((value) => !value)} />}
        primaryAction={<HeaderPrimaryAction icon={MessageSquarePlusIcon} label="Новый чат" onClick={() => setNewChatOpen(true)} />}
        tabs={<SegmentedTabs aria-label="Фильтр диалогов" items={tabs} value={tab} onValueChange={setTab} fill />}
      />

      <ScreenBody surface scroll="none" className="rounded-lg">
        <div ref={bodyRef} className="flex h-full min-h-0 min-w-0">
          <aside
            className={cn(
              "min-h-0 flex-col",
              showList ? "flex" : "hidden",
              containerWidth >= listContainerPx ? "w-80 shrink-0" : "w-full"
            )}
            aria-label="Список диалогов"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <ChatList
                chats={chats}
                selectedId={selected?.id ?? null}
                currentUserId={currentUser.id}
                loading={loading}
                emptyHint={query ? "По этому запросу ничего не найдено." : emptyHints[tab]}
                onSelect={selectChat}
                onMarkAnswered={(chat) => void runChatAction(() => markChatAnsweredAction(chat.id))}
                onAssignToMe={(chat) => void runChatAction(() => assignChatAction(chat.id, currentUser.id))}
                onUnassign={(chat) => void runChatAction(() => assignChatAction(chat.id, null))}
              />
            </div>
          </aside>

          {selected ? (
            <>
              {showList ? <div className="w-px shrink-0 bg-border/40" aria-hidden /> : null}
              <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Переписка">
                <ChatWindow
                  key={selected.id}
                  chat={selected}
                  currentUser={currentUser}
                  users={users}
                  bouquets={bouquets}
                  panel={panel}
                  showBack={!showList}
                  onTogglePanel={(next) => setPanel((current) => (current === next ? null : next))}
                  onAssign={(userId) => void runChatAction(() => assignChatAction(selected.id, userId))}
                  onBack={() => selectChat(null)}
                  onForward={setForwardMessage}
                  onAttachToOrder={(message, kind) => void attachToOrder(message, kind)}
                  onActivity={refreshInbox}
                />
              </section>
              {wide && contextPanel ? (
                <>
                  <div className="w-px shrink-0 bg-border/40" aria-hidden />
                  <aside className="flex w-80 shrink-0 flex-col" aria-label={panel === "contact" ? "Контакт" : "Заказы клиента"}>
                    {contextPanel}
                  </aside>
                </>
              ) : null}
            </>
          ) : containerWidth >= listContainerPx ? (
            <>
              <div className="w-px shrink-0 bg-border/40" aria-hidden />
              <section className="flex min-w-0 flex-1 items-center justify-center" aria-label="Переписка">
                <Empty className="border-0">
                  <EmptyHeader>
                    <MessagesSquareIcon className="mx-auto size-8 text-muted-foreground/70" aria-hidden />
                    <EmptyTitle>Выберите диалог</EmptyTitle>
                    <EmptyDescription>Переписка откроется здесь. Заказ можно создать прямо из чата — кнопка «Заказы» в шапке.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </section>
            </>
          ) : null}
        </div>
      </ScreenBody>

      {!wide ? (
        <Sheet open={Boolean(panel && selected)} onOpenChange={(open) => !open && setPanel(null)}>
          <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-md">
            <SheetHeader className="sr-only">
              <SheetTitle>{panel === "contact" ? "Контакт" : "Заказы клиента"}</SheetTitle>
              <SheetDescription>Панель диалога</SheetDescription>
            </SheetHeader>
            {contextPanel}
          </SheetContent>
        </Sheet>
      ) : null}

      <ForwardDialog
        message={forwardMessage}
        currentChatId={selected?.id ?? null}
        onOpenChange={(open) => !open && setForwardMessage(null)}
        onForwarded={() => refreshInbox()}
      />

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={(open) => {
          setNewChatOpen(open)
          if (!open) {
            syncUrl(selected?.id ?? null)
          }
        }}
        onOpened={(chatId) => void selectChatById(chatId)}
      />

      {orderCustomer && selected ? (
        <OrderDialog
          open={Boolean(orderCustomer)}
          onOpenChange={(open) => {
            if (!open) {
              setOrderCustomer(null)
            }
          }}
          products={products}
          bouquets={bouquets}
          customers={customers}
          pending={isOrderPending}
          items={orderItems}
          setItems={setOrderItems}
          onSubmit={submitOrder}
          initialCustomer={orderCustomer}
          initialSource={selected.chatType}
          initialImages={pendingImages}
          description={`Заказ для клиента из чата ${selected.name || selected.phone}. Клиент и источник подставлены автоматически.`}
        />
      ) : null}
    </>
  )
}
