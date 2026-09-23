import * as React from "react"

// Ниже md (768px) — телефон. Через useMediaQuery: при гидратации false, как на сервере,
// иначе сайдбар (десктоп-разметка на сервере, лист на клиенте) ломал гидратацию всей страницы.
export function useIsMobile() {
  return useMediaQuery(PHONE_MEDIA)
}

function subscribeMedia(query: string) {
  return (callback: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener("change", callback)
    return () => mql.removeEventListener("change", callback)
  }
}

// Медиазапрос без расхождения гидратации: на сервере и при гидратации — false, затем реальное значение.
export function useMediaQuery(query: string) {
  const subscribe = React.useMemo(() => subscribeMedia(query), [query])
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

// Телефон: уже md (768px) — там нижняя панель вместо сайдбара.
export const PHONE_MEDIA = "(max-width: 767px)"

export function useIsPhone() {
  return useMediaQuery(PHONE_MEDIA)
}
