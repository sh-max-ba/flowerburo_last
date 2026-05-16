export const productImagePublicPathPrefix = "/uploads/products/"

export function getSafeProductImagePath(value: unknown) {
  if (typeof value !== "string") {
    return ""
  }

  const path = value.trim()
  if (!path.startsWith(productImagePublicPathPrefix)) {
    return ""
  }

  const filename = path.slice(productImagePublicPathPrefix.length)
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return ""
  }

  return path
}
