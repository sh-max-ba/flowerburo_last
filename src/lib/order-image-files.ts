import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { cleanupOrphanOrderImages, createPendingOrderImage, type OrderImage, type OrderImageKind } from "@/lib/db"
import { orderImagesDir } from "@/lib/db/queries/order-images"
import { orderImagePublicPathPrefix } from "@/lib/order-images"

// Серверная обработка изображения заказа, общая для загрузки из формы (/api/orders/images) и для
// вложений из чата («в заказ как фото/чек»). Файл нормализуем через sharp: авто-поворот по EXIF,
// длинная сторона ≤ 2000px, webp — так «любой тип» на входе становится одним форматом на выходе,
// а 10-мегабайтное фото с телефона — ~300 KB. Плюс миниатюра ≤ 480px для карточек. Строка
// order_images создаётся с order_id = NULL — привяжется при сохранении формы заказа.
const maxSide = 2000
const thumbSide = 480

// Если sharp не смог декодировать (например, HEIC с HEVC — прибранные бинарники без кодека),
// но браузер такой файл показать умеет — сохраняем как есть, без миниатюры.
const rawFallbackTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
])

export class OrderImageError extends Error {}

export async function storeOrderImage(input: {
  bytes: Buffer
  mimeType: string
  originalName: string
  kind: OrderImageKind
  userId: number | null
}): Promise<OrderImage> {
  const baseName = `order-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
  await fs.mkdir(orderImagesDir, { recursive: true })

  let processed: { ext: string; data: Buffer; thumb: Buffer | null; width: number; height: number }
  try {
    processed = await normalizeImage(input.bytes)
  } catch {
    const ext = rawFallbackTypes.get(input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "")
    if (!ext) {
      throw new OrderImageError("Не удалось прочитать изображение. Сохраните его как JPG или PNG и загрузите снова.")
    }
    processed = { ext, data: input.bytes, thumb: null, width: 0, height: 0 }
  }

  const filename = `${baseName}.${processed.ext}`
  const thumbFilename = processed.thumb ? `${baseName}-thumb.webp` : ""
  await fs.writeFile(path.join(orderImagesDir, filename), processed.data, { flag: "wx" })
  if (processed.thumb) {
    await fs.writeFile(path.join(orderImagesDir, thumbFilename), processed.thumb, { flag: "wx" })
  }

  const image = createPendingOrderImage({
    kind: input.kind,
    imagePath: `${orderImagePublicPathPrefix}${filename}`,
    thumbPath: thumbFilename ? `${orderImagePublicPathPrefix}${thumbFilename}` : "",
    originalName: input.originalName,
    width: processed.width,
    height: processed.height,
    userId: input.userId,
  })

  // Попутная чистка сирот (не чаще раза в час, best-effort — на ответ не влияет).
  try {
    cleanupOrphanOrderImages()
  } catch {
    // Чистка не должна ломать загрузку.
  }

  return image
}

async function normalizeImage(source: Buffer) {
  // failOn: "none" — терпим повреждённые/усечённые файлы, limitInputPixels — защита от «бомб».
  const pipeline = sharp(source, { failOn: "none", limitInputPixels: 80_000_000 }).rotate()
  const full = await pipeline
    .clone()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  const thumb = await sharp(full.data)
    .resize({ width: thumbSide, height: thumbSide, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer()
  return { ext: "webp", data: full.data, thumb, width: full.info.width, height: full.info.height }
}
