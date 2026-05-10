import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(amount: number) {
  const value = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  })
    .format(Number.isFinite(amount) ? amount : 0)
    .replace(/\u00a0/g, " ")

  return `${value} сом`
}
