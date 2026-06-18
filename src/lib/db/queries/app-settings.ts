import type Database from "better-sqlite3"
import { db } from "../connection"
import type { AllocationMethod } from "../types"

// Универсальное key-value хранилище настроек приложения (таблица app_settings,
// создаётся миграцией v6). Значения храним строками; типобезопасные обёртки ниже.

export function getAppSetting(key: string, client: Database.Database = db()): string | null {
  const row = client.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function setAppSetting(key: string, value: string, client: Database.Database = db()): void {
  client
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .run(key, value)
}

// «Разрешить заказы с отсутствующими позициями»: когда включено, резерв склада при
// создании/изменении заказа не упирается в доступный остаток (остаток уходит в минус).
const ALLOW_OVERSELL_ORDERS_KEY = "allow_oversell_orders"

export function getAllowOversellOrders(client: Database.Database = db()): boolean {
  return getAppSetting(ALLOW_OVERSELL_ORDERS_KEY, client) === "1"
}

export function setAllowOversellOrders(value: boolean, client: Database.Database = db()): void {
  setAppSetting(ALLOW_OVERSELL_ORDERS_KEY, value ? "1" : "0", client)
}

// «Пересчитывать себестоимость при приходе»: когда включено, проведение приходного акта
// пересчитывает products.cost_price по средневзвешенной из цен закупки позиций (unit_cost).
// По умолчанию ВЫКЛЮЧЕНО — поведение прода не меняется, пока владелец явно не включит.
const RECOMPUTE_COST_ON_RECEIPT_KEY = "recompute_cost_on_receipt"

export function getRecomputeCostOnReceipt(client: Database.Database = db()): boolean {
  return getAppSetting(RECOMPUTE_COST_ON_RECEIPT_KEY, client) === "1"
}

export function setRecomputeCostOnReceipt(value: boolean, client: Database.Database = db()): void {
  setAppSetting(RECOMPUTE_COST_ON_RECEIPT_KEY, value ? "1" : "0", client)
}

// «Учёт по партиям»: когда включено, проведение приходного акта создаёт партии (stock_lots) для
// товаров с track_lots, считает сроки годности и включает FEFO-сверку/виджет свежести. По умолчанию
// ВЫКЛЮЧЕНО — до явного включения партии не создаются и поведение прода не меняется.
const TRACK_LOTS_ENABLED_KEY = "track_lots_enabled"

export function getTrackLotsEnabled(client: Database.Database = db()): boolean {
  return getAppSetting(TRACK_LOTS_ENABLED_KEY, client) === "1"
}

export function setTrackLotsEnabled(value: boolean, client: Database.Database = db()): void {
  setAppSetting(TRACK_LOTS_ENABLED_KEY, value ? "1" : "0", client)
}

// «Инвентаризация»: когда включено, доступен раздел /stock/inventory (пересчёт фактических остатков).
// По умолчанию ВЫКЛЮЧЕНО — до явного включения раздел скрыт и создание актов инвентаризации блокируется
// (безопасный поэтапный выкат + мгновенный выключатель при инциденте).
const ENABLE_INVENTORY_KEY = "enable_inventory"

export function getInventoryEnabled(client: Database.Database = db()): boolean {
  return getAppSetting(ENABLE_INVENTORY_KEY, client) === "1"
}

export function setInventoryEnabled(value: boolean, client: Database.Database = db()): void {
  setAppSetting(ENABLE_INVENTORY_KEY, value ? "1" : "0", client)
}

// Метод распределения накладных расходов ПО УМОЛЧАНИЮ — подставляется в новый приходный акт
// (на самом акте метод можно поменять). by_value (по стоимости) | by_qty (по количеству).
// По умолчанию by_value, как и прежде.
const DEFAULT_ALLOCATION_METHOD_KEY = "default_overhead_allocation_method"

export function getDefaultAllocationMethod(client: Database.Database = db()): AllocationMethod {
  return getAppSetting(DEFAULT_ALLOCATION_METHOD_KEY, client) === "by_qty" ? "by_qty" : "by_value"
}

export function setDefaultAllocationMethod(value: AllocationMethod, client: Database.Database = db()): void {
  setAppSetting(DEFAULT_ALLOCATION_METHOD_KEY, value === "by_qty" ? "by_qty" : "by_value", client)
}

export type OrderSettings = {
  allowOversellOrders: boolean
  recomputeCostOnReceipt: boolean
  trackLotsEnabled: boolean
  inventoryEnabled: boolean
  defaultAllocationMethod: AllocationMethod
}

export function getOrderSettings(client: Database.Database = db()): OrderSettings {
  return {
    allowOversellOrders: getAllowOversellOrders(client),
    recomputeCostOnReceipt: getRecomputeCostOnReceipt(client),
    trackLotsEnabled: getTrackLotsEnabled(client),
    inventoryEnabled: getInventoryEnabled(client),
    defaultAllocationMethod: getDefaultAllocationMethod(client),
  }
}
