"use client"

import { useState } from "react"
import { Maximize2Icon, ScanIcon, ZoomInIcon } from "lucide-react"

import { unionBox } from "@/lib/guides/geometry"
import type { ShotBox, ShotMeta, ShotRef } from "@/lib/guides/types"
import { cn } from "@/lib/utils"

type GuideShotProps = {
  shot: ShotRef
  meta: ShotMeta
  src: string
  // Номер шага — на рамке подсвеченной области, чтобы связать текст и экран.
  step?: number
  // Обложка карточки: без подсветки, меток и кнопок.
  cover?: boolean
  eager?: boolean
  className?: string
}

// Поля вокруг области при кадрировании — в долях ширины/высоты кадра.
const CROP_PAD_X = 0.035
const CROP_PAD_Y = 0.05
// Кадр не приближаем сильнее, чем до 40% ширины экрана — иначе теряется, где это.
const CROP_MIN_W = 0.4

// Скриншот настоящего экрана с подсветкой места, куда нажимать. Области (focus/crop/marks)
// заданы в долях кадра, поэтому подсветка остаётся на месте при любой ширине.
export function GuideShot({ shot, meta, src, step, cover = false, eager = false, className }: GuideShotProps) {
  const cropBox = unionBox(meta, shot.crop)
  const [whole, setWhole] = useState(false)
  const view: ShotBox = cropBox && !whole ? expandBox(cropBox, meta.width) : [0, 0, 1, 1]
  const [vx, vy, vw, vh] = view
  const aspect = (vw * meta.width) / (vh * meta.height)
  const focus = !cover && shot.focus ? meta.targets[shot.focus] : undefined
  const marks = cover ? [] : (shot.marks ?? []).map((name) => meta.targets[name]).filter(Boolean)
  const place = (box: ShotBox) => ({
    left: `${((box[0] - vx) / vw) * 100}%`,
    top: `${((box[1] - vy) / vh) * 100}%`,
    width: `${(box[2] / vw) * 100}%`,
    height: `${(box[3] / vh) * 100}%`,
  })

  const frame = (
    <div
      className="relative w-full overflow-hidden bg-muted"
      style={{ aspectRatio: String(aspect) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- кадр отдаёт защищённый маршрут, оптимизатор без cookie его не получит */}
      <img
        src={src}
        alt={cover ? "" : shot.alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          width: `${100 / vw}%`,
          left: `${(-vx / vw) * 100}%`,
          top: `${(-vy / vh) * 100}%`,
        }}
      />
      {focus ? (
        <div aria-hidden className="guide-spotlight pointer-events-none absolute rounded-[10px]" style={place(padBox(focus))}>
          {step ? (
            <span className="absolute -top-3 -left-3 flex size-7 items-center justify-center rounded-full bg-brand-strong text-sm font-semibold text-white shadow-md ring-2 ring-white">
              {step}
            </span>
          ) : null}
        </div>
      ) : null}
      {marks.map((box, index) => (
        <div
          key={index}
          aria-hidden
          className="pointer-events-none absolute rounded-lg outline-2 outline-offset-2 outline-brand-strong/80 outline-dashed"
          style={place(box)}
        >
          <span className="absolute -top-3 -left-3 flex size-7 items-center justify-center rounded-full bg-brand-strong text-sm font-semibold text-white shadow-md ring-2 ring-white">
            {index + 1}
          </span>
        </div>
      ))}
    </div>
  )

  if (cover) {
    return <div className={cn("overflow-hidden", className)}>{frame}</div>
  }

  return (
    <figure
      className={cn("group/shot mx-auto overflow-hidden rounded-xl bg-background shadow-xs ring-1 ring-foreground/8", className)}
      // Высокий кадр (телефон, длинная карточка) не растягиваем на всю ширину — не выше 75% экрана,
      // но и не мельче оригинала: иначе текст на скриншоте не прочитать.
      style={{ maxWidth: `min(100%, max(${Math.round(vw * meta.width)}px, calc(75vh * ${aspect.toFixed(3)})))` }}
    >
      {frame}
      <figcaption className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/50 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ScanIcon className="size-3.5 shrink-0" aria-hidden />
          Настоящий экран FlowerBuro
        </span>
        <span className="flex items-center gap-1">
          {cropBox ? (
            <button
              type="button"
              onClick={() => setWhole((value) => !value)}
              aria-pressed={whole}
              className="flex h-9 items-center gap-1.5 rounded-md px-2 font-medium text-foreground/80 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
            >
              <Maximize2Icon className="size-3.5" aria-hidden />
              {whole ? "Крупно" : "Весь экран"}
            </button>
          ) : null}
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-1.5 rounded-md px-2 font-medium text-foreground/80 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35"
          >
            <ZoomInIcon className="size-3.5" aria-hidden />
            Открыть в полном размере
            <span className="sr-only"> (в новой вкладке)</span>
          </a>
        </span>
      </figcaption>
    </figure>
  )
}

// Меню слева на настольном экране — 256px: если область правее, в кадр его не берём.
const SIDEBAR_PX = 256

function expandBox([x, y, w, h]: ShotBox, shotWidth: number): ShotBox {
  const sidebar = shotWidth >= 1000 ? SIDEBAR_PX / shotWidth : 0
  const floor = sidebar && x >= sidebar - 0.01 ? sidebar : 0
  let width = w + CROP_PAD_X * 2
  let left = x - CROP_PAD_X
  if (width < CROP_MIN_W) {
    left -= (CROP_MIN_W - width) / 2
    width = CROP_MIN_W
  }
  width = Math.min(1 - floor, width)
  left = Math.min(Math.max(floor, left), 1 - width)
  const height = Math.min(1, h + CROP_PAD_Y * 2)
  const top = y - CROP_PAD_Y
  return clampBox([left, top, width, height])
}

// Подсветка чуть шире самой кнопки — рамка не режет подпись.
function padBox([x, y, w, h]: ShotBox): ShotBox {
  const pad = 0.004
  return [x - pad, y - pad * 1.6, w + pad * 2, h + pad * 3.2]
}

function clampBox([x, y, w, h]: ShotBox): ShotBox {
  const left = Math.min(Math.max(0, x), 1 - w)
  const top = Math.min(Math.max(0, y), 1 - h)
  return [left, top, w, h]
}
