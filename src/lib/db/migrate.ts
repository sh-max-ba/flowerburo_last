import type Database from "better-sqlite3"
import { migrateBaseline } from "./schema"
import { seedDefaultDealPipeline } from "./seed"

export type Migration = {
  version: number
  up: (client: Database.Database) => void
}

export const MIGRATIONS: Migration[] = [
  { version: 1, up: migrateBaseline },
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
