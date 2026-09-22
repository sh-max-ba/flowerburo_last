"use client"

import { useSyncExternalStore } from "react"
import { Volume2Icon, VolumeXIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { readSoundPref, SOUND_PREF_EVENT, writeSoundPref } from "@/lib/sound-preference"

// Тумблер звука уведомлений в leading поля поиска (касса, стол заказов, сделки). Состояние живёт в cookie (пер-девайс) и
// читается через useSyncExternalStore: SSR-снимок = «включено» (без расхождений
// гидратации), на клиенте — реальное значение cookie; подписка на событие держит
// иконку синхронной с любым изменением (в т.ч. из глобального островка).
function subscribe(callback: () => void) {
  window.addEventListener(SOUND_PREF_EVENT, callback)
  return () => window.removeEventListener(SOUND_PREF_EVENT, callback)
}

export function SoundToggle() {
  const enabled = useSyncExternalStore(subscribe, readSoundPref, () => true)

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="size-10 text-muted-foreground hover:text-foreground"
      onClick={() => writeSoundPref(!enabled)}
      title={enabled ? "Звук уведомлений включён" : "Звук уведомлений выключен"}
      aria-label={enabled ? "Выключить звук уведомлений" : "Включить звук уведомлений"}
      aria-pressed={enabled}
    >
      {enabled ? <Volume2Icon /> : <VolumeXIcon />}
    </Button>
  )
}
