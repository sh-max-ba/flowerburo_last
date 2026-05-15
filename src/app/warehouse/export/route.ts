import { requireRole } from "@/lib/auth"
import { createWarehouseExportWorkbook, writeWorkbookBuffer } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  await requireRole(["owner"])

  const date = new Date().toISOString().slice(0, 10)

  return new Response(toArrayBuffer(writeWorkbookBuffer(createWarehouseExportWorkbook())), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="warehouse_export_${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  })
}

function toArrayBuffer(buffer: Buffer) {
  const body = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(body).set(new Uint8Array(buffer))
  return body
}
