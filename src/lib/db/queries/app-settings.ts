import type Database from "better-sqlite3"
import { db } from "../connection"

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

export type OrderSettings = {
  allowOversellOrders: boolean
}

export function getOrderSettings(client: Database.Database = db()): OrderSettings {
  return { allowOversellOrders: getAllowOversellOrders(client) }
}
