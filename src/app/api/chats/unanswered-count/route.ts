import { getCurrentUser } from "@/lib/auth"
import { countUnansweredChats, getChatsRevision } from "@/lib/db"

export const dynamic = "force-dynamic"

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" }

// Бейдж «Чаты» в сайдбаре: сколько диалогов ждут ответа — count (не отвечали, яркий) и repliedCount
// (уже отвечали, бледный). Флористу — 0 (раздел ему недоступен).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ count: 0 }, { status: 401, headers: noStoreHeaders })
  }
  if (user.role === "florist") {
    return Response.json({ count: 0 }, { headers: noStoreHeaders })
  }
  return Response.json({ ...countUnansweredChats(), revision: getChatsRevision() }, { headers: noStoreHeaders })
}
