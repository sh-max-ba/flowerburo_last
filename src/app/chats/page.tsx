import { AccessDenied } from "@/components/access-denied"
import { ChatsScreen } from "@/components/chats/chats-screen"
import { CrmShell } from "@/components/crm-shell"
import { getDefaultPathForRole, requireUser } from "@/lib/auth"
import { getShiftShellContext, getSidebarDefaultOpen } from "@/lib/app-shell"
import { getCustomer, listCustomerOptions, listProducts } from "@/lib/crm"
import { findOrCreateWhatsappChat, getChatByCustomerId, getChatById, getChatCounts, getChatsRevision, listBouquetTemplates, listChats, listUsers } from "@/lib/db"

export const dynamic = "force-dynamic"

// Единое окно чатов (WhatsApp / Instagram через Wazzup). Только owner + manager.
// ?chat=<id> — открытый диалог, ?customer=<id> — диалог клиента (ссылка из заказа/карточки;
// если переписки ещё нет, а телефон есть — создаём пустой WhatsApp-диалог), ?new=1 — окно «Новый чат».
export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string; customer?: string; new?: string }>
}) {
  const user = await requireUser()
  if (user.role === "florist") {
    return <AccessDenied homeHref={getDefaultPathForRole(user.role)} />
  }

  const params = await searchParams
  const chatId = Number(params.chat)
  const customerId = Number(params.customer)
  let initialChat = Number.isInteger(chatId) && chatId > 0 ? getChatById(chatId) : null
  if (!initialChat && Number.isInteger(customerId) && customerId > 0) {
    initialChat = getChatByCustomerId(customerId) ?? openChatForCustomer(customerId)
  }
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

function openChatForCustomer(customerId: number) {
  const customer = getCustomer(customerId)
  if (!customer?.phone) {
    return null
  }
  try {
    const { id } = findOrCreateWhatsappChat({ phone: customer.phone, name: customer.name, customerId })
    return getChatById(id)
  } catch {
    return null
  }
}
