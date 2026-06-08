import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getWazzupIframeUrlForDeal } from "@/lib/wazzup"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "no-store",
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role === "florist") {
    return json({ status: "error", message: "Недостаточно прав." }, 401)
  }

  const dealId = Number(request.nextUrl.searchParams.get("dealId"))
  if (!Number.isInteger(dealId) || dealId <= 0) {
    return json({ status: "error", message: "Сделка не найдена." }, 400)
  }

  try {
    const result = await getWazzupIframeUrlForDeal(dealId, user)
    return json(result)
  } catch {
    return json({ status: "error", message: "Не удалось открыть Wazzup чат" }, 500)
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: noStoreHeaders,
  })
}
