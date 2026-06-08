"use client"

import { useMemo, useState } from "react"
import { ChevronsUpDownIcon, XIcon } from "lucide-react"
import type { CustomerOption } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type CustomerComboboxProps = {
  customers: CustomerOption[]
  value: number | null
  disabled?: boolean
  placeholder?: string
  onChange: (customer: CustomerOption | null) => void
}

export function CustomerCombobox({
  customers,
  value,
  disabled,
  placeholder = "Найти клиента по имени или телефону",
  onChange,
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selectedCustomer = customers.find((customer) => customer.id === value) ?? null
  const normalizedSearch = search.trim().toLowerCase()
  const phoneSearch = search.replace(/\D/g, "")

  const results = useMemo(() => {
    if (!normalizedSearch && !phoneSearch) {
      return customers.slice(0, 20)
    }

    return customers
      .filter((customer) => {
        const haystack = `${customer.name} ${customer.phone}`.toLowerCase()
        const phone = customer.phone.replace(/\D/g, "")

        return haystack.includes(normalizedSearch) || (phoneSearch.length > 0 && phone.includes(phoneSearch))
      })
      .slice(0, 20)
  }, [customers, normalizedSearch, phoneSearch])

  function selectCustomer(customer: CustomerOption | null) {
    onChange(customer)
    setOpen(false)
    setSearch("")
  }

  return (
    <div className="flex min-w-0 gap-2">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            setSearch("")
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-10 min-w-0 flex-1 justify-between bg-white font-normal"
            />
          }
        >
          <span className={selectedCustomer ? "min-w-0 truncate text-left" : "min-w-0 truncate text-left text-zinc-500"}>
            {selectedCustomer
              ? `${selectedCustomer.name}${selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}`
              : placeholder}
          </span>
          <ChevronsUpDownIcon className="opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-(--anchor-width) min-w-[320px] p-0">
          <Command shouldFilter={false} loop>
            <CommandInput value={search} onValueChange={setSearch} placeholder={placeholder} autoFocus />
            <CommandList className="max-h-[320px] overflow-y-auto">
              <CommandGroup>
                <CommandItem value="Без клиента" onSelect={() => selectCustomer(null)}>
                  <span className="font-medium">Без клиента</span>
                </CommandItem>
              </CommandGroup>
              <CommandGroup>
                {results.length ? (
                  results.map((customer) => (
                    <CommandItem
                      key={customer.id}
                      value={`${customer.name} ${customer.phone}`}
                      onSelect={() => selectCustomer(customer)}
                      className="items-start py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{customer.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {customer.phone || "Телефон не указан"}
                        </span>
                      </span>
                      {customer.defaultDiscountPercent > 0 && (
                        <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
                          {customer.defaultDiscountPercent}%
                        </Badge>
                      )}
                    </CommandItem>
                  ))
                ) : (
                  <CommandItem value="Клиент не найден" disabled>
                    Клиент не найден
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedCustomer && (
        <Button type="button" variant="outline" size="icon" disabled={disabled} onClick={() => selectCustomer(null)}>
          <XIcon />
          <span className="sr-only">Очистить клиента</span>
        </Button>
      )}
    </div>
  )
}
