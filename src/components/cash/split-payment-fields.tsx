"use client"

import { useEffect, useState } from "react"
import { PlusIcon, XIcon } from "lucide-react"
import { getPaymentMethodLabel, paymentMethodOptions } from "@/lib/labels"
import { formatMoney } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type SplitPaymentState = { enabled: boolean; valid: boolean }

// Смешанная оплата (до двух способов) для любой платёжной формы: чип «+ Второй способ оплаты»,
// при включении — способ и сумма второй части. Первая часть = total − вторая (сервер выводит её
// сам из parsePaymentParts, сюда передаются только скрытые поля paymentMethod2/paymentAmount2).
// Компонент самодостаточен; родитель узнаёт о состоянии через onStateChange (гейтит submit).
export function SplitPaymentFields({
  total,
  primaryMethod,
  disabled,
  idPrefix,
  onStateChange,
}: {
  // Полная сумма платёжного события (итог продажи / предоплата / доплата).
  total: number
  // Первый способ, если форма его знает — для клиентской проверки «способы различаются».
  primaryMethod?: string
  disabled?: boolean
  idPrefix: string
  onStateChange?: (state: SplitPaymentState) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [method2, setMethod2] = useState("mbank")
  const [amount2Input, setAmount2Input] = useState("")

  const amount2 = Number(amount2Input.replace(",", "."))
  const amount2Valid =
    amount2Input.trim() !== "" && Number.isFinite(amount2) && amount2 > 0 && total - amount2 >= 0.01
  const methodsDiffer = !primaryMethod || method2 !== primaryMethod
  const valid = !enabled || (amount2Valid && methodsDiffer)
  const firstAmount = amount2Valid ? Math.round((total - amount2) * 100) / 100 : null

  useEffect(() => {
    onStateChange?.({ enabled, valid })
  }, [enabled, valid, onStateChange])

  if (!enabled) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || total < 0.02}
        onClick={() => setEnabled(true)}
      >
        <PlusIcon data-icon="inline-start" />
        Оплата двумя способами
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/30 p-3">
      <input type="hidden" name="paymentMethod2" value={method2} />
      <input type="hidden" name="paymentAmount2" value={amount2Input} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Смешанная оплата</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-zinc-500"
          disabled={disabled}
          onClick={() => {
            setEnabled(false)
            setAmount2Input("")
          }}
        >
          <XIcon data-icon="inline-start" />
          Убрать
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={method2} onValueChange={(value) => setMethod2(value ?? "mbank")}>
          <SelectTrigger id={`${idPrefix}-method2`} className="w-full" disabled={disabled}>
            <SelectValue placeholder="Второй способ">
              {(value) => getPaymentMethodLabel(String(value ?? method2))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              {paymentMethodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          id={`${idPrefix}-amount2`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="0"
          value={amount2Input}
          disabled={disabled}
          className="text-right tabular-nums"
          onChange={(event) => setAmount2Input(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        {firstAmount !== null
          ? `${primaryMethod ? getPaymentMethodLabel(primaryMethod) : "Первым способом"}: ${formatMoney(firstAmount)} · ${getPaymentMethodLabel(method2)}: ${formatMoney(amount2)}`
          : `Введите сумму второй части — больше нуля и меньше ${formatMoney(total)}. Первая часть посчитается автоматически.`}
      </div>
      {!methodsDiffer && (
        <div className="text-xs font-medium text-destructive">Способы оплаты должны различаться.</div>
      )}
    </div>
  )
}
