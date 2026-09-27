// Общие помощники съёмки экранов для раздела «Руководства».
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")
export const BASE = process.env.GUIDES_BASE_URL || "http://127.0.0.1:3007"
export const PASSWORD = process.env.GUIDES_PASSWORD || "demo2026"
export const SHOTS_DIR = path.join(ROOT, "content", "guides", "shots")
export const MANIFEST = path.join(ROOT, "src", "lib", "guides", "shots.ts")
export const VIEWPORT = { width: 1280, height: 800 }

// Съёмка без анимаций, мигающего курсора и индикатора dev-сервера — кадры стабильны.
const QUIET_CSS = `
  nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }
  *, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important;
    animation-duration: 0s !important; animation-delay: 0s !important; caret-color: transparent !important; }
  [data-sonner-toaster] { --offset: 16px; }
`

export async function newRoleContext(browser, { phone = false } = {}) {
  const context = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Asia/Bishkek" }
      : { viewport: VIEWPORT, deviceScaleFactor: 2, hasTouch: true, locale: "ru-RU", timezoneId: "Asia/Bishkek" }
  )
  await context.addInitScript((css) => {
    const inject = () => {
      if (document.getElementById("guides-quiet")) return
      const style = document.createElement("style")
      style.id = "guides-quiet"
      style.textContent = css
      document.documentElement.appendChild(style)
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject)
    else inject()
  }, QUIET_CSS)
  // Звук уведомлений «включён» — как на планшете в магазине.
  await context.addCookies([{ name: "fb_sound", value: "on", url: BASE }])
  return context
}

export async function login(page, loginName) {
  await page.goto(`${BASE}/login`, { waitUntil: "load" })
  await page.locator("#login").fill(loginName)
  await page.locator("#password").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 })
  await settle(page)
}

export async function go(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 180_000 })
  await settle(page, 1000)
}

// Страницы опрашивают счётчики каждые несколько секунд — «тишины в сети» может не быть,
// поэтому ждём недолго и не падаем.
export async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined)
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined)
  await page.waitForTimeout(ms)
}

// Закрыть уведомления их же кнопкой (удалять узлы руками нельзя — React перестанет показывать новые).
export async function dismissToasts(page) {
  for (let i = 0; i < 6; i += 1) {
    const close = page.locator("[data-sonner-toast] [data-close-button]").first()
    if (!(await close.isVisible().catch(() => false))) break
    await close.click({ force: true }).catch(() => undefined)
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(250)
}

const manifest = loadManifest()

function loadManifest() {
  try {
    const text = fs.readFileSync(MANIFEST, "utf8")
    // Объект после «= » (до него — import type { … }, его фигурные скобки не трогаем).
    const json = text.slice(text.indexOf("= {") + 2, text.lastIndexOf("}") + 1)
    return JSON.parse(json)
  } catch {
    return {}
  }
}

// Снимает кадр и измеряет области. targets: { имя: Locator | () => Locator }.
// Область, которой нет на экране, — ошибка: сценарий подсвечивал бы пустое место.
// GUIDES_ONLY_SHOTS=id1,id2 — переснять только эти кадры (сюжет проходит целиком, остальные не пишутся).
const onlyShots = process.env.GUIDES_ONLY_SHOTS ? new Set(process.env.GUIDES_ONLY_SHOTS.split(",")) : null

export async function capture(page, id, targets = {}, { clipTo } = {}) {
  if (onlyShots && !onlyShots.has(id)) return
  await settle(page, 400)
  const viewport = page.viewportSize()
  const boxes = {}
  for (const [name, target] of Object.entries(targets)) {
    // Массив локаторов — общая рамка вокруг всех (напр. первые строки таблицы).
    const locators = (Array.isArray(target) ? target : [target]).map((item) => (typeof item === "function" ? item() : item))
    const parts = []
    for (const locator of locators) {
      const part = await locator.first().boundingBox()
      if (!part) {
        throw new Error(`[${id}] target "${name}" is not visible`)
      }
      parts.push(part)
    }
    const left = Math.min(...parts.map((part) => part.x))
    const top = Math.min(...parts.map((part) => part.y))
    const box = {
      x: left,
      y: top,
      width: Math.max(...parts.map((part) => part.x + part.width)) - left,
      height: Math.max(...parts.map((part) => part.y + part.height)) - top,
    }
    const x = Math.max(0, box.x)
    const y = Math.max(0, box.y)
    const w = Math.min(viewport.width, box.x + box.width) - x
    const h = Math.min(viewport.height, box.y + box.height) - y
    // Большие контейнеры (таблица, доска) обрезаем по окну; элемент меньше окна, но уходящий за край
    // (карточка без кнопок внизу), — ошибка: подсветка показала бы обрубок.
    const cutOff = box.y + box.height > viewport.height + 2 && box.height < viewport.height * 0.9
    if (w < 4 || h < 4 || cutOff) {
      throw new Error(`[${id}] target "${name}" is outside the viewport (${Math.round(box.y)}+${Math.round(box.height)} > ${viewport.height})`)
    }
    boxes[name] = [x / viewport.width, y / viewport.height, w / viewport.width, h / viewport.height].map((v) => Number(v.toFixed(4)))
  }
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const png = await page.screenshot({ animations: "disabled", caret: "hide", ...(clipTo ? { clip: clipTo } : {}) })
  const webp = await sharp(png).webp({ quality: 80, effort: 6, smartSubsample: true }).toBuffer()
  fs.writeFileSync(path.join(SHOTS_DIR, `${id}.webp`), webp)
  await writeThumb(id, png)
  manifest[id] = {
    width: viewport.width,
    height: viewport.height,
    v: crypto.createHash("sha1").update(webp).digest("hex").slice(0, 8),
    targets: boxes,
  }
  writeManifest()
  console.log(`  ✓ ${id} (${Math.round(webp.length / 1024)} KB)${Object.keys(boxes).length ? " · " + Object.keys(boxes).join(", ") : ""}`)
}

// Уменьшенная копия для обложек карточек на главной руководства (в 2 раза легче).
export async function writeThumb(id, source) {
  const meta = await sharp(source).metadata()
  const thumb = await sharp(source)
    .resize({ width: Math.round((meta.width ?? 2560) / 2) })
    .webp({ quality: 78, effort: 6 })
    .toBuffer()
  fs.writeFileSync(path.join(SHOTS_DIR, `${id}-sm.webp`), thumb)
}

function writeManifest() {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
  const body = JSON.stringify(sorted, null, 2)
  fs.writeFileSync(
    MANIFEST,
    `// Сгенерировано scripts/guides/capture.mjs — не править руками.\n` +
      `// Кадры: content/guides/shots/<id>.webp (сняты в 2x), области — доли кадра [x, y, w, h].\n` +
      `import type { ShotMeta } from "@/lib/guides/types"\n\n` +
      `export const SHOTS: Record<string, ShotMeta & { v: string }> = ${body}\n`
  )
}

// Входящее сообщение клиента — через настоящий вебхук, как от Wazzup.
export async function inbound({ chatId, name, text, chatType = "whatsapp", minutesAgo = 0, isEcho = false, authorName }) {
  const dateTime = new Date(Date.now() - minutesAgo * 60_000).toISOString()
  const payload = {
    messages: [
      {
        messageId: crypto.randomUUID(),
        channelId: "demo-whatsapp-channel",
        chatType,
        chatId,
        dateTime,
        type: "text",
        status: isEcho ? "sent" : "inbound",
        text,
        isEcho,
        ...(authorName ? { authorName } : {}),
        contact: { name, phone: chatType === "whatsapp" ? chatId : undefined },
      },
    ],
  }
  const response = await fetch(`${BASE}/api/wazzup/webhook?key=sandbox-crm-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sandbox-crm-key" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`webhook ${response.status}: ${await response.text()}`)
  }
}
