"use client"

import type React from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MenuIcon } from "lucide-react"

import type { UserRole } from "@/lib/db"
import type { NavItem, NavSectionId } from "@/lib/nav"
import { NAV_ICONS } from "@/lib/nav-icons"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"

// Нижний док на телефоне (< md) вместо гамбургера: 4 главных раздела роли + «Ещё»
// (открывает полное меню — тот же сайдбар листом). Если текущий раздел не среди четырёх,
// пятая вкладка показывает его и подсвечена — видно, где ты.

// Порядок важности разделов на телефоне: первые четыре доступных роли попадают на панель.
// owner → Аналитика, Чаты, Касса, Заказы (Дашборд — в «Ещё»); manager → Чаты, Касса, Заказы, Готовые;
// florist — от стола заказов (его главный экран): Заказы, Касса (при открытой смене), Готовые, Чаты.
const MOBILE_PRIORITY: NavSectionId[] = ["analytics", "chats", "sales", "orders", "ready-orders", "clients"]
const FLORIST_MOBILE_PRIORITY: NavSectionId[] = ["orders", "sales", "ready-orders", "chats", "clients"]
const MOBILE_SLOTS = 4

const SHORT_LABELS: Partial<Record<NavSectionId, string>> = {
  orders: "Заказы",
  "ready-orders": "Готовые",
  "history-cash": "История",
}

export function getMobileTabs(items: NavItem[], role: UserRole) {
  const priority = role === "florist" ? FLORIST_MOBILE_PRIORITY : MOBILE_PRIORITY
  return priority.map((id) => items.find((item) => item.id === id)).filter((item): item is NavItem => Boolean(item)).slice(0, MOBILE_SLOTS)
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

// Пока на телефоне открыта экранная клавиатура (фокус в текстовом поле), док не нужен —
// он только съедает место над клавиатурой.
export function useTextInputFocused() {
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

// Параметры «лупы» дока: во сколько раз растёт иконка под пальцем, на сколько px
// приподнимается и сколько соседей с каждой стороны это чувствуют.
const DOCK_MAGNIFY = 1.32
const DOCK_LIFT = 8
const DOCK_SPREAD = 2
// Сдвиг пальца, после которого отпускание — «выбор скольжением», а не обычный тап.
const DRAG_THRESHOLD_PX = 8
// Лупа включается только при зажатии: палец держат дольше этого (мс) или ведут по доку.
// Обычный тап её не трогает — док не дёргается.
const HOLD_DELAY_MS = 250

type MobileTabBarProps = {
  items: NavItem[]
  role: UserRole
  active: NavSectionId
  hidden?: boolean
  badges?: Partial<Record<NavSectionId, React.ReactNode>>
}

type DockEntry = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  href?: string
  badge?: React.ReactNode
  ariaLabel?: string
  ariaExpanded?: boolean
}

// Док-панель на телефоне: плавающая стеклянная капсула. Тап — просто открывает раздел. Если палец
// зажать или повести по доку, иконка под ним увеличивается (слабее — соседи); отпускание над
// иконкой открывает раздел.
export function MobileTabBar({ items, role, active, hidden = false, badges }: MobileTabBarProps) {
  const router = useRouter()
  const { setOpenMobile, openMobile } = useSidebar()
  const dockRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLElement | null>>([])
  const pointerRef = useRef<{ id: number; startX: number; lastX: number; held: boolean } | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  // «Лупа»: позиция пальца/мыши по X внутри дока и замеренные центры иконок (null — выключена).
  const [lens, setLens] = useState<Lens | null>(null)

  // Уход со страницы посреди зажатия — таймер лупы не должен сработать после размонтирования.
  useEffect(() => {
    const timers = holdTimerRef
    return () => {
      if (timers.current !== null) {
        window.clearTimeout(timers.current)
      }
    }
  }, [])

  const tabs = getMobileTabs(items, role)
  const activeInTabs = tabs.some((item) => item.id === active)
  const activeItem = items.find((item) => item.id === active)
  // «Ещё» становится текущим разделом, если он не на панели (Склад, Клиенты, Настройки…).
  const moreItem = !activeInTabs && activeItem ? activeItem : null

  const entries: DockEntry[] = [
    ...tabs.map((item) => ({
      key: item.id,
      label: SHORT_LABELS[item.id] ?? item.label,
      icon: NAV_ICONS[item.iconKey],
      active: item.id === active,
      href: item.href,
      badge: badges?.[item.id],
    })),
    {
      key: "more",
      label: moreItem ? (SHORT_LABELS[moreItem.id] ?? moreItem.label) : "Ещё",
      icon: moreItem ? NAV_ICONS[moreItem.iconKey] : MenuIcon,
      active: Boolean(moreItem),
      ariaLabel: moreItem ? `${moreItem.label} — все разделы` : "Все разделы",
      ariaExpanded: openMobile,
    },
  ]

  if (hidden) {
    return null
  }

  function localX(clientX: number) {
    const rect = dockRef.current?.getBoundingClientRect()
    return rect ? clientX - rect.left : null
  }

  // Центры иконок без учёта transform (offsetLeft) — лупа не должна «убегать» от пальца.
  function measure(clientX: number): Lens | null {
    const x = localX(clientX)
    const elements = itemRefs.current.slice(0, entries.length)
    if (x === null || elements.some((element) => !element)) {
      return null
    }
    return {
      x,
      centers: elements.map((element) => element!.offsetLeft + element!.offsetWidth / 2),
      itemWidth: elements[0]!.offsetWidth,
    }
  }

  function indexAt(current: Lens) {
    let best = -1
    let bestDistance = Number.POSITIVE_INFINITY
    current.centers.forEach((center, index) => {
      const distance = Math.abs(current.x - center)
      if (distance < bestDistance) {
        bestDistance = distance
        best = index
      }
    })
    return best
  }

  function activate(index: number) {
    const entry = entries[index]
    if (!entry) {
      return
    }
    if (entry.href) {
      router.push(entry.href)
    } else {
      setOpenMobile(!openMobile)
    }
  }

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    clearHoldTimer()
    const pointer = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, held: false }
    pointerRef.current = pointer
    suppressClickRef.current = false
    // Лупу не показываем сразу — только если палец задержался на доке.
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      if (pointerRef.current === pointer) {
        pointer.held = true
        setLens(measure(pointer.lastX))
      }
    }, HOLD_DELAY_MS)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) {
      return
    }
    pointer.lastX = event.clientX
    // Повёл пальцем по доку — это тоже зажатие: лупа сразу, без ожидания.
    if (!pointer.held && Math.abs(event.clientX - pointer.startX) > DRAG_THRESHOLD_PX) {
      pointer.held = true
      clearHoldTimer()
    }
    if (pointer.held) {
      setLens(measure(event.clientX))
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const pointer = pointerRef.current
    pointerRef.current = null
    clearHoldTimer()
    setLens(null)
    if (!pointer || !pointer.held) {
      // Обычный тап — работает штатный click по ссылке/кнопке.
      return
    }
    // Зажатие/скольжение: открываем раздел под пальцем, а синтетический click (на иконке,
    // где палец коснулся) гасим.
    const current = measure(event.clientX)
    suppressClickRef.current = true
    if (current) {
      activate(indexAt(current))
    }
  }

  function handlePointerCancel() {
    pointerRef.current = null
    clearHoldTimer()
    setLens(null)
  }

  function handleClickCapture(event: React.MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:hidden">
      <nav aria-label="Разделы" className="pointer-events-auto w-full max-w-md">
        <div
          ref={dockRef}
          className="relative flex touch-none items-end gap-0.5 rounded-[26px] bg-white/80 p-1.5 shadow-[0_10px_30px_-8px_rgba(24,24,27,0.28),inset_0_1px_0_rgba(255,255,255,0.75)] ring-1 ring-zinc-950/[0.07] backdrop-blur-2xl backdrop-saturate-150 select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onClickCapture={handleClickCapture}
          onContextMenu={(event) => event.preventDefault()}
        >
          {entries.map((entry, index) => {
            const Icon = entry.icon
            const strength = magnifyStrength(lens, index)
            const content = (
              <span
                className="flex origin-bottom flex-col items-center gap-0.5 transition-transform duration-150 ease-out will-change-transform motion-reduce:transform-none"
                style={{
                  transform: strength
                    ? `translateY(${-DOCK_LIFT * strength}px) scale(${1 + (DOCK_MAGNIFY - 1) * strength})`
                    : undefined,
                }}
              >
                <span className="relative">
                  <Icon className="size-[22px]" aria-hidden />
                  {entry.badge}
                </span>
                <span className="max-w-full truncate">{entry.label}</span>
              </span>
            )
            const className = dockItemClass(entry.active)

            return entry.href ? (
              <Link
                key={entry.key}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                href={entry.href}
                aria-current={entry.active ? "page" : undefined}
                className={className}
                draggable={false}
              >
                {content}
              </Link>
            ) : (
              <button
                key={entry.key}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                type="button"
                onClick={() => setOpenMobile(!openMobile)}
                aria-expanded={entry.ariaExpanded}
                aria-label={entry.ariaLabel}
                className={className}
              >
                {content}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

type Lens = { x: number; centers: number[]; itemWidth: number }

// Сила «лупы» для иконки: 1 под пальцем, плавно к 0 через DOCK_SPREAD соседей.
function magnifyStrength(lens: Lens | null, index: number) {
  const center = lens?.centers[index]
  if (!lens || center === undefined || !lens.itemWidth) {
    return 0
  }
  const distance = Math.abs(lens.x - center) / lens.itemWidth
  const reach = DOCK_SPREAD + 0.5
  if (distance >= reach) {
    return 0
  }
  // Косинусный спад — без «ступенек» между соседями.
  return (Math.cos((distance / reach) * Math.PI) + 1) / 2
}

function dockItemClass(active: boolean) {
  return cn(
    "flex h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-[20px] px-1 text-[10.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
    active ? "bg-white text-zinc-950 shadow-[0_1px_3px_rgba(24,24,27,0.12)]" : "text-zinc-500"
  )
}

// Точка-счётчик на иконке вкладки.
// muted — бледно-серый бейдж: есть сообщения, но не срочные (клиенту уже отвечали).
export function MobileTabBadge({ count, muted = false }: { count: number; muted?: boolean }) {
  if (count <= 0) {
    return null
  }
  return (
    <span
      className={cn(
        "absolute -top-1.5 left-3 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums",
        muted ? "bg-zinc-200 text-zinc-500" : "bg-primary text-primary-foreground"
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}
