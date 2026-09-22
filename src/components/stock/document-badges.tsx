import {
  BanIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FileEditIcon,
  MinusCircleIcon,
  MinusIcon,
  PlusCircleIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { StockDocumentStatus, StockDocumentType } from "@/lib/db"
import { stockDocumentStatusLabel, stockDocumentTypeLabel } from "@/lib/labels"
import { cn } from "@/lib/utils"

// Единый источник правды для бейджей статуса/типа складского документа.
// Раньше эти функции были СКОПИРОВАНЫ в acts/page.tsx, acts/[id]/page.tsx,
// inventory/page.tsx, inventory-detail-client.tsx, warehouse/imports/page.tsx —
// с разными цветами и то с иконкой, то без. Теперь один компонент + тон Badge.

const STATUS_VARIANT: Record<StockDocumentStatus, "success" | "violet" | "destructive" | "neutral"> = {
  posted: "success", // Проведен — зелёный
  corrected: "violet", // Скорректирован — фиолетовый
  cancelled: "destructive", // Отменен — красный
  draft: "neutral", // Черновик — нейтральный серый
}

const STATUS_ICON: Record<StockDocumentStatus, typeof CheckCircle2Icon> = {
  posted: CheckCircle2Icon,
  corrected: RotateCcwIcon,
  cancelled: BanIcon,
  draft: FileEditIcon,
}

export function StockDocumentStatusBadge({
  status,
  className,
}: {
  status: StockDocumentStatus
  className?: string
}) {
  const Icon = STATUS_ICON[status] ?? FileEditIcon
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"} className={className}>
      <Icon data-icon="inline-start" />
      {stockDocumentStatusLabel(status)}
    </Badge>
  )
}

// Инвентаризация — не расход: у неё фиолетовый тон (её проведённая дельта может быть плюсом),
// Пополнение — зелёный, Списание — оранжевый (не красный: красный читается как ошибка/отмена).
const TYPE_VARIANT: Record<StockDocumentType, "success" | "orange" | "violet"> = {
  stock_in: "success",
  stock_out: "orange",
  count: "violet",
}

const TYPE_ICON: Record<StockDocumentType, typeof PlusCircleIcon> = {
  stock_in: PlusCircleIcon,
  stock_out: MinusCircleIcon,
  count: ClipboardCheckIcon,
}

export function StockDocumentTypeBadge({
  type,
  className,
}: {
  type: StockDocumentType
  className?: string
}) {
  const Icon = TYPE_ICON[type] ?? PlusCircleIcon
  return (
    <Badge variant={TYPE_VARIANT[type] ?? "neutral"} className={className}>
      <Icon data-icon="inline-start" />
      {stockDocumentTypeLabel(type)}
    </Badge>
  )
}

// Иконка-квадрат типа документа (для списков): цветной тонированный квадрат с иконкой,
// подпись типа рендерится рядом отдельно. Пополнение — зелёный «+», Списание — оранжевый «−»,
// Инвентаризация — фиолетовый планшет.
const TYPE_ICON_SQUARE: Record<StockDocumentType, { tile: string; Icon: typeof PlusIcon }> = {
  stock_in: { tile: "bg-emerald-50 text-emerald-600", Icon: PlusIcon },
  stock_out: { tile: "bg-orange-50 text-orange-600", Icon: MinusIcon },
  count: { tile: "bg-violet-50 text-violet-600", Icon: ClipboardCheckIcon },
}

export function StockDocumentTypeIcon({ type, className }: { type: StockDocumentType; className?: string }) {
  const { tile, Icon } = TYPE_ICON_SQUARE[type] ?? TYPE_ICON_SQUARE.stock_in
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tile, className)}>
      <Icon className="size-4" />
    </span>
  )
}

// Статус точкой + цветным текстом (минималистичный вид для строк списка).
const STATUS_DOT: Record<StockDocumentStatus, { dot: string; text: string }> = {
  posted: { dot: "bg-emerald-500", text: "text-emerald-700" },
  corrected: { dot: "bg-violet-500", text: "text-violet-700" },
  cancelled: { dot: "bg-red-500", text: "text-red-600" },
  draft: { dot: "bg-zinc-400", text: "text-zinc-500" },
}

export function StockDocumentStatusDot({ status }: { status: StockDocumentStatus }) {
  const s = STATUS_DOT[status] ?? STATUS_DOT.draft
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", s.text)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
      {stockDocumentStatusLabel(status)}
    </span>
  )
}
