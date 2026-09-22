import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { listChatsForPicker } from "@/lib/db"

export const dynamic = "force-dynamic"

// Короткий список диалогов для выбора цели пересылки (поиск по имени/телефону).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role === "florist") {
    return NextResponse.json({ status: "error", message: "Недостаточно прав." }, { status: 401 })
  }
  const chats = listChatsForPicker(request.nextUrl.searchParams.get("q") ?? "")
  return NextResponse.json({ status: "ok", chats }, { headers: { "Cache-Control": "no-store" } })
}
