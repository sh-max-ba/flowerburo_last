import { redirect } from "next/navigation"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function Home() {
  // Прежний дефолтный лендинг сохранён: florist → /orders, остальные → /cash.
  const user = await requireUser()
  redirect(getDefaultPathForRole(user.role))
}
