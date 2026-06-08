// Пер-девайс настройка звука уведомлений. Храним в cookie (как sidebar_state),
// а НЕ в localStorage: у планшета флориста и у ноутбука владельца независимые
// настройки, переживает сессии, читается и на сервере при желании.
// Переключение рассылается событием, чтобы глобальный звуковой островок и тумблер
// в топбаре оставались синхронными без общего провайдера.
export const SOUND_COOKIE = "fb_sound"
export const SOUND_PREF_EVENT = "fb-sound-pref"

export function readSoundPref(): boolean {
  if (typeof document === "undefined") {
    return true
  }
  const match = document.cookie.match(/(?:^|;\s*)fb_sound=([^;]+)/)
  // По умолчанию звук включён.
  return match ? decodeURIComponent(match[1]) !== "off" : true
}

export function writeSoundPref(enabled: boolean): void {
  if (typeof document === "undefined") {
    return
  }
  // 1 год; path=/ — общий для всего приложения; lax — обычный UI-cookie.
  document.cookie = `${SOUND_COOKIE}=${enabled ? "on" : "off"}; path=/; max-age=31536000; samesite=lax`
  window.dispatchEvent(new CustomEvent<boolean>(SOUND_PREF_EVENT, { detail: enabled }))
}
