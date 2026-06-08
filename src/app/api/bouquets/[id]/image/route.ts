import fs from "node:fs/promises"
import path from "node:path"
import { revalidatePath } from "next/cache"
import { getCurrentUser } from "@/lib/auth"
import { getBouquetTemplate, updateBouquetTemplateImagePath } from "@/lib/db"
import { bouquetImagePublicPathPrefix } from "@/lib/product-images"

export const runtime = "nodejs"

const maxFileSize = 5 * 1024 * 1024
const uploadsDir = path.join(process.cwd(), "public", "uploads", "bouquets")
const allowedTypes = new Map([
  ["image/jpeg", new Set(["jpg", "jpeg"])],
  ["image/png", new Set(["png"])],
  ["image/webp", new Set(["webp"])],
])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user || (user.role !== "owner" && user.role !== "manager")) {
    return Response.json({ ok: false, message: "Недостаточно прав." }, { status: 403 })
  }

  const { id: rawId } = await params
  const bouquetId = Number(String(rawId ?? "").trim())
  if (!Number.isInteger(bouquetId) || bouquetId <= 0) {
    return Response.json({ ok: false, message: "Букет не найден." }, { status: 404 })
  }

  const bouquet = getBouquetTemplate(bouquetId)
  if (!bouquet) {
    return Response.json({ ok: false, message: "Букет не найден." }, { status: 404 })
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
  const filename = `bouquet-${bouquet.id}-${Date.now()}.${ext}`
  const fullPath = path.join(uploadsDir, filename)
  const buffer = Buffer.from(await file.arrayBuffer())

  await fs.writeFile(fullPath, buffer, { flag: "wx" })

  const imagePath = `${bouquetImagePublicPathPrefix}${filename}`
  updateBouquetTemplateImagePath(bouquet.id, imagePath)
  revalidatePath("/bouquets")
  revalidatePath("/deals")
  revalidatePath(`/api/bouquets/${bouquet.id}/image`)

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
