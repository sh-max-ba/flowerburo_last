import { Flower2Icon } from "lucide-react"

import type { UserRole } from "@/lib/db"
import { cn } from "@/lib/utils"

type FloristMarkProps = {
  // Роль автора действия: метка рисуется только для флориста.
  role: UserRole | null | undefined
  name?: string | null
  // Что сделал: «Оформил», «Выдал», «Добавил» — глагол согласуется со словом «флорист», поэтому
  // подходит для любого имени: «Оформил флорист · Жибек».
  action?: string
  // compact — только значок и слово «флорист» (узкие строки: касса, сообщения).
  compact?: boolean
  // wrap — узкая колонка (панель заказов в чате): подпись переносится, а не обрезается.
  wrap?: boolean
  className?: string
}

// Отметка действий флориста: флористам открыты заказы, клиенты, чаты и выдача, а менеджер и
// управляющий по этой метке видят, что сделал именно флорист и кто.
export function FloristMark({ role, name, action = "Сделал", compact = false, wrap = false, className }: FloristMarkProps) {
  if (role !== "florist") {
    return null
  }
  const label = `${action} флорист${name ? ` ${name}` : ""}`

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700",
        wrap ? "rounded-lg" : "rounded-full whitespace-nowrap",
        className
      )}
    >
      <Flower2Icon className="size-3 shrink-0" aria-hidden />
      <span className={wrap ? "min-w-0" : "truncate"}>{compact ? "флорист" : `${action} флорист${name ? ` · ${name}` : ""}`}</span>
    </span>
  )
}
