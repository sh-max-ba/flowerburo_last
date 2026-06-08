import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type Row = Record<string, unknown>

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const originalCwd = process.cwd()
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowerburo-wazzup-smoke-"))

  try {
    process.chdir(tempDir)

    const [
      { initDb, listUsers, listWazzupChatMessages },
      { isWazzupWebhookAuthorized, processWazzupWebhook },
      { getDeal, listDeals, updateCustomer },
      {
        buildWazzupContactEntity,
        buildWazzupDealEntity,
        buildWazzupIframeRequestBodyForDeal,
        buildWazzupUserSyncBody,
        getWazzupChatForDeal,
        getWazzupIframeUrlForDeal,
        resolveWazzupChatTargetForDeal,
        sendTextToDealChat,
        syncWazzupAll,
        syncWazzupContacts,
        syncWazzupDeals,
        syncWazzupPipelines,
        syncWazzupUsers,
        syncWazzupWebhookEntities,
      },
    ] =
      await Promise.all([
        import("../src/lib/db"),
        import("../src/lib/wazzup-webhook"),
        import("../src/lib/crm"),
        import("../src/lib/wazzup"),
      ])

    const db = initDb()
    const user = listUsers(db).find((item) => item.role === "owner")
    assert(user, "Default owner user was not seeded")

    const pipeline = db.prepare("SELECT id FROM deal_pipelines ORDER BY id ASC LIMIT 1").get() as { id: number }
    const stage = db.prepare("SELECT id FROM deal_stages ORDER BY id ASC LIMIT 1").get() as { id: number }
    const customerResult = db
      .prepare(
        `INSERT INTO customers (name, phone, normalized_phone, source, updated_at)
         VALUES ('Шабдан', '+996 995 606 909', '996995606909', 'manual', CURRENT_TIMESTAMP)`
      )
      .run()
    const customerId = Number(customerResult.lastInsertRowid)
    const dealResult = db
      .prepare(
        `INSERT INTO deals (
          customer_id, customer_name, customer_phone, responsible_user_id, responsible_user_name,
          pipeline_id, stage_id, status, source, title, updated_at
        ) VALUES (
          @customerId, 'Шабдан', '+996 995 606 909', @userId, @userName,
          @pipelineId, @stageId, 'open', 'manual', 'Ручная сделка', CURRENT_TIMESTAMP
        )`
      )
      .run({
        customerId,
        userId: user.id,
        userName: user.name,
        pipelineId: pipeline.id,
        stageId: stage.id,
      })
    const dealId = Number(dealResult.lastInsertRowid)

    const manualDeal = getDeal(dealId)
    assert(manualDeal, "Manual deal was not readable through CRM helper")
    const phoneFallbackTarget = resolveWazzupChatTargetForDeal(manualDeal)
    assert(phoneFallbackTarget.status === "ok", "Manual deal with phone did not resolve to a Wazzup target")
    assert(phoneFallbackTarget.chatType === "whatsapp", "Phone fallback chat type is invalid")
    assert(phoneFallbackTarget.chatId === "996995606909", "Phone fallback chat id is invalid")
    assert(phoneFallbackTarget.source === "phone_fallback", "Manual deal did not use phone fallback source")

    const noPhoneDealResult = db
      .prepare(
        `INSERT INTO deals (
          customer_name, responsible_user_id, responsible_user_name, pipeline_id, stage_id,
          status, source, title, updated_at
        ) VALUES ('Без телефона', @userId, @userName, @pipelineId, @stageId, 'open', 'manual', 'Нет телефона', CURRENT_TIMESTAMP)`
      )
      .run({
        userId: user.id,
        userName: user.name,
        pipelineId: pipeline.id,
        stageId: stage.id,
      })
    const noPhoneDeal = getDeal(Number(noPhoneDealResult.lastInsertRowid))
    assert(noPhoneDeal, "No-phone deal was not readable")
    const noPhoneTarget = resolveWazzupChatTargetForDeal(noPhoneDeal)
    assert(noPhoneTarget.status === "no_chat", "Deal without phone and Wazzup fields must resolve to no_chat")

    const explicitDealResult = db
      .prepare(
        `INSERT INTO deals (
          customer_name, customer_phone, responsible_user_id, responsible_user_name, pipeline_id, stage_id,
          status, source, title, wazzup_chat_type, wazzup_chat_id, wazzup_channel_id, updated_at
        ) VALUES (
          'Explicit', '+996 000 000 000', @userId, @userName, @pipelineId, @stageId,
          'open', 'manual', 'Explicit', 'whatsapp', '996111111111', 'explicit-channel', CURRENT_TIMESTAMP
        )`
      )
      .run({
        userId: user.id,
        userName: user.name,
        pipelineId: pipeline.id,
        stageId: stage.id,
      })
    const explicitDeal = getDeal(Number(explicitDealResult.lastInsertRowid))
    assert(explicitDeal, "Explicit Wazzup deal was not readable")
    const explicitTarget = resolveWazzupChatTargetForDeal(explicitDeal)
    assert(explicitTarget.status === "ok", "Explicit Wazzup deal did not resolve")
    assert(explicitTarget.chatId === "996111111111", "Explicit Wazzup fields must win over phone fallback")
    assert(explicitTarget.channelId === "explicit-channel", "Explicit channel id was not used")
    assert(explicitTarget.source === "deal", "Explicit Wazzup deal source is invalid")

    const wazzupCustomerResult = db
      .prepare(
        `INSERT INTO customers (
          name, phone, normalized_phone, source, wazzup_chat_type, wazzup_chat_id, wazzup_channel_id, updated_at
        ) VALUES (
          'Customer Wazzup', '+996 222 222 222', '996222222222', 'manual',
          'whatsapp', '996333333333', 'customer-channel', CURRENT_TIMESTAMP
        )`
      )
      .run()
    const wazzupCustomerDealResult = db
      .prepare(
        `INSERT INTO deals (
          customer_id, customer_name, customer_phone, responsible_user_id, responsible_user_name,
          pipeline_id, stage_id, status, source, title, updated_at
        ) VALUES (
          @customerId, 'Customer Wazzup', '+996 222 222 222', @userId, @userName,
          @pipelineId, @stageId, 'open', 'manual', 'Customer Wazzup', CURRENT_TIMESTAMP
        )`
      )
      .run({
        customerId: Number(wazzupCustomerResult.lastInsertRowid),
        userId: user.id,
        userName: user.name,
        pipelineId: pipeline.id,
        stageId: stage.id,
      })
    const wazzupCustomerDeal = getDeal(Number(wazzupCustomerDealResult.lastInsertRowid))
    assert(wazzupCustomerDeal, "Customer Wazzup deal was not readable")
    const customerTarget = resolveWazzupChatTargetForDeal(wazzupCustomerDeal)
    assert(customerTarget.status === "ok", "Customer Wazzup fields did not resolve")
    assert(customerTarget.chatId === "996333333333", "Customer Wazzup fields must win over phone fallback")
    assert(customerTarget.channelId === "customer-channel", "Customer channel id was not used")
    assert(customerTarget.source === "customer", "Customer Wazzup target source is invalid")

    const staleCustomerResult = db
      .prepare(
        `INSERT INTO customers (name, phone, normalized_phone, source, updated_at)
         VALUES ('Старый телефон', '+996 995 606 909', '996995606909', 'manual', CURRENT_TIMESTAMP)`
      )
      .run()
    const staleCustomerId = Number(staleCustomerResult.lastInsertRowid)
    const staleDealResult = db
      .prepare(
        `INSERT INTO deals (
          customer_id, customer_name, customer_phone, responsible_user_id, responsible_user_name,
          pipeline_id, stage_id, status, source, title, updated_at
        ) VALUES (
          @customerId, 'Старый телефон', '+996 995 606 909', @userId, @userName,
          @pipelineId, @stageId, 'open', 'manual', 'Смена телефона', CURRENT_TIMESTAMP
        )`
      )
      .run({
        customerId: staleCustomerId,
        userId: user.id,
        userName: user.name,
        pipelineId: pipeline.id,
        stageId: stage.id,
      })
    const staleDealId = Number(staleDealResult.lastInsertRowid)
    const customerForm = new FormData()
    customerForm.set("customerId", String(staleCustomerId))
    customerForm.set("name", "Новый телефон")
    customerForm.set("phone", "996706069090")
    customerForm.set("source", "manual")
    updateCustomer(customerForm)

    const updatedDealRow = db.prepare("SELECT customer_name, customer_phone FROM deals WHERE id = ?").get(staleDealId) as Row
    assert(updatedDealRow.customer_name === "Новый телефон", "Deal customer name snapshot was not updated")
    assert(updatedDealRow.customer_phone === "996706069090", "Deal customer phone snapshot was not updated")
    const updatedDeal = getDeal(staleDealId)
    assert(updatedDeal, "Updated-phone deal was not readable")
    assert(updatedDeal.customerName === "Новый телефон", "Deal detail must show current customer name")
    assert(updatedDeal.customerPhone === "996706069090", "Deal detail must show current customer phone")
    const boardDeal = listDeals().find((item) => item.id === staleDealId)
    assert(boardDeal, "Updated-phone deal was not present in Kanban list")
    assert(boardDeal.customerPhone === "996706069090", "Kanban list must show current customer phone")
    const updatedPhoneTarget = resolveWazzupChatTargetForDeal(updatedDeal)
    assert(updatedPhoneTarget.status === "ok", "Updated-phone deal did not resolve to a Wazzup target")
    assert(updatedPhoneTarget.chatId === "996706069090", "Phone fallback must use current customer phone")

    const payload = {
      messages: [
        {
          messageId: "test-message-unique",
          channelId: "test-channel",
          chatType: "whatsapp",
          chatId: "996995606909",
          dateTime: "2026-05-16T10:00:00.000Z",
          type: "text",
          isEcho: false,
          contact: {
            name: "Шабдан",
          },
          text: "Тестовое сообщение",
          status: "inbound",
        },
      ],
    }

    const result = processWazzupWebhook(payload)
    assert(result.messagesSaved === 1, "Inbound message was not saved")
    assert(result.contactId === customerId, "Existing customer was not matched by normalized phone")
    assert(result.dealId === dealId, "Existing manual deal was not linked")

    const message = db
      .prepare("SELECT * FROM wazzup_messages WHERE message_id = 'test-message-unique'")
      .get() as Row | undefined
    assert(message, "Saved Wazzup message was not found")
    assert(message.customer_id === customerId, "Message customer_id was not assigned")
    assert(message.deal_id === dealId, "Message deal_id was not assigned")

    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as Row
    assert(customer.wazzup_chat_type === "whatsapp", "Customer chat type was not updated")
    assert(customer.wazzup_chat_id === "996995606909", "Customer chat id was not updated")
    assert(customer.wazzup_channel_id === "test-channel", "Customer channel id was not updated")

    const linkedDealRow = db.prepare("SELECT * FROM deals WHERE id = ?").get(dealId) as Row
    assert(linkedDealRow.wazzup_chat_type === "whatsapp", "Deal chat type was not updated")
    assert(linkedDealRow.wazzup_chat_id === "996995606909", "Deal chat id was not updated")
    assert(linkedDealRow.wazzup_channel_id === "test-channel", "Deal channel id was not updated")

    const dealsCount = db
      .prepare("SELECT COUNT(*) as count FROM deals WHERE customer_id = ? AND status = 'open'")
      .get(customerId) as { count: number }
    assert(dealsCount.count === 1, "Duplicate open deal was created")

    const deal = getDeal(dealId)
    assert(deal, "Linked deal was not readable through CRM helper")
    const body = buildWazzupIframeRequestBodyForDeal(deal, user)
    assert(body.user.id === String(user.id), "Iframe user.id is not a stringified current user id")
    assert(body.scope === "card", "Iframe scope is not card")
    assert(body.filter.length === 1, "Iframe filter must contain exactly one chat")
    assert(body.filter[0].chatType === "whatsapp", "Iframe filter chatType is invalid")
    assert(body.filter[0].chatId === "996995606909", "Iframe filter chatId is invalid")
    assert(body.activeChat.chatType === "whatsapp", "Iframe activeChat chatType is invalid")
    assert(body.activeChat.chatId === "996995606909", "Iframe activeChat chatId is invalid")
    assert(body.activeChat.channelId === "test-channel", "Iframe activeChat channelId is invalid")

    const syncBody = buildWazzupUserSyncBody(user)
    assert(syncBody[0].id === String(user.id), "Wazzup user sync id must be a stringified current user id")
    assert(syncBody[0].name === user.name, "Wazzup user sync name must be current user name")

    // createContact/createDeal handshake: маршрут отвечает телом сущности в сигнатуре CRUD.
    const contactEntity = buildWazzupContactEntity(customerId)
    assert(
      contactEntity != null &&
        contactEntity.id === String(customerId) &&
        contactEntity.contactData[0]?.chatId === "996995606909",
      "buildWazzupContactEntity must return the CRUD contact entity (id + contactData.chatId)"
    )
    const dealEntity = buildWazzupDealEntity(dealId)
    assert(
      dealEntity != null && dealEntity.id === String(dealId) && dealEntity.contacts[0] === String(customerId),
      "buildWazzupDealEntity must return the CRUD deal entity (id + contacts)"
    )

    const closedStageResult = db
      .prepare(
        `INSERT INTO deal_stages (pipeline_id, name, position, color, is_closed, is_won)
         VALUES (@pipelineId, 'Закрыта', 999, '', 1, 0)`
      )
      .run({ pipelineId: pipeline.id })
    const closedStageId = Number(closedStageResult.lastInsertRowid)
    const closedDealResult = db
      .prepare(
        `INSERT INTO deals (
          customer_id, customer_name, customer_phone, responsible_user_id, responsible_user_name,
          pipeline_id, stage_id, status, source, title, updated_at
        ) VALUES (
          @customerId, 'Шабдан', '+996 995 606 909', @userId, @userName,
          @pipelineId, @stageId, 'cancelled', 'manual', 'Закрытая сделка', CURRENT_TIMESTAMP
        )`
      )
      .run({
        customerId,
        userId: user.id,
        userName: user.name,
        pipelineId: pipeline.id,
        stageId: closedStageId,
      })
    const closedDealId = Number(closedDealResult.lastInsertRowid)

    db
      .prepare(
        `INSERT INTO integration_settings (
          provider, api_key, crm_key, webhook_url, webhook_auth_required, is_enabled, updated_at
        ) VALUES ('wazzup', 'test-api-key', 'test-crm-key', '/api/wazzup/webhook', 0, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(provider) DO UPDATE SET
          api_key = excluded.api_key,
          crm_key = excluded.crm_key,
          webhook_url = excluded.webhook_url,
          webhook_auth_required = excluded.webhook_auth_required,
          is_enabled = excluded.is_enabled,
          updated_at = CURRENT_TIMESTAMP`
      )
      .run()

    // Webhook fail-closed: действительный CRM key обязателен ВСЕГДА (это требование безопасности —
    // неаутентифицированный webhook мог бы создавать сделки/контакты). Проверяем оба способа: Bearer и query.
    const noKeyAuth = isWazzupWebhookAuthorized({ authorization: null })
    assert(!noKeyAuth.authorized, "Webhook without a valid CRM key must be rejected")
    const wrongKeyAuth = isWazzupWebhookAuthorized({ authorization: "Bearer wrong-key" })
    assert(!wrongKeyAuth.authorized, "Webhook with an invalid CRM key must be rejected")
    const queryAuth = isWazzupWebhookAuthorized({ authorization: null, queryKey: "test-crm-key" })
    assert(queryAuth.authorized && queryAuth.method === "query", "Valid query CRM key must authorize the request")
    const bearerAuth = isWazzupWebhookAuthorized({ authorization: "Bearer test-crm-key" })
    assert(bearerAuth.authorized && bearerAuth.method === "bearer", "Valid Bearer CRM key must authorize the request")

    const fetchCalls: Array<{ url: string; init: RequestInit }> = []
    let outboundMessageSeq = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      fetchCalls.push({ url, init: init ?? {} })

      if (url.endsWith("/channels")) {
        return Response.json([
          {
            channelId: "active-channel",
            transport: "whatsapp",
            plainId: "996995606909",
            state: "active",
          },
        ])
      }
      if (url.endsWith("/users")) {
        return new Response("", { status: 200 })
      }
      if (url.endsWith("/pipelines")) {
        return new Response("", { status: 200 })
      }
      if (url.endsWith("/contacts")) {
        return new Response("", { status: 200 })
      }
      if (url.endsWith("/deals")) {
        return new Response("", { status: 200 })
      }
      if (url.endsWith("/iframe")) {
        return Response.json({ url: "https://frame.test/wazzup" })
      }
      if (url.endsWith("/message")) {
        // POST /v3/message → 201 { messageId, chatId } (см. references/messages.md). Уникальный id на вызов.
        outboundMessageSeq += 1
        return Response.json({ messageId: `wz-msg-${outboundMessageSeq}`, chatId: "996995606909" }, { status: 201 })
      }

      return Response.json({ error: "UNEXPECTED_URL" }, { status: 500 })
    }) as typeof fetch

    try {
      const syncResult = await syncWazzupUsers()
      assert(syncResult.ok, "Bulk Wazzup users sync did not return ok")
      assert(syncResult.totalSent === listUsers(db).filter((item) => item.isActive).length, "Bulk Wazzup users sync count is invalid")
      const syncedUser = db.prepare("SELECT * FROM wazzup_user_sync WHERE user_id = ?").get(user.id) as Row | undefined
      assert(syncedUser, "Synced Wazzup user status was not saved")
      assert(syncedUser.wazzup_user_id === String(user.id), "Synced Wazzup user id was not saved")
      assert(syncedUser.status === "synced", "Synced Wazzup user status is invalid")

      fetchCalls.length = 0
      const pipelineSyncResult = await syncWazzupPipelines()
      assert(pipelineSyncResult.ok, "Wazzup pipelines sync did not return ok")
      const pipelinesCall = fetchCalls.find((call) => call.url.endsWith("/pipelines"))
      assert(pipelinesCall, "Pipelines sync did not call POST /v3/pipelines")
      const pipelinesBody = JSON.parse(String(pipelinesCall.init.body)) as Array<{
        id: string
        name: string
        stages?: Array<{ id: string; name: string }>
      }>
      assert(pipelinesBody[0]?.id === String(pipeline.id), "Pipeline sync body id is invalid")
      assert(Boolean(pipelinesBody[0]?.name), "Pipeline sync body name is empty")
      assert(Boolean(pipelinesBody[0]?.stages?.some((item) => item.id === String(stage.id))), "Pipeline sync body stages are invalid")

      fetchCalls.length = 0
      const contactsSyncResult = await syncWazzupContacts({ customerIds: [customerId] })
      assert(contactsSyncResult.ok, "Wazzup contacts sync did not return ok")
      const contactsCall = fetchCalls.find((call) => call.url.endsWith("/contacts"))
      assert(contactsCall, "Contacts sync did not call POST /v3/contacts")
      const contactsBody = JSON.parse(String(contactsCall.init.body)) as Array<{
        id: string
        responsibleUserId: string
        name: string
        contactData: Array<{ chatType: string; chatId: string }>
        uri: string
      }>
      assert(contactsBody[0]?.id === String(customerId), "Contact sync body id is invalid")
      assert(contactsBody[0]?.responsibleUserId === String(user.id), "Contact sync body responsibleUserId is invalid")
      assert(contactsBody[0]?.name === "Шабдан", "Contact sync body name is invalid")
      assert(contactsBody[0]?.contactData[0]?.chatType === "whatsapp", "Contact sync body chatType is invalid")
      assert(contactsBody[0]?.contactData[0]?.chatId === "996995606909", "Contact sync body chatId is invalid")
      assert(contactsBody[0]?.uri.endsWith(`/clients/${customerId}`), "Contact sync body uri is invalid")

      fetchCalls.length = 0
      const dealsSyncResult = await syncWazzupDeals({ dealIds: [dealId, closedDealId] })
      assert(dealsSyncResult.ok, "Wazzup deals sync did not return ok")
      const dealsCall = fetchCalls.find((call) => call.url.endsWith("/deals"))
      assert(dealsCall, "Deals sync did not call POST /v3/deals")
      const dealsBody = JSON.parse(String(dealsCall.init.body)) as Array<{
        id: string
        responsibleUserId: string
        name: string
        uri: string
        contacts: string[]
        closed: boolean
      }>
      const openDealPayload = dealsBody.find((item) => item.id === String(dealId))
      const closedDealPayload = dealsBody.find((item) => item.id === String(closedDealId))
      assert(openDealPayload?.responsibleUserId === String(user.id), "Deal sync body responsibleUserId is invalid")
      assert(openDealPayload?.contacts[0] === String(customerId), "Deal sync body contacts are invalid")
      assert(openDealPayload?.uri.endsWith(`/deals/${dealId}`), "Deal sync body uri is invalid")
      assert(openDealPayload?.closed === false, "Open deal sync body closed flag is invalid")
      assert(closedDealPayload?.closed === true, "Closed deal sync body closed flag is invalid")

      fetchCalls.length = 0
      const fullSyncResult = await syncWazzupAll()
      assert(fullSyncResult.ok, "Full Wazzup sync did not return ok")
      assert(
        fetchCalls.findIndex((call) => call.url.endsWith("/users")) <
          fetchCalls.findIndex((call) => call.url.endsWith("/pipelines")),
        "Full sync must send users before pipelines"
      )
      assert(
        fetchCalls.findIndex((call) => call.url.endsWith("/pipelines")) <
          fetchCalls.findIndex((call) => call.url.endsWith("/contacts")),
        "Full sync must send pipelines before contacts"
      )
      assert(
        fetchCalls.findIndex((call) => call.url.endsWith("/contacts")) <
          fetchCalls.findIndex((call) => call.url.endsWith("/deals")),
        "Full sync must send contacts before deals"
      )

      fetchCalls.length = 0
      const iframeResult = await getWazzupIframeUrlForDeal(staleDealId, user)
      assert(iframeResult.status === "ok", "Iframe helper did not return ok with mocked Wazzup API")
      const usersCallIndex = fetchCalls.findIndex((call) => call.url.endsWith("/users"))
      const iframeCallIndex = fetchCalls.findIndex((call) => call.url.endsWith("/iframe"))
      assert(usersCallIndex !== -1, "Iframe helper did not sync current Wazzup user")
      assert(iframeCallIndex !== -1, "Iframe helper did not request iframe URL")
      assert(usersCallIndex < iframeCallIndex, "Iframe helper must sync current user before requesting iframe")

      const usersBody = JSON.parse(String(fetchCalls[usersCallIndex].init.body)) as Array<Record<string, unknown>>
      assert(usersBody[0]?.id === String(user.id), "POST /v3/users body id is invalid")
      assert(usersBody[0]?.name === user.name, "POST /v3/users body name is invalid")

      const iframeBody = JSON.parse(String(fetchCalls[iframeCallIndex].init.body)) as {
        filter: Array<{ chatId: string }>
        activeChat: { chatId: string; channelId?: string }
      }
      assert(iframeBody.filter[0]?.chatId === "996706069090", "Iframe filter chatId must use current customer phone")
      assert(iframeBody.activeChat.chatId === "996706069090", "Iframe activeChat chatId must use current customer phone")
      assert(iframeBody.activeChat.channelId === "active-channel", "Iframe activeChat channelId must use active channel id")

      const repeatedResult = processWazzupWebhook(payload)
      assert(repeatedResult.messagesSaved === 0, "Repeated Wazzup messageId must not be saved twice")
      const repeatedDealsCount = db
        .prepare("SELECT COUNT(*) as count FROM deals WHERE customer_id = ?")
        .get(customerId) as { count: number }
      assert(repeatedDealsCount.count === 2, "Repeated Wazzup message must not create another deal")

      const closedOnlyCustomerResult = db
        .prepare(
          `INSERT INTO customers (name, phone, normalized_phone, source, wazzup_chat_type, wazzup_chat_id, updated_at)
           VALUES ('Closed Only', '996444444444', '996444444444', 'manual', 'whatsapp', '996444444444', CURRENT_TIMESTAMP)`
        )
        .run()
      const closedOnlyCustomerId = Number(closedOnlyCustomerResult.lastInsertRowid)
      db
        .prepare(
          `INSERT INTO deals (
            customer_id, customer_name, customer_phone, responsible_user_id, responsible_user_name,
            pipeline_id, stage_id, status, source, title, wazzup_chat_type, wazzup_chat_id, updated_at
          ) VALUES (
            @customerId, 'Closed Only', '996444444444', @userId, @userName,
            @pipelineId, @stageId, 'cancelled', 'whatsapp', 'Closed old', 'whatsapp', '996444444444', CURRENT_TIMESTAMP
          )`
        )
        .run({
          customerId: closedOnlyCustomerId,
          userId: user.id,
          userName: user.name,
          pipelineId: pipeline.id,
          stageId: closedStageId,
        })
      const closedOnlyResult = processWazzupWebhook({
        messages: [
          {
            messageId: "closed-only-new-message",
            channelId: "test-channel",
            chatType: "whatsapp",
            chatId: "996444444444",
            dateTime: "2026-05-16T11:00:00.000Z",
            type: "text",
            isEcho: false,
            contact: { name: "Closed Only" },
            text: "Новая заявка после закрытия",
            status: "inbound",
          },
        ],
      })
      assert(closedOnlyResult.contactId === closedOnlyCustomerId, "Closed-only customer was not reused")
      assert(closedOnlyResult.dealId, "Closed-only incoming message did not create a new deal")
      const closedOnlyOpenDeals = db
        .prepare("SELECT COUNT(*) as count FROM deals WHERE customer_id = ? AND status = 'open'")
        .get(closedOnlyCustomerId) as { count: number }
      assert(closedOnlyOpenDeals.count === 1, "Closed-only incoming message must create exactly one open deal")

      // --- Собственный чат: исходящий текст пишется в wazzup_messages, эхо дедупится, статусы, лента ---
      fetchCalls.length = 0
      await sendTextToDealChat(dealId, "Привет из CRM", user)
      const messageCall = fetchCalls.find((call) => call.url.endsWith("/message"))
      assert(messageCall, "sendTextToDealChat must POST /v3/message")
      const messageBody = JSON.parse(String(messageCall.init.body)) as {
        channelId: string
        chatType: string
        chatId: string
        crmMessageId: string
        text: string
      }
      assert(messageBody.text === "Привет из CRM", "Send body must carry the text")
      assert(messageBody.chatType === "whatsapp", "Send body chatType must match the channel transport")
      assert(messageBody.chatId === "996995606909", "Send body chatId must be the resolved chat identity")
      // Сделка уже привязана к каналу 'test-channel' предыдущим входящим вебхуком, поэтому отправка
      // идёт с её сохранённым channelId (source 'deal'), а не с подобранным активным каналом.
      assert(messageBody.channelId === "test-channel", "Send body must use the deal's resolved channel id")
      assert(
        messageBody.crmMessageId.startsWith(`deal-${dealId}-text-`),
        "Free-form send must use a unique deal-scoped crmMessageId"
      )

      const sentRow = db.prepare("SELECT * FROM wazzup_messages WHERE message_id = 'wz-msg-1'").get() as
        | Row
        | undefined
      assert(sentRow, "sendTextToDealChat must persist an outbound row in wazzup_messages")
      assert(sentRow.direction === "outbound", "Outbound text row direction must be 'outbound'")
      assert(sentRow.status === "sent", "Outbound text row status must be 'sent'")
      assert(sentRow.text === "Привет из CRM", "Outbound text row must store the text")
      assert(
        String(sentRow.crm_message_id ?? "").startsWith(`deal-${dealId}-text-`),
        "Outbound row must persist the free-form crm_message_id"
      )
      assert(
        sentRow.chat_type === "whatsapp" && sentRow.chat_id === "996995606909",
        "Outbound row must carry the chat identity"
      )
      assert(Number(sentRow.deal_id) === dealId, "Outbound row must link to the deal")

      // Эхо того же сообщения (Wazzup присылает наш messageId с isEcho=true) НЕ должно дублироваться.
      const echoResult = processWazzupWebhook({
        messages: [
          {
            messageId: "wz-msg-1",
            channelId: "active-channel",
            chatType: "whatsapp",
            chatId: "996995606909",
            dateTime: "2026-05-16T10:05:00.000Z",
            type: "text",
            isEcho: true,
            text: "Привет из CRM",
            status: "sent",
          },
        ],
      })
      assert(echoResult.messagesSaved === 0, "Echo of our own send must be deduped by messageId")
      const sentRowCount = db
        .prepare("SELECT COUNT(*) as count FROM wazzup_messages WHERE message_id = 'wz-msg-1'")
        .get() as { count: number }
      assert(sentRowCount.count === 1, "There must be exactly one row for our outbound message after the echo")

      // Статус-вебхук обновляет нашу исходящую строку по message_id.
      const statusResult = processWazzupWebhook({
        statuses: [{ messageId: "wz-msg-1", status: "delivered" }],
      })
      assert(statusResult.statusesUpdated === 1, "Status webhook must update our outbound row")
      const deliveredRow = db
        .prepare("SELECT status FROM wazzup_messages WHERE message_id = 'wz-msg-1'")
        .get() as Row
      assert(deliveredRow.status === "delivered", "Outbound row status must become 'delivered'")

      // Лента по идентичности чата: входящее (до отправки) + наше исходящее, по возрастанию времени.
      const feed = listWazzupChatMessages({ dealId, chatType: "whatsapp", chatId: "996995606909" })
      const feedIds = feed.map((message) => message.messageId)
      assert(feedIds.includes("test-message-unique"), "Feed must include the earlier inbound message by chat identity")
      assert(feedIds.includes("wz-msg-1"), "Feed must include our outbound message")
      const feedTimes = feed.map((message) => message.dateTime)
      assert(
        JSON.stringify(feedTimes) === JSON.stringify([...feedTimes].sort()),
        "Chat feed must be ordered ascending by time"
      )

      const chat = getWazzupChatForDeal(dealId)
      assert(chat.status === "ok", "getWazzupChatForDeal must return ok for an enabled, resolvable deal")
      assert(
        chat.status === "ok" && chat.messages.some((message) => message.messageId === "wz-msg-1"),
        "getWazzupChatForDeal must include the outbound message"
      )
      assert(chat.status === "ok" && Boolean(chat.revision), "getWazzupChatForDeal must return a revision string")

      // --- Ответ (цитирование): refMessageId + quoted_text сохраняются на исходящей строке ---
      await sendTextToDealChat(dealId, "Это ответ", user, {
        refMessageId: "wz-msg-1",
        quotedText: "Привет из CRM",
      })
      const replyRow = db.prepare("SELECT * FROM wazzup_messages WHERE message_id = 'wz-msg-2'").get() as
        | Row
        | undefined
      assert(replyRow, "Reply must persist an outbound row")
      assert(replyRow.quoted_message_id === "wz-msg-1", "Reply row must store quoted_message_id (refMessageId)")
      assert(replyRow.quoted_text === "Привет из CRM", "Reply row must store the quoted text snapshot")

      // --- Голосовое/медиа: абсолютный contentUri уходит как audio, текст не пишется ---
      await sendTextToDealChat(dealId, "", user, {
        contentUri: "https://example.test/voice.ogg",
        messageType: "audio",
      })
      const voiceRow = db.prepare("SELECT * FROM wazzup_messages WHERE message_id = 'wz-msg-3'").get() as
        | Row
        | undefined
      assert(voiceRow, "Voice/media send must persist an outbound row")
      assert(voiceRow.message_type === "audio", "Voice row message_type must be 'audio'")
      assert(
        voiceRow.content_uri === "https://example.test/voice.ogg",
        "Voice row must store the content_uri"
      )
      assert(!voiceRow.text, "Voice row must not carry text")

      // --- Вебхук с quotedMessage: входящая цитата парсится в quoted_* ---
      const quoteWebhook = processWazzupWebhook({
        messages: [
          {
            messageId: "in-quote-1",
            channelId: "active-channel",
            chatType: "whatsapp",
            chatId: "996995606909",
            dateTime: "2026-05-16T12:00:00.000Z",
            type: "text",
            isEcho: false,
            text: "Да, как договаривались",
            quotedMessage: { messageId: "wz-msg-1", text: "Привет из CRM", type: "text" },
            status: "inbound",
          },
        ],
      })
      assert(quoteWebhook.messagesSaved === 1, "Inbound quoted message must be saved")
      const inQuoteRow = db.prepare("SELECT * FROM wazzup_messages WHERE message_id = 'in-quote-1'").get() as Row
      assert(inQuoteRow.quoted_message_id === "wz-msg-1", "Inbound quote must store quoted_message_id")
      assert(inQuoteRow.quoted_text === "Привет из CRM", "Inbound quote must store quoted text")

      fetchCalls.length = 0
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init: init ?? {} })
        return Response.json({ error: "INVALID_CONTACTS_DATA" }, { status: 400 })
      }) as typeof fetch
      await syncWazzupWebhookEntities({ contactId: closedOnlyCustomerId, dealId: closedOnlyResult.dealId })
    } finally {
      globalThis.fetch = originalFetch
    }

    db.close()
    console.log("Wazzup smoke passed")
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

void main()
