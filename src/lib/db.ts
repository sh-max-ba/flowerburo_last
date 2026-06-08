// Публичный баррель @/lib/db (ARCH-8).
// Реализация разнесена по дереву src/lib/db/*; этот файл лишь ре-экспортирует
// РОВНО прежний публичный набор (113 имён), чтобы импортёры @/lib/db не менялись.
// Файл db.ts имеет приоритет над каталогом db/ при резолве "@/lib/db",
// а "@/lib/db/x" резолвится в db/x.ts — коллизии нет.


export type {
  BouquetTemplate,
  BouquetTemplateInput,
  BouquetTemplateItem,
  CashLedgerEntry,
  CashLedgerLineItem,
  CashTransaction,
  CashTransactionType,
  CurrentUser,
  CustomerOption,
  DashboardData,
  DealBouquetMessage,
  DealBouquetMessageStatus,
  HistoryReportData,
  Movement,
  Order,
  OrderItem,
  OrderStatus,
  OwnerDashboardData,
  OwnerDashboardDebtor,
  OwnerDashboardPayment,
  OwnerDashboardRange,
  OwnerDashboardRevenuePoint,
  PaymentMethod,
  Product,
  Sale,
  SaleItem,
  Shift,
  ShiftDetails,
  ShiftPaymentBreakdown,
  ShiftRelatedOrder,
  ShiftSale,
  ShiftShellData,
  ShiftSummary,
  StockDocument,
  StockDocumentItem,
  StockDocumentStatus,
  StockDocumentType,
  StockMovementType,
  Supplier,
  User,
  UserRole,
  WarehouseImport,
  WarehouseImportAction,
  WarehouseImportItem,
  WarehouseImportPreview,
  WazzupMessage,
  WazzupMessageDirection,
} from "./db/types"

export {
  initDb,
} from "./db/connection"
export {
  ensureColumn,
} from "./db/schema"
export {
  recordCashTransaction,
  recordStockMovement,
} from "./db/ledger"
export {
  formatOrderNumber,
  generateOrderNumber,
} from "./db/form-parsers"
export {
  getCurrentUserById,
  listUsers,
  createUser,
  updateUser,
  setUserActive,
  changeUserPassword,
  getUserByLogin,
  getUserBySessionToken,
  getActiveFlorists,
  createSessionRecord,
  deleteSessionRecord,
} from "./db/queries/users"
export {
  listSuppliers,
  getSupplier,
  getSupplierPurchaseHistory,
  upsertSupplier,
  setSupplierActive,
} from "./db/queries/suppliers"
export {
  getOpenShift,
  requireOpenShift,
  getDefaultOpeningCash,
  getShiftShellData,
  getOrdersActivityRevision,
  calculateShiftSummary,
  getShiftDetails,
  getShiftAccessInfo,
  userHasOpenNightShift,
} from "./db/queries/shifts"
export {
  openShift,
  closeShift,
  cashIn,
  cashOut,
  updatePaymentMethod,
  reverseCashTransaction,
} from "./db/queries/cash"
export {
  getProductByCode,
  updateProductImagePath,
  upsertProduct,
  renameProductCategory,
  clearProductCategory,
  deleteProduct,
  setProductArchived,
  listArchivedProducts,
} from "./db/queries/products"
export {
  listBouquetTemplates,
  getBouquetTemplate,
  updateBouquetTemplateImagePath,
  createBouquetTemplate,
  updateBouquetTemplate,
  toggleBouquetTemplateActive,
  deleteBouquetTemplate,
  listDealBouquetMessages,
  recordDealBouquetMessage,
} from "./db/queries/bouquets"
export {
  upsertOutboundWazzupMessage,
  listWazzupChatMessages,
  getWazzupChatRevision,
  getWazzupMessageMedia,
  getWazzupTranscriptionSource,
  saveWazzupMessageTranscript,
} from "./db/queries/wazzup-messages"
export type {
  WazzupChatIdentity,
  OutboundWazzupMessageInput,
} from "./db/queries/wazzup-messages"
export {
  listStockDocuments,
  getStockDocument,
  generateStockDocumentNumber,
  saveStockDocumentDraft,
  postStockDocument,
  createAndPostStockDocument,
  cancelStockDocument,
} from "./db/queries/stock-documents"
export {
  createWarehouseImportTemplateWorkbook,
  createWarehouseExportWorkbook,
  writeWorkbookBuffer,
  previewWarehouseImport,
  applyWarehouseImport,
  listWarehouseImports,
  getWarehouseImport,
} from "./db/queries/warehouse"
export {
  getCashLedger,
  getHistoryReportData,
} from "./db/queries/history"
export {
  getDashboardData,
  getReadyOrdersActionCount,
} from "./db/queries/dashboard"
export {
  getOwnerDashboardData,
} from "./db/queries/owner-dashboard"
export {
  getAppSetting,
  setAppSetting,
  getAllowOversellOrders,
  setAllowOversellOrders,
  getRecomputeCostOnReceipt,
  setRecomputeCostOnReceipt,
  getOrderSettings,
} from "./db/queries/app-settings"
export type { OrderSettings } from "./db/queries/app-settings"
export {
  createSale,
} from "./db/queries/sales"
export {
  createOrder,
  startOrderWork,
  markOrderReady,
  completePickupOrder,
  handOrderToCourier,
  cancelOrder,
} from "./db/domain/order-lifecycle"
export {
  createOrderFromDeal,
  updateOrderFromDeal,
  updateOrder,
  acceptDealPayment,
} from "./db/domain/deal-orders"
