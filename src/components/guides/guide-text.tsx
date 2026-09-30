import type React from "react"

import { cn } from "@/lib/utils"

// Текст инструкции: **Надпись** — подпись кнопки, поля или вкладки. Выделяем её «таблеткой»,
// как на экране, чтобы глаз сразу находил, что нажимать.
export function GuideText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <UiLabel key={index}>{part.slice(2, -2)}</UiLabel>
        ) : (
          part
        )
      )}
    </span>
  )
}

export function UiLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <strong
      className={cn(
        "rounded-md bg-muted px-1.5 py-px font-semibold text-foreground [box-decoration-break:clone] [-webkit-box-decoration-break:clone]",
        className
      )}
    >
      {children}
    </strong>
  )
}

// «3 шага», «5 инструкций», «1 минута».
export function plural(count: number, forms: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

export const STEP_FORMS: [string, string, string] = ["шаг", "шага", "шагов"]
export const SCENARIO_FORMS: [string, string, string] = ["инструкция", "инструкции", "инструкций"]
export const MINUTE_FORMS: [string, string, string] = ["минута", "минуты", "минут"]
