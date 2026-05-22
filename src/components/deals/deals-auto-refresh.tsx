"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

const refreshIntervalMs = 5000

export function DealsAutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return
      }

      if (document.querySelector('[role="dialog"]')) {
        return
      }

      router.refresh()
    }, refreshIntervalMs)

    return () => window.clearInterval(intervalId)
  }, [router])

  return null
}
