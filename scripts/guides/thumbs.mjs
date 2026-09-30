// Пересобрать уменьшенные копии кадров (обложки карточек) из уже снятых: node scripts/guides/thumbs.mjs
import fs from "node:fs"
import path from "node:path"

import { SHOTS_DIR, writeThumb } from "./lib.mjs"

const files = fs.readdirSync(SHOTS_DIR).filter((file) => file.endsWith(".webp") && !file.endsWith("-sm.webp"))
for (const file of files) {
  await writeThumb(file.replace(/\.webp$/, ""), fs.readFileSync(path.join(SHOTS_DIR, file)))
}
console.log(`Обложки: ${files.length}`)
