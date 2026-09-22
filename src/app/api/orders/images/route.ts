import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { getCurrentUser } from "@/lib/auth"
import { cleanupOrphanOrderImages, createPendingOrderImage } from "@/lib/db"
import { orderImagesDir } from "@/lib/db/queries/order-images"
import { maxOrderImageFileSize, orderImagePublicPathPrefix } from "@/lib/order-images"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Загрузка изображения к заказу. Файл нормализуем через sharp: авто-поворот по EXIF, длинная
// сторона ≤ 2000px, webp — так «любой тип» на входе (jpg/png/gif/webp/tiff/svg/avif/bmp…)
// становится одним форматом на выходе, а 10-мегабайтное фото с телефона — ~300 KB.
// Плюс миниатюра ≤ 480px для карточек. Строка order_images создаётся с order_id = NULL —
// привяжется при сохранении формы заказа (см. queries/order-images.ts).
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

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ ok: false, message: "Нужно войти в систему." }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ ok: false, message: "Не удалось прочитать файл." }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json({ ok: false, message: "Файл не передан." }, { status: 400 })
  }
  if (file.size <= 0) {
    return Response.json({ ok: false, message: "Файл пустой." }, { status: 400 })
  }
  if (file.size > maxOrderImageFileSize) {
    return Response.json(
      { ok: false, message: `Файл слишком большой — до ${Math.round(maxOrderImageFileSize / 1024 / 1024)} MB.` },
      { status: 400 }
    )
  }

  const source = Buffer.from(await file.arrayBuffer())
  const baseName = `order-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
  await fs.mkdir(orderImagesDir, { recursive: true })

  let processed: { ext: string; data: Buffer; thumb: Buffer | null; width: number; height: number }
  try {
    processed = await normalizeImage(source)
  } catch {
    const ext = rawFallbackTypes.get(file.type)
    if (!ext) {
      return Response.json(
        {
          ok: false,
          message: "Не удалось прочитать изображение. Сохраните его как JPG или PNG и загрузите снова.",
        },
        { status: 400 }
      )
    }
    processed = { ext, data: source, thumb: null, width: 0, height: 0 }
  }

  const filename = `${baseName}.${processed.ext}`
  const thumbFilename = processed.thumb ? `${baseName}-thumb.webp` : ""
  await fs.writeFile(path.join(orderImagesDir, filename), processed.data, { flag: "wx" })
  if (processed.thumb) {
    await fs.writeFile(path.join(orderImagesDir, thumbFilename), processed.thumb, { flag: "wx" })
  }

  const image = createPendingOrderImage({
    imagePath: `${orderImagePublicPathPrefix}${filename}`,
    thumbPath: thumbFilename ? `${orderImagePublicPathPrefix}${thumbFilename}` : "",
    originalName: file.name,
    width: processed.width,
    height: processed.height,
    userId: user.id,
  })

  // Попутная чистка сирот (не чаще раза в час, best-effort — на ответ не влияет).
  try {
    cleanupOrphanOrderImages()
  } catch {
    // Чистка не должна ломать загрузку.
  }

  return Response.json({ ok: true, image })
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
