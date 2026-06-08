export type BouquetAvailabilityItem = {
  productCode: string
  productName: string
  qty: number
  stock: number
}

export type BouquetAvailabilityMissingItem = {
  productCode: string
  productName: string
  requiredQty: number
  stock: number
  missingQty: number
}

export type BouquetAvailability = {
  available: boolean
  missingItems: BouquetAvailabilityMissingItem[]
}

export function getBouquetAvailability(
  bouquet: { items: BouquetAvailabilityItem[] },
  multiplier = 1
): BouquetAvailability {
  const normalizedMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  const missingItems = bouquet.items
    .map((item) => {
      const itemQty = Number(item.qty)
      const itemStock = Number(item.stock)
      const requiredQty = Number.isFinite(itemQty) ? Math.max(0, itemQty * normalizedMultiplier) : 0
      const stock = Number.isFinite(itemStock) ? itemStock : 0
      const missingQty = Math.max(0, requiredQty - stock)

      return {
        productCode: item.productCode,
        productName: item.productName || item.productCode,
        requiredQty,
        stock,
        missingQty,
      }
    })
    .filter((item) => item.missingQty > 0)

  return {
    available: missingItems.length === 0,
    missingItems,
  }
}
