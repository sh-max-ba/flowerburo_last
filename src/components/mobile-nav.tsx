"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState } from "react"
import Link from "next/link"
import { MenuIcon } from "lucide-react"

import type { NavItem, NavSectionId } from "@/lib/nav"
import { NAV_ICONS } from "@/lib/nav-icons"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"

// Нижняя панель вкладок на телефоне (< md) вместо гамбургера: 4 главных раздела роли + «Ещё»
// (открывает полное меню — тот же сайдбар листом). Если текущий раздел не среди четырёх,
// пятая вкладка показывает его и подсвечена — видно, где ты.

// Порядок важности разделов на телефоне: первые четыре доступных роли попадают на панель.
// owner → Дашборд, Чаты, Касса, Заказы; manager → Чаты, Касса, Заказы, Готовые; florist → Заказы (+Касса).
const MOBILE_PRIORITY: NavSectionId[] = ["dashboard", "chats", "sales", "orders", "ready-orders", "clients"]
const MOBILE_SLOTS = 4

const SHORT_LABELS: Partial<Record<NavSectionId, string>> = {
  orders: "Заказы",
  "ready-orders": "Готовые",
  "history-cash": "История",
}

export function getMobileTabs(items: NavItem[]) {
  return MOBILE_PRIORITY.map((id) => items.find((item) => item.id === id)).filter((item): item is NavItem => Boolean(item)).slice(0, MOBILE_SLOTS)
}

type MobileChrome = {
  // Экран просит спрятать панель (открытая переписка, полноэкранный режим).
  setNavHidden: (hidden: boolean) => void
}

const MobileChromeContext = createContext<MobileChrome>({ setNavHidden: () => undefined })

export const MobileChromeProvider = MobileChromeContext.Provider

// Спрятать нижнюю панель, пока hidden=true (напр. открыт диалог в чатах на телефоне).
export function useHideMobileNav(hidden: boolean) {
  const { setNavHidden } = useContext(MobileChromeContext)
  useEffect(() => {
    if (!hidden) {
      return
    }
    setNavHidden(true)
    return () => setNavHidden(false)
  }, [hidden, setNavHidden])
}

// Пока на телефоне открыта экранная клавиатура (фокус в текстовом поле), панель не нужна —
// она только съедает место над клавиатурой.
function useTextInputFocused() {
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    function isTextField(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) {
        return false
      }
      if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
        return true
      }
      if (!(target instanceof HTMLInputElement)) {
        return false
      }
      return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"].includes(target.type)
    }
    function onFocusIn(event: FocusEvent) {
      setFocused(isTextField(event.target))
    }
    function onFocusOut(event: FocusEvent) {
      if (!isTextField(event.relatedTarget)) {
        setFocused(false)
      }
    }
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut)
    return () => {
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut)
    }
  }, [])

  return focused
}

type MobileTabBarProps = {
  items: NavItem[]
  active: NavSectionId
  hidden?: boolean
  badges?: Partial<Record<NavSectionId, React.ReactNode>>
}

export function MobileTabBar({ items, active, hidden = false, badges }: MobileTabBarProps) {
  const { setOpenMobile, openMobile } = useSidebar()
  const typing = useTextInputFocused()
  const tabs = getMobileTabs(items)
  const activeInTabs = tabs.some((item) => item.id === active)
  const activeItem = items.find((item) => item.id === active)
  // «Ещё» становится текущим разделом, если он не на панели (Склад, Клиенты, Настройки…).
  const moreItem = !activeInTabs && activeItem ? activeItem : null
  const MoreIcon = moreItem ? NAV_ICONS[moreItem.iconKey] : MenuIcon

  if (hidden || typing) {
    return null
  }

  return (
    <nav
      aria-label="Разделы"
      className="flex shrink-0 items-stretch border-t border-border/50 bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((item) => {
        const Icon = NAV_ICONS[item.iconKey]
        const isActive = item.id === active
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={tabClass(isActive)}
          >
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {badges?.[item.id]}
            </span>
            <span className="max-w-full truncate">{SHORT_LABELS[item.id] ?? item.label}</span>
          </Link>
        )
      })}
      <button
        type="button"
        onClick={() => setOpenMobile(!openMobile)}
        aria-expanded={openMobile}
        aria-label={moreItem ? `${moreItem.label} — все разделы` : "Все разделы"}
        className={tabClass(Boolean(moreItem))}
      >
        <MoreIcon className="size-5" aria-hidden />
        <span className="max-w-full truncate">{moreItem ? (SHORT_LABELS[moreItem.id] ?? moreItem.label) : "Ещё"}</span>
      </button>
    </nav>
  )
}

function tabClass(active: boolean) {
  return cn(
    "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium outline-none transition-colors focus-visible:bg-muted",
    active ? "text-foreground" : "text-muted-foreground"
  )
}

// Точка-счётчик на иконке вкладки.
export function MobileTabBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null
  }
  return (
    <span className="absolute -top-1.5 left-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  )
}
