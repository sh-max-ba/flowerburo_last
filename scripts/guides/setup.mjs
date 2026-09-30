// Подготовка демо-сцены перед съёмкой: быстрые ответы, демо-переписка через вебхук, фото-примеры.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"

import { writeBouquetPng } from "./demo-images.mjs"
import { inbound, ROOT } from "./lib.mjs"

// Иллюстрации букетов для загрузки через интерфейс — во временной папке, в репозиторий не попадают.
export const ASSETS_DIR = path.join(os.tmpdir(), "flowerburo-guides-assets")
export const STORY = {
  // Главный сюжет: клиентка пишет в WhatsApp → менеджер оформляет заказ → флорист собирает → выдача.
  client: { name: "Айгерим Садыкова", chatId: "996555200101" },
  bouquets: [
    { name: "Нежность", price: 4900, palette: "tender", description: "Розы, эустома и эвкалипт в пастельных тонах.", items: [["Роза микс 40-70см", 9], ["Эустома", 5], ["Эвкалипт", 3], ["Пакет S", 1]] },
    { name: "Солнечный день", price: 3900, palette: "sunny", description: "Яркий букет из 11 роз с зеленью.", items: [["Роза микс 40-70см", 11], ["Эвкалипт", 2], ["Пакет S", 1]] },
    { name: "Классика: 15 роз", price: 5200, palette: "classic", description: "Высокие красные розы 80 см в крафте.", items: [["Роза 80 см", 15], ["Пакет S", 1]] },
  ],
}

export function openDb() {
  const db = new Database(path.join(ROOT, "app.db"))
  db.pragma("busy_timeout = 5000")
  return db
}

export async function prepareAssets() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true })
  for (const bouquet of STORY.bouquets) {
    await writeBouquetPng(bouquet.palette, path.join(ASSETS_DIR, `${bouquet.palette}.png`))
  }
  // «Фото от клиента» в переписке: лежит в public/uploads/chat песочницы (не коммитится).
  await writeBouquetPng("tender", path.join(ROOT, "public", "uploads", "chat", "demo-client-example.png"), 700)
}

export function seedQuickReplies(db) {
  const exists = db.prepare("SELECT count(*) AS n FROM quick_replies").get().n
  if (exists) return
  const insert = db.prepare(
    "INSERT INTO quick_replies (title, text, usage_count, created_by_user_id, created_by_name) VALUES (?, ?, ?, 2, 'Асель')"
  )
  insert.run("Приветствие", "Здравствуйте, {имя}! Меня зовут Асель, я менеджер FlowerBuro 🌷 Чем могу помочь?", 12)
  insert.run("Доставка", "Доставка по городу — 300 сом, привезём к удобному времени. Подскажите, пожалуйста, адрес и время?", 8)
  insert.run("Реквизиты", "Оплатить можно переводом на Mbank по номеру +996 555 000 000 или наличными при получении.", 6)
  insert.run("Букет готов", "{имя}, ваш букет готов! Отправляю фото 💐", 4)
  db.prepare("UPDATE bouquet_templates SET name = 'Букет из архива' WHERE is_active = 0").run()
  // Заказы из копии базы — на пару дней позже, чтобы в «Завтра» первым стоял заказ из сюжета.
  db.prepare(
    `UPDATE orders SET due_at = strftime('%Y-%m-%dT%H:%M', due_at, '+2 days')
     WHERE status IN ('Новый', 'В работе', 'Готов') AND due_at IS NOT NULL AND due_at <> ''`
  ).run()
}

// Демо-переписка — в хронологическом порядке, как пришла бы от Wazzup.
export async function seedChats() {
  const m = (minutes) => minutes
  await inbound({ chatId: "996555200106", name: "Екатерина Смирнова", text: "Добрый день! Можно букет из белых роз на пятницу?", minutesAgo: m(4320) })
  await inbound({ chatId: "996555200106", name: "Екатерина Смирнова", text: "Конечно! Оформили заказ на пятницу, 14:00 🌷", minutesAgo: m(4300), isEcho: true, authorName: "Phone" })
  await inbound({ chatId: "996555200106", name: "Екатерина Смирнова", text: "Спасибо!", minutesAgo: m(4290) })
  await inbound({ chatId: "996555200106", name: "Екатерина Смирнова", text: "Хорошего дня!", minutesAgo: m(4280), isEcho: true, authorName: "Phone" })

  await inbound({ chatId: "996555200104", name: "Мадина К.", text: "Сколько стоят 9 красных роз?", minutesAgo: m(1500) })
  await inbound({ chatId: "996555200104", name: "Мадина К.", text: "9 роз 80 см — 2 610 сом, с упаковкой 2 710 сом.", minutesAgo: m(1480), isEcho: true, authorName: "Phone" })
  await inbound({ chatId: "996555200104", name: "Мадина К.", text: "А если 15 роз?", minutesAgo: m(95) })

  await inbound({ chatId: "996555200103", name: "Дарья", text: "Букет получили, очень красиво! Спасибо 😍", minutesAgo: m(300) })
  await inbound({ chatId: "996555200103", name: "Дарья", text: "Рады, что понравилось! Ждём вас снова 🌸", minutesAgo: m(290), isEcho: true, authorName: "Phone" })

  await inbound({ chatId: "flower.lover.kg", chatType: "instagram", name: "flower.lover.kg", text: "Сколько стоит букет из 25 роз?", minutesAgo: m(64) })

  await inbound({ chatId: "996555200102", name: "Тимур Асанов", text: "Добрый вечер! Букет для мамы готов? Во сколько привезёте?", minutesAgo: m(26) })

  await inbound({ chatId: STORY.client.chatId, name: STORY.client.name, text: "Здравствуйте! Хочу заказать букет на завтра к 12:00 с доставкой 🌷", minutesAgo: m(9) })
  await inboundImage({ chatId: STORY.client.chatId, name: STORY.client.name, minutesAgo: m(8) })
  await inbound({ chatId: STORY.client.chatId, name: STORY.client.name, text: "Примерно такой, в нежных тонах. Бюджет около 5000 сом", minutesAgo: m(8) })

  await inbound({ chatId: "996555200107", name: "Нурлан", text: "Можно самовывоз сегодня в 19:00?", minutesAgo: m(4) })
}

async function inboundImage({ chatId, name, minutesAgo }) {
  const { BASE } = await import("./lib.mjs")
  const crypto = await import("node:crypto")
  const payload = {
    messages: [
      {
        messageId: crypto.randomUUID(),
        channelId: "demo-whatsapp-channel",
        chatType: "whatsapp",
        chatId,
        dateTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
        type: "image",
        status: "inbound",
        contentUri: `${BASE}/uploads/chat/demo-client-example.png`,
        contact: { name, phone: chatId },
      },
    ],
  }
  const response = await fetch(`${BASE}/api/wazzup/webhook?key=sandbox-crm-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`webhook image ${response.status}`)
}

// Важные даты демо-клиентов — от сегодняшнего дня магазина, чтобы «сегодня», «завтра» и «через N дней»
// были в кадре. Клиентка сюжета получает свои даты через интерфейс (съёмка окна «Новая важная дата»).
export function seedDates(db) {
  if (db.prepare("SELECT count(*) AS n FROM customer_dates").get().n) return
  const plan = [
    { offset: 0, title: "Годовщина свадьбы", year: 2016, note: "Муж заказывает каждый год — 25 красных роз" },
    { offset: 1, title: "ДР жены", year: 1992, note: "Жена Алия, любит пионы" },
    { offset: 3, title: "День рождения", year: 1988, note: "" },
    { offset: 6, title: "ДР мамы", year: null, note: "Мама — Галина, хризантемы" },
    { offset: 12, title: "День рождения", year: 1995, note: "Любит тюльпаны" },
    { offset: 19, title: "Годовщина свадьбы", year: 2021, note: "" },
    { offset: 27, title: "День рождения", year: null, note: "" },
  ]
  // Сначала клиенты из демо-переписки (у них есть чат — в строке будет «Написать в чат»), потом с заказами.
  const customers = db
    .prepare(
      `SELECT c.id FROM customers c
       WHERE COALESCE(c.phone, '') <> '' AND c.name <> ?
       ORDER BY EXISTS (SELECT 1 FROM chats WHERE chats.customer_id = c.id) DESC,
         (SELECT count(*) FROM orders o WHERE o.customer_id = c.id) DESC, c.id
       LIMIT ?`
    )
    .all(STORY.client.name, plan.length)
  const insert = db.prepare(
    "INSERT INTO customer_dates (customer_id, title, month, day, year, note) VALUES (?, ?, ?, ?, ?, ?)"
  )
  plan.forEach((item, index) => {
    const customer = customers[index]
    if (!customer) return
    const { month, day } = shopDayFromToday(item.offset)
    insert.run(customer.id, item.title, month, day, item.year, item.note)
  })
}

// День и месяц через `offset` дней от сегодняшнего дня магазина (Бишкек).
export function shopDayFromToday(offset) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date())
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + offset))
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}
