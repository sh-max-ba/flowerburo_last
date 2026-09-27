// Готовит КОПИЮ базы для съёмки экранов раздела «Руководства»: убирает персональные данные
// (клиенты, телефоны, адреса, переписка, комментарии с именами), переименовывает сотрудников и
// поставщиков, ставит всем пользователям известный пароль, отключает реальный ключ Wazzup.
// Каталог, остатки и суммы остаются — экраны выглядят живыми.
//
//   sqlite3 app.db "VACUUM INTO '/path/to/sandbox/app.db'"
//   node scripts/guides/make-demo-db.mjs /path/to/sandbox/app.db --yes-this-is-a-copy
//
// НИКОГДА не запускать на рабочей базе магазина.
import path from "node:path"
import Database from "better-sqlite3"
import bcrypt from "bcryptjs"

const [, , dbArg, confirm] = process.argv
if (!dbArg || confirm !== "--yes-this-is-a-copy") {
  console.error("Usage: node scripts/guides/make-demo-db.mjs <copy.db> --yes-this-is-a-copy")
  process.exit(1)
}
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run with NODE_ENV=production")
  process.exit(1)
}

export const DEMO_PASSWORD = "demo2026"

const db = new Database(path.resolve(dbArg))
db.pragma("foreign_keys = OFF")

// Детерминированный генератор — повторный запуск даёт те же имена.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (random, list) => list[Math.floor(random() * list.length)]

const FEMALE = ["Айгерим", "Асель", "Нурай", "Бегимай", "Айдана", "Динара", "Эльмира", "Алина", "Мария", "Анна", "Екатерина", "Ольга", "Светлана", "Елена", "Юлия", "Камила", "Мадина", "Айжан", "Гульнара", "Алтынай", "Назира", "Салтанат", "Айпери", "Томирис", "Виктория", "Дарья", "Ксения", "Полина"]
const MALE = ["Азамат", "Бакыт", "Эрлан", "Нурлан", "Тимур", "Руслан", "Данияр", "Максим", "Артём", "Дмитрий", "Сергей", "Алексей", "Бекзат", "Улан", "Мирлан", "Чынгыз", "Марат", "Адилет", "Эмиль", "Санжар"]
const SURNAMES = ["Иванов", "Садыков", "Осмонов", "Токтогулов", "Смирнов", "Асанов", "Мамбетов", "Абдыкадыров", "Кузнецов", "Жумабаев", "Орозов", "Соколов"]
const STREETS = ["ул. Токтогула", "пр. Чуй", "ул. Киевская", "мкр. Джал", "ул. Ахунбаева", "бул. Эркиндик", "ул. Исанова", "мкр. Асанбай", "ул. Горького", "пр. Манаса", "ул. Московская", "мкр. Восток-5"]
const ORDER_NOTES = ["Открытка: «С днём рождения!»", "Позвонить получателю за 30 минут", "Собрать в кашпо", "Упаковка — крафт, без плёнки", "Добавить ленту и открытку", "Сюрприз — заранее не звонить", "Домофон 25, 4 этаж"]

function personName(random) {
  const female = random() < 0.7
  const first = pick(random, female ? FEMALE : MALE)
  const style = random()
  if (style < 0.35) return first
  const surname = pick(random, SURNAMES) + (female ? "а" : "")
  return style < 0.7 ? `${first} ${surname}` : `${first} ${surname[0]}.`
}
const phoneFor = (n) => `+996555${String(100000 + n).slice(-6)}`
const addressFor = (random) => `${pick(random, STREETS)}, ${1 + Math.floor(random() * 180)}${random() < 0.6 ? `, кв. ${1 + Math.floor(random() * 90)}` : ""}`

const USERS = {
  1: ["admin", "Азамат"],
  2: ["asel", "Асель"],
  3: ["zhibek", "Жибек"],
  4: ["nurai", "Нурай"],
  5: ["dinara", "Динара"],
  6: ["begimai", "Бегимай"],
  7: ["erlan", "Эрлан"],
  8: ["altynai", "Алтынай"],
  9: ["timur", "Тимур"],
}

const SUPPLIERS = ["Цветочная база «Ала-Тоо»", "Голландия · прямые поставки", "Теплица «Весна»", "Фермер Чуй", "Семь цветов опт", "Эустома опт", "Розы Иссык-Куля", "Зелень и листья", "Теплица «Сад»", "Кения · розы", "Китай · импорт", "Оранжерея", "Романтик опт", "Центр цветов", "Орхидеи в горшках", "La Rosa опт", "Упаковка и ленты", "Китай · упаковка", "Листья малины", "Выкупили у коллег", "Сухоцветы", "Флора-маркет", "Эквадор · розы", "Клумба", "Декор 3D", "Гладиолусы Иссык-Куль", "Флорекс", "Неизвестный", "Хризантемы опт"]

const has = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)

const run = db.transaction(() => {
  // --- Сотрудники ---
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10)
  const userNames = new Map()
  for (const user of db.prepare("SELECT id, name FROM users").all()) {
    const [login, name] = USERS[user.id] ?? [`user${user.id}`, `Сотрудник ${user.id}`]
    userNames.set(user.name, name)
    db.prepare("UPDATE users SET login = ?, name = ?, password_hash = ? WHERE id = ?").run(login, name, hash, user.id)
  }
  const renameUser = (value) => (value && userNames.has(value) ? userNames.get(value) : value ? "Сотрудник" : value)
  const userColumns = [
    ["shifts", "cashier_name"],
    ["stock_documents", "created_by_name"],
    ["stock_documents", "posted_by_name"],
    ["supplier_payments", "user_name"],
    ["deals", "responsible_user_name"],
    ["chats", "assigned_user_name"],
    ["bouquet_templates", "created_by_name"],
    ["warehouse_imports", "created_by_name"],
    ["quick_replies", "created_by_name"],
  ]
  for (const [table, column] of userColumns) {
    for (const row of db.prepare(`SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all()) {
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(renameUser(row.v), row.v)
    }
  }
  db.prepare("DELETE FROM sessions").run()

  // --- Поставщики ---
  const supplierNames = new Map()
  for (const supplier of db.prepare("SELECT id, name FROM suppliers ORDER BY id").all()) {
    const name = SUPPLIERS[supplier.id - 1] ?? `Поставщик ${supplier.id}`
    supplierNames.set(supplier.name, name)
    db.prepare(
      `UPDATE suppliers SET name = ?, phone = ?, contact_name = '', comment = '', legal_name = '', inn = '', kpp = '', ogrn = '',
        email = '', address = '', bank_name = '', bank_account = '', bik = '', corr_account = '', responsible_name = '',
        contact_name_2 = '', phone_2 = '' WHERE id = ?`
    ).run(name, supplier.id % 3 === 0 ? "" : phoneFor(900 + supplier.id), supplier.id)
  }
  for (const [table, column] of [["stock_documents", "supplier_name"], ["supplier_payments", "supplier_name"], ["stock_lots", "supplier_name"]]) {
    for (const row of db.prepare(`SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all()) {
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(supplierNames.get(row.v) ?? "Поставщик", row.v)
    }
  }
  db.prepare("UPDATE supplier_payments SET comment = '' WHERE comment IS NOT NULL").run()

  // --- Клиенты ---
  const customerNames = new Map()
  for (const customer of db.prepare("SELECT id FROM customers").all()) {
    const random = rng(customer.id * 7919)
    const name = personName(random)
    const phone = phoneFor(customer.id)
    customerNames.set(customer.id, { name, phone })
    db.prepare(
      `UPDATE customers SET name = ?, phone = ?, normalized_phone = ?, instagram = '', comment = '',
        wazzup_chat_id = CASE WHEN wazzup_chat_id IS NULL OR wazzup_chat_id = '' THEN wazzup_chat_id ELSE ? END
       WHERE id = ?`
    ).run(name, phone, phone.replace(/\D/g, ""), phone.replace(/\D/g, ""), customer.id)
  }
  db.prepare("DELETE FROM customer_changes").run()

  // --- Заказы ---
  const isInternalLabel = (value) => /\d/.test(value ?? "") || /витрин/i.test(value ?? "")
  for (const order of db.prepare("SELECT id, customer, customer_id, phone, recipient_phone, address, note, courier_name FROM orders").all()) {
    const random = rng(order.id * 104729)
    const linked = order.customer_id ? customerNames.get(order.customer_id) : null
    const customer = linked?.name ?? (isInternalLabel(order.customer) ? order.customer : order.customer ? personName(random) : order.customer)
    db.prepare(
      "UPDATE orders SET customer = ?, phone = ?, recipient_phone = ?, address = ?, note = ?, courier_name = ? WHERE id = ?"
    ).run(
      customer,
      order.phone ? (linked?.phone ?? phoneFor(5000 + order.id)) : order.phone,
      order.recipient_phone ? phoneFor(7000 + order.id) : order.recipient_phone,
      order.address ? addressFor(random) : order.address,
      order.note ? pick(random, ORDER_NOTES) : order.note,
      order.courier_name ? "Курьер" : order.courier_name,
      order.id
    )
  }
  // Фото заказов могли быть чеками/скриншотами из переписки — убираем привязки (файлы не копируются).
  db.prepare("DELETE FROM order_images").run()

  // --- Продажи и касса ---
  for (const sale of db.prepare("SELECT id, customer_id, customer_name, customer_phone FROM sales WHERE customer_name <> '' OR customer_phone <> ''").all()) {
    const linked = sale.customer_id ? customerNames.get(sale.customer_id) : null
    db.prepare("UPDATE sales SET customer_name = ?, customer_phone = ? WHERE id = ?").run(
      sale.customer_name ? (linked?.name ?? personName(rng(sale.id))) : sale.customer_name,
      sale.customer_phone ? (linked?.phone ?? phoneFor(9000 + sale.id)) : sale.customer_phone,
      sale.id
    )
  }
  db.prepare("UPDATE sales SET note = '' WHERE note IS NOT NULL AND note <> ''").run()

  const cashComment = (type, comment) => {
    if (!comment || /^Продажа на кассе$|^Предоплата|^Доплата|^Возврат|^Сторно|^Оплата|^Заказ|^Смена/i.test(comment)) return comment
    if (type === "sale") return "Продажа на кассе"
    if (/такси/i.test(comment)) return "Такси"
    if (/аванс|зп|зарплат/i.test(comment)) return "Аванс сотруднику"
    if (/дост|курьер/i.test(comment)) return "Доставка"
    if (/постав|закуп/i.test(comment)) return "Оплата поставки"
    return "Хозяйственные расходы"
  }
  for (const row of db.prepare("SELECT DISTINCT type, comment FROM cash_transactions WHERE comment IS NOT NULL AND comment <> ''").all()) {
    db.prepare("UPDATE cash_transactions SET comment = ? WHERE type = ? AND comment = ?").run(cashComment(row.type, row.comment), row.type, row.comment)
  }

  // --- Журналы движений: оставляем только системные подписи ---
  const SYSTEM = /^(Продажа на кассе|Списание при готовности букета|Резерв при|Отмена резерва|Изменение состава заказа|Импорт склада|Инвентаризация INV-|Обновлен товар|Товар отправлен в архив|Открыта (ночная|дневная) смена|Закрыта|Заказ #\d+:|Заказ ORD-[\d-]+: отправлен в работу|Приход|Списание|Корректировка|Возврат)/
  for (const [table, column] of [["movements", "note"], ["stock_movements", "comment"]]) {
    for (const row of db.prepare(`SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all()) {
      const created = /^Создан заказ (ORD-[\d-]+)/.exec(row.v)
      const next = created ? `Создан заказ ${created[1]}` : SYSTEM.test(row.v) ? row.v : ""
      if (next !== row.v) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(next, row.v)
    }
  }
  const docComment = (comment) => {
    if (!comment) return comment
    if (/^порча$/i.test(comment)) return "Порча"
    if (/^(долг|оплачено|оплачен)$/i.test(comment)) return comment
    if (/марк|бартер|блогер/i.test(comment)) return "Маркетинг"
    if (/перепрод|коллег/i.test(comment)) return "Перепродали коллегам"
    if (/брак/i.test(comment)) return "Брак"
    return "Прочее"
  }
  for (const row of db.prepare("SELECT DISTINCT comment FROM stock_documents WHERE comment IS NOT NULL AND comment <> ''").all()) {
    db.prepare("UPDATE stock_documents SET comment = ? WHERE comment = ?").run(docComment(row.comment), row.comment)
  }
  db.prepare("UPDATE stock_document_items SET comment = '', variance_reason = '' WHERE comment <> '' OR variance_reason <> ''").run()
  db.prepare("UPDATE shifts SET note = '' WHERE note IS NOT NULL AND note <> ''").run()

  // --- CRM и переписка: сделки обезличиваем, переписку удаляем (демо-диалоги создаёт съёмка) ---
  for (const deal of db.prepare("SELECT id, customer_id FROM deals").all()) {
    const linked = deal.customer_id ? customerNames.get(deal.customer_id) : null
    db.prepare(
      `UPDATE deals SET customer_name = ?, customer_phone = ?, recipient_phone = '', title = 'Заявка WhatsApp', address = '',
        comment = '', last_message_text = '' WHERE id = ?`
    ).run(linked?.name ?? "Клиент", linked?.phone ?? "", deal.id)
  }
  for (const table of ["chats", "wazzup_messages", "wazzup_webhook_events", "wazzup_contact_sync", "wazzup_deal_sync", "wazzup_user_sync", "deal_bouquet_messages", "quick_replies"]) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
  if (has("integration_settings", "api_key")) {
    db.prepare("UPDATE integration_settings SET api_key = 'sandbox-invalid-key', crm_key = 'sandbox-crm-key'").run()
  }
})

run()
db.pragma("foreign_keys = ON")
db.exec("VACUUM")
db.close()
console.log(`Demo DB ready: ${dbArg} (password for all users: ${DEMO_PASSWORD})`)
