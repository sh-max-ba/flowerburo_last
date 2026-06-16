import { mapProductRow, numberFromRow } from "@/lib/db-row"
import type { CurrentUser, Product } from "../types"
import { db } from "../connection"
import { addMovement, getProduct, recordStockMovement } from "../ledger"
import { clean, toNumber } from "../form-parsers"
import { parseForm } from "@/lib/forms/parse"
import { ProductInputSchema } from "@/lib/forms/schemas"

export function getProductByCode(code: string) {
  const row = getProduct(db(), code)
  return row ? mapProductRow(row) : null
}

export function updateProductImagePath(code: string, imagePath: string) {
  const client = db()
  const product = getProduct(client, code)
  if (!product) {
    throw new Error("Товар не найден.")
  }

  client
    .prepare("UPDATE products SET image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?")
    .run(imagePath, code)

  return getProductByCode(code)
}

export function upsertProduct(formData: FormData, currentUser: CurrentUser) {
  const client = db()
  const input = parseForm(ProductInputSchema, formData)
  const { code, name, costPrice, salePrice } = input
  // "create" | "edit" из формы товара.
  const formMode = String(formData.get("formMode") ?? "")

  const saveProduct = client.transaction(() => {
    const before = getProduct(client, code)

    // Код — первичный ключ: «Новый товар» с занятым кодом раньше МОЛЧА перезаписывал чужой товар
    // (реальные инциденты 09.06 и 11.06: позиции «переименовывали» друг друга). Создание с
    // коллизией — ошибка. Форма без маркера formMode (вкладка со сборкой до деплоя гарда) тем
    // более не имеет права перезаписывать: именно через такую вкладку инцидент повторился —
    // требуем обновить страницу. Создание НОВОГО кода без маркера безопасно (чистый INSERT).
    if (before && formMode !== "edit") {
      const isArchived = numberFromRow(before.is_active ?? 1) === 0
      throw new Error(
        formMode === "create"
          ? `Код ${code} уже занят товаром «${String(before.name)}»${isArchived ? " (в архиве)" : ""}. Укажите другой код.`
          : `Код ${code} уже занят товаром «${String(before.name)}». Обновите страницу (она устарела) и повторите.`
      )
    }
    if (formMode === "edit" && !before) {
      throw new Error("Товар не найден — возможно, он был удалён. Обновите страницу.")
    }
    const stock = before ? numberFromRow(before.stock) : toNumber(formData.get("stock"))
    const reserved = before ? numberFromRow(before.reserved) : toNumber(formData.get("reserved"))
    const expected = before ? numberFromRow(before.expected) : toNumber(formData.get("expected"))

    // Настройки учёта по партиям приходят из формы товара только если она их содержит
    // (скрытый маркер lotSettingsPresent). Иначе сохраняем существующие — чтобы не сбросить
    // непереданным чекбоксом (снятый чекбокс не отправляет ключ).
    const hasLotSettings = formData.get("lotSettingsPresent") === "on"
    const trackLots = hasLotSettings
      ? formData.get("trackLots") === "on"
        ? 1
        : 0
      : before
        ? numberFromRow(before.track_lots ?? 0)
        : 0
    let vaseLifeDays: number | null
    if (hasLotSettings) {
      const raw = toNumber(formData.get("vaseLifeDays"))
      vaseLifeDays = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null
    } else {
      vaseLifeDays = before && before.vase_life_days != null ? numberFromRow(before.vase_life_days) : null
    }

    client
      .prepare(
        `INSERT INTO products (
          code, category_path, article, name, unit, stock, reserved, expected, cost_price, sale_price,
          track_lots, vase_life_days, updated_at
        ) VALUES (
          @code, @categoryPath, @article, @name, @unit, @stock, @reserved, @expected, @costPrice, @salePrice,
          @trackLots, @vaseLifeDays, CURRENT_TIMESTAMP
        )
        ON CONFLICT(code) DO UPDATE SET
          category_path = excluded.category_path,
          article = excluded.article,
          name = excluded.name,
          unit = excluded.unit,
          stock = excluded.stock,
          reserved = excluded.reserved,
          expected = excluded.expected,
          cost_price = excluded.cost_price,
          sale_price = excluded.sale_price,
          track_lots = excluded.track_lots,
          vase_life_days = excluded.vase_life_days,
          updated_at = CURRENT_TIMESTAMP`
      )
      .run({
        code,
        categoryPath: input.categoryPath,
        article: input.article,
        name,
        unit: input.unit || "шт",
        stock,
        reserved,
        expected,
        costPrice,
        salePrice,
        trackLots,
        vaseLifeDays,
      })

    const after = getProduct(client, code)
    const beforeStock = before ? numberFromRow(before.stock) : null
    const afterStock = after ? numberFromRow(after.stock) : null
    const beforeReserved = before ? numberFromRow(before.reserved) : null
    const afterReserved = after ? numberFromRow(after.reserved) : null

    if (beforeStock !== afterStock || beforeReserved !== afterReserved) {
      recordStockMovement(client, {
        productCode: code,
        userId: currentUser.id,
        type: "adjustment",
        qty: numberFromRow(after?.stock) - numberFromRow(before?.stock),
        beforeStock,
        afterStock,
        beforeReserved,
        afterReserved,
        comment: `Обновлен товар ${code}`,
      })
    }

    addMovement(client, {
      userId: currentUser.id,
      type: "stock_update",
      productCode: code,
      productName: name,
      note: `Обновлен товар ${code}`,
    })
  })

  saveProduct()
}

export function renameProductCategory(formData: FormData) {
  const client = db()
  const oldName = clean(formData.get("oldName"))
  const newName = clean(formData.get("newName"))

  if (!oldName || !newName) {
    throw new Error("Укажите старую и новую категорию.")
  }

  const rename = client.transaction(() => {
    const result = client
      .prepare("UPDATE products SET category_path = ?, updated_at = CURRENT_TIMESTAMP WHERE category_path = ?")
      .run(newName, oldName)

    return result.changes
  })

  return rename()
}

export function clearProductCategory(categoryPath: string) {
  const client = db()
  const name = clean(categoryPath)

  if (!name) {
    throw new Error("Категория не выбрана.")
  }

  const clear = client.transaction(() => {
    const result = client
      .prepare("UPDATE products SET category_path = '', updated_at = CURRENT_TIMESTAMP WHERE category_path = ?")
      .run(name)

    return result.changes
  })

  return clear()
}

export function deleteProduct(code: string, currentUser: CurrentUser) {
  const client = db()

  const removeProduct = client.transaction(() => {
    const product = getProduct(client, code)

    if (!product) {
      return
    }

    if (numberFromRow(product.reserved) > 0) {
      throw new Error("Нельзя удалить товар: есть активный резерв. Сначала закройте или отмените связанные заказы.")
    }

    const activeOrderRef = client
      .prepare(
        `SELECT COUNT(*) as count
         FROM order_items
         JOIN orders ON orders.id = order_items.order_id
         WHERE order_items.product_code = ? AND orders.status NOT IN ('Черновик', 'Выдан', 'Отменен')`
      )
      .get(code) as { count: number }
    if (numberFromRow(activeOrderRef.count) > 0) {
      throw new Error("Нельзя удалить товар: он есть в активных заказах.")
    }

    const saleRef = client
      .prepare("SELECT COUNT(*) as count FROM sale_items WHERE product_code = ?")
      .get(code) as { count: number }
    if (numberFromRow(saleRef.count) > 0) {
      throw new Error("Нельзя удалить товар: он есть в истории продаж.")
    }

    recordStockMovement(client, {
      productCode: code,
      userId: currentUser.id,
      type: "adjustment",
      qty: -numberFromRow(product.stock),
      beforeStock: numberFromRow(product.stock),
      afterStock: null,
      beforeReserved: numberFromRow(product.reserved),
      afterReserved: null,
      comment: "Товар удален из склада",
    })

    client.prepare("DELETE FROM products WHERE code = ?").run(code)
    addMovement(client, {
      userId: currentUser.id,
      type: "delete_product",
      productCode: code,
      productName: String(product.name),
      note: "Товар удален из склада",
    })
  })

  removeProduct()
}

// Мягкий архив товара (is_active=0) вместо удаления. Безопасно для FK: исторические строки
// и снимки в заказах/сделках/букетах продолжают резолвиться через getProductByCode (он не
// фильтрует is_active). Резерв > 0 блокирует архивацию — иначе скрытая из подборов позиция
// сломала бы жизненный цикл заказа. Остаток на складе НЕ списывается (остаётся в отчётах).
export function setProductArchived(code: string, archived: boolean, currentUser: CurrentUser) {
  const client = db()

  const run = client.transaction(() => {
    const product = getProduct(client, code)
    if (!product) {
      throw new Error("Товар не найден.")
    }

    if (archived && numberFromRow(product.reserved) > 0) {
      throw new Error(
        "Нельзя архивировать товар: есть активный резерв. Сначала закройте или отмените связанные заказы."
      )
    }

    client
      .prepare("UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?")
      .run(archived ? 0 : 1, code)

    addMovement(client, {
      userId: currentUser.id,
      type: "stock_update",
      productCode: code,
      productName: String(product.name),
      note: archived ? "Товар отправлен в архив" : "Товар восстановлен из архива",
    })
  })

  run()
}

// Только архивные товары — для вкладки «В архиве» на странице склада. getDashboardData отдаёт
// активные (LIMIT 234), поэтому архив тянем отдельным запросом без лимита (архив обычно невелик).
export function listArchivedProducts(): Product[] {
  return (
    db()
      .prepare(
        `SELECT * FROM products
         WHERE COALESCE(is_active, 1) = 0
         ORDER BY name COLLATE NOCASE`
      )
      .all() as Array<Record<string, unknown>>
  ).map(mapProductRow)
}

// Активные товары для отчёта «Остатки» — отсортированы по категории, затем по названию.
// Суммы (себестоимость/продажа) и группировку по категориям считаем на клиенте.
export function listActiveProductsForReport(): Product[] {
  return (
    db()
      .prepare(
        `SELECT * FROM products
         WHERE COALESCE(is_active, 1) = 1
         ORDER BY category_path COLLATE NOCASE, name COLLATE NOCASE`
      )
      .all() as Array<Record<string, unknown>>
  ).map(mapProductRow)
}
