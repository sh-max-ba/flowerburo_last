"use client"

import type React from "react"
import { useState } from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { openWhatsappChatAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Новый диалог по номеру WhatsApp: находим существующий чат/клиента по телефону или создаём
// пустой диалог — написать первым можно прямо из него.
export function NewChatDialog({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpened: (chatId: number) => void
}) {
  const [phone, setPhone] = useState("996")
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await openWhatsappChatAction({ phone, name })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.data.created ? "Диалог создан" : "Диалог найден")
      onOpened(result.data.chatId)
      onOpenChange(false)
      setPhone("996")
      setName("")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Новый чат в WhatsApp</DialogTitle>
            <DialogDescription>Если клиент с этим номером уже писал — откроется его диалог.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-chat-phone">Телефон</FieldLabel>
              <Input
                id="new-chat-phone"
                inputMode="tel"
                autoFocus
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="996555123456"
                required
              />
              <FieldDescription>Международный формат, только цифры.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-chat-name">Имя (необязательно)</FieldLabel>
              <Input id="new-chat-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Как записать клиента" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
              Открыть чат
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
