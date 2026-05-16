"use client"

import { useEffect, useState } from "react"
import type React from "react"
import Link from "next/link"
import {
  BanknoteIcon,
  BoxesIcon,
  ClipboardListIcon,
  HistoryIcon,
  LogOutIcon,
  MenuIcon,
  PackageCheckIcon,
  SettingsIcon,
  TagsIcon,
  UserCheckIcon,
} from "lucide-react"
import { logoutAction } from "@/app/auth-actions"
import type { CurrentUser, UserRole } from "@/lib/db"
import { PageHeader } from "@/components/page-header"
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
  SidebarTrigger,
} from "@/components/ui/sidebar"

type CrmSection = "clients" | "deals" | "sales" | "orders" | "ready-orders" | "stock" | "stock-acts" | "history" | "shifts" | "settings"

type CrmShellProps = {
  user: CurrentUser
  active: CrmSection
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

const navItems: Array<{
  id: CrmSection
  label: string
  icon: typeof BoxesIcon
  href: string
  roles: UserRole[]
}> = [
  { id: "deals", label: "Сделки", icon: TagsIcon, href: "/deals", roles: ["owner", "manager"] },
  { id: "clients", label: "Клиенты", icon: UserCheckIcon, href: "/clients", roles: ["owner", "manager"] },
  { id: "sales", label: "Касса", icon: BanknoteIcon, href: "/cash", roles: ["owner", "manager"] },
  { id: "orders", label: "Стол заказов", icon: ClipboardListIcon, href: "/orders", roles: ["owner", "manager", "florist"] },
  { id: "ready-orders", label: "Готовые заказы", icon: PackageCheckIcon, href: "/ready-orders", roles: ["owner", "manager"] },
  { id: "stock", label: "Склад", icon: BoxesIcon, href: "/stock", roles: ["owner"] },
  { id: "stock-acts", label: "Акты склада", icon: ClipboardListIcon, href: "/stock/acts", roles: ["owner"] },
  { id: "history", label: "История", icon: HistoryIcon, href: "/history/stock", roles: ["owner"] },
  { id: "shifts", label: "Смены", icon: BanknoteIcon, href: "/shifts", roles: ["owner"] },
  { id: "settings", label: "Настройки", icon: SettingsIcon, href: "/settings", roles: ["owner"] },
] as const

const navGroups: Array<{ label: string; ids: CrmSection[] }> = [
  { label: "CRM", ids: ["deals", "clients"] },
  { label: "Работа", ids: ["sales", "orders", "ready-orders"] },
  { label: "Склад", ids: ["stock", "stock-acts", "history"] },
  { label: "Администрирование", ids: ["shifts", "settings"] },
]

const descriptions: Partial<Record<CrmSection, string>> = {
  deals: "Воронка продаж и обработка заявок",
  clients: "База клиентов, скидки и история заказов",
  sales: "Продажи, заказы и денежные операции смены",
  orders: "Состав, сроки и статусы заказов в работе",
  "ready-orders": "Выдача, доставка и финальная оплата готовых заказов",
  stock: "Остатки, акты, импорт и движение товаров",
  "stock-acts": "Черновики, проведения и отмены складских актов",
  history: "Движения товаров и складская история",
  shifts: "Открытие, закрытие и сверка кассовых смен",
  settings: "Пользователи, поставщики и административные справочники",
}

export function CrmShell({ user, active, title, actions, children }: CrmShellProps) {
  const visibleItems = navItems.filter((item) => item.roles.includes(user.role))

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-10 items-center px-2">
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-semibold">Flower Buro</div>
            </div>
            <div className="hidden size-8 items-center justify-center text-sm font-semibold group-data-[collapsible=icon]:flex">
              FB
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {navGroups.map((group) => {
            const items = visibleItems.filter((item) => group.ids.includes(item.id))
            if (items.length === 0) {
              return null
            }

            return (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => {
                      const Icon = item.icon
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
            <form action={logoutAction} className="w-full group-data-[collapsible=icon]:w-8">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="w-full justify-start group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
              >
                <LogOutIcon data-icon="inline-start" />
                <span className="group-data-[collapsible=icon]:hidden">Выйти</span>
              </Button>
            </form>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-zinc-50">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 shadow-sm md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger variant="ghost" size="icon-sm">
              <MenuIcon />
            </SidebarTrigger>
            <span className="truncate text-sm font-medium text-zinc-500">Flower Buro</span>
          </div>
        </header>
        <main className="flex flex-1 flex-col p-4 md:p-5">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
            <PageHeader title={title} description={descriptions[active]} actions={actions} />
            {children}
          </div>
        </main>
      </SidebarInset>
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
