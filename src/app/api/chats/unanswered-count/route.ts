import { getCurrentUser } from "@/lib/auth"
import { countUnansweredChats, getChatsRevision } from "@/lib/db"
import { canAccessSection } from "@/lib/nav"

export const dynamic = "force-dynamic"

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" }

// Бейдж «Чаты» в сайдбаре: сколько диалогов ждут ответа — count (не отвечали, яркий) и repliedCount
// (уже отвечали, бледный). Тем, кому раздел недоступен, — 0.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ count: 0 }, { status: 401, headers: noStoreHeaders })
  }
  if (!canAccessSection("chats", user.role, false)) {
    return Response.json({ count: 0 }, { headers: noStoreHeaders })
  }
  return Response.json({ ...countUnansweredChats(), revision: getChatsRevision() }, { headers: noStoreHeaders })
}
