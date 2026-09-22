"use client"

import Link from "next/link"
import { BanknoteIcon, ChevronDownIcon, ReceiptTextIcon } from "lucide-react"
import { parseDbInstant, SHOP_TIME_ZONE } from "@/lib/datetime"
import { cn, formatMoney } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type ShiftChipShift = {
  id: number
  cashierName?: string | null
  expectedCash?: number | null
  openedAt?: string | null
  openingCash?: number | null
}

type ShiftChipProps = {
  openShift?: ShiftChipShift | null
  canManageShift?: boolean
  canViewShiftDetails?: boolean
  onShiftAction?: () => void
  className?: string
}

// Чип смены в leading поля поиска (касса, стол заказов, смены): точка статуса + кассир;
// детали и «Открыть/Закрыть смену» — в поповере по клику. Компактный, без рамки —
// живёт внутри серого поля, поэтому читается заливкой на hover, а не обводкой.
export function ShiftChip({
  openShift,
  canManageShift = false,
  canViewShiftDetails = false,
  onShiftAction,
  className,
}: ShiftChipProps) {
  const isOpen = Boolean(openShift)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
              isOpen
                ? "text-emerald-900 hover:bg-emerald-500/10 aria-expanded:bg-emerald-500/10"
                : "text-muted-foreground hover:bg-muted aria-expanded:bg-muted",
              className
            )}
            aria-label={isOpen ? `Смена открыта · ${openShift?.cashierName || "без ответственного"}` : "Смена закрыта"}
          />
        }
      >
        <span
          className={cn("size-2 shrink-0 rounded-full", isOpen ? "bg-emerald-500" : "bg-zinc-400")}
          aria-hidden
        />
        <span className="hidden max-w-40 truncate @5xl/screen:inline">
          {isOpen ? `Смена · ${openShift?.cashierName || "без ответственного"}` : "Смена закрыта"}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
          <span className={cn("size-2 rounded-full", isOpen ? "bg-emerald-500" : "bg-zinc-400")} aria-hidden />
          <span className="text-sm font-semibold">{isOpen ? "Смена открыта" : "Смена не открыта"}</span>
        </div>
        {isOpen && openShift ? (
          <dl className="flex flex-col gap-2 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Кассир</dt>
              <dd className="truncate font-medium">{openShift.cashierName || "не указан"}</dd>
            </div>
            {openShift.openedAt && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Открыта</dt>
                <dd className="font-medium tabular-nums">{formatShiftTime(openShift.openedAt)}</dd>
              </div>
            )}
            {typeof openShift.openingCash === "number" && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Наличные при открытии</dt>
                <dd className="font-medium tabular-nums">{formatMoney(openShift.openingCash)}</dd>
              </div>
            )}
            {typeof openShift.expectedCash === "number" && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Ожидается в кассе</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(openShift.expectedCash)}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Продажи и заказы недоступны, пока смена не открыта.
          </p>
        )}
        {(canManageShift || (isOpen && canViewShiftDetails)) && (
          <div className="flex gap-2 border-t border-border/40 px-4 py-3">
            {isOpen && canViewShiftDetails && openShift && (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                render={<Link href={`/shifts/${openShift.id}`} />}
              >
                <ReceiptTextIcon data-icon="inline-start" />
                Детали смены
              </Button>
            )}
            {canManageShift && onShiftAction && (
              <Button
                variant={isOpen ? "ghost" : "default"}
                size="sm"
                className="flex-1"
                onClick={onShiftAction}
              >
                <BanknoteIcon data-icon="inline-start" />
                {isOpen ? "Закрыть смену" : "Открыть смену"}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function formatShiftTime(value: string) {
  const date = parseDbInstant(value)
  if (!date) {
    return value
  }

  return date.toLocaleString("ru-RU", {
    timeZone: SHOP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
