import type { ShotBox, ShotMeta } from "@/lib/guides/types"

// Общая рамка вокруг одной или нескольких областей кадра.
export function unionBox(meta: ShotMeta, names: string | string[] | undefined): ShotBox | undefined {
  const boxes = (Array.isArray(names) ? names : names ? [names] : []).map((name) => meta.targets[name]).filter(Boolean)
  if (!boxes.length) {
    return undefined
  }
  const left = Math.min(...boxes.map((box) => box[0]))
  const top = Math.min(...boxes.map((box) => box[1]))
  const right = Math.max(...boxes.map((box) => box[0] + box[2]))
  const bottom = Math.max(...boxes.map((box) => box[1] + box[3]))
  return [left, top, right - left, bottom - top]
}
