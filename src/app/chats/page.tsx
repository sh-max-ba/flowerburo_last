import { AccessDenied } from "@/components/access-denied"
import { ChatsScreen } from "@/components/chats/chats-screen"
import { CrmShell } from "@/components/crm-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { listCustomerOptions, listProducts } from "@/lib/crm"
import { getChatById, getChatCounts, getChatsRevision, listBouquetTemplates, listChats, listUsers } from "@/lib/db"

export const dynamic = "force-dynamic"

// Единое окно чатов (WhatsApp / Instagram через Wazzup). Только owner + manager.
// ?chat=<id> — открытый диалог, ?new=1 — сразу окно «Новый чат».
export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string; new?: string }>
}) {
  const user = await requireUser()
  if (user.role === "florist") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const params = await searchParams
  const chatId = Number(params.chat)
  const initialChat = Number.isInteger(chatId) && chatId > 0 ? getChatById(chatId) : null
  const users = listUsers()
    .filter((item) => item.isActive && item.role !== "florist")
    .map((item) => ({ id: item.id, name: item.name }))

  return (
    <CrmShell
      user={user}
      active="chats"
      title="Чаты"
      shiftContext={getShiftShellContext(user)}
      defaultSidebarOpen={await getSidebarDefaultOpen()}
      header="page"
      layout="fill"
    >
      <ChatsScreen
        currentUser={{ id: user.id, name: user.name }}
        users={users}
        bouquets={listBouquetTemplates({ activeOnly: true })}
        products={listProducts()}
        customers={listCustomerOptions()}
        initialChats={listChats({ tab: "all", userId: user.id })}
        initialCounts={getChatCounts(user.id)}
        initialRevision={getChatsRevision()}
        initialChat={initialChat}
        openNew={params.new === "1"}
      />
    </CrmShell>
  )
}
