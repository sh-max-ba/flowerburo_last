"use client"

import { useEffect, useState, useTransition } from "react"
import type React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  Flower2Icon,
  LogOutIcon,
  MenuIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  PlusIcon,
} from "lucide-react"
import { toast } from "sonner"
import { closeShiftAction, openShiftAction } from "@/app/actions"
import { logoutAction } from "@/app/auth-actions"
import type { ShiftShellContext } from "@/lib/app-shell"
import type { CurrentUser, UserRole } from "@/lib/db"
import { canAccessSection, getNavForRole, getSubnav, NAV_BY_ID, NAV_GROUPS, type NavSectionId, type SubTab } from "@/lib/nav"
import { cn } from "@/lib/utils"
import { NAV_ICONS } from "@/lib/nav-icons"
import { getPageTitle } from "@/lib/page-title"
import { HeaderAction, HeaderPrimaryAction, ScreenChromeProvider, ScreenHeader } from "@/components/screen-header"
import { ShiftChip } from "@/components/shift-chip"
import { SoundToggle } from "@/components/notifications/sound-toggle"
import { ShiftSheet } from "@/components/shifts/shift-sheet"
import { Button } from "@/components/ui/button"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
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
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"

type CrmShellProps = {
  user: CurrentUser
  active: NavSectionId
  title: string
  shiftContext?: ShiftShellContext
  defaultSidebarOpen?: boolean
  // Florist с открытой ночной сменой видит «Касса» в сайдбаре. Owner/manager-страницы
  // оставляют значение по умолчанию (false) — для них роль покрывает доступ к sales.
  canAccessCash?: boolean
  // Кто рисует карточку-шапку экрана: "page" — сама страница (ScreenHeader с поиском и
  // действиями), "auto" — оболочка (вкладки раздела, чип смены; на детальных страницах —
  // строка «назад»), "none" — без шапки.
  header?: "page" | "auto" | "none"
  // "fill" — рабочая область на всю оставшуюся высоту, скроллится сама страница (списки,
  // канбан, касса). "scroll" — прокручивается вся область (детальные страницы, настройки).
  layout?: "fill" | "scroll"
  // Счётчики для вкладок раздела (напр. «Товары 17», «Акты 18») — передаёт страница, которая их знает.
  subnavCounts?: Partial<Record<NavSectionId, number>>
  children: React.ReactNode
}

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

// Экраны, где в leading поля живут чип смены и звук: касса, стол заказов, готовые, смены.
const shiftChipSections = new Set<NavSectionId>(["sales", "orders", "order-drafts", "ready-orders", "shifts"])
const soundSections = new Set<NavSectionId>(["sales", "orders", "order-drafts", "ready-orders", "deals"])

export function CrmShell({
  user,
  active,
  title,
  shiftContext,
  defaultSidebarOpen = true,
  canAccessCash = false,
  header = "auto",
  layout = "scroll",
  subnavCounts,
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
  // Подстраницы разделов с вкладками (Склад, Стол заказов) подсвечивают единый родительский
  // пункт в сайдбаре и получают вкладки раздела в шапку.
  const subnav = getSubnav(active)
  const sidebarActive: NavSectionId = subnav?.parent ?? active
  const pageTitle = getPageTitle(pathname) || title
  const detail = getDetailParent({ active, subnav, pathname })
  const rowActions = buildRowActions(user.role, canAccessCash)

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

  const showShiftChip = Boolean(shiftContext) && shiftChipSections.has(active)
  const showSound = soundSections.has(active)
  const leading =
    showShiftChip || showSound ? (
      <>
        {showShiftChip && shiftContext ? (
          <ShiftChip
            openShift={shiftContext.openShift}
            canManageShift={shiftContext.canManageShift}
            canViewShiftDetails={user.role === "owner"}
            onShiftAction={() => setShiftSheet(true)}
          />
        ) : null}
        {showSound ? <SoundToggle /> : null}
      </>
    ) : null

  const subnavTabs = subnav ? (
    <SectionTabs tabs={subnav.tabs} active={active} role={user.role} counts={subnavCounts} />
  ) : null

  // Вкладок «Склада» семь — им нужна своя строка; двум вкладкам стола заказов хватает 30% справа.
  const chrome = {
    leading,
    tabs: subnavTabs,
    tabsPlacement: (subnav && subnav.tabs.length > 3 ? "row" : "inline") as "row" | "inline",
  }

  const showStockActions = subnav?.parent === "stock" && canAccessSection("stock", user.role, false)
  const autoHeader =
    header !== "auto" ? null : detail ? (
      <DetailBar parent={detail} title={pageTitle} />
    ) : subnavTabs || leading ? (
      <ScreenHeader
        title={pageTitle}
        actions={
          showStockActions ? (
            <HeaderAction icon={MinusCircleIcon} label="Списать" href="/stock?new=stock_out" />
          ) : undefined
        }
        primaryAction={
          showStockActions ? (
            <HeaderPrimaryAction icon={PlusCircleIcon} label="Пополнить" href="/stock?new=stock_in" />
          ) : undefined
        }
      />
    ) : null

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
                {items.length > 1 ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => {
                      const Icon = NAV_ICONS[item.iconKey]
                      const isActive = item.id === sidebarActive
                      const rowAction = rowActions[item.id]

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
                          {rowAction ? (
                            <SidebarMenuAction
                              showOnHover
                              render={<Link href={rowAction.href} />}
                              aria-label={rowAction.label}
                              title={rowAction.label}
                            >
                              <PlusIcon />
                            </SidebarMenuAction>
                          ) : null}
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
          <div className="flex items-center gap-2 rounded-lg p-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{roleLabels[user.role]}</div>
            </div>
            <form action={logoutAction} className="shrink-0">
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label="Выйти"
                title="Выйти"
              >
                <LogOutIcon />
              </Button>
            </form>
          </div>
        </SidebarFooter>
        {/* Полоска-переключатель на правом крае: на lg+ можно свернуть сайдбар до рельса. */}
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="h-svh min-h-0 overflow-hidden bg-muted/60">
        {/* Мобильная полоса (< md): кнопка меню + раздел. На планшете и шире сайдбар всегда виден. */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 bg-background px-2 md:hidden">
          <SidebarTrigger variant="ghost" size="icon" aria-label="Меню">
            <MenuIcon />
          </SidebarTrigger>
          <span className="truncate text-sm font-medium">{pageTitle}</span>
        </div>
        <ScreenChromeProvider value={chrome}>
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-4",
              layout === "fill" ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            {autoHeader}
            {children}
          </div>
        </ScreenChromeProvider>
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

// Детальная страница (сделка, клиент, акт, поставщик, смена) — родительский раздел для
// строки «назад»: для вкладочных разделов — вкладка («Акты»), иначе — пункт меню.
function getDetailParent({
  active,
  subnav,
  pathname,
}: {
  active: NavSectionId
  subnav: { parent: NavSectionId; tabs: SubTab[] } | null
  pathname: string
}): { label: string; href: string } | null {
  const normalized = pathname.replace(/\/+$/, "") || "/"

  if (subnav) {
    const tab = subnav.tabs.find((entry) => entry.id === active)
    if (tab && normalized !== tab.href) {
      return { label: tab.label, href: tab.href }
    }
    return null
  }

  const navItem = NAV_BY_ID[active]
  if (navItem && normalized !== navItem.href) {
    return { label: navItem.label, href: navItem.href }
  }

  return null
}

// Строка детальной страницы: «← Раздел» и название записи. Заголовок раздела не дублируем —
// он подсвечен в меню.
function DetailBar({ parent, title }: { parent: { label: string; href: string }; title: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-9 text-muted-foreground"
        render={<Link href={parent.href} />}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        {parent.label}
      </Button>
      <span className="text-muted-foreground/60" aria-hidden>
        /
      </span>
      <h1 className="truncate px-1 text-sm font-medium">{title}</h1>
    </div>
  )
}

// Действия разделов на строке меню («+» справа): создание без захода в раздел. Состав по роли.
function buildRowActions(role: UserRole, canAccessCash: boolean): Partial<Record<NavSectionId, { label: string; href: string }>> {
  const actions: Partial<Record<NavSectionId, { label: string; href: string }>> = {}
  if (canAccessSection("deals", role, canAccessCash)) {
    actions.deals = { label: "Новая сделка", href: "/deals?new=1" }
  }
  if (canAccessSection("clients", role, canAccessCash)) {
    actions.clients = { label: "Новый клиент", href: "/clients?new=1" }
  }
  if (canAccessSection("bouquets", role, canAccessCash)) {
    actions.bouquets = { label: "Новый букет", href: "/bouquets?new=1" }
  }
  if (canAccessSection("sales", role, canAccessCash)) {
    actions.sales = { label: "Новый заказ", href: "/cash?order=new" }
    actions.orders = { label: "Новый заказ", href: "/cash?order=new" }
  }
  if (canAccessSection("stock", role, canAccessCash)) {
    actions.stock = { label: "Пополнение", href: "/stock?new=stock_in" }
  }

  return actions
}

// Вкладки раздела (Склад: Товары/Остатки/…, Стол заказов: Стол/Черновики) — сегментированные,
// с иконкой и счётчиком. Доступ фильтруем по роли (флорист не видит «Черновики»);
// при одной доступной вкладке вкладок нет.
function SectionTabs({
  tabs,
  active,
  role,
  counts,
}: {
  tabs: SubTab[]
  active: NavSectionId
  role: UserRole
  counts?: Partial<Record<NavSectionId, number>>
}) {
  const visibleTabs = tabs.filter((tab) => canAccessSection(tab.id, role, false))
  if (visibleTabs.length <= 1) {
    return null
  }

  return (
    <SegmentedTabs
      aria-label="Вкладки раздела"
      value={active}
      fill
      collapseLabels={visibleTabs.length > 3}
      items={visibleTabs.map((tab) => ({
        value: tab.id,
        label: tab.label,
        href: tab.href,
        icon: NAV_ICONS[NAV_BY_ID[tab.id]?.iconKey ?? ""],
        count: counts?.[tab.id],
      }))}
    />
  )
}

function IncomingDealsSidebarBadge() {
  const count = usePolledCount("/api/deals/incoming-count")
  if (count <= 0) {
    return null
  }

  return <SidebarMenuBadge>{count > 99 ? "99+" : count}</SidebarMenuBadge>
}

// PERF-2: счётчик «Готовые заказы, ожидающие действия». Опрашивает /api/ready-orders/count
// каждые 5 сек (доступ к подсчёту имеют только owner/manager — см. route).
function ReadyOrdersSidebarBadge() {
  const count = usePolledCount("/api/ready-orders/count")
  if (count <= 0) {
    return null
  }

  return <SidebarMenuBadge>{count}</SidebarMenuBadge>
}

// Опрос счётчика раз в 5 сек, только пока вкладка видима; предыдущий запрос отменяется.
function usePolledCount(url: string) {
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
        const response = await fetch(url, {
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
  }, [url])

  return count
}
