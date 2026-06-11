"use server"

import { revalidatePath } from "next/cache"
import { canCloseShift, canUseCash, getCurrentUser } from "@/lib/auth"
import {
  addDealItem,
  addDealBouquet,
  createCustomer,
  createDeal,
  getCustomer,
  removeDealItem,
  removeDealItemGroup,
  updateCustomer,
  updateDealFields,
  updateDealItem,
  updateDealStage,
} from "@/lib/crm"
import {
  connectWazzupWebhookSubscriptions,
  clearWazzupApiKey,
  generateAndSaveWazzupCrmKey,
  getWazzupWebhookSubscriptions,
  getSecureWazzupWebhookUrlForOwner,
  linkDealToWazzupByCustomer,
  listWazzupChannels,
  maskWazzupWebhookUrl,
  saveWazzupSettings,
  sendBouquetToDealChat,
  sendTextToDealChat,
  syncWazzupAll,
  syncWazzupContacts,
  syncWazzupDeals,
  syncWazzupPipelines,
  syncWazzupUsers,
  testLocalWazzupWebhook,
  testWazzupApiKey,
  type WazzupWebhookConfig,
} from "@/lib/wazzup"
import {
  cancelOrder,
  cancelStockDocument,
  acceptDealPayment,
  cashIn,
  cashOut,
  updatePaymentMethod,
  reverseCashTransaction,
  changeUserPassword,
  closeShift,
  completePickupOrder,
  createOrder,
  createOrderDraft,
  updateOrderDraft,
  finalizeOrderDraft,
  deleteDraftOrder,
  createOrderFromDeal,
  updateOrderFromDeal,
  updateOrder,
  createSale,
  createBouquetTemplate,
  createAndPostStockDocument,
  createStockCorrectionDraft,
  createInventoryDraftWithSnapshot,
  saveInventoryDraft,
  recalcInventoryExpected,
  postInventory,
  cancelInventory,
  getInventoryEnabled,
  setInventoryEnabled,
  createUser,
  deleteBouquetTemplate,
  deleteProduct,
  setProductArchived,
  handOrderToCourier,
  markOrderReady,
  openShift,
  applyWarehouseImport,
  previewWarehouseImport,
  postStockDocument,
  saveStockDocumentDraft,
  clearProductCategory,
  renameProductCategory,
  setSupplierActive,
  setUserActive,
  setAllowOversellOrders,
  setRecomputeCostOnReceipt,
  setTrackLotsEnabled,
  writeOffLot,
  startOrderWork,
  toggleBouquetTemplateActive,
  updateUser,
  updateBouquetTemplate,
  upsertSupplier,
  upsertProduct,
  type StockDocumentType,
  type UserRole,
  type CurrentUser,
  type CustomerOption,
  type BouquetTemplateInput,
} from "@/lib/db"

type ActionResult = {
  ok: boolean
  message: string
  messages?: string[]
}

type DataActionResult<T> =
  | {
      ok: true
      message: string
      data: T
    }
  | {
      ok: false
      message: string
    }

type ActionPayload = void | string[] | boolean | { acceptedPayment: boolean; paidCourier: boolean }
type UserAction = (user: CurrentUser) => ActionPayload | Promise<ActionPayload>

function getShiftId(formData: FormData) {
  return Number(String(formData.get("shiftId") ?? "").trim())
}

function parseBouquetTemplateFormData(formData: FormData): BouquetTemplateInput {
  const productCodes = formData.getAll("itemProductCode").map((value) => String(value ?? "").trim())
  const qtyValues = formData.getAll("itemQty")

  return {
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    price: Number(String(formData.get("price") ?? "0").replace(",", ".")),
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "1",
    items: productCodes.map((productCode, index) => ({
      productCode,
      qty: Number(String(qtyValues[index] ?? "0").replace(",", ".")),
    })),
  }
}

async function requireCashAccess() {
  const user = await requireActionUser()
  if (!(await canUseCash(user))) {
    throw new Error("Недостаточно прав для кассы.")
  }

  return user
}

async function requireActionUser() {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Сессия истекла. Войдите снова.")
  }

  return user
}

async function requireActionRole(roles: UserRole[]) {
  const user = await requireActionUser()
  if (!roles.includes(user.role)) {
    throw new Error("Недостаточно прав.")
  }

  return user
}

async function runAction(
  action: () => ActionPayload | Promise<ActionPayload>,
  message: string
): Promise<ActionResult> {
  try {
    const result = await action()
    revalidatePath("/")
    revalidatePath("/stock")
    revalidatePath("/cash")
    revalidatePath("/ready-orders")
    revalidatePath("/orders")
    revalidatePath("/orders/drafts")
    revalidatePath("/bouquets")
    revalidatePath("/shifts")
    revalidatePath("/users")
    revalidatePath("/settings")
    if (Array.isArray(result)) {
      return { ok: true, message: result[0] ?? message, messages: result }
    }
    if (typeof result === "boolean") {
      return {
        ok: true,
        message: result ? "Доплата принята" : message,
        messages: result ? ["Доплата принята", message] : [message],
      }
    }
    if (result && typeof result === "object") {
      const messages = [
        ...(result.acceptedPayment ? ["Доплата принята"] : []),
        ...(result.paidCourier ? ["Курьеру выдано из кассы"] : []),
        message,
      ]
      return { ok: true, message: messages[0] ?? message, messages }
    }
    return { ok: true, message, messages: [message] }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Операция не выполнена.",
    }
  }
}

async function runRoleAction(
  roles: UserRole[],
  action: UserAction,
  message: string
) {
  return runAction(async () => {
    const user = await requireActionRole(roles)
    return action(user)
  }, message)
}

async function runCashAction(
  action: UserAction,
  message: string
) {
  return runAction(async () => {
    const user = await requireCashAccess()
    return action(user)
  }, message)
}

async function runDataAction<T>(
  roles: UserRole[],
  fn: (user: CurrentUser) => T | Promise<T>,
  message: string,
  errorMessage?: string
): Promise<DataActionResult<T>> {
  try {
    const user = await requireActionRole(roles)
    const data = await fn(user)
    return { ok: true, message, data }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : errorMessage ?? "Операция не выполнена.",
    }
  }
}

async function runMessageAction(
  roles: UserRole[],
  fn: () => ActionResult | Promise<ActionResult>,
  errorMessage: string,
  { revalidate = true }: { revalidate?: boolean } = {}
): Promise<ActionResult> {
  try {
    await requireActionRole(roles)
    const result = await fn()
    if (revalidate) {
      revalidatePath("/settings")
    }
    return result
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : errorMessage,
    }
  }
}

export async function saveProductAction(formData: FormData) {
  return runRoleAction(["owner"], (user) => upsertProduct(formData, user), "Товар сохранен.")
}

export async function createBouquetTemplateAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], (user) => {
    createBouquetTemplate(parseBouquetTemplateFormData(formData), user)
    revalidatePath("/bouquets")
  }, "Букет сохранен.")
}

export async function updateBouquetTemplateAction(id: number, formData: FormData) {
  return runRoleAction(["owner", "manager"], () => {
    updateBouquetTemplate(id, parseBouquetTemplateFormData(formData))
    revalidatePath("/bouquets")
  }, "Букет сохранен.")
}

export async function toggleBouquetTemplateActiveAction(id: number) {
  return runRoleAction(["owner", "manager"], () => {
    const isActive = toggleBouquetTemplateActive(id)
    revalidatePath("/bouquets")
    return [isActive ? "Букет включен" : "Букет выключен"]
  }, "Статус букета изменен.")
}

export async function deleteBouquetTemplateAction(id: number) {
  return runRoleAction(["owner", "manager"], () => {
    deleteBouquetTemplate(id)
    revalidatePath("/bouquets")
  }, "Букет выключен.")
}

export async function saveWazzupSettingsAction(formData: FormData) {
  return runRoleAction(["owner"], () => {
    saveWazzupSettings({
      apiKey: String(formData.get("apiKey") ?? ""),
      crmKey: String(formData.get("crmKey") ?? ""),
      isEnabled: formData.get("isEnabled") === "on",
      webhookAuthRequired: formData.get("webhookAuthRequired") === "on",
      chatMode: formData.get("chatMode") === "custom" ? "custom" : "iframe",
    })
  }, "Настройки Wazzup сохранены.")
}

// Флаги настроек меняем только при маркере присутствия `<имя>Present`: вкладка устаревшей
// сборки (без нового чекбокса и его маркера) иначе молча ВЫКЛЮЧАЛА бы флаг, которого не знала —
// тот же класс stale-форм, что инциденты с товарами 09.06/11.06. Снятый чекбокс новой сборки
// отличим от отсутствующего: маркер шлётся всегда, ключ "on" — только при включении.
export async function saveOrderSettingsAction(formData: FormData) {
  return runRoleAction(["owner"], () => {
    if (formData.has("allowOversellOrdersPresent")) {
      setAllowOversellOrders(formData.get("allowOversellOrders") === "on")
    }
  }, "Настройки заказов сохранены.")
}

export async function saveStockCostSettingsAction(formData: FormData) {
  return runRoleAction(["owner"], () => {
    if (formData.has("recomputeCostOnReceiptPresent")) {
      setRecomputeCostOnReceipt(formData.get("recomputeCostOnReceipt") === "on")
    }
    if (formData.has("trackLotsEnabledPresent")) {
      setTrackLotsEnabled(formData.get("trackLotsEnabled") === "on")
    }
    if (formData.has("enableInventoryPresent")) {
      setInventoryEnabled(formData.get("enableInventory") === "on")
    }
  }, "Настройки склада сохранены.")
}

function revalidateInventory(documentId?: number) {
  revalidatePath("/stock/inventory")
  if (documentId) {
    revalidatePath(`/stock/inventory/${documentId}`)
  }
  revalidatePath("/stock/acts")
  revalidatePath("/history/stock")
  revalidatePath("/stock")
}

export async function createInventoryAction(
  formData: FormData
): Promise<DataActionResult<{ documentId: number }>> {
  return runDataAction(
    ["owner"],
    (user) => {
      if (!getInventoryEnabled()) {
        throw new Error("Инвентаризация выключена. Включите её в настройках.")
      }
      const documentId = createInventoryDraftWithSnapshot(formData, user)
      revalidateInventory(documentId)
      return { documentId }
    },
    "Инвентаризация создана.",
    "Инвентаризация не создана."
  )
}

export async function saveInventoryDraftAction(formData: FormData) {
  return runRoleAction(
    ["owner"],
    () => {
      saveInventoryDraft(formData)
      revalidateInventory(Number(formData.get("documentId")) || undefined)
    },
    "Черновик инвентаризации сохранён."
  )
}

export async function recalcInventoryExpectedAction(documentId: number) {
  return runRoleAction(
    ["owner"],
    () => {
      recalcInventoryExpected(documentId)
      revalidateInventory(documentId)
    },
    "Учётные остатки обновлены."
  )
}

export async function postInventoryAction(documentId: number) {
  return runRoleAction(
    ["owner"],
    (user) => {
      postInventory(documentId, user)
      revalidateInventory(documentId)
    },
    "Инвентаризация проведена."
  )
}

export async function cancelInventoryAction(documentId: number) {
  return runRoleAction(
    ["owner"],
    () => {
      cancelInventory(documentId)
      revalidateInventory(documentId)
    },
    "Инвентаризация отменена."
  )
}

export async function writeOffLotAction(formData: FormData) {
  const lotId = Number(formData.get("lotId"))
  const qty = Number(formData.get("qty"))
  const reason = String(formData.get("reason") ?? "spoilage")
  const comment = String(formData.get("comment") ?? "")
  return runRoleAction(
    ["owner"],
    (user) => {
      writeOffLot({ lotId, qty, reason, comment }, user)
      revalidatePath("/stock/lots")
      revalidatePath("/stock")
    },
    "Партия списана."
  )
}

export async function getSecureWazzupWebhookUrlAction(): Promise<DataActionResult<{ url: string }>> {
  return runDataAction(
    ["owner"],
    () => {
      const url = getSecureWazzupWebhookUrlForOwner()
      if (!url.includes("?key=")) {
        throw new Error("CRM key не настроен.")
      }

      return { url }
    },
    "Защищенный webhook URL скопирован.",
    "Защищенный webhook URL не получен."
  )
}

export async function generateWazzupCrmKeyAction() {
  return runRoleAction(["owner"], () => {
    generateAndSaveWazzupCrmKey()
  }, "CRM key обновлен.")
}

export async function clearWazzupApiKeyAction() {
  return runRoleAction(["owner"], () => {
    clearWazzupApiKey()
  }, "API key очищен.")
}

export async function testWazzupApiKeyAction(): Promise<ActionResult> {
  return runMessageAction(["owner"], () => testWazzupApiKey(), "API key не проверен.")
}

export async function testLocalWazzupWebhookAction(): Promise<ActionResult> {
  return runMessageAction(["owner"], () => testLocalWazzupWebhook(), "Webhook endpoint не проверен.")
}

export async function checkWazzupWebhookSubscriptionsAction(): Promise<ActionResult> {
  return runMessageAction(
    ["owner"],
    async () => {
      const config = await getWazzupWebhookSubscriptions()
      const messages = webhookConfigMessages("Текущие подписки Wazzup", config)
      return { ok: true, message: messages.join("\n"), messages }
    },
    "Подписки Wazzup не проверены."
  )
}

export async function connectWazzupWebhookAction(): Promise<ActionResult> {
  return runMessageAction(
    ["owner"],
    async () => {
      const result = await connectWazzupWebhookSubscriptions()
      const messages = [
        "Webhook subscriptions обновлены в Wazzup.",
        ...webhookConfigMessages("До PATCH", result.before),
        `PATCH: HTTP ${result.patch.status}, body: ${result.patch.body}`,
        ...webhookConfigMessages("После PATCH", result.after),
      ]
      return { ok: true, message: messages.join("\n"), messages }
    },
    "Webhook subscriptions не подключены."
  )
}

export async function checkWazzupChannelsAction(): Promise<ActionResult> {
  return runMessageAction(
    ["owner"],
    async () => {
      const channels = await listWazzupChannels()
      const activeWhatsappChannels = channels.filter((channel) => channel.transport === "whatsapp" && channel.state === "active")
      const messages = channels.length
        ? channels.map(
            (channel) =>
              `${channel.channelId || "-"} · ${channel.transport || "-"} · ${channel.plainId || "-"} · ${
                channel.state || "-"
              }${channel.state && channel.state !== "active" ? " · warning: channel is not active" : ""}`
          )
        : ["Каналы Wazzup не найдены."]
      if (activeWhatsappChannels.length > 1) {
        messages.push("warning: для iframe будет использован первый active whatsapp channel")
      }
      return { ok: true, message: messages.join("\n"), messages }
    },
    "Каналы Wazzup не проверены.",
    { revalidate: false }
  )
}

export async function syncWazzupUsersAction(): Promise<ActionResult> {
  return runMessageAction(
    ["owner"],
    async () => {
      const result = await syncWazzupUsers()
      return { ok: result.ok, message: result.message, messages: result.messages }
    },
    "Пользователи Wazzup не синхронизированы."
  )
}

export async function syncWazzupPipelinesAction(): Promise<ActionResult> {
  return runMessageAction(
    ["owner"],
    async () => {
      const result = await syncWazzupPipelines()
      return { ok: result.ok, message: result.message, messages: result.messages }
    },
    "Воронки Wazzup не синхронизированы."
  )
}

export async function syncWazzupContactsAction(): Promise<ActionResult> {
  return runMessageAction(
    ["owner"],
    async () => {
      const result = await syncWazzupContacts()
      return { ok: result.ok, message: result.message, messages: result.messages }
    },
    "Клиенты Wazzup не синхронизированы."
  )
}

export async function syncWazzupDealsAction(): Promise<ActionResult> {
  return runMessageAction(
    ["owner"],
    async () => {
      const result = await syncWazzupDeals()
      return { ok: result.ok, message: result.message, messages: result.messages }
    },
    "Сделки Wazzup не синхронизированы."
  )
}

export async function syncWazzupAllAction(): Promise<ActionResult> {
  return runMessageAction(
    ["owner"],
    async () => {
      const result = await syncWazzupAll()
      return { ok: result.ok, message: result.message, messages: result.messages }
    },
    "Полная синхронизация Wazzup не выполнена."
  )
}

function webhookConfigMessages(title: string, config: WazzupWebhookConfig) {
  return [
    title,
    `webhooksUri: ${config.webhooksUri ? maskWazzupWebhookUrl(config.webhooksUri) : "-"}`,
    `targetUri: ${maskWazzupWebhookUrl(getSecureWazzupWebhookUrlForOwner())}`,
    `messagesAndStatuses: ${String(config.subscriptions.messagesAndStatuses)}`,
    `contactsAndDealsCreation: ${String(config.subscriptions.contactsAndDealsCreation)}`,
    `channelsUpdates: ${String(config.subscriptions.channelsUpdates)}`,
    `templateStatus: ${String(config.subscriptions.templateStatus)}`,
  ]
}

function revalidateCrm(customerId?: number | null, dealId?: number | null) {
  revalidatePath("/clients")
  revalidatePath("/deals")
  if (customerId) {
    revalidatePath(`/clients/${customerId}`)
  }
  if (dealId) {
    revalidatePath(`/deals/${dealId}`)
  }
}

export async function linkDealToWazzupByCustomerAction(dealId: number) {
  return runRoleAction(["owner", "manager"], () => {
    linkDealToWazzupByCustomer(dealId)
    revalidateCrm(null, dealId)
  }, "Wazzup чат привязан к сделке.")
}

export async function createCustomerAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], () => {
    const customerId = createCustomer(formData)
    revalidateCrm(customerId, null)
  }, "Клиент создан.")
}

export async function createCashCustomerAction(formData: FormData): Promise<DataActionResult<CustomerOption>> {
  return runDataAction<CustomerOption>(
    ["owner", "manager"],
    () => {
      const customerId = createCustomer(formData)
      const customer = getCustomer(customerId)
      if (!customer) {
        throw new Error("Клиент создан, но не найден.")
      }

      revalidateCrm(customerId, null)
      revalidatePath("/cash")
      revalidatePath("/orders")

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        defaultDiscountPercent: customer.defaultDiscountPercent,
      }
    },
    "Клиент создан",
    "Клиент не создан."
  )
}

export async function updateCustomerAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], () => {
    const customerId = Number(String(formData.get("customerId") ?? ""))
    updateCustomer(formData)
    revalidateCrm(customerId, null)
  }, "Клиент сохранен.")
}

export async function createDealAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], (user) => {
    const dealId = createDeal(formData, user)
    revalidateCrm(null, dealId)
  }, "Сделка создана.")
}

export async function updateDealFieldsAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], (user) => {
    const dealId = Number(String(formData.get("dealId") ?? ""))
    updateDealFields(formData, user)
    revalidateCrm(Number(String(formData.get("customerId") ?? "")) || null, dealId)
  }, "Сделка сохранена.")
}

export async function updateDealStageAction(dealId: number, stageId: number) {
  return runRoleAction(["owner", "manager"], () => {
    updateDealStage(dealId, stageId)
    revalidateCrm(null, dealId)
  }, "Этап сделки обновлен.")
}

export async function addDealItemAction(dealId: number, productCode: string) {
  return runRoleAction(["owner", "manager"], () => {
    addDealItem(dealId, productCode)
    revalidateCrm(null, dealId)
  }, "Позиция добавлена.")
}

export async function addDealBouquetAction(dealId: number, bouquetId: number) {
  return runRoleAction(["owner", "manager"], () => {
    addDealBouquet(dealId, bouquetId)
    revalidateCrm(null, dealId)
  }, "Букет добавлен.")
}

export async function sendBouquetToDealChatAction(dealId: number, bouquetId: number): Promise<ActionResult> {
  try {
    const user = await requireActionRole(["owner", "manager"])
    await sendBouquetToDealChat(dealId, bouquetId, user)
    revalidateCrm(null, dealId)
    return { ok: true, message: "Букет отправлен в чат", messages: ["Букет отправлен в чат"] }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Букет не отправлен в чат.",
    }
  }
}

export async function sendTextToDealChatAction(
  dealId: number,
  text: string,
  options: { contentUri?: string; messageType?: string; refMessageId?: string; quotedText?: string } = {}
): Promise<ActionResult> {
  try {
    const user = await requireActionRole(["owner", "manager"])
    await sendTextToDealChat(dealId, text, user, options)
    revalidateCrm(null, dealId)
    return { ok: true, message: "Сообщение отправлено", messages: ["Сообщение отправлено"] }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Сообщение не отправлено.",
    }
  }
}

export async function updateDealItemAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], () => {
    const dealId = Number(String(formData.get("dealId") ?? ""))
    updateDealItem(formData)
    revalidateCrm(null, dealId)
  }, "Позиция сохранена.")
}

export async function removeDealItemAction(dealId: number, itemId: number) {
  return runRoleAction(["owner", "manager"], () => {
    removeDealItem(dealId, itemId)
    revalidateCrm(null, dealId)
  }, "Позиция удалена.")
}

export async function removeDealItemGroupAction(dealId: number, bouquetGroupId: string) {
  return runRoleAction(["owner", "manager"], () => {
    removeDealItemGroup(dealId, bouquetGroupId)
    revalidateCrm(null, dealId)
  }, "Букет удален.")
}

export async function createOrderFromDealAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], (user) => {
    const dealId = Number(String(formData.get("dealId") ?? ""))
    const orderId = createOrderFromDeal(formData, user)
    revalidateCrm(null, dealId)
    revalidatePath("/orders")
    revalidatePath(`/orders?orderId=${orderId}`)
  }, "Заказ создан и отправлен флористам")
}

export async function updateOrderFromDealAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], (user) => {
    const dealId = Number(String(formData.get("dealId") ?? ""))
    const orderId = updateOrderFromDeal(formData, user)
    revalidateCrm(null, dealId)
    revalidatePath("/orders")
    revalidatePath("/ready-orders")
    revalidatePath(`/orders?orderId=${orderId}`)
  }, "Заказ обновлён")
}

export async function updateOrderAction(formData: FormData) {
  // Редактирование заказа со «Стола заказов» доступно флористу/менеджеру/управляющему.
  // Денег не двигает (меняет резерв склада и состав), поэтому кассовый доступ не требуется.
  return runRoleAction(["owner", "manager", "florist"], (user) => {
    const { dealId } = updateOrder(formData, user)
    revalidatePath("/orders")
    revalidatePath("/ready-orders")
    revalidatePath("/cash")
    if (dealId) {
      revalidateCrm(null, dealId)
    }
  }, "Заказ обновлён")
}

export async function acceptDealPaymentAction(formData: FormData) {
  return runCashAction((user) => {
    const dealId = Number(String(formData.get("dealId") ?? ""))
    acceptDealPayment(formData, user)
    revalidateCrm(null, dealId)
    revalidatePath("/cash")
    revalidatePath("/shifts")
    revalidatePath("/orders")
  }, "Оплата по сделке принята")
}

export async function deleteProductAction(code: string) {
  return runRoleAction(["owner"], (user) => deleteProduct(code, user), "Товар удален.")
}

export async function setProductArchivedAction(code: string, archived: boolean) {
  return runRoleAction(
    ["owner"],
    (user) => setProductArchived(code, archived, user),
    archived ? "Товар отправлен в архив." : "Товар восстановлен."
  )
}

export async function createStockDocumentAction(type: StockDocumentType, formData: FormData) {
  const message = type === "stock_in" ? "Акт пополнения проведен" : "Акт списания проведен"

  return runRoleAction(
    ["owner"],
    (user) => {
      const documentId = createAndPostStockDocument(formData, type, user)
      revalidatePath("/stock/acts")
      revalidatePath(`/stock/acts/${documentId}`)
      revalidatePath("/history/stock")
    },
    message
  )
}

export async function createStockCorrectionDraftAction(
  originalDocumentId: number
): Promise<DataActionResult<{ documentId: number }>> {
  return runDataAction(
    ["owner"],
    (user) => {
      const documentId = createStockCorrectionDraft(originalDocumentId, user)
      revalidatePath("/stock/acts")
      revalidatePath(`/stock/acts/${originalDocumentId}`)
      return { documentId }
    },
    "Создан черновик корректировки"
  )
}

export async function saveStockDocumentDraftAction(type: StockDocumentType, formData: FormData) {
  return runRoleAction(
    ["owner"],
    (user) => {
      const documentId = saveStockDocumentDraft(formData, type, user)
      revalidatePath("/stock/acts")
      revalidatePath(`/stock/acts/${documentId}`)
    },
    "Черновик акта сохранен"
  )
}

export async function postStockDocumentAction(documentId: number) {
  return runRoleAction(
    ["owner"],
    (user) => {
      postStockDocument(documentId, user)
      revalidatePath("/stock/acts")
      revalidatePath(`/stock/acts/${documentId}`)
      revalidatePath("/history/stock")
    },
    "Акт склада проведен"
  )
}

export async function cancelStockDocumentAction(documentId: number) {
  return runRoleAction(
    ["owner"],
    () => {
      cancelStockDocument(documentId)
      revalidatePath("/stock/acts")
      revalidatePath(`/stock/acts/${documentId}`)
      revalidatePath("/history/stock")
    },
    "Акт склада отменен"
  )
}

export async function renameProductCategoryAction(formData: FormData) {
  return runRoleAction(["owner"], () => {
    const count = renameProductCategory(formData)
    return [`Категория переименована. Обновлено товаров: ${count}`]
  }, "Категория переименована")
}

export async function clearProductCategoryAction(categoryPath: string) {
  return runRoleAction(["owner"], () => {
    const count = clearProductCategory(categoryPath)
    return [`Категория очищена. Обновлено товаров: ${count}`]
  }, "Категория очищена")
}

export async function saveSupplierAction(formData: FormData) {
  return runRoleAction(["owner"], () => {
    upsertSupplier(formData)
    revalidatePath("/settings")
    revalidatePath("/suppliers")
  }, "Поставщик сохранен")
}

export async function setSupplierActiveAction(supplierId: number, isActive: boolean) {
  return runRoleAction(["owner"], () => {
    setSupplierActive(supplierId, isActive)
    revalidatePath("/settings")
    revalidatePath("/suppliers")
  }, isActive ? "Поставщик включен" : "Поставщик отключен")
}

export async function previewWarehouseImportAction(formData: FormData) {
  return runDataAction(
    ["owner"],
    async (user) => {
      const file = formData.get("file")
      if (!(file instanceof File) || file.size === 0) {
        throw new Error("Выберите XLSX файл.")
      }
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        throw new Error("Загрузите файл в формате .xlsx.")
      }
      // XLSX.read синхронный: большой файл заморозил бы единственный Node-процесс
      // (касса, заказы, вебхуки). Реальные выгрузки склада — сотни КБ.
      if (file.size > 15 * 1024 * 1024) {
        throw new Error("Файл слишком большой (максимум 15 МБ). Сохраните XLSX без картинок и лишних листов.")
      }

      const preview = previewWarehouseImport({
        filename: file.name,
        buffer: await file.arrayBuffer(),
        currentUser: user,
      })

      revalidatePath("/stock")
      revalidatePath("/warehouse/imports")

      return preview
    },
    "Предпросмотр импорта сформирован.",
    "Не удалось прочитать XLSX."
  )
}

export async function applyWarehouseImportAction(importId: number) {
  return runDataAction(
    ["owner"],
    (user) => {
      const preview = applyWarehouseImport(importId, user)

      revalidatePath("/stock")
      revalidatePath("/warehouse/imports")
      revalidatePath(`/warehouse/imports/${importId}`)

      return preview
    },
    "Импорт применен.",
    "Импорт не применен."
  )
}

export async function createSaleAction(formData: FormData) {
  return runCashAction((user) => createSale(formData, user), "Продажа проведена.")
}

export async function openShiftAction(formData: FormData) {
  return runAction(async () => {
    // Все роли могут открыть смену (флорист — свою дневную). Бизнес-правила (единственная открытая
    // смена, type='day', user_id=self) обеспечивает openShift в db-слое.
    const user = await requireActionUser()
    openShift(formData, user)
  }, "Смена открыта.")
}

export async function closeShiftAction(formData: FormData) {
  return runAction(async () => {
    const user = await requireActionUser()
    if (!canCloseShift(user, getShiftId(formData))) {
      throw new Error("Недостаточно прав для закрытия этой смены.")
    }

    closeShift(formData, user)
  }, "Смена закрыта.")
}

export async function cashInAction(formData: FormData) {
  return runCashAction((user) => cashIn(formData, user), "Наличные внесены")
}

export async function cashOutAction(formData: FormData) {
  return runCashAction((user) => cashOut(formData, user), "Наличные изъяты")
}

// Исправление способа оплаты проведённой продажи/платежа из «Кассы за смену».
// Только текущая открытая смена; сумму не двигает — пересчёт кассы остаётся верным.
export async function updatePaymentMethodAction(formData: FormData) {
  return runCashAction((user) => {
    updatePaymentMethod(formData, user)
    revalidatePath("/cash")
    revalidatePath("/shifts")
    revalidatePath("/orders")
    revalidatePath("/ready-orders")
  }, "Способ оплаты изменён")
}

// Отмена служебной кассовой операции (внесение/изъятие) из «Истории кассы».
export async function reverseCashTransactionAction(formData: FormData) {
  return runCashAction((user) => {
    reverseCashTransaction(formData, user)
    revalidatePath("/cash")
    revalidatePath("/shifts")
    revalidatePath("/history")
  }, "Операция отменена")
}

export async function createOrderAction(formData: FormData) {
  return runRoleAction(["owner", "manager"], (user) => createOrder(formData, user), "Заказ создан и отправлен флористам")
}

// Черновики заказов — owner/manager (флористы их не видят и не трогают). Серверная граница доступа.
export async function createOrderDraftAction(formData: FormData) {
  return runRoleAction(
    ["owner", "manager"],
    (user) => {
      createOrderDraft(formData, user)
    },
    "Черновик сохранён"
  )
}

export async function updateOrderDraftAction(formData: FormData) {
  const orderId = Number(formData.get("orderId") ?? formData.get("id"))
  return runRoleAction(
    ["owner", "manager"],
    (user) => {
      updateOrderDraft(orderId, formData, user)
    },
    "Черновик обновлён"
  )
}

export async function finalizeOrderDraftAction(orderId: number, priceMode: "keep" | "current" = "keep") {
  return runRoleAction(
    ["owner", "manager"],
    (user) => finalizeOrderDraft(orderId, user, { priceMode }),
    "Черновик отправлен флористам"
  )
}

export async function deleteDraftOrderAction(orderId: number) {
  return runRoleAction(["owner", "manager"], (user) => deleteDraftOrder(orderId, user), "Черновик удалён")
}

export async function startOrderWorkAction(orderId: number) {
  return runRoleAction(["owner", "manager", "florist"], (user) => startOrderWork(orderId, user), "Заказ взят в работу")
}

export async function markOrderReadyAction(orderId: number) {
  return runRoleAction(["owner", "manager", "florist"], (user) => markOrderReady(orderId, user), "Букет готов, склад списан")
}

export async function completePickupOrderAction(orderId: number, formData: FormData) {
  return runCashAction((user) => completePickupOrder(orderId, formData, user), "Заказ закрыт")
}

export async function handOrderToCourierAction(orderId: number, formData: FormData) {
  return runCashAction((user) => handOrderToCourier(orderId, formData, user), "Заказ передан курьеру")
}

export async function cancelOrderAction(orderId: number) {
  // Отмена может проводить возврат денег в кассу → требуется кассовый доступ (как у
  // выдачи/передачи курьеру), а не только роль. Иначе флорист без своей ночной смены
  // мог бы загнать возврат в чужую открытую смену.
  return runCashAction(
    (user) => {
      const result = cancelOrder(orderId, user)
      if (result.dealId) {
        revalidateCrm(null, result.dealId)
      }
      const messages: string[] = []
      if (result.alreadyBuilt) {
        messages.push("Букет уже собран, склад автоматически не восстанавливается")
      }
      if (result.refunded > 0) {
        messages.push(`Возврат ${new Intl.NumberFormat("ru-RU").format(result.refunded)} сом проведён`)
      }
      messages.push("Заказ отменен")
      return messages
    },
    "Заказ отменен"
  )
}

export async function createUserAction(formData: FormData) {
  return runRoleAction(["owner"], () => createUser(formData), "Пользователь создан.")
}

export async function updateUserAction(formData: FormData) {
  return runRoleAction(["owner"], () => updateUser(formData), "Пользователь сохранен.")
}

export async function changeUserPasswordAction(formData: FormData) {
  return runRoleAction(["owner"], () => changeUserPassword(formData), "Пароль изменен.")
}

export async function setUserActiveAction(userId: number, isActive: boolean) {
  return runRoleAction(
    ["owner"],
    () => setUserActive(userId, isActive),
    isActive ? "Пользователь включен." : "Пользователь отключен."
  )
}
