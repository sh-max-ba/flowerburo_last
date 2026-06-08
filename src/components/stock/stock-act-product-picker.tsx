"use client"

import type { Product } from "@/lib/db"
import { ProductCombobox } from "@/components/products/product-combobox"

type StockActProductPickerProps = {
  products: Product[]
  disabled?: boolean
  placeholder?: string
  onSelect: (product: Product) => void
}

export function StockActProductPicker({
  products,
  disabled,
  placeholder = "Найти товар и добавить в акт",
  onSelect,
}: StockActProductPickerProps) {
  return (
    <ProductCombobox
      products={products}
      disabled={disabled}
      placeholder={placeholder}
      maxResults={20}
      onSelect={onSelect}
    />
  )
}
