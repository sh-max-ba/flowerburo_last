import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getChatCounts, getChatsRevision, listChats, type ChatTab } from "@/lib/db"

export const dynamic = "force-dynamic"

const noStoreHeaders = { "Cache-Control": "no-store" }
const tabs = new Set<ChatTab>(["all", "waiting", "mine", "new"])

// Список диалогов единого окна чатов. С ?probe=1 — только ревизия и счётчики вкладок (дешёвый
// поллинг), без probe — полный список по вкладке/поиску. Только owner+manager.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role === "florist") {
    return NextResponse.json({ status: "error", message: "Недостаточно прав." }, { status: 401, headers: noStoreHeaders })
  }

  const params = request.nextUrl.searchParams
  const includeGroups = params.get("groups") === "1"
  const archived = params.get("archived") === "1"
  const revision = getChatsRevision()
  const counts = getChatCounts(user.id, includeGroups, archived)
  if (params.get("probe") === "1") {
    return NextResponse.json({ status: "ok", revision, counts }, { headers: noStoreHeaders })
  }

  const rawTab = params.get("tab") ?? "all"
  const tab = tabs.has(rawTab as ChatTab) ? (rawTab as ChatTab) : "all"
  const chats = listChats({ tab, search: params.get("q") ?? "", userId: user.id, includeGroups, archived })
  return NextResponse.json({ status: "ok", revision, counts, chats }, { headers: noStoreHeaders })
}
