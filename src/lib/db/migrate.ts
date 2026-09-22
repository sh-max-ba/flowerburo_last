import type Database from "better-sqlite3"
import {
  migrateBaseline,
  migrateWazzupCustomChat,
  migrateWazzupChatReplies,
  migrateWazzupTranscripts,
  migrateOrderModifiedFlag,
  migrateAppSettings,
  migrateOrderCompletionShift,
  migrateBackfillCompletionShift,
  migrateCashSourceShift,
  migrateCashReversal,
  migrateSaleReversal,
  migrateProductArchive,
  migrateSupplierExtraInfo,
  migrateStockCostAtReceipt,
  migrateStockOverhead,
  migrateStockDocCorrection,
  migrateStockLots,
  migrateStockInventory,
  migrateOrderDraftPrepayment,
  migrateInventoryCategoryTemplates,
  migrateStockDefectQty,
  migrateCrmListIndexes,
  migrateStockSupplierPayment,
  migrateOrderImages,
  migrateOrderPendingPrepayments,
} from "./schema"
import { seedDefaultDealPipeline } from "./seed"

export type Migration = {
  version: number
  up: (client: Database.Database) => void
}

export const MIGRATIONS: Migration[] = [
  { version: 1, up: migrateBaseline },
  { version: 2, up: migrateWazzupCustomChat },
  { version: 3, up: migrateWazzupChatReplies },
  { version: 4, up: migrateWazzupTranscripts },
  { version: 5, up: migrateOrderModifiedFlag },
  { version: 6, up: migrateAppSettings },
  { version: 7, up: migrateOrderCompletionShift },
  { version: 8, up: migrateBackfillCompletionShift },
  { version: 9, up: migrateCashSourceShift },
  { version: 10, up: migrateCashReversal },
  { version: 11, up: migrateSaleReversal },
  { version: 12, up: migrateProductArchive },
  { version: 13, up: migrateSupplierExtraInfo },
  { version: 14, up: migrateStockCostAtReceipt },
  { version: 15, up: migrateStockOverhead },
  { version: 16, up: migrateStockDocCorrection },
  { version: 17, up: migrateStockLots },
  { version: 18, up: migrateStockInventory },
  { version: 19, up: migrateOrderDraftPrepayment },
  { version: 20, up: migrateInventoryCategoryTemplates },
  { version: 21, up: migrateStockDefectQty },
  { version: 22, up: migrateCrmListIndexes },
  { version: 23, up: migrateStockSupplierPayment },
  { version: 24, up: migrateOrderImages },
  { version: 25, up: migrateOrderPendingPrepayments },
]

export function migrate(client: Database.Database) {
  const fromVersion = client.pragma("user_version", { simple: true }) as number

  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= fromVersion) {
      continue
    }
    client.transaction(() => {
      migration.up(client)
      client.pragma(`user_version = ${migration.version}`)
    })()
  }

  seedDefaultDealPipeline(client)
}
