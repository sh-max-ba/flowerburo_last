"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { cancelStockDocumentAction, postStockDocumentAction } from "@/app/actions"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

type StockDocumentActionsProps = {
  documentId: number
}

export function StockDocumentActions({ documentId }: StockDocumentActionsProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={pending} onClick={() => run(() => postStockDocumentAction(documentId))}>
        Провести
      </Button>
      <AlertDialog>
        <AlertDialogTrigger render={<Button type="button" variant="outline" disabled={pending} />}>
          Отменить
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить акт?</AlertDialogTitle>
            <AlertDialogDescription>
              Акт перейдет в статус «Отменен». Складские остатки по черновику не будут изменены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Назад</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" disabled={pending} />}
              onClick={() => run(() => cancelStockDocumentAction(documentId))}
            >
              Отменить акт
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
