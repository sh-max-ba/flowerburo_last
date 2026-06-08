"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createStockCorrectionDraftAction } from "@/app/actions"
import { Button } from "@/components/ui/button"

export function CreateStockCorrectionButton({ documentId }: { documentId: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function create() {
    startTransition(async () => {
      const result = await createStockCorrectionDraftAction(documentId)
      if (result.ok && "data" in result && result.data) {
        toast.success(result.message)
        router.push(`/stock/acts/${result.data.documentId}/edit`)
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Button type="button" disabled={pending} onClick={create}>
      Создать корректировку
    </Button>
  )
}
