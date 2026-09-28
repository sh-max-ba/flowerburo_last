// Съёмка экранов для раздела «Руководства» по сюжету «один заказ через все роли».
// Запускать только против песочницы с демо-базой (см. scripts/guides/README.md):
//   node scripts/guides/capture.mjs                 — все этапы по порядку
//   node scripts/guides/capture.mjs --only=admin    — отдельные этапы (состояние базы — от прошлых)
import path from "node:path"
import { chromium } from "playwright"

import { BASE, capture, dismissToasts, go, login, newRoleContext, settle } from "./lib.mjs"
import { ASSETS_DIR, openDb, prepareAssets, seedChats, seedDates, seedQuickReplies, shopDayFromToday, STORY } from "./setup.mjs"

const LOGINS = { admin: "admin", manager: "asel", florist: "zhibek" }

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")))
const only = args.only ? new Set(args.only.split(",")) : null

const PHASES = [
  ["setup", phaseSetup],
  ["manager-open", phaseManagerOpenDialog],
  ["florist-start", phaseFloristStart],
  ["manager-bouquets", phaseManagerBouquets],
  ["manager-chat", phaseManagerChat],
  ["florist-orders", phaseFloristOrders],
  ["florist-calendar", phaseFloristCalendar],
  ["florist-cash", phaseFloristCash],
  ["florist-phone", phaseFloristPhone],
  ["manager-work", phaseManagerWork],
  ["florist-close", phaseFloristClose],
  ["manager-close", phaseManagerClose],
  ["admin", phaseAdmin],
  ["admin-inventory", phaseAdminInventory],
  ["admin-setup", phaseAdminSetup],
]

// Полный Chromium с русской локалью окружения: системные элементы (выбор файла) — по-русски,
// как на планшетах в магазине (headless-shell знает только английский, флаг --lang на Linux не работает).
const browser = await chromium.launch({
  channel: "chromium",
  env: { ...process.env, LANGUAGE: "ru", LANG: "ru_RU.UTF-8", LC_ALL: "ru_RU.UTF-8" },
})
const sessions = {}
try {
  for (const [name, run] of PHASES) {
    if (only && !only.has(name)) continue
    console.log(`▸ ${name}`)
    await run()
  }
} finally {
  await browser.close()
}

// ─── Общие помощники ──────────────────────────────────────────────────────────

async function as(role) {
  if (!sessions[role]) {
    const context = await newRoleContext(browser)
    const page = await context.newPage()
    await login(page, LOGINS[role])
    sessions[role] = page
  }
  return sessions[role]
}

function shiftChip(page) {
  return page.getByRole("button", { name: /^Смена (открыта|закрыта)/ }).first()
}

function popover(page) {
  return page.locator('[data-slot="popover-content"]').last()
}

function dialog(page, name) {
  // Без имени — последнее окно приложения; скрытое окно ошибок dev-сервера Next (data-nextjs-dialog)
  // не считаем, иначе при любом предупреждении съёмка ждала бы его.
  return name ? page.getByRole("dialog", { name }) : page.locator('[role="dialog"]:not([data-nextjs-dialog])').last()
}

function toast(page, text) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first()
}

async function waitToast(page, text) {
  await toast(page, text).waitFor({ timeout: 30_000 })
}

// Выбрать товар в поиске-комбобоксе (касса, заказ, букет, акт склада).
async function pickProduct(page, input, name) {
  await input.click()
  await input.fill(name.split(" ")[0])
  const option = page.getByRole("option").filter({ hasText: name }).first()
  await option.waitFor({ timeout: 20_000 })
  await option.click()
  await page.waitForTimeout(250)
}

async function closeOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape")
    await page.waitForTimeout(150)
  }
}

function latestStoryOrder() {
  const db = openDb()
  try {
    return db
      .prepare("SELECT id, number, status FROM orders WHERE customer = ? ORDER BY id DESC LIMIT 1")
      .get(STORY.client.name)
  } finally {
    db.close()
  }
}

// Карточка заказа на столе по номеру.
function orderCard(page, number) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("button", { name: new RegExp(number) }) })
    .filter({ has: page.getByRole("button", { name: /В работу|Букет готов|Изменить/ }) })
    .last()
}

// ─── Этапы ────────────────────────────────────────────────────────────────────

async function phaseSetup() {
  const db = openDb()
  seedQuickReplies(db)
  const chats = db.prepare("SELECT count(*) AS n FROM chats").get().n
  const openShift = db.prepare("SELECT id FROM shifts WHERE status = 'open'").get()
  db.close()
  await prepareAssets()
  if (!chats) {
    await seedChats()
  }
  if (openShift) {
    // Смена из рабочей копии базы открыта кем-то — закрываем, чтобы флорист открыл свою.
    const page = await as("admin")
    await go(page, "/cash")
    await closeShiftFromChip(page)
  }
}

async function closeShiftFromChip(page, { confirm = true } = {}) {
  await shiftChip(page).click()
  await popover(page).getByRole("button", { name: "Закрыть смену" }).click()
  const box = dialog(page, "Закрыть смену")
  await box.waitFor()
  const hint = await box.getByText(/Ожидается в кассе:/).first().innerText()
  const expected = Number(hint.replace(/[^\d]/g, "")) || 0
  await box.locator("#closingCash").fill(String(expected))
  if (!confirm) return box
  await box.getByRole("button", { name: "Закрыть смену" }).last().click()
  const alert = page.getByRole("alertdialog")
  await alert.getByRole("button", { name: "Закрыть смену" }).click()
  await waitToast(page, "Смена закрыта.")
  await settle(page)
  return null
}

async function phaseManagerOpenDialog() {
  const page = await as("manager")
  await go(page, "/cash")
  await shiftChip(page).click()
  await popover(page).getByRole("button", { name: "Открыть смену" }).click()
  const box = dialog(page, "Открыть смену")
  await box.waitFor()
  await capture(page, "manager-shift-dialog", {
    dialog: box,
    responsible: page.locator("#responsibleUserId"),
    cash: page.locator("#openingCash"),
    submit: box.getByRole("button", { name: "Открыть смену" }).last(),
  })
  await closeOverlays(page)
}

async function phaseFloristStart() {
  const context = await newRoleContext(browser)
  const page = await context.newPage()
  await go(page, "/login")
  await page.locator("#login").fill(LOGINS.florist)
  await page.locator("#password").fill("demo2026")
  await capture(page, "florist-login", {
    form: page.locator('[data-slot="card"]').first(),
    submit: page.getByRole("button", { name: "Войти" }),
  })
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/orders"), { timeout: 120_000 })
  await settle(page, 1200)
  sessions.florist = page

  await shiftChip(page).click()
  await popover(page).waitFor()
  await capture(page, "florist-shift-closed", {
    chip: shiftChip(page),
    popover: popover(page),
    open: popover(page).getByRole("button", { name: "Открыть смену" }),
  })
  await popover(page).getByRole("button", { name: "Открыть смену" }).click()
  const box = dialog(page, "Открыть смену")
  await box.waitFor()
  await capture(page, "florist-shift-dialog", {
    dialog: box,
    cash: page.locator("#openingCash"),
    submit: box.getByRole("button", { name: "Открыть смену" }).last(),
  })
  await box.getByRole("button", { name: "Открыть смену" }).last().click()
  await waitToast(page, "Смена открыта.")
  await settle(page)
}

async function phaseManagerBouquets() {
  const page = await as("manager")
  await go(page, "/bouquets")
  const db = openDb()
  const existing = new Map(db.prepare("SELECT name, image_path FROM bouquet_templates").all().map((row) => [row.name, row.image_path]))
  db.close()
  for (const [index, bouquet] of STORY.bouquets.entries()) {
    const exists = existing.has(bouquet.name)
    // Первый букет снимаем всегда; уже созданный — снимаем и закрываем без сохранения.
    if (exists && index > 0) {
      if (!existing.get(bouquet.name)) await uploadBouquetPhoto(page, bouquet)
      continue
    }
    await page.getByRole("button", { name: "Новый букет" }).first().click()
    const sheet = dialog(page, "Новый букет")
    await sheet.waitFor()
    await sheet.locator("#bouquet-name").fill(bouquet.name)
    await sheet.locator("#bouquet-price").fill(String(bouquet.price))
    await sheet.locator("#bouquet-description").fill(bouquet.description)
    const search = sheet.getByPlaceholder("Найти товар по названию, коду или артикулу")
    for (const [productName, qty] of bouquet.items) {
      await pickProduct(page, search, productName)
      const row = sheet.locator("div").filter({ has: page.locator('input[name="itemQty"]') }).filter({ hasText: productName }).last()
      await row.locator('input[name="itemQty"]').fill(String(qty))
    }
    if (index === 0) {
      // Высокое окно — чтобы в кадр поместился весь состав букета.
      await page.setViewportSize({ width: 1280, height: 1200 })
      await settle(page, 500)
      await capture(page, "manager-bouquet-sheet", {
        sheet: sheet,
        form: sheet.locator("form").first(),
        save: sheet.getByRole("button", { name: "Сохранить" }),
      })
      await page.setViewportSize({ width: 1280, height: 800 })
    }
    if (exists) {
      await closeOverlays(page)
      continue
    }
    await sheet.getByRole("button", { name: "Сохранить" }).click()
    await waitToast(page, "Букет сохранен")
    await settle(page)
    await dismissToasts(page)
    await uploadBouquetPhoto(page, bouquet)
  }
  await go(page, "/bouquets")
  await capture(page, "manager-bouquets", {
    header: page.locator('[data-slot="screen-header"]'),
    new: page.getByRole("button", { name: "Новый букет" }).first(),
    table: page.locator('[data-slot="screen-body"]').first(),
  })
}

// Фото — только у сохранённого букета: открываем его на редактирование карандашом в строке.
async function uploadBouquetPhoto(page, bouquet) {
  const row = page.getByRole("row").filter({ hasText: bouquet.name }).first()
  await row.getByRole("button").first().click()
  const edit = dialog(page, "Редактировать букет")
  await edit.waitFor()
  await edit.locator("#bouquet-image").setInputFiles(path.join(ASSETS_DIR, `${bouquet.palette}.png`))
  await edit.getByRole("button", { name: "Загрузить фото" }).click()
  await waitToast(page, "Фото букета обновлено")
  await closeOverlays(page)
  await settle(page)
  await dismissToasts(page)
}

async function phaseManagerChat() {
  const page = await as("manager")
  await go(page, "/chats?tab=waiting")
  await page.getByRole("option").filter({ hasText: STORY.client.name }).first().click()
  await settle(page, 1500)
  // CSS, а не роли: открытое меню делает остальную страницу aria-hidden, и getByRole её не видит.
  const conversation = page.locator('section[aria-label="Переписка"]')
  const chatList = page.locator('aside[aria-label="Список диалогов"]')
  const composer = page.locator('textarea[aria-label="Текст сообщения"]')
  // CSS, а не роль: при открытом меню список скрыт от доступности (aria-hidden).
  const chatRows = chatList.locator('[role="option"]')
  await capture(page, "manager-chats", {
    header: page.locator('[data-slot="screen-header"]'),
    tabs: page.getByRole("tablist", { name: "Фильтр диалогов" }),
    list: chatList,
    rows: [chatRows.first(), chatRows.last()],
    bright: chatList.getByRole("option").filter({ hasText: STORY.client.name }).locator('[aria-label$="без ответа"]'),
    muted: chatList.locator('[aria-label$="после нашего ответа"]').first(),
    conversation,
    panels: conversation.getByRole("button", { name: /^Заказы/ }).locator("xpath=..").first(),
    composer,
    attach: page.getByRole("button", { name: "Прикрепить файл" }),
  })

  // Меню строки диалога.
  await page.getByRole("option").filter({ hasText: "Тимур Асанов" }).first().click({ button: "right" })
  const rowMenu = page.getByRole("menu").last()
  await rowMenu.waitFor()
  await capture(page, "manager-chat-menu", { list: chatList, rows: [chatRows.first(), chatRows.last()], menu: rowMenu })
  await closeOverlays(page)
  await page.getByRole("option").filter({ hasText: STORY.client.name }).first().click()
  await settle(page, 1000)

  // Меню фото от клиента: «В заказ как фото».
  const photo = conversation.getByRole("button", { name: "Открыть фото" }).last()
  await photo.click({ button: "right" })
  const messageMenu = page.getByRole("menu").last()
  await messageMenu.waitFor()
  await capture(page, "manager-message-menu", {
    conversation,
    menu: messageMenu,
    toOrder: messageMenu.getByRole("menuitem", { name: "В заказ как фото" }),
  })
  await messageMenu.getByRole("menuitem", { name: "В заказ как фото" }).click()
  await settle(page)
  await dismissToasts(page)

  // Быстрые ответы: «/» в начале поля.
  await composer.click()
  await composer.fill("/прив")
  const quick = page.getByRole("dialog", { name: "Быстрые ответы" })
  await quick.waitFor()
  await capture(page, "manager-quick", { conversation, panel: quick, composer })
  await page.keyboard.press("Enter")
  await page.waitForTimeout(300)
  await page.keyboard.press("Enter")
  await settle(page, 1500)

  // Окно нового быстрого ответа.
  await page.locator("[data-quick-replies-toggle]").click()
  await page.getByRole("button", { name: "Новый быстрый ответ" }).click()
  const editor = dialog(page, "Новый быстрый ответ")
  await editor.waitFor()
  await editor.locator("#quick-reply-text").fill("{имя}, спасибо за заказ! Букет будет готов к сроку, пришлём фото перед доставкой 🌷")
  await editor.locator("#quick-reply-title").fill("Спасибо за заказ")
  await capture(page, "manager-quick-edit", { dialog: editor })
  await closeOverlays(page)

  // Предложить букет из каталога.
  await page.getByRole("button", { name: "Предложить букет" }).click()
  const offer = dialog(page, "Предложить букет")
  await offer.waitFor()
  await settle(page, 800)
  await capture(page, "manager-offer", {
    dialog: offer,
    list: offer.getByRole("button", { name: "В чат" }).first().locator("xpath=ancestor::*[3]"),
    send: offer.getByRole("button", { name: "В чат" }).first(),
  })
  await offer.getByRole("button", { name: "В чат" }).first().click()
  await waitToast(page, "Букет отправлен в чат")
  await dismissToasts(page)
  await settle(page, 1200)

  // Заказ из чата.
  await conversation.getByRole("button", { name: /^Заказы/ }).click()
  // На планшетной ширине панель заказов открывается листом справа, на широком экране — колонкой.
  const panel = page.getByRole("dialog", { name: "Заказы клиента" }).or(page.locator('aside[aria-label="Заказы клиента"]')).first()
  await panel.waitFor()
  await settle(page)
  await capture(page, "manager-chat-orders", {
    panel,
    panelTop: [panel.getByText("Заказы", { exact: true }).first(), panel.getByText("Попадут в заказ или черновик при создании.")],
    create: panel.getByRole("button", { name: "Создать заказ" }),
  })
  await panel.getByRole("button", { name: "Создать заказ" }).click()
  const order = dialog(page, "Новый заказ")
  await order.waitFor()
  await pickProduct(page, order.getByPlaceholder("Найти товар или букет"), "Нежность")
  await tall(page, () =>
    capture(page, "manager-order", {
      dialog: order,
      composition: order.getByRole("region", { name: "Состав заказа" }),
      stages: order.getByRole("tablist", { name: "Этапы заказа" }),
    })
  )
  await order.getByRole("tab", { name: /Получение/ }).click()
  await order.getByRole("button", { name: "Завтра", exact: true }).click()
  await order.getByRole("button", { name: "12:00", exact: true }).click()
  await order.getByRole("button", { name: /Доставка/ }).first().click()
  await order.locator("#order-address").fill("ул. Киевская, 95, кв. 12")
  await order.locator("#order-note").fill("Открытка: «С днём рождения, мама!» Позвонить получателю за 30 минут")
  await tall(page, async () => {
    await order.getByText("Когда", { exact: true }).first().scrollIntoViewIfNeeded()
    await capture(page, "manager-order-delivery", {
      dialog: order,
      stage: order.getByRole("region", { name: "Данные заказа" }),
    })
  })
  await order.getByRole("tab", { name: /Оплата/ }).click()
  await order.locator("#order-delivery-price").fill("300")
  await order.locator("#order-prepaid").fill("2000")
  await chooseSelect(page, order.locator("#order-payment-method"), "Mbank")
  await tall(page, () =>
    capture(page, "manager-order-payment", {
      dialog: order,
      stage: order.getByRole("region", { name: "Данные заказа" }),
      create: order.locator('button[data-intent="create"]'),
    })
  )
  await order.locator('button[data-intent="create"]').click()
  await waitToast(page, "Заказ создан")
  await settle(page, 1500)
  if (!(await panel.isVisible().catch(() => false))) {
    await conversation.getByRole("button", { name: /^Заказы/ }).click()
    await panel.waitFor()
    await settle(page, 800)
  }
  await capture(page, "manager-chat-orders-done", {
    panel,
    panelTop: [panel.getByText("Заказы", { exact: true }).first(), panel.getByRole("button", { name: "Отправить состав в чат" }).first().locator("xpath=ancestor::*[2]")],
    send: panel.getByRole("button", { name: "Отправить состав в чат" }).first(),
  })
  await panel.getByRole("button", { name: "Отправить состав в чат" }).first().click()
  const preview = dialog(page, "Отправить состав в чат")
  await preview.waitFor()
  await preview.getByRole("button", { name: "Отправить", exact: true }).click()
  await waitToast(page, "Состав заказа отправлен в чат")
  await dismissToasts(page)
}

// Окно заказа высокое: снимаем в высоком окне браузера, чтобы все поля этапа были в кадре.
// Прокрутить окно/лист к началу — после ввода в нижние поля он уезжает вниз.
async function scrollTop(locator) {
  await locator.evaluate((element) => {
    element.scrollTop = 0
    element.querySelectorAll("*").forEach((node) => {
      if (node.scrollTop) node.scrollTop = 0
    })
  })
}

async function tall(page, run, height = 1360) {
  await page.setViewportSize({ width: 1280, height })
  await settle(page, 400)
  try {
    await run()
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 })
    await settle(page, 300)
  }
}

async function chooseSelect(page, trigger, optionName) {
  await trigger.click()
  await page.getByRole("option", { name: optionName, exact: true }).click()
  await page.waitForTimeout(200)
}

async function phaseFloristOrders() {
  const page = await as("florist")
  const story = latestStoryOrder()
  await go(page, "/orders")
  await page.getByRole("tab", { name: /^Новые/ }).click()
  await settle(page)
  const card = orderCard(page, story.number)
  // Карточка с фото и составом высокая — окно выше, чтобы кнопки карточки были в кадре.
  await tall(page, () =>
    capture(page, "florist-orders", {
      header: page.locator('[data-slot="screen-header"]'),
      chip: shiftChip(page),
      search: page.getByRole("searchbox", { name: "Поиск заказов" }),
      view: page.getByRole("group", { name: "Вид" }),
      tabs: page.getByRole("tablist", { name: "Вкладки раздела" }),
      statusTabs: page.getByRole("tab", { name: /^Все/ }).locator("xpath=.."),
      board: page.locator('[data-slot="screen-body"]').first(),
      card,
      work: card.getByRole("button", { name: "В работу" }),
      edit: card.getByRole("button", { name: "Изменить" }),
    }), 1500)

  // Подробности заказа.
  await card.getByRole("button", { name: new RegExp(story.number) }).click()
  const details = dialog(page)
  await details.waitFor()
  await settle(page, 800)
  await capture(page, "florist-order-details", { dialog: details })
  await closeOverlays(page)

  // Окно редактирования (без сохранения).
  await card.getByRole("button", { name: "Изменить" }).click()
  const sheet = dialog(page, /Редактировать заказ/)
  await sheet.waitFor()
  await settle(page, 600)
  // Поле даты получает фокус при открытии и подсвечивает день — снимаем фокус.
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await capture(page, "florist-edit", {
    sheet,
    photos: sheet.getByText("Фото к заказу").first().locator("xpath=ancestor::*[2]"),
    save: sheet.getByRole("button", { name: "Сохранить" }),
  })
  await closeOverlays(page)

  // В работу.
  await card.getByRole("button", { name: "В работу" }).click()
  await waitToast(page, "Заказ взят в работу")
  await page.getByRole("tab", { name: /^В работе/ }).click()
  await settle(page, 800)
  const inWork = orderCard(page, story.number)
  await tall(page, () =>
    capture(page, "florist-in-work", {
      board: page.locator('[data-slot="screen-body"]').first(),
      card: inWork,
      status: inWork.getByText("В работе", { exact: true }).first(),
      ready: inWork.getByRole("button", { name: "Букет готов" }),
    }), 1500)
  await dismissToasts(page)

  // Букет готов.
  await inWork.getByRole("button", { name: "Букет готов" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Отметить букет готовым?" })
  await confirm.waitFor()
  await capture(page, "florist-ready-confirm", { dialog: confirm, confirm: confirm.getByRole("button", { name: "Букет готов" }) })
  await confirm.getByRole("button", { name: "Букет готов" }).click()
  await waitToast(page, "Букет готов")
  await dismissToasts(page)
  await page.getByRole("tab", { name: /^Готовые/ }).click()
  await settle(page, 800)
  const readyCard = page.locator("div").filter({ has: page.getByRole("button", { name: new RegExp(story.number) }) }).filter({ hasText: "Готов" }).last()
  await capture(page, "florist-ready-done", { board: page.locator('[data-slot="screen-body"]').first(), card: readyCard })

  // Отмена — только окно подтверждения.
  await page.getByRole("tab", { name: /^Новые/ }).click()
  await settle(page, 500)
  const other = page.getByRole("button", { name: "Отменить", exact: true }).first()
  await other.click()
  const cancel = page.getByRole("alertdialog", { name: "Отменить заказ?" })
  await cancel.waitFor()
  await capture(page, "florist-cancel", { dialog: cancel, confirm: cancel.getByRole("button", { name: "Отменить заказ" }) })
  await cancel.getByRole("button", { name: "Назад" }).click()

}

// Календарь недели — отдельным этапом: заказы сюжета на следующей неделе, листаем к ним.
async function phaseFloristCalendar() {
  const page = await as("florist")
  await go(page, "/orders")
  await page.getByRole("group", { name: "Вид" }).getByRole("button", { name: "Календарь" }).click()
  await settle(page, 600)
  if (await page.getByText("На этой неделе заказов нет").isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Следующая неделя" }).click()
    await settle(page, 800)
  }
  await tall(page, () =>
    capture(page, "florist-calendar", {
      board: page.locator('[data-slot="screen-body"]').first(),
      week: page.locator('[data-slot="screen-body"]').first(),
      nav: page.getByRole("button", { name: "Предыдущая неделя" }).locator("xpath=.."),
      toolbar: page.getByRole("button", { name: "Предыдущая неделя" }).locator("xpath=../.."),
    }), 1000)
  await page.getByRole("group", { name: "Вид" }).getByRole("button", { name: "Список" }).click()
}

async function phaseFloristCash() {
  const page = await as("florist")
  await go(page, "/cash")
  const search = page.getByPlaceholder("Найти товар — название, код или артикул")
  await search.click()
  await search.fill("роза")
  const firstOption = page.getByRole("option").first()
  await firstOption.waitFor()
  await settle(page, 400)
  await capture(page, "florist-cash-search", {
    search,
    results: page.getByRole("listbox").first(),
  })
  await page.getByRole("option").filter({ hasText: "Роза 80 см" }).first().click()
  await page.waitForTimeout(300)
  for (let i = 0; i < 6; i += 1) {
    await page.getByRole("button", { name: "Увеличить количество" }).first().click()
  }
  await pickProduct(page, search, "Эвкалипт")
  await pickProduct(page, search, "Пакет S")
  await chooseSelect(page, page.locator("#salePaymentMethod"), "Наличные")
  await page.locator("#sale-received").fill("3000")
  // Снимаем фокус без Tab — иначе в кадре рамка фокуса на соседней кнопке.
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await settle(page, 400)
  const panels = page.locator('[data-slot="screen-body"], main').first()
  await capture(page, "florist-cash", {
    cart: page.getByText("Корзина", { exact: true }).first().locator("xpath=ancestor::*[2]"),
    payment: page.getByText("Способ оплаты", { exact: true }).first().locator("xpath=ancestor::*[3]"),
    extras: page.getByRole("button", { name: "Клиент", exact: true }).locator("xpath=.."),
    submit: page.getByRole("button", { name: "Провести продажу" }),
    body: panels,
  })
  await page.getByRole("button", { name: "Провести продажу" }).click()
  await waitToast(page, "Продажа проведена.")
  await dismissToasts(page)

  // Черновик заказа от флориста.
  await go(page, "/cash?order=new")
  const order = dialog(page, "Новый заказ")
  await order.waitFor()
  await pickProduct(page, order.getByPlaceholder("Найти товар или букет"), "Классика: 15 роз")
  await order.locator("#order-customer").fill("Марат Орозов")
  await order.locator("#order-phone").fill("+996 555 300 118")
  await tall(page, () =>
    capture(page, "florist-draft", {
      dialog: order,
      composition: order.getByRole("region", { name: "Состав заказа" }),
      stages: order.getByRole("tablist", { name: "Этапы заказа" }),
      draftButton: order.locator('button[data-intent="draft"]'),
    })
  )
  await order.getByRole("tab", { name: /Получение/ }).click()
  await order.getByRole("button", { name: "Послезавтра", exact: true }).click()
  await order.getByRole("button", { name: "18:00", exact: true }).click()
  await order.locator("#order-note").fill("Клиент заберёт сам, позвонит за час")
  await tall(page, async () => {
    await order.getByText("Когда", { exact: true }).first().scrollIntoViewIfNeeded()
    await capture(page, "florist-draft-delivery", {
      dialog: order,
      stage: order.getByRole("region", { name: "Данные заказа" }),
    })
  })
  await order.locator('button[data-intent="draft"]').click()
  await waitToast(page, "Черновик сохранён")
  await dismissToasts(page)
}

async function phaseFloristPhone() {
  const context = await newRoleContext(browser, { phone: true })
  const page = await context.newPage()
  await login(page, LOGINS.florist)
  await go(page, "/orders")
  await settle(page, 800)
  await capture(page, "florist-phone", {
    dock: page.getByRole("navigation", { name: "Разделы" }),
    filters: page.getByRole("button", { name: "Фильтры и действия" }),
  })
  await context.close()
}

async function phaseManagerWork() {
  const page = await as("manager")

  // Черновики: отправить в работу.
  await go(page, "/orders/drafts")
  const draft = page.locator("div").filter({ hasText: "Марат Орозов" }).filter({ has: page.getByRole("button", { name: "Отправить в работу" }) }).last()
  await capture(page, "manager-drafts", {
    board: page.locator('[data-slot="screen-body"]').first(),
    card: draft,
    edit: draft.getByRole("button", { name: "Изменить" }),
    send: draft.getByRole("button", { name: "Отправить в работу" }),
  })
  await draft.getByRole("button", { name: "Отправить в работу" }).click()
  const prices = page.getByRole("alertdialog", { name: "Цены изменились" })
  if (await prices.isVisible().catch(() => false)) {
    await prices.getByRole("button", { name: "Оставить цены черновика" }).click()
  }
  await waitToast(page, "Черновик отправлен флористам")
  await dismissToasts(page)

  // Самовывоз для «Готовых»: флорист отмечает черновик готовым.
  const florist = await as("florist")
  await go(florist, "/orders")
  const marat = florist.locator("div").filter({ hasText: "Марат Орозов" }).filter({ has: florist.getByRole("button", { name: "Букет готов" }) }).last()
  await marat.getByRole("button", { name: "Букет готов" }).click()
  await florist.getByRole("alertdialog").getByRole("button", { name: "Букет готов" }).click()
  await waitToast(florist, "Букет готов")

  // Готовые заказы.
  await go(page, "/ready-orders")
  await settle(page, 800)
  const pickup = page.locator("div").filter({ hasText: "Марат Орозов" }).filter({ has: page.getByRole("button", { name: "Выдать клиенту" }) }).last()
  const delivery = page.locator("div").filter({ hasText: STORY.client.name }).filter({ has: page.getByRole("button", { name: "Передать курьеру" }) }).last()
  await tall(page, () =>
    capture(page, "manager-ready", {
      board: page.locator('[data-slot="screen-body"]').first(),
      cards: [delivery, pickup],
      card: pickup,
      pickup: pickup.getByRole("button", { name: "Выдать клиенту" }).locator("xpath=ancestor::*[2]"),
    }), 1500)
  await delivery.getByRole("button", { name: "Передать курьеру" }).click()
  const courier = dialog(page, "Передача курьеру")
  await courier.waitFor()
  await courier.locator("#courierName").fill("Бакыт")
  const payCourier = courier.getByText(/Выдать курьеру из кассы/).first()
  if (await payCourier.isVisible().catch(() => false)) await payCourier.click()
  await capture(page, "manager-courier", { sheet: courier, form: courier.locator("form").first() })
  await courier.getByRole("button", { name: "Передать курьеру" }).last().click()
  await waitToast(page, "Заказ передан курьеру")
  await dismissToasts(page)
  await pickup.getByRole("button", { name: "Выдать клиенту" }).click()
  await waitToast(page, "Заказ закрыт")
  await dismissToasts(page)

  // Касса за смену и изъятие.
  await go(page, "/cash")
  await page.getByRole("button", { name: "Касса за смену" }).click()
  const cashSheet = dialog(page, "Касса за смену")
  await cashSheet.waitFor()
  await settle(page, 800)
  const cashSummary = cashSheet.getByText("Ожидается в кассе", { exact: true }).first().locator("xpath=ancestor::*[2]")
  await capture(page, "manager-cash-sheet", {
    sheet: cashSheet,
    summary: cashSummary,
    ops: [cashSheet.getByRole("button", { name: "Внесение наличных" }), cashSummary],
  })
  await cashSheet.getByRole("button", { name: "Изъятие наличных" }).click()
  const op = dialog(page, "Изъятие наличных")
  await op.waitFor()
  await op.locator("#cash-operation-amount").fill("1500")
  await op.locator("#cash-operation-comment").fill("Инкассация")
  await capture(page, "manager-cash-op", { dialog: op, form: op.locator("form").first() })
  await closeOverlays(page)

  // Возврат: только окна, без проведения.
  await go(page, "/cash")
  await page.getByRole("button", { name: "Оформить возврат" }).click()
  const refund = dialog(page, "Оформить возврат")
  await refund.waitFor()
  await settle(page, 1200)
  const firstReturn = refund.getByRole("button", { name: "Вернуть" }).first()
  await capture(page, "manager-refund", { sheet: refund, result: firstReturn.locator("xpath=ancestor::*[3]") })
  await firstReturn.click()
  const confirm = page.getByRole("alertdialog")
  await confirm.waitFor()
  await confirm.getByRole("button", { name: "Клиент передумал" }).click().catch(() => undefined)
  await capture(page, "manager-refund-confirm", { dialog: confirm, reason: confirm.getByText(/Причина/).first().locator("xpath=ancestor::*[2]") })
  await confirm.getByRole("button", { name: "Назад" }).click()
  await closeOverlays(page)

  // История кассы.
  await go(page, "/history")
  await capture(page, "manager-history", { body: page.locator('[data-slot="screen-body"]').first(), table: page.locator("table").first() })
  const saleRow = page.getByRole("row").filter({ hasText: "Продажа" }).first()
  await saleRow.click()
  await settle(page, 500)
  const action = page.getByRole("button", { name: /Сторнировать и вернуть/ }).first()
  // Таблица шире окна планшета — снимаем в широком окне, чтобы кнопка была видна без прокрутки.
  await page.setViewportSize({ width: 1680, height: 900 })
  await settle(page, 600)
  await capture(page, "manager-history-open", { row: action.locator("xpath=ancestor::td[1]"), action })
  await page.setViewportSize({ width: 1280, height: 800 })

  // Клиенты.
  await go(page, "/clients")
  await capture(page, "manager-clients", { body: page.locator('[data-slot="screen-body"]').first(), table: page.locator('[data-slot="screen-body"]').first() })
  await page.getByRole("searchbox", { name: "Поиск клиентов" }).fill("Айгерим Садыкова")
  await settle(page, 1200)
  await page.getByRole("link").filter({ hasText: STORY.client.name }).first().click()
  await page.waitForURL(/\/clients\/\d+/)
  await settle(page, 800)
  const clientUrl = page.url()

  // Важные даты: демо-даты других клиентов + день рождения клиентки сюжета через окно в карточке.
  const db = openDb()
  seedDates(db)
  db.close()
  const dates = page.locator('[data-slot="customer-dates"]')
  const birthday = shopDayFromToday(4)
  const anniversary = shopDayFromToday(47)
  const monthName = (month) => ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"][month - 1]
  async function addDate({ title, day, month, year, note }, shotId) {
    await dates.getByRole("button", { name: "Добавить" }).click()
    const box = dialog(page, "Новая важная дата")
    await box.waitFor()
    const preset = box.getByRole("button", { name: title, exact: true })
    if (await preset.isVisible().catch(() => false)) await preset.click()
    else await box.locator("#customer-date-title").fill(title)
    await chooseSelect(page, box.locator("#customer-date-month"), monthName(month))
    await chooseSelect(page, box.locator("#customer-date-day"), String(day))
    if (year) await box.locator("#customer-date-year").fill(String(year))
    if (note) await box.locator("#customer-date-note").fill(note)
    if (shotId) {
      await capture(page, shotId, {
        dialog: box,
        title: [box.locator("#customer-date-title"), box.locator('[data-slot="customer-date-presets"]')],
        when: box.locator('[data-slot="customer-date-when"]'),
        note: box.locator("#customer-date-note"),
      })
    }
    await box.getByRole("button", { name: "Добавить", exact: true }).click()
    await waitToast(page, "Дата добавлена")
    await dismissToasts(page)
    await settle(page, 600)
  }
  await addDate({ title: "День рождения", ...birthday, year: 1994, note: "Любит пионы и нежные тона" }, "manager-date-dialog")
  await addDate({ title: "Годовщина свадьбы", ...anniversary, year: 2019, note: "Муж — Тимур, заказывает сюрприз" })

  await capture(page, "manager-client", { body: page.locator("main, [data-slot='screen-body']").first(), tiles: page.getByText("Всего оплачено").first().locator("xpath=ancestor::*[3]") })
  // Карточка с блоком дат выше окна планшета — снимаем в высоком окне.
  await tall(page, () =>
    capture(page, "manager-dates-card", {
      card: page.locator('[data-slot="card"]').filter({ has: dates }).first(),
      dates,
      add: dates.getByRole("button", { name: "Добавить" }),
    }), 1000)

  // «Клиенты → Даты»: кого поздравить.
  await go(page, "/clients?view=dates")
  await settle(page, 800)
  await capture(page, "manager-dates-list", {
    body: page.locator('[data-slot="screen-body"]').first(),
    tabs: page.getByRole("tablist", { name: "Раздел клиентов" }),
    filter: page.getByRole("button", { name: /^Период/ }),
    chat: page.getByRole("link", { name: "Написать в чат" }).first(),
  })

  // Тот же блок в панели «Контакт» чата.
  const customerId = clientUrl.match(/\/clients\/(\d+)/)[1]
  await go(page, `/chats?customer=${customerId}`)
  await settle(page, 1200)
  const contactToggle = page.getByRole("button", { name: "Контакт", exact: true }).first()
  if ((await contactToggle.getAttribute("aria-pressed")) !== "true") await contactToggle.click()
  const contact = page.getByRole("dialog", { name: "Контакт" }).or(page.locator('aside[aria-label="Контакт"]')).first()
  await contact.waitFor()
  await settle(page, 1200)
  await capture(page, "manager-chat-dates", { panel: contact, dates: contact.locator('[data-slot="customer-dates"]') })
  await closeOverlays(page)
}

async function phaseFloristClose() {
  const page = await as("florist")
  await go(page, "/orders")
  await shiftChip(page).click()
  await popover(page).waitFor()
  await capture(page, "florist-shift-open", { chip: shiftChip(page), popover: popover(page), close: popover(page).getByRole("button", { name: "Закрыть смену" }) })
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  const box = await closeShiftFromChip(page, { confirm: false })
  await settle(page, 400)
  await capture(page, "florist-close-dialog", {
    dialog: box,
    cash: page.locator("#closingCash"),
    submit: box.getByRole("button", { name: "Закрыть смену" }).last(),
  })
  await box.getByRole("button", { name: "Закрыть смену" }).last().click()
  const alert = page.getByRole("alertdialog")
  await alert.waitFor()
  await capture(page, "florist-close-confirm", { dialog: alert, confirm: alert.getByRole("button", { name: "Закрыть смену" }) })
  await alert.getByRole("button", { name: "Закрыть смену" }).click()
  await waitToast(page, "Смена закрыта.")
}

async function phaseManagerClose() {
  const page = await as("manager")
  await go(page, "/cash")
  // Менеджер открывает свою дневную смену, чтобы показать закрытие с ночной сменой флориста.
  await shiftChip(page).click()
  await popover(page).getByRole("button", { name: "Открыть смену" }).click()
  const open = dialog(page, "Открыть смену")
  await open.waitFor()
  await open.getByRole("button", { name: "Открыть смену" }).last().click()
  await waitToast(page, "Смена открыта.")
  await dismissToasts(page)
  await settle(page)
  await page.setViewportSize({ width: 1280, height: 1500 })
  const box = await closeShiftFromChip(page, { confirm: false })
  await box.getByText("Открыть ночную смену для флориста").first().click()
  await chooseSelect(page, box.locator("#nightFloristId"), "Жибек")
  await settle(page, 300)
  await capture(page, "manager-close", {
    dialog: box,
    cash: box.locator("#closingCash"),
    night: box.getByText("Открыть ночную смену для флориста").first().locator("xpath=ancestor::*[3]"),
    submit: box.getByRole("button", { name: "Закрыть смену" }).last(),
  })
  await closeOverlays(page)
  await page.setViewportSize({ width: 1280, height: 800 })
}

async function phaseAdmin() {
  const page = await as("admin")
  const db = openDb()
  const supplier = db.prepare(
    "SELECT s.id FROM suppliers s JOIN stock_documents d ON d.supplier_id = s.id WHERE d.type='stock_in' AND d.status='posted' GROUP BY s.id ORDER BY SUM(d.goods_total - d.paid_amount) DESC LIMIT 1"
  ).get()
  const shift = db.prepare("SELECT id FROM shifts WHERE status='closed' ORDER BY id DESC LIMIT 1").get()
  db.close()

  // Дашборд — высокое окно, чтобы поместились все карточки, включая «Ближайшие даты» и «Заказы».
  await page.setViewportSize({ width: 1280, height: 2350 })
  await go(page, "/dashboard")
  await settle(page, 1200)
  const statCard = (text) => page.locator('div[class*="group/stat"]').filter({ hasText: text }).last()
  await capture(page, "admin-dashboard", {
    top: page.locator('[data-slot="screen-header"]'),
    period: page.locator('[data-slot="screen-header"] [data-slot="popover-trigger"]'),
    cards: [statCard("Выручка за сегодня"), statCard("Разбивка по оплатам")],
    revenue: statCard("Выручка за сегодня"),
    shift: statCard("Касса ожидается"),
    stock: statCard("Открыть склад"),
    payments: statCard("Разбивка по оплатам"),
    orders: statCard("Ждут ответа"),
    dates: statCard("Ближайшие даты"),
  })
  await page.setViewportSize({ width: 1280, height: 800 })

  // Склад и приход.
  await go(page, "/stock")
  await capture(page, "admin-stock", {
    header: page.locator('[data-slot="screen-header"]'),
    stockIn: page.locator('[data-slot="screen-header"]').getByRole("link", { name: "Пополнить" }),
    stockOut: page.locator('[data-slot="screen-header"]').getByRole("link", { name: "Списать" }),
    table: page.locator('[data-slot="screen-body"]').first(),
    edit: page.getByRole("button", { name: "Редактировать" }).first(),
  })
  await go(page, "/stock?new=stock_in")
  const act = dialog(page, "Акт пополнения")
  await act.waitFor()
  const picker = act.getByPlaceholder("Найти товар и добавить в акт")
  for (const [name, qty, price] of [["Роза 80 см", 50, 130], ["Эустома", 30, 80], ["Эвкалипт", 20, 75]]) {
    await pickProduct(page, picker, name)
    const row = act.getByRole("row").filter({ hasText: name }).first()
    await row.locator('input[name="itemQty"]').fill(String(qty))
    await row.locator('input[type="number"]').nth(2).fill(String(price))
  }
  await chooseSelect(page, act.locator("#stock-document-supplier"), "Голландия · прямые поставки")
  await act.locator("#stock-document-paid").fill("5000")
  await act.locator("#stock-document-comment").fill("Поставка из Голландии")
  await tall(page, async () => {
    await scrollTop(act)
    const info = act.getByText("Основная информация").first().locator("xpath=ancestor::*[2]")
    await capture(page, "admin-stock-in", {
      sheet: act,
      picker,
      items: act.locator("table").first(),
      top: [picker, act.locator("table").first()],
      info,
      middle: [info, act.getByText("Накладные расходы").first().locator("xpath=ancestor::*[2]")],
      post: act.getByRole("button", { name: "Провести акт" }),
      footer: act.getByRole("button", { name: "Провести акт" }).locator("xpath=.."),
    })
  }, 1100)
  await act.getByRole("button", { name: "Провести акт" }).click()
  await waitToast(page, "Акт пополнения проведен")
  await dismissToasts(page)

  await go(page, "/stock?new=stock_out")
  const out = dialog(page, "Акт списания")
  await out.waitFor()
  await pickProduct(page, out.getByPlaceholder("Найти товар и добавить в акт"), "Эустома")
  await out.getByRole("row").filter({ hasText: "Эустома" }).first().locator('input[name="itemQty"]').fill("4")
  await out.locator("#stock-document-comment").fill("Порча")
  await tall(page, async () => {
    await scrollTop(out)
    await capture(page, "admin-stock-out", {
      sheet: out,
      items: out.locator("table").first(),
      top: [out.getByPlaceholder("Найти товар и добавить в акт"), out.locator("table").first()],
      reason: out.locator("#stock-document-comment"),
      middle: out.getByText("Основная информация").first().locator("xpath=ancestor::*[2]"),
      post: out.getByRole("button", { name: "Провести акт" }),
      footer: out.getByRole("button", { name: "Провести акт" }).locator("xpath=.."),
    })
  }, 900)
  await out.getByRole("button", { name: "Провести акт" }).click()
  await waitToast(page, "Акт списания проведен")
  await dismissToasts(page)

  // Акты и корректировка.
  await go(page, "/stock/acts")
  await capture(page, "admin-acts", {
    table: page.locator('[data-slot="screen-body"]').first(),
    row: page.getByRole("row").filter({ hasText: "IN-" }).first(),
  })
  const lastIn = openDb().prepare("SELECT id FROM stock_documents WHERE type='stock_in' AND status='posted' ORDER BY id DESC LIMIT 1").get()
  await go(page, `/stock/acts/${lastIn.id}`)
  await capture(page, "admin-act", { top: page.getByRole("button", { name: "Редактировать акт" }).locator("xpath=ancestor::*[4]"), correct: page.getByRole("button", { name: "Редактировать акт" }) })

  // Поставщик и оплата.
  if (supplier) {
    await go(page, `/suppliers/${supplier.id}`)
    await settle(page, 800)
    await capture(page, "admin-supplier", {
      header: page.locator('[data-slot="screen-header"]'),
      top: [page.locator('[data-slot="screen-header"]'), page.getByText("Долг", { exact: true }).first().locator("xpath=ancestor::*[2]")],
      tiles: [
        page.getByText("Закуплено всего", { exact: true }).first().locator("xpath=ancestor::*[2]"),
        page.getByText("Долг", { exact: true }).first().locator("xpath=ancestor::*[2]"),
      ],
      pay: page.getByRole("button", { name: /Погасить долг/ }).first(),
    })
    await page.getByRole("button", { name: /Погасить долг/ }).first().click()
    const pay = dialog(page, "Оплата поставщику")
    await pay.waitFor()
    await settle(page, 400)
    await capture(page, "admin-supplier-pay", {
      dialog: pay,
      form: pay.locator("form").first(),
      submit: pay.getByRole("button", { name: /^Оплатить/ }),
    })
    await closeOverlays(page)
  }

  // Смены.
  await go(page, "/shifts")
  await capture(page, "admin-shifts", {
    table: page.locator('[data-slot="screen-body"]').first(),
    diff: page.getByText(/Совпало|Недостача|Излишек/).first(),
  })
  if (shift) {
    await go(page, `/shifts/${shift.id}`)
    await settle(page, 800)
    await capture(page, "admin-shift", {
      top: page.getByText("Ожидается в кассе").first().locator("xpath=ancestor::*[4]"),
      recon: page.getByText("Ожидается в кассе").first().locator("xpath=ancestor::*[3]"),
      formula: page.getByText("Наличные в кассе").first().locator("xpath=ancestor::*[3]"),
      cards: page.getByText("Наличные в кассе").first().locator("xpath=ancestor::*[4]"),
    })
  }

  // Аналитика.
  await go(page, "/analytics")
  await settle(page, 1200)
  await capture(page, "admin-analytics", {
    header: page.locator('[data-slot="screen-header"]'),
    period: page.getByRole("button", { name: /^Период:/ }),
    tabs: page.getByRole("tablist", { name: "Разделы аналитики" }),
    body: page.locator('[data-slot="screen-body"]').first(),
    tiles: [
      page.locator('[data-slot="screen-body"]').getByText("Выручка", { exact: true }).first().locator("xpath=ancestor::*[2]"),
      page.locator('[data-slot="screen-body"]').getByText("Списания", { exact: true }).first().locator("xpath=ancestor::*[2]"),
    ],
  })
  await go(page, "/analytics?tab=operations")
  await settle(page, 1000)
  await capture(page, "admin-operations", { body: page.locator('[data-slot="screen-body"]').first(), table: page.locator("table").first() })
  await go(page, "/stock/products/00138")
  await settle(page, 1200)
  await capture(page, "admin-product-card", {
    body: page.locator('[data-slot="screen-body"]').first(),
    passport: page.getByText("Себестоимость").first().locator("xpath=ancestor::*[4]"),
  })

}

async function phaseAdminInventory() {
  const page = await as("admin")
  await go(page, "/stock/inventory")
  await page.getByRole("button", { name: "Новая инвентаризация" }).click()
  const inv = dialog(page, "Новая инвентаризация")
  await inv.waitFor()
  await inv.locator("select").first().selectOption({ label: "По категориям" }).catch(() => undefined)
  await settle(page, 400)
  const zelen = inv.getByText(/^Зелень/).first()
  if (await zelen.isVisible().catch(() => false)) await zelen.click()
  await inv.locator("#inventory-comment").fill("Пересчёт зелени")
  await capture(page, "admin-inventory-new", { dialog: inv })
  await inv.getByRole("button", { name: "Начать пересчёт" }).click()
  await page.waitForURL(/\/stock\/inventory\/\d+/, { timeout: 60_000 })
  await settle(page, 1200)
  const factInputs = page.locator("tbody").getByRole("textbox")
  const count = Math.min(await factInputs.count(), 4)
  for (let i = 0; i < count; i += 1) {
    const matchButton = page.locator("tbody tr").nth(i).getByRole("button", { name: "совпало" })
    if (i === 1) await factInputs.nth(i).fill("7")
    else if (await matchButton.isEnabled().catch(() => false)) await matchButton.click()
    else await factInputs.nth(i).fill("0")
  }
  await settle(page, 2500)
  const rows = page.locator("tbody tr")
  await capture(page, "admin-inventory", {
    top: page.getByText(/^Инвентаризация INV-/).first().locator("xpath=ancestor::*[3]"),
    table: page.locator("table").first(),
    rows: [rows.nth(0), rows.nth(3)],
  })
  const post = page.getByRole("button", { name: /Провести/ })
  await post.scrollIntoViewIfNeeded()
  await settle(page, 400)
  await capture(page, "admin-inventory-post", {
    post,
    actions: [page.getByRole("button", { name: "Сохранить" }).first(), page.getByRole("button", { name: "Отменить" }).last()],
  })

}

async function phaseAdminSetup() {
  const page = await as("admin")
  // Товар: цены и фото.
  await go(page, "/stock?edit=00021")
  const product = dialog(page, "Редактировать товар")
  await product.waitFor()
  await tall(page, () =>
    capture(page, "admin-product-sheet", {
      sheet: product,
      prices: [product.getByText("Закупка", { exact: true }).first(), product.locator("#salePrice")],
      photo: product.getByText("Фото товара").first().locator("xpath=.."),
      save: product.getByRole("button", { name: "Сохранить" }),
    }), 1200)
  await closeOverlays(page)

  // Пользователи.
  await go(page, "/users")
  await capture(page, "admin-users", {
    header: page.locator('[data-slot="screen-header"]'),
    add: page.getByRole("button", { name: "Добавить" }).first(),
    table: page.locator('[data-slot="screen-body"]').first(),
    row: page.getByRole("row").filter({ hasText: "Жибек" }).first(),
  })
  await page.getByRole("button", { name: "Добавить" }).first().click()
  const user = dialog(page, "Новый пользователь")
  await user.waitFor()
  await user.locator("#user-name").fill("Алина")
  await user.locator("#user-login").fill("alina")
  await chooseSelect(page, user.locator("#user-role"), "Флорист")
  await user.locator("#user-password").fill("flowers24")
  await capture(page, "admin-user-sheet", { sheet: user, form: user.locator("form").first() })
  await closeOverlays(page)

  // Настройки.
  await go(page, "/settings")
  await page.getByRole("tab", { name: "Заказы" }).click()
  await settle(page, 500)
  await tall(page, () =>
    capture(page, "admin-settings", {
      body: page.locator("main, [data-slot='screen-body']").first(),
      stock: page.locator('[data-slot="card"]').filter({ hasText: "Склад: себестоимость и партии" }).first(),
    }), 1000)
  await page.getByRole("tab", { name: "Wazzup" }).click()
  await settle(page, 500)
  await capture(page, "admin-settings-wazzup", {
    body: page.locator("main, [data-slot='screen-body']").first(),
    status: page.locator('[data-slot="card"]').filter({ hasText: "Статус подключения" }).first(),
  })
  void BASE
}
