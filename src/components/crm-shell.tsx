"use client"

import { useEffect, useState, useTransition } from "react"
import type React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Flower2Icon, LogOutIcon } from "lucide-react"
import { toast } from "sonner"
import { closeShiftAction, openShiftAction } from "@/app/actions"
import { logoutAction } from "@/app/auth-actions"
import type { ShiftShellContext } from "@/lib/app-shell"
import type { CurrentUser, UserRole } from "@/lib/db"
import { getNavForRole, NAV_GROUPS, type NavSectionId } from "@/lib/nav"
import { NAV_ICONS } from "@/lib/nav-icons"
import { getPageContext, getPageTitle } from "@/lib/page-title"
import { AppTopbar } from "@/components/app-topbar"
import { ShiftSheet } from "@/components/shifts/shift-sheet"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"

type CrmShellProps = {
  user: CurrentUser
  active: NavSectionId
  title: string
  actions?: React.ReactNode
  shiftContext?: ShiftShellContext
  defaultSidebarOpen?: boolean
  // Florist с открытой ночной сменой видит «Касса» в сайдбаре. Owner/manager-страницы
  // оставляют значение по умолчанию (false) — для них роль покрывает доступ к sales.
  canAccessCash?: boolean
  // Растягивает контент на всю ширину без max-w/центрирования (для канбана сделок).
  fullBleed?: boolean
  children: React.ReactNode
}

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

export function CrmShell({
  user,
  active,
  title,
  actions,
  shiftContext,
  defaultSidebarOpen = true,
  canAccessCash = false,
  fullBleed = false,
  children,
}: CrmShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [shiftSheet, setShiftSheet] = useState(false)
  const [isPending, startTransition] = useTransition()
  // Большинство CrmShell-страниц — owner/manager (clients/deals/shifts/...), для них
  // canAccessCash=false воспроизводит прежнее поведение (visibleItems по roles).
  // Страница /orders доступна florist'у и пробрасывает canAccessCash, чтобы при
  // открытой ночной смене florist дополнительно видел «Касса» (sales).
  const visibleItems = getNavForRole(user.role, { canAccessCash })
  const topbarTitle = getPageTitle(pathname) || title
  const topbarContext = getPageContext(pathname)

  function submitShiftForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await (shiftContext?.openShift ? closeShiftAction(formData) : openShiftAction(formData))
      if (result.ok) {
        toast.success(result.message)
        setShiftSheet(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-12 items-center gap-2 px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <Flower2Icon className="size-5" />
            </div>
            <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
              <div className="truncate font-heading text-lg font-semibold">FlowerBuro</div>
              <div className="truncate text-[11px] text-muted-foreground">sellz.cloud</div>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {NAV_GROUPS.map((group) => {
            const items = visibleItems.filter((item) => group.ids.includes(item.id))
            if (items.length === 0) {
              return null
            }

            return (
              <SidebarGroup key={group.id}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => {
                      const Icon = NAV_ICONS[item.iconKey]
                      const isActive = item.id === active

                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            tooltip={item.label}
                            isActive={isActive}
                            render={<Link href={item.href} />}
                          >
                            <Icon />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                          {item.id === "deals" ? <IncomingDealsSidebarBadge /> : null}
                          {item.id === "ready-orders" ? <ReadyOrdersSidebarBadge /> : null}
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )
          })}
        </SidebarContent>
        <SidebarFooter>
          <div className="flex flex-col gap-2 rounded-lg border bg-background p-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{roleLabels[user.role]}</div>
            </div>
            <form action={logoutAction} className="w-full group-data-[collapsible=icon]:w-10">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="w-full justify-start group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
              >
                <LogOutIcon data-icon="inline-start" className="size-4 group-data-[collapsible=icon]:size-5" />
                <span className="group-data-[collapsible=icon]:hidden">Выйти</span>
              </Button>
            </form>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-zinc-50">
        <AppTopbar
          title={topbarTitle}
          context={topbarContext}
          openShift={shiftContext?.openShift}
          canManageShift={shiftContext?.canManageShift}
          canViewShiftDetails={user.role === "owner"}
          onShiftAction={shiftContext ? () => setShiftSheet(true) : undefined}
        />
        <div className="flex flex-1 flex-col p-4 md:p-5">
          <div className={`flex w-full flex-col gap-5 ${fullBleed ? "" : "mx-auto max-w-[1600px]"}`}>
            {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
            {children}
          </div>
        </div>
      </SidebarInset>
      {shiftContext ? (
        <ShiftSheet
          open={shiftSheet}
          currentUserId={user.id}
          currentUserName={user.name}
          currentUserRole={user.role}
          defaultOpeningCash={shiftContext.defaultOpeningCash}
          activeFlorists={shiftContext.activeFlorists}
          activeCashUsers={shiftContext.activeCashUsers}
          openShift={shiftContext.openShift}
          openShiftDetails={shiftContext.openShiftDetails}
          pending={isPending}
          onOpenChange={setShiftSheet}
          onSubmit={submitShiftForm}
        />
      ) : null}
    </SidebarProvider>
  )
}

function IncomingDealsSidebarBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let disposed = false
    let controller: AbortController | null = null

    async function loadCount() {
      if (document.visibilityState !== "visible") {
        return
      }

      controller?.abort()
      controller = new AbortController()

      try {
        const response = await fetch("/api/deals/incoming-count", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) {
          return
        }

        const data = (await response.json()) as { count?: unknown }
        if (!disposed) {
          setCount(Number(data.count ?? 0))
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
      }
    }

    void loadCount()
    const intervalId = window.setInterval(loadCount, 5000)

    return () => {
      disposed = true
      controller?.abort()
      window.clearInterval(intervalId)
    }
  }, [])

  if (count <= 0) {
    return null
  }

  return <SidebarMenuBadge>{count > 99 ? "99+" : count}</SidebarMenuBadge>
}

// PERF-2: бейдж «Готовые заказы, ожидающие действия». Опрашивает /api/ready-orders/count
// каждые 5 сек (доступ к подсчёту имеют только owner/manager — см. route).
function ReadyOrdersSidebarBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let disposed = false
    let controller: AbortController | null = null

    async function loadCount() {
      if (document.visibilityState !== "visible") {
        return
      }

      controller?.abort()
      controller = new AbortController()

      try {
        const response = await fetch("/api/ready-orders/count", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) {
          return
        }

        const data = (await response.json()) as { count?: unknown }
        if (!disposed) {
          setCount(Number(data.count ?? 0))
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
      }
    }

    void loadCount()
    const intervalId = window.setInterval(loadCount, 5000)

    return () => {
      disposed = true
      controller?.abort()
      window.clearInterval(intervalId)
    }
  }, [])

  if (count <= 0) {
    return null
  }

  return <SidebarMenuBadge>{count}</SidebarMenuBadge>
}
