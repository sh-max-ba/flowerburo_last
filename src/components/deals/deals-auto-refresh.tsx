"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

const pollIntervalMs = 5000

export function DealsAutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    let lastRevision: string | null = null
    let active = true
    let controller: AbortController | null = null

    async function checkForUpdates() {
      if (document.visibilityState !== "visible") {
        return
      }

      if (document.querySelector('[role="dialog"]')) {
        return
      }

      if (document.body.dataset.dndActive === "true") {
        return
      }

      controller?.abort()
      controller = new AbortController()

      try {
        const response = await fetch("/api/deals/incoming-count", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as { count?: number }
        const revision = String(payload.count ?? 0)
        if (lastRevision === null) {
          lastRevision = revision
          return
        }
        if (revision !== lastRevision) {
          lastRevision = revision
          if (active) {
            router.refresh()
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
      }
    }

    const intervalId = window.setInterval(checkForUpdates, pollIntervalMs)

    return () => {
      active = false
      controller?.abort()
      window.clearInterval(intervalId)
    }
  }, [router])

  return null
}
