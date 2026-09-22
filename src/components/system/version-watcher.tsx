"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

// Вкладка, открытая ДО деплоя, ломается: при пересборке меняются id серверных экшенов,
// и любая мутация из старой вкладки молча падает с «Failed to find Server Action»
// (run() не ловит ошибку → тост не показывается → у кассира кнопка «ничего не делает»).
// Решение: знаем build-id своей сборки (проброшен из layout, отрисован тем же билдом,
// что и клиентский бандл), раз в VERSION_POLL_MS сверяем с живым /api/version.
// При расхождении — тихо перезагружаемся, пока вкладка не на виду (чтобы не прервать
// продажу), иначе показываем тост с кнопкой «Обновить» и перезагружаемся, как только
// вкладку свернут/переключат.
const VERSION_POLL_MS = 20000

export function VersionWatcher({ currentBuildId }: { currentBuildId: string }) {
  const baselineRef = useRef(currentBuildId)
  const staleRef = useRef(false)
  const notifiedRef = useRef(false)

  useEffect(() => {
    const baseline = baselineRef.current
    // В dev сборки нет стабильного build-id — поллинг отключаем, чтобы не ловить циклы.
    if (!baseline || baseline === "dev" || baseline === "development") return

    let active = true

    function reload() {
      // Полная перезагрузка сбрасывает чанки и подтягивает свежую сборку.
      window.location.reload()
    }

    function notifyStale() {
      if (notifiedRef.current) return
      notifiedRef.current = true
      toast.info("Вышла новая версия", {
        description: "Обновите страницу, чтобы всё работало корректно.",
        duration: Infinity,
        action: { label: "Обновить", onClick: reload },
      })
    }

    async function check() {
      if (!active || staleRef.current) return
      try {
        const response = await fetch("/api/version", { cache: "no-store" })
        if (!response.ok) return
        const payload = (await response.json()) as { buildId?: string }
        const live = String(payload.buildId ?? "")
        if (!live || live === baseline) return
        staleRef.current = true
        if (document.visibilityState === "hidden") {
          reload()
        } else {
          notifyStale()
        }
      } catch {
        // Поллинг не должен ломать UI.
      }
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        // Свернули устаревшую вкладку — момент перезагрузиться без помех.
        if (staleRef.current) reload()
      } else {
        // Вернулись на вкладку: таймеры в фоне тормозятся браузером, проверим сразу.
        void check()
      }
    }

    const interval = window.setInterval(check, VERSION_POLL_MS)
    const kickoff = window.setTimeout(check, 5000)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      active = false
      window.clearInterval(interval)
      window.clearTimeout(kickoff)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return null
}
