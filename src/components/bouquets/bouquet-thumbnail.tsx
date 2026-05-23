"use client"

import { ImageIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { getSafeBouquetImagePath } from "@/lib/product-images"
import { cn } from "@/lib/utils"

type BouquetThumbnailSize = "sm" | "md" | "lg" | "xl"

type BouquetThumbnailProps = {
  name: string
  imagePath?: string | null
  size?: BouquetThumbnailSize
  className?: string
  cacheKey?: string | number
}

const sizeClasses: Record<BouquetThumbnailSize, string> = {
  sm: "size-9",
  md: "size-10",
  lg: "size-12",
  xl: "size-28",
}

export function BouquetThumbnail({
  name,
  imagePath,
  size = "md",
  className,
  cacheKey,
}: BouquetThumbnailProps) {
  const safePath = getSafeBouquetImagePath(imagePath)
  const [failedPath, setFailedPath] = useState("")
  const src = useMemo(() => {
    if (!safePath || safePath === failedPath) {
      return ""
    }

    return cacheKey === undefined ? safePath : `${safePath}?v=${encodeURIComponent(String(cacheKey))}`
  }, [cacheKey, failedPath, safePath])

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground",
        sizeClasses[size],
        className
      )}
      aria-hidden={!src}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
          onError={() => setFailedPath(safePath)}
        />
      ) : name ? (
        <span className="text-xs font-medium uppercase">{name.trim().slice(0, 1)}</span>
      ) : (
        <ImageIcon className="size-4" />
      )}
    </span>
  )
}
