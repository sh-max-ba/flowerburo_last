import type React from "react"

import { cn } from "@/lib/utils"

type ScreenBodyProps = {
  // surface — белая подложка со скруглением и тенью (таблицы, формы). Без неё — прозрачная
  // область для контента, который сам рисует свои поверхности (сетка карточек, канбан).
  surface?: boolean
  // По умолчанию область скроллится по вертикали; "none" — прокрутку ведёт сам контент (канбан).
  scroll?: "y" | "none"
  className?: string
  children: React.ReactNode
}

// Рабочая область экрана под карточкой-шапкой: занимает всю оставшуюся высоту и ширину,
// скроллится сама, а не страница.
export function ScreenBody({ surface = true, scroll = "y", className, children }: ScreenBodyProps) {
  return (
    <div
      data-slot="screen-body"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        scroll === "y" ? "overflow-auto overscroll-contain" : "overflow-hidden",
        surface && "rounded-2xl bg-background shadow-xs",
        className
      )}
    >
      {children}
    </div>
  )
}
