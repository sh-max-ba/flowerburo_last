"use client"

import { useCallback, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

// Диалог, который можно открыть и кнопкой на экране, и ссылкой с флагом в URL
// (напр. «+» на строке меню → /clients?new=1). Открыт, если есть локальное состояние
// ИЛИ флаг в URL; закрытие снимает и то и другое (флаг стирается из адреса, чтобы F5
// не открывал диалог заново). Остальные параметры адреса (?search=) сохраняются.
export function useUrlFlagDialog(param: string, expected = "1") {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [localOpen, setLocalOpen] = useState(false)
  // Закрыли диалог, открытый флагом, — прячем его сразу, не дожидаясь, пока навигация
  // сотрёт флаг из адреса (иначе окно «висит» до ответа сервера).
  const [suppressed, setSuppressed] = useState(false)
  const urlOpen = searchParams.get(param) === expected
  if (!urlOpen && suppressed) {
    setSuppressed(false)
  }
  const open = localOpen || (urlOpen && !suppressed)

  const setOpen = useCallback(
    (next: boolean) => {
      setLocalOpen(next)
      if (!next && urlOpen) {
        setSuppressed(true)
        const rest = new URLSearchParams(searchParams)
        rest.delete(param)
        const query = rest.toString()
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
      }
    },
    [param, pathname, router, searchParams, urlOpen]
  )

  return [open, setOpen] as const
}
