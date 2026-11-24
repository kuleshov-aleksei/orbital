// Copying chat images to the system clipboard (docs/specs/CHAT_SYSTEM.md §7.12).
//
// The Async Clipboard API accepts image/png only, so other formats (JPEG, WebP,
// AVIF, SVG, GIF's first frame) are rasterized through a canvas first.
//
// The bytes come from GET /api/attachments/{id}/file, not the presigned URL the
// <img> shows: the bucket is a different origin and sends no CORS headers, so
// JavaScript cannot read the already-loaded image (a canvas would be tainted).
// The same-origin endpoint also does not depend on the bucket's CORS setup.
import { apiService, type ApiError } from "@/services/api"
import { isCapacitor } from "@/services/platform"

export type CopyImageErrorReason = "unsupported" | "gone" | "blocked" | "failed"

/** A copy that failed for a reason worth telling the user about. */
export class CopyImageError extends Error {
  readonly reason: CopyImageErrorReason

  constructor(reason: CopyImageErrorReason) {
    super(`copy image: ${reason}`)
    this.name = "CopyImageError"
    this.reason = reason
  }
}

/**
 * Whether this client can put an image on the clipboard. False in the Android
 * app: its WebView does not reliably write images (a native plugin would be
 * needed), so the action is hidden there rather than shown and broken.
 */
export function clipboardImageSupported(): boolean {
  if (typeof navigator === "undefined" || isCapacitor()) return false
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false
  if (typeof window !== "undefined" && window.isSecureContext === false) return false
  // Safari before 18.4 has no supports(); assume it can (it writes images since 13.1).
  const supports = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports
  return typeof supports !== "function" || supports("image/png")
}

/**
 * Copy an image attachment to the clipboard. Throws CopyImageError so the
 * caller can explain what went wrong (see copyImageErrorText).
 */
export async function copyImageToClipboard(id: string): Promise<void> {
  if (!clipboardImageSupported()) throw new CopyImageError("unsupported")

  let pipelineError: unknown = null
  const png = fetchPng(id).catch((err) => {
    pipelineError = err
    throw err
  })
  // write() may reject before it ever consumes the item's promise.
  void png.catch(() => {})

  try {
    // A promise value keeps the click's user activation: awaiting a slow fetch
    // before write() can exceed the browser's short activation window.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
  } catch (err) {
    if (pipelineError instanceof CopyImageError) throw pipelineError
    if (err instanceof CopyImageError) throw err
    if (
      err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "SecurityError")
    ) {
      throw new CopyImageError("blocked")
    }
    throw new CopyImageError("failed")
  }
}

/** User-facing explanation for a failed copy. */
export function copyImageErrorText(err: unknown): string {
  if (err instanceof CopyImageError) {
    if (err.reason === "gone") return "This image is no longer available."
    if (err.reason === "blocked") {
      return "The browser blocked clipboard access. Try again from the focused window."
    }
  }
  return "Could not copy the image."
}

async function fetchPng(id: string): Promise<Blob> {
  return toPngBlob(await fetchOriginal(id))
}

async function fetchOriginal(id: string): Promise<Blob> {
  try {
    const blob = await apiService.getAttachmentFile(id)
    if (!blob.size) throw new CopyImageError("failed")
    return blob
  } catch (err) {
    if (err instanceof CopyImageError) throw err
    // 404 (invisible) and 410 (removed) mean the file is not there to copy.
    const status = (err as ApiError | undefined)?.status
    if (status === 404 || status === 410) throw new CopyImageError("gone")
    throw new CopyImageError("failed")
  }
}

/** PNG as-is, everything else rasterized to PNG (only image/png is writable). */
export async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob
  return rasterizePng(blob)
}

async function rasterizePng(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob)
      try {
        return await drawPng(bitmap, bitmap.width, bitmap.height)
      } finally {
        bitmap.close?.()
      }
    } catch {
      // Safari cannot decode SVG through createImageBitmap; the <img> path can.
    }
  }
  const img = await loadImage(blob)
  return drawPng(img, img.naturalWidth || img.width, img.naturalHeight || img.height)
}

async function drawPng(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new CopyImageError("failed")
    ctx.drawImage(source, 0, 0)
    return canvas.convertToBlob({ type: "image/png" })
  }
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new CopyImageError("failed")
  ctx.drawImage(source, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((png) => (png ? resolve(png) : reject(new CopyImageError("failed"))), "image/png")
  })
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new CopyImageError("failed"))
    }
    img.src = objectUrl
  })
}
