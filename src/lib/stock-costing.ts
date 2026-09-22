import type { AllocationMethod } from "@/lib/db/types"

// Чистый расчёт распределения накладных расходов по строкам прихода. Используется и сервером при
// проведении акта, и клиентскими формами для живого предпросмотра себестоимости («было → стало») —
// формула ОБЯЗАНА быть одна, иначе предпросмотр разойдётся с проведением.
//
// Вес строки = стоимость (by_value) или количество (by_qty); при нулевой сумме весов — фолбэк на
// количество. Остаток округления добавляется к строке с наибольшим весом, чтобы сумма долей
// сходилась с overheadTotal ровно. Возвращает доли в порядке входных строк.
export function allocateOverheadShares(
  lines: Array<{ qty: number; lineValue: number }>,
  overheadTotal: number,
  method: AllocationMethod
): number[] {
  if (overheadTotal <= 0 || lines.length === 0) {
    return lines.map(() => 0)
  }

  let weights = lines.map((line) => (method === "by_qty" ? line.qty : line.lineValue))
  let sumWeights = weights.reduce((a, b) => a + b, 0)
  if (sumWeights <= 0) {
    weights = lines.map((line) => line.qty)
    sumWeights = weights.reduce((a, b) => a + b, 0)
  }
  if (sumWeights <= 0) {
    return lines.map(() => 0)
  }

  const shares = weights.map((weight) => round2((overheadTotal * weight) / sumWeights))
  const assigned = round2(shares.reduce((a, b) => a + b, 0))
  const remainder = round2(overheadTotal - assigned)
  if (remainder !== 0) {
    let maxIndex = 0
    for (let i = 1; i < weights.length; i += 1) {
      if (weights[i] > weights[maxIndex]) {
        maxIndex = i
      }
    }
    shares[maxIndex] = round2(shares[maxIndex] + remainder)
  }

  return shares
}

// Себестоимость единицы годного по строке прихода: оплачено всё количество (включая брак),
// поэтому в числителе qty × цена + доля накладных, в знаменателе — только годное (qty − брак).
// Вся строка — брак: на склад ничего не идёт, себестоимость не определена (null).
export function landedUnitCostOf(line: {
  qty: number
  effectiveQty: number
  unitCost: number
  allocatedOverhead: number
}): number | null {
  if (line.effectiveQty <= 0) {
    return null
  }

  return round2((line.qty * line.unitCost + line.allocatedOverhead) / line.effectiveQty)
}

function round2(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
