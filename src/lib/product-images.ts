export const productImagePublicPathPrefix = "/uploads/products/"
export const bouquetImagePublicPathPrefix = "/uploads/bouquets/"

const uploadImagePublicPathPrefixes = [productImagePublicPathPrefix, bouquetImagePublicPathPrefix]

export function getSafeProductImagePath(value: unknown) {
  return getSafeUploadImagePath(value, [productImagePublicPathPrefix])
}

export function getSafeBouquetImagePath(value: unknown) {
  return getSafeUploadImagePath(value, [bouquetImagePublicPathPrefix])
}

export function getSafeUploadImagePath(value: unknown, prefixes = uploadImagePublicPathPrefixes) {
  if (typeof value !== "string") {
    return ""
  }

  const imagePath = value.trim()
  const prefix = prefixes.find((candidate) => imagePath.startsWith(candidate))
  if (!prefix) {
    return ""
  }

  const filename = imagePath.slice(prefix.length)
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return ""
  }

  return imagePath
}
