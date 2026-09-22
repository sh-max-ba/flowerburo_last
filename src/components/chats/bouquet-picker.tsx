"use client"

import { useMemo, useState } from "react"
import { SendIcon } from "lucide-react"
import type { BouquetTemplate } from "@/lib/db"
import { getBouquetAvailability } from "@/lib/bouquet-availability"
import { formatMoney } from "@/lib/utils"
import { BouquetThumbnail } from "@/components/bouquets/bouquet-thumbnail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

// Выбор букета из каталога для отправки в чат: фото + текст с ценой уходят клиенту.
export function BouquetPickerDialog({
  open,
  onOpenChange,
  bouquets,
  busyId,
  onSend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bouquets: BouquetTemplate[]
  busyId: number | null
  onSend: (bouquet: BouquetTemplate) => void
}) {
  const [search, setSearch] = useState("")
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return bouquets
    }
    return bouquets.filter((bouquet) =>
      [bouquet.name, bouquet.description, String(bouquet.price)].join(" ").toLowerCase().includes(query)
    )
  }, [search, bouquets])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Предложить букет</DialogTitle>
          <DialogDescription>Клиенту уйдут фото и описание с ценой.</DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          placeholder="Поиск: название, описание или цена"
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">Активные букеты не найдены.</div>
          ) : (
            filtered.map((bouquet) => {
              const availability = getBouquetAvailability(bouquet)
              const busy = busyId === bouquet.id
              return (
                <div key={bouquet.id} className="flex items-center gap-3 rounded-lg bg-muted/30 p-2.5">
                  <BouquetThumbnail name={bouquet.name} imagePath={bouquet.imagePath} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{bouquet.name}</div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">{formatMoney(bouquet.price)}</span>
                      {!availability.available ? <Badge variant="warning">Не хватает</Badge> : null}
                    </div>
                  </div>
                  <Button type="button" size="sm" disabled={busy} onClick={() => onSend(bouquet)}>
                    <SendIcon data-icon="inline-start" />В чат
                  </Button>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
