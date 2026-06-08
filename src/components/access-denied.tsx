import Link from "next/link"
import { ArrowRightIcon, LogOutIcon, ShieldAlertIcon } from "lucide-react"
import { logoutAction } from "@/app/auth-actions"
import { getDefaultPathForRole } from "@/lib/auth"
import type { UserRole } from "@/lib/db"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

const roleLabels: Record<UserRole, string> = {
  owner: "Управляющий",
  manager: "Менеджер",
  florist: "Флорист",
}

type AccessDeniedProps = {
  /** Роль текущего пользователя — для подсказки и выбора доступной страницы. */
  role?: UserRole
  /**
   * Куда ведёт основная кнопка. Если не задано, рассчитывается по роли
   * (флорист → /orders, остальные → /cash); по умолчанию — на главную.
   */
  homeHref?: string
}

export function AccessDenied({ role, homeHref }: AccessDeniedProps) {
  const landingHref = homeHref ?? (role ? getDefaultPathForRole(role) : "/")
  const roleLabel = role ? roleLabels[role] : null
  const landingLabel = landingHref === "/orders" ? "К заказам" : "В кассу"

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Empty className="w-full max-w-md bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Нет доступа к разделу</EmptyTitle>
          <EmptyDescription>
            {roleLabel
              ? `Ваша роль — «${roleLabel}». У неё нет прав на этот раздел. Откройте доступную вам страницу или войдите под другой учётной записью.`
              : "У вашей роли нет прав на этот раздел. Откройте доступную вам страницу или войдите под другой учётной записью."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link
            href={landingHref}
            className={buttonVariants({ className: "w-full" })}
          >
            {landingHref === "/orders" || landingHref === "/cash"
              ? landingLabel
              : "На главную"}
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
          <form action={logoutAction} className="w-full">
            <Button type="submit" variant="outline" className="w-full">
              <LogOutIcon data-icon="inline-start" />
              Сменить пользователя
            </Button>
          </form>
        </EmptyContent>
      </Empty>
    </main>
  )
}
