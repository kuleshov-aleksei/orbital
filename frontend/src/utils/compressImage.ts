// Client-side image compression before upload (docs/specs/CHAT_SYSTEM.md
// §7.12). It only saves bandwidth: the server applies the same rule to
// whatever arrives (backend/internal/service/chatmedia/image.go).

// Keep in sync with maxStoredEdge / storedWebPQuality in image.go.
export const MAX_STORED_EDGE = 2560
export const WEBP_QUALITY = 0.85
/** A decode/encode that takes longer gives up and sends the original. */
const COMPRESS_TIMEOUT_MS = 10_000

/** Scales w×h down (never up) to fit a box×box square. */
export function fitBox(w: number, h: number, box: number): [number, number] {
  if (w <= box && h <= box) return [w, h]
  if (w >= h) return [box, Math.max(1, Math.floor((h * box) / w))]
  return [Math.max(1, Math.floor((w * box) / h)), box]
}

/** VP8X animation flag (same check as animatedWebP in sniff.go). */
export function isAnimatedWebP(head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  return (
    head.length >= 21 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 12) === "WEBP" &&
    ascii(12, 16) === "VP8X" &&
    (head[20] & 0x02) !== 0
  )
}

/** Files the server keeps byte-for-byte (animations): never re-encode. */
async function keepAsIs(file: File): Promise<boolean> {
  if (file.type === "image/gif" || /\.gif$/i.test(file.name)) return true
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  if (String.fromCharCode(...head.subarray(0, 6)).startsWith("GIF8")) return true
  return isAnimatedWebP(head)
}

function webpName(name: string): string {
  const dot = name.lastIndexOf(".")
  return `${dot > 0 ? name.slice(0, dot) : name || "image"}.webp`
}

async function encode(bitmap: ImageBitmap, w: number, h: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY })
  }
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(bitmap, 0, 0, w, h)
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY))
}

async function compress(file: File): Promise<File | null> {
  if (await keepAsIs(file)) return null
  // from-image applies the EXIF orientation, so the result is upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const [w, h] = fitBox(bitmap.width, bitmap.height, MAX_STORED_EDGE)
    const blob = await encode(bitmap, w, h)
    // Browsers without a WebP encoder (Safari) silently return PNG.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return null
    return new File([blob], webpName(file.name), {
      type: "image/webp",
      lastModified: file.lastModified,
    })
  } finally {
    bitmap.close()
  }
}

/**
 * A smaller WebP copy of a still image, or null to upload the original
 * (animation, no encoder, no gain, error or timeout).
 */
export async function compressImage(file: File): Promise<File | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), COMPRESS_TIMEOUT_MS)
  })
  try {
    return await Promise.race([compress(file).catch(() => null), timeout])
  } finally {
    clearTimeout(timer)
  }
}
