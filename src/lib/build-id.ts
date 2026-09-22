import { readFileSync } from "node:fs"
import path from "node:path"

// Идентификатор текущей сборки Next (.next/BUILD_ID). Меняется на каждой пересборке,
// потому что generateBuildId не задан в next.config — значит годится как сигнал
// «вышла новая версия» для авто-перезагрузки устаревших вкладок (см. VersionWatcher).
// Кэшируется на время жизни процесса: `next start` обслуживает ровно одну сборку.
let cached: string | null = null

export function getBuildId(): string {
  if (cached !== null) return cached
  try {
    cached = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || "dev"
  } catch {
    // В dev-режиме файла может не быть — поллинг версии тогда отключён на клиенте.
    cached = "dev"
  }
  return cached
}
