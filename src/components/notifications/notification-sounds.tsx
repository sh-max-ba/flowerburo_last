"use client"

import { useEffect, useRef } from "react"
import { readSoundPref, SOUND_PREF_EVENT } from "@/lib/sound-preference"

// Глобальный звуковой островок. Монтируется в корневом layout (один раз на сессию,
// переживает клиентские переходы), поэтому звуки работают на ЛЮБОЙ странице, пока
// вкладка открыта. Привязан к realtime-поллингу (как остальные счётчики) — отдельный
// лёгкий эндпоинт /api/notifications/pulse отдаёт монотонные «номера» (MAX id), по
// росту которых отличаем именно ПОЯВЛЕНИЕ нового заказа/сделки, а не любое изменение.
const POLL_MS = 5000
const ORDER_SOUND_SRC = "/sounds/new_order.mp3"
const DEAL_SOUND_SRC = "/sounds/new_deal.mp3"

export function NotificationSounds() {
  const enabledRef = useRef(true)
  const unlockedRef = useRef(false)
  const orderAudioRef = useRef<HTMLAudioElement | null>(null)
  const dealAudioRef = useRef<HTMLAudioElement | null>(null)
  // null — ещё не инициализировано (первый опрос только запоминает базовые значения).
  const lastOrderSeq = useRef<number | null>(null)
  const lastDealSeq = useRef<number | null>(null)

  useEffect(() => {
    enabledRef.current = readSoundPref()

    const orderAudio = new Audio(ORDER_SOUND_SRC)
    const dealAudio = new Audio(DEAL_SOUND_SRC)
    orderAudio.preload = "auto"
    dealAudio.preload = "auto"
    orderAudioRef.current = orderAudio
    dealAudioRef.current = dealAudio

    // Браузеры блокируют автозвук до первого взаимодействия. На первый жест
    // «благословляем» оба элемента (play→pause в .then(), чтобы не ловить
    // «play() interrupted by pause()» в консоли). До разблокировки play() не зовём
    // вовсе — поэтому в консоль не сыпятся ошибки автоплея.
    const unlock = () => {
      if (unlockedRef.current) {
        return
      }
      unlockedRef.current = true
      for (const audio of [orderAudio, dealAudio]) {
        const played = audio.play()
        if (played && typeof played.then === "function") {
          played
            .then(() => {
              audio.pause()
              audio.currentTime = 0
            })
            .catch(() => {})
        }
      }
    }
    const gestureOptions: AddEventListenerOptions = { passive: true }
    window.addEventListener("pointerdown", unlock, gestureOptions)
    window.addEventListener("keydown", unlock, gestureOptions)
    window.addEventListener("touchstart", unlock, gestureOptions)

    const onPrefChange = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail
      enabledRef.current = typeof detail === "boolean" ? detail : readSoundPref()
    }
    window.addEventListener(SOUND_PREF_EVENT, onPrefChange)

    const play = (audio: HTMLAudioElement | null) => {
      if (!audio || !enabledRef.current || !unlockedRef.current) {
        return
      }
      try {
        audio.currentTime = 0
        const played = audio.play()
        if (played && typeof played.catch === "function") {
          played.catch(() => {})
        }
      } catch {
        // Воспроизведение никогда не должно ломать UI.
      }
    }

    let controller: AbortController | null = null

    const poll = async () => {
      if (document.visibilityState !== "visible") {
        return
      }
      controller?.abort()
      controller = new AbortController()
      try {
        const response = await fetch("/api/notifications/pulse", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) {
          // 401 на странице логина и т.п. — просто молчим.
          return
        }
        const data = (await response.json()) as { orderSeq?: number; dealSeq?: number }
        const orderSeq = Number(data.orderSeq ?? 0)
        const dealSeq = Number(data.dealSeq ?? 0)

        if (lastOrderSeq.current === null) {
          // Первый успешный опрос — только инициализация, без звука.
          lastOrderSeq.current = orderSeq
          lastDealSeq.current = dealSeq
          return
        }

        if (orderSeq > lastOrderSeq.current) {
          play(orderAudioRef.current)
        }
        if (dealSeq > (lastDealSeq.current ?? 0)) {
          play(dealAudioRef.current)
        }
        lastOrderSeq.current = orderSeq
        lastDealSeq.current = dealSeq
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
        // Сетевые сбои поллинга игнорируем.
      }
    }

    const interval = window.setInterval(poll, POLL_MS)
    void poll()

    return () => {
      controller?.abort()
      window.clearInterval(interval)
      window.removeEventListener("pointerdown", unlock, gestureOptions)
      window.removeEventListener("keydown", unlock, gestureOptions)
      window.removeEventListener("touchstart", unlock, gestureOptions)
      window.removeEventListener(SOUND_PREF_EVENT, onPrefChange)
    }
  }, [])

  return null
}
