"use client"

import type React from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type SegmentedTabItem<V extends string = string> = {
  value: V
  label: React.ReactNode
  icon?: LucideIcon
  // Счётчик после названия: серый tabular-nums, ноль не показывается.
  count?: number | null
  // Вкладка-ссылка (навигация между разделами) — рендерится <Link>, иначе <button>.
  href?: string
  disabled?: boolean
}

type SegmentedTabsProps<V extends string> = {
  items: SegmentedTabItem<V>[]
  value: V
  onValueChange?: (value: V) => void
  // fill — таблетки растягиваются на всю ширину контейнера (колонка шапки).
  fill?: boolean
  // Много вкладок: в узкой шапке экрана (контейнер screen < 896px) подписи прячутся, кроме
  // активной, — остаются иконки. Контейнером служит карточка-шапка, а не сам список: элемент с
  // container-type не даёт вклада в ширину колонки грида, и вкладки бы схлопнулись.
  collapseLabels?: boolean
  size?: "default" | "sm"
  className?: string
  "aria-label"?: string
}

// Сегментированные вкладки первого уровня: серый контейнер bg-muted p-0.5, активная —
// bg-background с лёгкой тенью, иконка перед названием, счётчик после. Без рамок.
// Используется и для навигации (href) — вкладки раздела «Склад», — и для локального
// состояния экрана (onValueChange).
export function SegmentedTabs<V extends string>({
  items,
  value,
  onValueChange,
  fill = false,
  collapseLabels = false,
  size = "default",
  className,
  "aria-label": ariaLabel,
}: SegmentedTabsProps<V>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "no-scrollbar flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 text-muted-foreground",
        size === "sm" ? "h-9" : "h-10 pointer-coarse:h-11",
        fill ? "w-full" : "w-fit",
        className
      )}
    >
      {items.map((item) => {
        const active = item.value === value
        const Icon = item.icon
        const content = (
          <>
            {Icon ? <Icon className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-65")} aria-hidden /> : null}
            <span className={cn("truncate", collapseLabels && Icon && !active && "hidden @4xl/screen:inline")}>{item.label}</span>
            {item.count ? (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {item.count > 999 ? "999+" : item.count}
              </span>
            ) : null}
          </>
        )
        const itemClassName = cn(
          "flex h-full min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/35",
          fill && "flex-[1_0_auto]",
          active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          item.disabled && "pointer-events-none opacity-50"
        )

        if (item.href) {
          return (
            <Link
              key={item.value}
              href={item.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              aria-label={typeof item.label === "string" ? item.label : undefined}
              className={itemClassName}
            >
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
            aria-label={typeof item.label === "string" ? item.label : undefined}
            disabled={item.disabled}
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
