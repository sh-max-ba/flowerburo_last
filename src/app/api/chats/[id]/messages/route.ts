import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getChatFeed, getChatFeedProbe } from "@/lib/chats"

export const dynamic = "force-dynamic"

const noStoreHeaders = { "Cache-Control": "no-store" }

// Лента диалога. Без probe — сообщения + карточка диалога + revision; с ?probe=1 — только revision
// (поллинг каждые ~3с, полную ленту тянем при смене). Только owner+manager.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.role === "florist") {
    return NextResponse.json({ status: "error", message: "Недостаточно прав." }, { status: 401, headers: noStoreHeaders })
  }

  const { id: rawId } = await params
  const chatId = Number(rawId)
  if (!Number.isInteger(chatId) || chatId <= 0) {
    return NextResponse.json({ status: "not_found", message: "Диалог не найден." }, { status: 404, headers: noStoreHeaders })
  }

  const probe = request.nextUrl.searchParams.get("probe") === "1"
  try {
    const result = probe ? getChatFeedProbe(chatId) : getChatFeed(chatId)
    return NextResponse.json(result, { status: result.status === "not_found" ? 404 : 200, headers: noStoreHeaders })
  } catch {
    return NextResponse.json({ status: "error", message: "Не удалось загрузить чат." }, { status: 500, headers: noStoreHeaders })
  }
}
