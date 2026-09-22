import { numberFromRow } from "@/lib/db-row"
import { roundMoney } from "./form-parsers"
import type {
  AllocationMethod,
  BouquetTemplate,
  BouquetTemplateItem,
  CurrentUser,
  DealBouquetMessage,
  DealBouquetMessageStatus,
  StockDocument,
  StockDocumentItem,
  StockDocumentOverhead,
  StockDocumentStatus,
  StockDocumentType,
  StockLot,
  StockLotStatus,
  StockOverheadKind,
  Supplier,
  User,
  WarehouseImport,
  WarehouseImportItem,
  WazzupMessage,
} from "./types"
import { stockLotStatuses, stockOverheadKinds } from "./types"

export function mapUser(row: Record<string, unknown>): User {
  const role = String(row.role)

  return {
    id: numberFromRow(row.id),
    login: String(row.login),
    name: String(row.name),
    role: role === "manager" || role === "florist" ? role : "owner",
    passwordHash: String(row.password_hash),
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }
}

export function mapSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: numberFromRow(row.id),
    name: String(row.name ?? ""),
    legalName: String(row.legal_name ?? ""),
    inn: String(row.inn ?? ""),
    kpp: String(row.kpp ?? ""),
    ogrn: String(row.ogrn ?? ""),
    phone: String(row.phone ?? ""),
    phone2: String(row.phone_2 ?? ""),
    email: String(row.email ?? ""),
    contactName: String(row.contact_name ?? ""),
    contactName2: String(row.contact_name_2 ?? ""),
    responsibleName: String(row.responsible_name ?? ""),
    address: String(row.address ?? ""),
    bankName: String(row.bank_name ?? ""),
    bankAccount: String(row.bank_account ?? ""),
    bik: String(row.bik ?? ""),
    corrAccount: String(row.corr_account ?? ""),
    paymentTerms: String(row.payment_terms ?? ""),
    paymentDelayDays: row.payment_delay_days == null ? null : numberFromRow(row.payment_delay_days),
    comment: String(row.comment ?? ""),
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }
}

export function publicUser(user: User): CurrentUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export function mapWarehouseImport(row: Record<string, unknown>): WarehouseImport {
  const status = String(row.status)

  return {
    id: numberFromRow(row.id),
    filename: String(row.filename ?? ""),
    status: status === "applied" || status === "failed" ? status : "preview",
    totalRows: numberFromRow(row.total_rows),
    createdCount: numberFromRow(row.created_count),
    updatedCount: numberFromRow(row.updated_count),
    unchangedCount: numberFromRow(row.unchanged_count),
    errorCount: numberFromRow(row.error_count),
    createdByUserId: row.created_by_user_id === null ? null : numberFromRow(row.created_by_user_id),
    createdByName: String(row.created_by_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    appliedAt: row.applied_at === null ? null : String(row.applied_at ?? ""),
    reportJson: String(row.report_json ?? ""),
  }
}

export function mapWarehouseImportItem(row: Record<string, unknown>): WarehouseImportItem {
  const action = String(row.action)

  return {
    id: numberFromRow(row.id),
    importId: numberFromRow(row.import_id),
    rowNumber: row.row_number === null ? null : numberFromRow(row.row_number),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    categoryPath: String(row.category_path ?? ""),
    action: action === "create" || action === "update" || action === "unchanged" ? action : "error",
    oldStock: row.old_stock === null ? null : numberFromRow(row.old_stock),
    newStock: row.new_stock === null ? null : numberFromRow(row.new_stock),
    stockDelta: row.stock_delta === null ? null : numberFromRow(row.stock_delta),
    oldReserved: row.old_reserved === null ? null : numberFromRow(row.old_reserved),
    newReserved: row.new_reserved === null ? null : numberFromRow(row.new_reserved),
    oldSalePrice: row.old_sale_price === null ? null : numberFromRow(row.old_sale_price),
    newSalePrice: row.new_sale_price === null ? null : numberFromRow(row.new_sale_price),
    oldCostPrice: row.old_cost_price === null ? null : numberFromRow(row.old_cost_price),
    newCostPrice: row.new_cost_price === null ? null : numberFromRow(row.new_cost_price),
    error: String(row.error ?? ""),
    createdAt: String(row.created_at ?? ""),
  }
}

export function mapBouquetTemplate(row: Record<string, unknown>, items: BouquetTemplateItem[]): BouquetTemplate {
  return {
    id: numberFromRow(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    imagePath: String(row.imagePath ?? row.image_path ?? ""),
    price: numberFromRow(row.price),
    isActive: numberFromRow(row.isActive ?? row.is_active) === 1,
    createdByUserId:
      row.createdByUserId === null || row.createdByUserId === undefined ? null : numberFromRow(row.createdByUserId),
    createdByName: String(row.createdByName ?? ""),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
    itemsCount: numberFromRow(row.itemsCount) || items.length,
    items,
  }
}

export function mapDealBouquetMessage(row: Record<string, unknown>): DealBouquetMessage {
  return {
    id: numberFromRow(row.id),
    dealId: numberFromRow(row.dealId),
    bouquetId: numberFromRow(row.bouquetId),
    bouquetName: String(row.bouquetName ?? ""),
    messageText: String(row.messageText ?? ""),
    imagePath: String(row.imagePath ?? ""),
    sentByUserId:
      row.sentByUserId === null || row.sentByUserId === undefined ? null : numberFromRow(row.sentByUserId),
    sentByName: String(row.sentByName ?? ""),
    sentAt: String(row.sentAt ?? ""),
    status: normalizeDealBouquetMessageStatus(String(row.status ?? "")),
    error: String(row.error ?? ""),
  }
}

export function normalizeDealBouquetMessageStatus(value: string): DealBouquetMessageStatus {
  return value === "sent" ? "sent" : "failed"
}

export function mapWazzupMessage(row: Record<string, unknown>): WazzupMessage {
  const direction = String(row.direction ?? "") === "outbound" ? "outbound" : "inbound"
  return {
    id: numberFromRow(row.id),
    messageId: String(row.message_id ?? ""),
    crmMessageId: String(row.crm_message_id ?? ""),
    dealId: row.deal_id === null || row.deal_id === undefined ? null : numberFromRow(row.deal_id),
    customerId:
      row.customer_id === null || row.customer_id === undefined ? null : numberFromRow(row.customer_id),
    channelId: String(row.channel_id ?? ""),
    chatType: String(row.chat_type ?? ""),
    chatId: String(row.chat_id ?? ""),
    direction,
    messageType: String(row.message_type ?? "") || "text",
    text: String(row.text ?? ""),
    contentUri: String(row.content_uri ?? ""),
    status: String(row.status ?? ""),
    isEcho: Number(row.is_echo ?? 0) === 1,
    authorName: String(row.author_name ?? ""),
    quotedMessageId: String(row.quoted_message_id ?? ""),
    quotedText: String(row.quoted_text ?? ""),
    transcript: String(row.transcript ?? ""),
    dateTime: String(row.date_time ?? ""),
    createdAt: String(row.created_at ?? ""),
  }
}

export function normalizeStockDocumentStatus(value: unknown): StockDocumentStatus {
  const status = String(value)
  if (status === "posted" || status === "cancelled" || status === "corrected") {
    return status
  }

  return "draft"
}

export function mapStockDocumentItem(row: Record<string, unknown>): StockDocumentItem {
  return {
    id: numberFromRow(row.id),
    documentId: numberFromRow(row.document_id),
    productCode: String(row.product_code ?? ""),
    productName: String(row.product_name ?? ""),
    qty: numberFromRow(row.qty),
    defectQty: numberFromRow(row.defect_qty),
    unitCost: numberFromRow(row.unit_cost),
    allocatedOverhead: numberFromRow(row.allocated_overhead),
    landedUnitCost: row.landed_unit_cost == null ? null : numberFromRow(row.landed_unit_cost),
    costBefore: row.cost_before == null ? null : numberFromRow(row.cost_before),
    costAfter: row.cost_after == null ? null : numberFromRow(row.cost_after),
    beforeStock: row.before_stock === null ? null : numberFromRow(row.before_stock),
    afterStock: row.after_stock === null ? null : numberFromRow(row.after_stock),
    expectedQty: row.expected_qty == null ? null : numberFromRow(row.expected_qty),
    countedQty: row.counted_qty == null ? null : numberFromRow(row.counted_qty),
    countedAt: row.counted_at == null ? null : String(row.counted_at),
    varianceReason: row.variance_reason == null ? null : String(row.variance_reason),
    applied: numberFromRow(row.applied ?? 0) === 1,
    currentStock: row.current_stock === null || row.current_stock === undefined ? null : numberFromRow(row.current_stock),
    currentReserved:
      row.current_reserved === null || row.current_reserved === undefined ? null : numberFromRow(row.current_reserved),
    currentCategory:
      row.current_category === null || row.current_category === undefined ? null : String(row.current_category),
    comment: String(row.comment ?? ""),
    createdAt: String(row.created_at ?? ""),
  }
}

export function normalizeAllocationMethod(value: unknown): AllocationMethod {
  return value === "by_qty" ? "by_qty" : "by_value"
}

// Мягкая нормализация типа акта для ЧТЕНИЯ (в отличие от parseStockDocumentType, который валидирует
// ввод и бросает). Forward-compatible: неизвестный тип не роняет рендер списков/истории, а мягко
// падает в "stock_out" (для отображения). Так появление нового типа не ломает старые страницы.
function normalizeStockDocumentType(value: unknown): StockDocumentType {
  const type = String(value ?? "")
  if (type === "stock_in" || type === "stock_out" || type === "count") {
    return type
  }
  return "stock_out"
}

export function mapStockLot(row: Record<string, unknown>): StockLot {
  const status = String(row.status ?? "active")
  return {
    id: numberFromRow(row.id),
    productCode: String(row.product_code ?? ""),
    productName: String(row.product_name ?? ""),
    documentId: row.document_id == null ? null : numberFromRow(row.document_id),
    documentNumber: row.document_number == null ? null : String(row.document_number),
    supplierId: row.supplier_id == null ? null : numberFromRow(row.supplier_id),
    supplierName: String(row.supplier_name ?? ""),
    receivedAt: String(row.received_at ?? ""),
    expiryDate: row.expiry_date == null ? null : String(row.expiry_date),
    qtyReceived: numberFromRow(row.qty_received),
    qtyRemaining: numberFromRow(row.qty_remaining),
    unitCost: row.unit_cost == null ? null : numberFromRow(row.unit_cost),
    status: stockLotStatuses.has(status as StockLotStatus) ? (status as StockLotStatus) : "active",
    note: String(row.note ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }
}

export function mapStockDocumentOverhead(row: Record<string, unknown>): StockDocumentOverhead {
  const kind = String(row.kind ?? "other")
  return {
    id: numberFromRow(row.id),
    documentId: numberFromRow(row.document_id),
    kind: stockOverheadKinds.has(kind as StockOverheadKind) ? (kind as StockOverheadKind) : "other",
    label: String(row.label ?? ""),
    amount: numberFromRow(row.amount),
    createdAt: String(row.created_at ?? ""),
  }
}

export function mapStockDocument(
  row: Record<string, unknown>,
  items: StockDocumentItem[] = [],
  overheads: StockDocumentOverhead[] = []
): StockDocument {
  const paidAmount = roundMoney(numberFromRow(row.paid_amount))

  return {
    id: numberFromRow(row.id),
    number: String(row.number ?? ""),
    type: normalizeStockDocumentType(row.type),
    status: normalizeStockDocumentStatus(row.status),
    supplierId: row.supplier_id === null || row.supplier_id === undefined ? null : numberFromRow(row.supplier_id),
    supplierName: String(row.supplier_name ?? ""),
    comment: String(row.comment ?? ""),
    operationAt: row.operation_at === null || row.operation_at === undefined ? null : String(row.operation_at),
    overheadTotal: numberFromRow(row.overhead_total),
    allocationMethod: normalizeAllocationMethod(row.allocation_method),
    goodsTotal: numberFromRow(row.goods_total),
    landedTotal: numberFromRow(row.landed_total),
    paidAmount,
    // delivery_total приходит из SQL в списках; в одиночных выборках считаем по строкам расходов.
    deliveryTotal:
      row.delivery_total === null || row.delivery_total === undefined
        ? roundMoney(
            overheads.reduce((sum, overhead) => (overhead.kind === "delivery" ? sum + overhead.amount : sum), 0)
          )
        : numberFromRow(row.delivery_total),
    // Долг только у проведённого прихода: у черновика goods_total ещё 0, у отменённого и
    // скорректированного акта долга нет (скорректированный заменён новым документом).
    supplierDebt:
      normalizeStockDocumentType(row.type) === "stock_in" && normalizeStockDocumentStatus(row.status) === "posted"
        ? Math.max(0, roundMoney(numberFromRow(row.goods_total) - paidAmount))
        : 0,
    correctsDocumentId:
      row.corrects_document_id === null || row.corrects_document_id === undefined
        ? null
        : numberFromRow(row.corrects_document_id),
    correctedByDocumentId:
      row.corrected_by_document_id === null || row.corrected_by_document_id === undefined
        ? null
        : numberFromRow(row.corrected_by_document_id),
    correctedAt: row.corrected_at === null || row.corrected_at === undefined ? null : String(row.corrected_at),
    countStartedAt:
      row.count_started_at === null || row.count_started_at === undefined ? null : String(row.count_started_at),
    createdByUserId: row.created_by_user_id === null ? null : numberFromRow(row.created_by_user_id),
    createdByName: String(row.created_by_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    postedByUserId: row.posted_by_user_id === null ? null : numberFromRow(row.posted_by_user_id),
    postedByName: String(row.posted_by_name ?? ""),
    postedAt: row.posted_at === null ? null : String(row.posted_at ?? ""),
    cancelledAt: row.cancelled_at === null ? null : String(row.cancelled_at ?? ""),
    itemsCount: numberFromRow(row.items_count ?? items.length),
    items,
    overheads,
  }
}
