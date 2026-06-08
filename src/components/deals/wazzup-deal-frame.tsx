"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MessageCircleIcon, RefreshCwIcon, SearchIcon, SettingsIcon } from "lucide-react"
import { toast } from "sonner"
import { linkDealToWazzupByCustomerAction } from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

type WazzupFrameState =
  | { status: "loading" }
  | ({ status: "ok"; url: string } & WazzupFrameDiagnostics)
  | ({ status: "not_configured" | "disabled" | "no_chat"; message?: string } & WazzupFrameDiagnostics)
  | ({ status: "error"; message?: string } & Partial<WazzupFrameDiagnostics>)

type WazzupFrameDiagnostics = {
  hasChatType: boolean
  hasChatId: boolean
  hasPhone: boolean
  targetSource: "deal" | "customer" | "phone_fallback" | null
  hasApiKey: boolean
  integrationEnabled: boolean
  webhookConfigured: boolean
  customerHasChat: boolean
  dealHasChatId: boolean
  matchingMessagesCount: number
  lastWebhookEvent: {
    eventType: string
    status: string
    createdAt: string
    error: string
  } | null
}

export function WazzupDealFrame({ dealId }: { dealId: number }) {
  const router = useRouter()
  const [state, setState] = useState<WazzupFrameState>({ status: "loading" })
  const [isLinkPending, startLinkTransition] = useTransition()

  useEffect(() => {
    let isActive = true

    async function load() {
      const nextState = await fetchIframeState(dealId)
      if (isActive) {
        setState(nextState)
      }
    }

    void load()

    return () => {
      isActive = false
    }
  }, [dealId])

  async function retry() {
    setState({ status: "loading" })
    setState(await fetchIframeState(dealId))
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
      setState({ status: "loading" })
      setState(await fetchIframeState(dealId))
    })
  }

  if (state.status === "ok") {
    return (
      <iframe
        title="Wazzup чат сделки"
        src={state.url}
        allow="microphone *; clipboard-write *"
        className="h-full w-full border-0"
      />
    )
  }

  if (state.status === "loading") {
    return (
      <div className="flex h-full min-h-[420px] flex-col gap-3 p-4">
        <div className="text-sm font-medium text-muted-foreground">Загружаем Wazzup чат…</div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="min-h-48 flex-1 w-full" />
      </div>
    )
  }

  if (state.status === "not_configured") {
    return (
      <FrameEmpty
        icon={<SettingsIcon />}
        title="Wazzup не настроен"
        description="Wazzup API key не настроен на сервере."
      />
    )
  }

  if (state.status === "disabled") {
    return (
      <FrameEmpty
        icon={<SettingsIcon />}
        title="Wazzup отключен в настройках"
        description="Включите интеграцию в настройках CRM."
      />
    )
  }

  if (state.status === "no_chat") {
    return (
      <FrameEmpty
        icon={<MessageCircleIcon />}
        title="Wazzup чат нельзя открыть"
        description={<NoChatDiagnostics state={state} />}
        action={
          <Button type="button" variant="outline" onClick={linkByCustomer} disabled={isLinkPending}>
            <SearchIcon data-icon="inline-start" />
            {isLinkPending ? "Проверяем..." : "Проверить чат по клиенту"}
          </Button>
        }
      />
    )
  }

  return (
    <FrameEmpty
      icon={<MessageCircleIcon />}
      title="Не удалось открыть Wazzup"
      description={<ErrorDescription message={state.message} />}
      action={
        <Button type="button" variant="outline" onClick={() => void retry()}>
          <RefreshCwIcon data-icon="inline-start" />
          Повторить
        </Button>
      }
    />
  )
}

function ErrorDescription({ message }: { message?: string }) {
  if (message?.includes("Пользователь CRM не синхронизирован с Wazzup")) {
    return (
      <span className="flex flex-col gap-1">
        <span>Пользователь CRM не синхронизирован с Wazzup</span>
        <span>Попробуйте повторить или проверьте настройки Wazzup</span>
      </span>
    )
  }

  return message
}

async function fetchIframeState(dealId: number): Promise<WazzupFrameState> {
  try {
    const response = await fetch(`/api/wazzup/iframe?dealId=${dealId}`, {
      cache: "no-store",
    })
    const data = (await response.json()) as WazzupFrameState

    if (data.status === "ok" && data.url) {
      return data
    }

    if (data.status === "not_configured" || data.status === "disabled" || data.status === "no_chat") {
      return data
    }

    return data.status === "error" ? data : { status: "error" }
  } catch {
    return { status: "error" }
  }
}

function NoChatDiagnostics({ state }: { state: WazzupFrameDiagnostics & { message?: string } }) {
  const checklist = [
    { label: "Webhook URL настроен", value: state.webhookConfigured ? "Да" : "Нет" },
    { label: "Интеграция включена", value: state.integrationEnabled ? "Да" : "Нет" },
    {
      label: "Последний webhook",
      value: state.lastWebhookEvent
        ? `${dateTime(state.lastWebhookEvent.createdAt)} / ${state.lastWebhookEvent.status || "unknown"}`
        : "Нет событий",
    },
    { label: "У клиента есть Wazzup chat", value: state.customerHasChat ? "Да" : "Нет" },
    { label: "У сделки есть chatId", value: state.dealHasChatId ? "Да" : "Нет" },
  ]

  return (
    <div className="flex flex-col gap-3 text-left">
      <p>{state.message || "У сделки нет телефона клиента, поэтому Wazzup чат открыть нельзя."}</p>
      <div className="grid gap-2">
        {checklist.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border p-2">
            <span>{item.label}</span>
            <Badge variant={item.value === "Да" ? "secondary" : "outline"}>{item.value}</Badge>
          </div>
        ))}
      </div>
      {!state.hasPhone ? (
        <p>Добавьте телефон клиента или дождитесь входящего сообщения.</p>
      ) : !state.customerHasChat && state.matchingMessagesCount === 0 ? (
        <p>Для клиента еще нет Wazzup-чата. Отправьте или получите сообщение в WhatsApp, затем обновите сделку.</p>
      ) : null}
    </div>
  )
}

function dateTime(value: string) {
  const date = parseDbInstant(value)
  if (!date) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SHOP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function FrameEmpty({
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
