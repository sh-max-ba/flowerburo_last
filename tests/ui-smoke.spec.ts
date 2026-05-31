import crypto from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { createSessionRecord, listUsers } from "../src/lib/db"

const ownerLogin = process.env.E2E_LOGIN
const ownerPassword = process.env.E2E_PASSWORD
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"
const sessionCookieName = "flower_ops_session"

const keyRoutes = [
  { path: "/cash", title: "Касса" },
  { path: "/orders", title: "Стол заказов" },
  { path: "/ready-orders", title: "Готовые заказы" },
  { path: "/stock", title: "Склад" },
  { path: "/stock/acts", title: "Акты склада" },
  { path: "/history/stock", title: "История склада" },
  { path: "/shifts", title: "Смены" },
  { path: "/clients", title: "Клиенты" },
  { path: "/deals", title: "Сделки" },
  { path: "/settings", title: "Настройки" },
  { path: "/bouquets", title: "Букеты" },
]

test("owner UI smoke audit", async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text())
    }
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))

  await login(page)

  for (const route of keyRoutes) {
    await test.step(route.path, async () => {
      await page.goto(route.path)
      await expect(page.locator("body")).toBeVisible()
      await expect(page.locator("main")).toBeVisible()
      await expect(page.locator("header").first()).toBeVisible()
      await expect(page.locator('[data-slot="sidebar"]').first()).toBeVisible()
      await expect(page.locator("body")).not.toContainText("Application error")
      await expect(page.locator("body")).not.toContainText("Unhandled Runtime Error")
      await expectVisibleAction(page)
      await expectNoDocumentOverflow(page, route.path)
      await exerciseFirstSelect(page)
    })
  }

  await openFirstDetail(page, "/deals", 'a[href^="/deals/"]')
  await openFirstDetail(page, "/clients", 'a[href^="/clients/"]')
  await openFirstDetail(page, "/stock/acts", 'a[href^="/stock/acts/"]')
  await openFirstDetail(page, "/shifts", 'a[href^="/shifts/"]')

  expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([])
})

async function login(page: Page) {
  if (!ownerLogin || !ownerPassword) {
    await installOwnerSession(page)
    await page.goto("/cash")
    await expect(page).not.toHaveURL(/\/login/)
    return
  }

  await page.goto("/login")

  if (!page.url().includes("/login")) {
    return
  }

  await page.getByLabel("Логин").fill(ownerLogin)
  await page.getByLabel("Пароль").fill(ownerPassword)
  await page.getByRole("button", { name: /Войти/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 })
}

async function installOwnerSession(page: Page) {
  const owner = listUsers().find((user) => user.role === "owner" && user.isActive)
  if (!owner) {
    throw new Error("No active owner user found for UI smoke audit.")
  }

  const expiresAt = new Date(Date.now() + 1000 * 60 * 60)
  const token = `e2e.${crypto.randomUUID()}`
  createSessionRecord(owner.id, token, expiresAt)
  await page.context().addCookies([
    {
      name: sessionCookieName,
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(expiresAt.getTime() / 1000),
    },
  ])
}

async function expectVisibleAction(page: Page) {
  const visibleActions = await page.locator("main button, main a").evaluateAll((elements) =>
    elements.filter((element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
    }).length
  )

  expect(visibleActions).toBeGreaterThan(0)
}

async function expectNoDocumentOverflow(page: Page, path: string) {
  const overflow = await page.evaluate(() =>
    Math.ceil(document.documentElement.scrollWidth - document.documentElement.clientWidth)
  )

  expect(overflow, `${path} has horizontal document overflow`).toBeLessThanOrEqual(2)
}

async function exerciseFirstSelect(page: Page) {
  const triggers = page.locator('[data-slot="select-trigger"]')
  const count = Math.min(await triggers.count(), 4)

  for (let index = 0; index < count; index += 1) {
    const trigger = triggers.nth(index)
    if (!(await trigger.isVisible()) || !(await trigger.isEnabled())) {
      continue
    }

    await trigger.click()
    const popup = page.locator('[data-slot="select-content"]').last()
    await expect(popup).toBeVisible()
    const box = await popup.boundingBox()
    const viewport = page.viewportSize()
    expect(box, "select popup should have a bounding box").not.toBeNull()
    expect(viewport, "viewport should exist").not.toBeNull()
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
    }
    await page.keyboard.press("Escape")
    break
  }
}

async function openFirstDetail(page: Page, listPath: string, selector: string) {
  await page.goto(listPath)
  const firstLink = page.locator(selector).first()
  if ((await firstLink.count()) === 0 || !(await firstLink.isVisible())) {
    return
  }

  const href = await firstLink.getAttribute("href")
  if (!href) {
    return
  }

  await page.goto(href)
  await expect(page.locator("main")).toBeVisible()
  await expect(page.locator("body")).not.toContainText("Application error")
  await expectNoDocumentOverflow(page, href)
  await exerciseFirstSelect(page)
}
