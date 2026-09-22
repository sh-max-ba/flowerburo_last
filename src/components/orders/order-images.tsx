"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ImageIcon,
  ImagePlusIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { OrderImage } from "@/lib/db"
import { uploadOrderImageFile } from "@/lib/image-upload"
import { getSafeOrderImagePath, maxOrderImageFileSize, maxOrderImages, orderImageIdsFieldName } from "@/lib/order-images"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

// Изображения заказа: поле формы (загрузка + список + удаление), полоса миниатюр для карточек
// и полноэкранный просмотр. Файл уходит на сервер сразу при выборе (см. uploadOrderImageFile),
// форма заказа получает только id через скрытое поле orderImageIds.

const thumbSizeClasses = {
  sm: "size-14",
  md: "size-20",
  lg: "size-24",
} as const

type ThumbSize = keyof typeof thumbSizeClasses

function imageSrc(image: OrderImage, variant: "thumb" | "full") {
  const candidate = variant === "thumb" ? image.thumbPath || image.imagePath : image.imagePath
  return getSafeOrderImagePath(candidate)
}

function imageAlt(image: OrderImage, index: number) {
  return image.originalName || `Фото ${index + 1}`
}

// ---------------------------------------------------------------------------------------------
// Миниатюра
// ---------------------------------------------------------------------------------------------

function OrderImageThumb({
  image,
  index,
  size,
  onOpen,
  className,
}: {
  image: OrderImage
  index: number
  size: ThumbSize
  onOpen: () => void
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const src = imageSrc(image, "thumb")

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Открыть просмотр"
      className={cn(
        "group relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        thumbSizeClasses[size],
        className
      )}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={imageAlt(image, index)}
          loading="lazy"
          className="size-full object-cover transition-transform group-hover:scale-105"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageIcon className="size-5 text-muted-foreground" />
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------------------------
// Полоса миниатюр для карточек (стол заказов, готовые, черновики, сделка)
// ---------------------------------------------------------------------------------------------

export function OrderImageStrip({
  images,
  size = "md",
  title = "Фото к заказу",
  className,
}: {
  images: OrderImage[]
  size?: ThumbSize
  // Подпись над полосой; пустая строка — без подписи.
  title?: string
  className?: string
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  if (!images.length) {
    return null
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {title && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ImageIcon className="size-4" />
          <span>
            {title} · {images.length}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {images.map((image, index) => (
          <OrderImageThumb key={image.id} image={image} index={index} size={size} onOpen={() => setOpenIndex(index)} />
        ))}
      </div>
      <OrderImageLightbox images={images} index={openIndex} onIndexChange={setOpenIndex} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Полноэкранный просмотр: листание (кнопки, стрелки, свайп), счётчик, зум по клику, оригинал
// ---------------------------------------------------------------------------------------------

export function OrderImageLightbox({
  images,
  index,
  onIndexChange,
}: {
  images: OrderImage[]
  // null — закрыт.
  index: number | null
  onIndexChange: (index: number | null) => void
}) {
  const open = index !== null && index >= 0 && index < images.length
  const current = open ? images[index] : null
  const count = images.length

  const go = useCallback(
    (delta: number) => {
      if (index === null || count <= 1) {
        return
      }
      onIndexChange((index + delta + count) % count)
    },
    [count, index, onIndexChange]
  )

  useEffect(() => {
    if (!open) {
      return
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") {
        event.preventDefault()
        go(1)
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        go(-1)
      }
    }
    // Capture-фаза на document: внутри base-ui Dialog keydown до window не всплывает.
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [go, open])

  const fullSrc = current ? imageSrc(current, "full") : ""

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onIndexChange(null)}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-1rem)] max-h-none w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl bg-zinc-950 p-0 text-zinc-100 ring-zinc-800 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1400px]"
      >
        <DialogTitle className="sr-only">Просмотр фото к заказу</DialogTitle>

        {/* Верхняя панель: счётчик, имя файла, оригинал, закрыть. */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            {count > 1 && (
              <span className="shrink-0 rounded-full bg-zinc-800 px-2.5 py-0.5 tabular-nums">
                {(index ?? 0) + 1} / {count}
              </span>
            )}
            {current?.originalName && <span className="truncate text-zinc-400">{current.originalName}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {fullSrc && (
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-200 hover:bg-zinc-800 hover:text-white"
                render={<a href={fullSrc} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                Оригинал
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-200 hover:bg-zinc-800 hover:text-white"
              onClick={() => onIndexChange(null)}
              aria-label="Закрыть"
            >
              <XIcon />
            </Button>
          </div>
        </div>

        {/* Кадр. key по id — зум и индикатор загрузки сбрасываются при смене фото. */}
        <div className="relative min-h-0 flex-1">
          {current && fullSrc && (
            <LightboxFrame
              key={current.id}
              src={fullSrc}
              alt={imageAlt(current, index ?? 0)}
              canSwipe={count > 1}
              onSwipe={go}
            />
          )}

          {count > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Предыдущее фото"
                className="absolute top-1/2 left-2 size-12 -translate-y-1/2 rounded-full bg-zinc-900/70 text-zinc-100 hover:bg-zinc-800 hover:text-white [&_svg]:size-6"
                onClick={() => go(-1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Следующее фото"
                className="absolute top-1/2 right-2 size-12 -translate-y-1/2 rounded-full bg-zinc-900/70 text-zinc-100 hover:bg-zinc-800 hover:text-white [&_svg]:size-6"
                onClick={() => go(1)}
              >
                <ChevronRightIcon />
              </Button>
            </>
          )}
        </div>

        {/* Лента миниатюр внизу — быстрый переход между фото. */}
        {count > 1 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto px-3 py-2">
            {images.map((image, imageIndex) => {
              const src = imageSrc(image, "thumb")
              const active = imageIndex === index
              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => onIndexChange(imageIndex)}
                  className={cn(
                    "size-14 shrink-0 overflow-hidden rounded-lg border-2 bg-zinc-900",
                    active ? "border-white" : "border-transparent opacity-60 hover:opacity-100"
                  )}
                  aria-label={`Фото ${imageIndex + 1}`}
                >
                  {src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" className="size-full object-cover" draggable={false} />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Один кадр просмотра: зум по тапу/клику, свайп для листания, индикатор загрузки.
function LightboxFrame({
  src,
  alt,
  canSwipe,
  onSwipe,
}: {
  src: string
  alt: string
  canSwipe: boolean
  onSwipe: (delta: number) => void
}) {
  const [zoomed, setZoomed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)

  function onPointerDown(event: React.PointerEvent) {
    pointerStart.current = { x: event.clientX, y: event.clientY }
  }

  function onPointerUp(event: React.PointerEvent) {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start) {
      return
    }
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    // Горизонтальный свайп — листание (только без зума, в зуме палец скроллит картинку).
    if (canSwipe && !zoomed && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      onSwipe(dx < 0 ? 1 : -1)
      return
    }
    // Короткий тап/клик — переключить зум.
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      setZoomed((value) => !value)
    }
  }

  return (
    <div
      className={cn(
        "size-full touch-pan-y select-none",
        zoomed ? "cursor-zoom-out overflow-auto" : "flex cursor-zoom-in items-center justify-center overflow-hidden"
      )}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={cn(
          "transition-opacity",
          loaded ? "opacity-100" : "opacity-0",
          zoomed ? "h-auto max-h-none w-auto max-w-none" : "max-h-full max-w-full object-contain"
        )}
      />
      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2Icon className="size-8 animate-spin text-zinc-500" />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Поле формы: загрузка (кнопка / перетаскивание / вставка из буфера), список, удаление
// ---------------------------------------------------------------------------------------------

type UploadingEntry = {
  key: string
  name: string
  previewUrl: string
  progress: number
}

export type OrderImagesUpdater = (current: OrderImage[]) => OrderImage[]

export function OrderImagesField({
  images,
  onChange,
  disabled,
  label = "Фото к заказу",
  size = "md",
  className,
}: {
  images: OrderImage[]
  // Функциональное обновление (как у setState): параллельные загрузки не затирают друг друга.
  onChange: (update: OrderImagesUpdater) => void
  disabled?: boolean
  label?: string
  size?: ThumbSize
  className?: string
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<UploadingEntry[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const uploadingCount = uploading.length
  const remaining = Math.max(0, maxOrderImages - images.length - uploadingCount)
  const canAdd = !disabled && remaining > 0

  const addFiles = useCallback(
    (fileList: FileList | File[] | null | undefined) => {
      if (!fileList || disabled) {
        return
      }
      // Принимаем всё, что похоже на изображение; финальную проверку делает сервер (sharp).
      const files = Array.from(fileList).filter(
        (file) => file.type.startsWith("image/") || !file.type || /\.(heic|heif|jpe?g|png|gif|webp|bmp|tiff?|avif|svg)$/i.test(file.name)
      )
      if (!files.length) {
        toast.error("Можно прикрепить только изображения.")
        return
      }
      const slots = maxOrderImages - images.length - uploadingCount
      if (slots <= 0) {
        toast.error(`Не больше ${maxOrderImages} фото на заказ.`)
        return
      }
      const accepted = files.slice(0, slots)
      if (accepted.length < files.length) {
        toast.error(`Не больше ${maxOrderImages} фото на заказ — лишние пропущены.`)
      }

      for (const file of accepted) {
        if (file.size > maxOrderImageFileSize) {
          toast.error(`«${file.name}»: файл больше ${Math.round(maxOrderImageFileSize / 1024 / 1024)} MB.`)
          continue
        }
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const previewUrl = URL.createObjectURL(file)
        setUploading((current) => [...current, { key, name: file.name, previewUrl, progress: 0 }])

        uploadOrderImageFile(file, (fraction) => {
          setUploading((current) =>
            current.map((entry) => (entry.key === key ? { ...entry, progress: fraction } : entry))
          )
        })
          .then((image) => {
            onChange((current) => (current.length < maxOrderImages ? [...current, image] : current))
          })
          .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : "Не удалось загрузить изображение.")
          })
          .finally(() => {
            URL.revokeObjectURL(previewUrl)
            setUploading((current) => current.filter((entry) => entry.key !== key))
          })
      }
    },
    [disabled, images.length, onChange, uploadingCount]
  )

  // Вставка из буфера (Ctrl+V / ⌘V скриншота или скопированного фото из мессенджера).
  useEffect(() => {
    if (disabled) {
      return
    }
    function onPaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"))
      if (!files.length) {
        return
      }
      event.preventDefault()
      addFiles(files)
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [addFiles, disabled])

  function remove(imageId: number) {
    onChange((current) => current.filter((image) => image.id !== imageId))
  }

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      onDragOver={(event) => {
        if (!canAdd) {
          return
        }
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (!canAdd) {
          return
        }
        event.preventDefault()
        setDragOver(false)
        addFiles(event.dataTransfer.files)
      }}
    >
      <input type="hidden" name={orderImageIdsFieldName} value={images.map((image) => image.id).join(",")} />
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        disabled={!canAdd}
        onChange={(event) => {
          addFiles(event.target.files)
          // Сброс, чтобы повторный выбор того же файла снова вызвал onChange.
          event.target.value = ""
        }}
      />

      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {label}
          {images.length > 0 && <span className="ml-1.5 text-muted-foreground">{images.length}</span>}
        </label>
        <span className="text-xs text-muted-foreground">Любой формат · до {maxOrderImages} шт.</span>
      </div>

      <div
        className={cn(
          "flex flex-wrap gap-2 rounded-xl border border-dashed p-2 transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border/60"
        )}
      >
        {images.map((image, index) => (
          <div key={image.id} className="relative">
            <OrderImageThumb image={image} index={index} size={size} onOpen={() => setOpenIndex(index)} />
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(image.id)}
                aria-label="Убрать фото"
                title="Убрать фото"
                className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border bg-white text-zinc-700 shadow-sm hover:bg-red-50 hover:text-red-700"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        ))}

        {uploading.map((entry) => (
          <div
            key={entry.key}
            className={cn(
              "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted",
              thumbSizeClasses[size]
            )}
            title={entry.name}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={entry.previewUrl} alt="" className="size-full object-cover opacity-40" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs font-medium">
              <Loader2Icon className="size-5 animate-spin" />
              <span className="tabular-nums">{Math.round(entry.progress * 100)}%</span>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!canAdd}
          className={cn(
            "flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-muted/40 text-xs text-muted-foreground transition-colors",
            "hover:border-zinc-400 hover:bg-zinc-50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            thumbSizeClasses[size]
          )}
        >
          <ImagePlusIcon className="size-5" />
          <span>Добавить</span>
        </button>

        {images.length === 0 && uploading.length === 0 && (
          <div className="hidden flex-1 items-center self-stretch px-2 text-xs text-muted-foreground sm:flex">
            Нажмите «Добавить», перетащите файл сюда или вставьте из буфера (Ctrl+V).
          </div>
        )}
      </div>

      <OrderImageLightbox images={images} index={openIndex} onIndexChange={setOpenIndex} />
    </div>
  )
}
