import type { GuideId } from "@/lib/guides/types"

// Адреса раздела — отдельно от контента, чтобы клиентские компоненты не тянули тексты всех ролей.
export function guideHref(id: GuideId) {
  return `/guides?role=${id}`
}

export function scenarioHref(id: GuideId, slug: string) {
  return `/guides/${id}/${slug}`
}
