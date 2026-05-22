"use client"

import Link from "next/link"
import { BanknoteIcon, MenuIcon } from "lucide-react"
import { formatMoney } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"

type OpenShift = {
  id: number
  expectedCash?: number | null
  cashierName?: string | null
}

type AppTopbarProps = {
  title: string
  context?: string
  userName: string
  roleLabel: string
  openShift?: OpenShift | null
  canManageShift?: boolean
  canViewShiftDetails?: boolean
  onShiftAction?: () => void
}

export function AppTopbar({
  title,
  context,
  userName,
  roleLabel,
  openShift,
  canManageShift = false,
  canViewShiftDetails = false,
  onShiftAction,
}: AppTopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 shadow-sm backdrop-blur md:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SidebarTrigger variant="ghost" size="icon-sm">
          <MenuIcon />
        </SidebarTrigger>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{title}</div>
          {context ? (
            <div className="hidden truncate text-xs text-muted-foreground sm:block">{context}</div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={openShift ? "secondary" : "outline"}>
            {openShift ? "Смена открыта" : "Смена закрыта"}
          </Badge>
          {openShift ? (
            <div className="hidden max-w-72 truncate text-xs text-muted-foreground xl:block">
              {openShift.cashierName || "Ответственный не указан"}
              {typeof openShift.expectedCash === "number"
                ? ` · Ожидается: ${formatMoney(openShift.expectedCash)}`
                : ""}
            </div>
          ) : null}
        </div>

        {openShift && canViewShiftDetails ? (
          <Button variant="outline" size="sm" render={<Link href={`/shifts/${openShift.id}`} />}>
            Детали смены
          </Button>
        ) : null}
        {canManageShift && onShiftAction ? (
          <Button
            variant={openShift ? "outline" : "default"}
            size="sm"
            onClick={onShiftAction}
          >
            <BanknoteIcon data-icon="inline-start" />
            {openShift ? "Закрыть смену" : "Открыть смену"}
          </Button>
        ) : null}

        <div className="hidden min-w-0 text-right lg:block">
          <div className="max-w-36 truncate text-sm font-medium">{userName}</div>
          <div className="text-xs text-muted-foreground">{roleLabel}</div>
        </div>
      </div>
    </header>
  )
}
