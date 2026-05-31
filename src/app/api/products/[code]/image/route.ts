import fs from "node:fs/promises"
import path from "node:path"
import { revalidatePath } from "next/cache"
import { getCurrentUser } from "@/lib/auth"
import { getProductByCode, updateProductImagePath } from "@/lib/db"
import { productImagePublicPathPrefix } from "@/lib/product-images"

export const runtime = "nodejs"

const maxFileSize = 5 * 1024 * 1024
const uploadsDir = path.join(process.cwd(), "public", "uploads", "products")
const allowedTypes = new Map([
  ["image/jpeg", new Set(["jpg", "jpeg"])],
  ["image/png", new Set(["png"])],
  ["image/webp", new Set(["webp"])],
])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const user = await getCurrentUser()
  if (!user || user.role !== "owner") {
    return Response.json({ ok: false, message: "Недостаточно прав." }, { status: 403 })
  }

  const { code: rawCode } = await params
  const code = String(rawCode ?? "").trim()
  if (!code) {
    return Response.json({ ok: false, message: "Код товара не указан." }, { status: 400 })
  }

  const product = getProductByCode(code)
  if (!product) {
    return Response.json({ ok: false, message: "Товар не найден." }, { status: 404 })
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json({ ok: false, message: "Файл не передан." }, { status: 400 })
  }

  if (file.size <= 0) {
    return Response.json({ ok: false, message: "Файл пустой." }, { status: 400 })
  }

  if (file.size > maxFileSize) {
    return Response.json({ ok: false, message: "Фото должно быть не больше 5 MB." }, { status: 400 })
  }

  const ext = getAllowedExtension(file)
  if (!ext) {
    return Response.json(
      { ok: false, message: "Можно загрузить только jpg, jpeg, png или webp." },
      { status: 400 }
    )
  }

  await fs.mkdir(uploadsDir, { recursive: true })
  const filename = `product-${safeFilenamePart(code)}-${Date.now()}.${ext}`
  const fullPath = path.join(uploadsDir, filename)
  const buffer = Buffer.from(await file.arrayBuffer())

  await fs.writeFile(fullPath, buffer, { flag: "wx" })

  const imagePath = `${productImagePublicPathPrefix}${filename}`
  updateProductImagePath(code, imagePath)
  revalidatePath("/")
  revalidatePath("/stock")
  revalidatePath("/cash")
  revalidatePath("/orders")
  revalidatePath("/deals")

  return Response.json({ ok: true, imagePath })
}

function getAllowedExtension(file: File) {
  const typeExtensions = allowedTypes.get(file.type)
  if (!typeExtensions) {
    return null
  }

  const ext = file.name.split(".").pop()?.trim().toLowerCase() ?? ""
  return typeExtensions.has(ext) ? ext : null
}

function safeFilenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "item"
}
