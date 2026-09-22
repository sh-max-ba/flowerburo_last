"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type LineTabItem<V extends string = string> = {
  value: V
  label: React.ReactNode
  icon?: LucideIcon
  count?: number | null
  href?: string
}

type LineTabsProps<V extends string> = {
  items: LineTabItem<V>[]
  value: V
  onValueChange?: (value: V) => void
  className?: string
  "aria-label"?: string
}

// Вкладки второго уровня внутри контента: подчёркивание под активной, без заливки и рамок.
// Ссылки (href) — для URL-состояния, кнопки — для локального.
export function LineTabs<V extends string>({ items, value, onValueChange, className, "aria-label": ariaLabel }: LineTabsProps<V>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("no-scrollbar flex h-10 max-w-full shrink-0 items-center gap-1 overflow-x-auto", className)}
    >
      {items.map((item) => {
        const active = item.value === value
        const Icon = item.icon
        const itemClassName = cn(
          "relative flex h-full shrink-0 items-center gap-1.5 px-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
          "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity",
          active ? "text-foreground after:opacity-100" : "text-muted-foreground hover:text-foreground"
        )
        const content = (
          <>
            {Icon ? <Icon className={cn("size-4", active ? "opacity-100" : "opacity-65")} aria-hidden /> : null}
            {item.label}
            {item.count ? <span className="text-xs font-normal text-muted-foreground tabular-nums">{item.count}</span> : null}
          </>
        )

        if (item.href) {
          return (
            <Link key={item.value} href={item.href} role="tab" aria-selected={active} className={itemClassName}>
              {content}
            </Link>
          )
        }

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={itemClassName}
            onClick={() => onValueChange?.(item.value)}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
