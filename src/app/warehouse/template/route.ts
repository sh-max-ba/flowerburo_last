import { requireRole } from "@/lib/auth"
import { createWarehouseImportTemplateWorkbook, writeWorkbookBuffer } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  await requireRole(["owner"])

  return xlsxResponse(writeWorkbookBuffer(createWarehouseImportTemplateWorkbook()), "warehouse_import_template.xlsx")
}

function xlsxResponse(buffer: Buffer, filename: string) {
  return new Response(toArrayBuffer(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}

function toArrayBuffer(buffer: Buffer) {
  const body = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(body).set(new Uint8Array(buffer))
  return body
}
