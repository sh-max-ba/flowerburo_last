import { unionBox } from "@/lib/guides/geometry"
import type { ShotBox, ShotMeta } from "@/lib/guides/types"
import { cn } from "@/lib/utils"

// Обложка карточки сценария: фрагмент настоящего экрана вокруг нужного места, в рамке 16:9.
// Масштаб — чтобы область заняла ширину обложки, по вертикали — центр области, без пустых полей.
const COVER_ASPECT = 16 / 9

export function ShotCover({
  meta,
  src,
  area,
  className,
}: {
  meta: ShotMeta
  src: string
  area?: string | string[]
  className?: string
}) {
  const box: ShotBox = unionBox(meta, area) ?? [0, 0, 1, 1]
  const [bx, by, bw, bh] = widen(box, meta.width)
  // Высота картинки в долях высоты обложки.
  const imageHeight = (1 / bw) * (meta.height / meta.width) * COVER_ASPECT
  const centered = 0.5 - (by + bh / 2) * imageHeight
  const top = Math.min(0, Math.max(1 - imageHeight, centered))

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)} style={{ aspectRatio: String(COVER_ASPECT) }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- кадр отдаёт защищённый маршрут */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute max-w-none select-none"
        style={{ width: `${100 / bw}%`, left: `${(-bx / bw) * 100}%`, top: `${top * 100}%` }}
      />
    </div>
  )
}

// Обложка не уже 55% экрана: иначе на карточке остаётся одна кнопка без окружения. Если область
// в рабочей части экрана, меню слева (256px на настольном кадре) в обложку не берём.
const SIDEBAR_PX = 256

function widen([x, y, w, h]: ShotBox, shotWidth: number): ShotBox {
  const sidebar = shotWidth >= 1000 ? SIDEBAR_PX / shotWidth : 0
  const floor = sidebar && x >= sidebar - 0.01 ? sidebar : 0
  const width = Math.min(1 - floor, Math.max(0.55, w + 0.08))
  const left = Math.min(Math.max(floor, x + w / 2 - width / 2), 1 - width)
  return [left, y, width, h]
}
