// Проверка руководств: каждый шаг ссылается на снятый кадр, а подсветка/кадрирование — на
// измеренные области этого кадра. Запуск: npx tsx scripts/guides/check-content.ts
import fs from "node:fs"
import path from "node:path"

import type { UserRole } from "../../src/lib/db/types"
import { GUIDES } from "../../src/lib/guides"
import { canViewGuide, guideOfShotFile } from "../../src/lib/guides/access"
import { SHOTS } from "../../src/lib/guides/shots"

const ROLES: UserRole[] = ["owner", "manager", "florist"]

const problems: string[] = []
const used = new Set<string>()

for (const guide of Object.values(GUIDES)) {
  const slugs = new Set(guide.scenarios.map((scenario) => scenario.slug))
  for (const group of guide.groups) {
    for (const slug of group.slugs) {
      if (!slugs.has(slug)) problems.push(`${guide.id}: группа «${group.title}» ссылается на неизвестный сценарий ${slug}`)
    }
  }
  for (const node of [...guide.flow, ...(guide.branches ?? [])]) {
    const target = GUIDES[node.guide ?? guide.id]
    if (!target.scenarios.some((scenario) => scenario.slug === node.slug)) {
      problems.push(`${guide.id}: шаг пути «${node.label}» ведёт на неизвестный сценарий ${node.guide ?? guide.id}/${node.slug}`)
    }
  }
  for (const scenario of guide.scenarios) {
    scenario.steps.forEach((step, index) => {
      const where = `${guide.id}/${scenario.slug} шаг ${index + 1}`
      if (!step.shot) return
      used.add(step.shot.id)
      const shot = SHOTS[step.shot.id]
      if (!shot) {
        problems.push(`${where}: нет кадра ${step.shot.id}`)
        return
      }
      if (!fs.existsSync(path.join("content", "guides", "shots", `${step.shot.id}.webp`))) {
        problems.push(`${where}: нет файла content/guides/shots/${step.shot.id}.webp`)
      }
      // Кадр отдаётся только ролям, которым видно его руководство (api/guides/shots): каждый, кто
      // читает этот шаг, должен иметь доступ и к кадру.
      const guideOfShot = guideOfShotFile(`${step.shot.id}.webp`)
      const blind = ROLES.filter((role) => canViewGuide(role, guide.id) && (!guideOfShot || !canViewGuide(role, guideOfShot)))
      if (blind.length) {
        problems.push(`${where}: кадр ${step.shot.id} не виден роли ${blind.join(", ")}`)
      }
      const crops = Array.isArray(step.shot.crop) ? step.shot.crop : [step.shot.crop]
      for (const name of [step.shot.focus, ...crops, ...(step.shot.marks ?? [])]) {
        if (name && !shot.targets[name]) problems.push(`${where}: в кадре ${step.shot.id} нет области «${name}»`)
      }
      if (step.shot.marks && step.legend && step.shot.marks.length !== step.legend.length) {
        problems.push(`${where}: меток ${step.shot.marks.length}, подписей ${step.legend.length}`)
      }
    })
  }
}

const unused = Object.keys(SHOTS).filter((id) => !used.has(id))
const files = fs.readdirSync(path.join("content", "guides", "shots")).filter((file) => file.endsWith(".webp"))
const orphans = files.filter((file) => !file.endsWith("-sm.webp") && !SHOTS[file.replace(/\.webp$/, "")])
for (const id of Object.keys(SHOTS)) {
  if (!files.includes(`${id}-sm.webp`)) problems.push(`нет обложки ${id}-sm.webp (node scripts/guides/thumbs.mjs)`)
}
const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join("content", "guides", "shots", file)).size, 0)

console.log(`Файлов: ${files.length} (${(bytes / 1024 / 1024).toFixed(1)} MB), кадров в тексте: ${used.size} из ${Object.keys(SHOTS).length}`)
if (unused.length) console.log(`Не используются: ${unused.join(", ")}`)
if (orphans.length) console.log(`Файлы без описания в shots.ts: ${orphans.join(", ")}`)
if (problems.length) {
  console.error(problems.map((problem) => `✗ ${problem}`).join("\n"))
  process.exit(1)
}
console.log("✓ Все ссылки на кадры и области в порядке")
