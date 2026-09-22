import type React from "react"

// Отдельное окно для таблицы/списка (?full=1): без сайдбара и вкладок — только шапка экрана
// и рабочая область на всю ширину. Открывается ссылкой «В отдельном окне» из таблиц аналитики.
export function FullscreenShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-svh min-h-0 flex-col gap-3 overflow-hidden bg-muted/60 p-3 md:p-4">
      <span className="sr-only">{title}</span>
      {children}
    </div>
  )
}
