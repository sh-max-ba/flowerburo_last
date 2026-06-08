import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getWazzupChatForDeal, getWazzupChatProbeForDeal } from "@/lib/wazzup"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "no-store",
}

// Собственный чат сделки. Без probe — полная лента + revision (первичная загрузка / обновление).
// С ?probe=1 — только статус + revision (дешёвый поллинг каждые ~5с). Только owner+manager.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role === "florist") {
    return json({ status: "error", message: "Недостаточно прав." }, 401)
  }

  const dealId = Number(request.nextUrl.searchParams.get("dealId"))
  if (!Number.isInteger(dealId) || dealId <= 0) {
    return json({ status: "error", message: "Сделка не найдена." }, 400)
  }

  const probe = request.nextUrl.searchParams.get("probe") === "1"
  try {
    return json(probe ? getWazzupChatProbeForDeal(dealId) : getWazzupChatForDeal(dealId))
  } catch {
    return json({ status: "error", message: "Не удалось загрузить чат." }, 500)
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders })
}
