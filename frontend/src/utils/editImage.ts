// Client-side image edits before upload: rotate by quarter turns, then crop.
// The result replaces the file the composer uploads (docs/specs/CHAT_SYSTEM.md
// §7.12); the server never sees the unedited image.

export type Rotation = 0 | 90 | 180 | 270

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** Crop is in pixels of the rotated (and EXIF-upright) image. */
export interface ImageEdit {
  rotation: Rotation
  crop: CropRect | null
}

/** Quality for lossy re-encodes: the normal (non-HD) path compresses again. */
const EDIT_QUALITY = 0.95
const KEEP_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

/** Size of a w×h image after rotation. */
export function rotatedSize(w: number, h: number, rotation: Rotation): [number, number] {
  return rotation === 90 || rotation === 270 ? [h, w] : [w, h]
}

export function rotateBy(rotation: Rotation, delta: 90 | -90): Rotation {
  return ((((rotation + delta) % 360) + 360) % 360) as Rotation
}

/** Rounds a crop to whole pixels and keeps it inside a w×h image (min 1×1). */
export function clampCrop(c: CropRect, w: number, h: number): CropRect {
  const x = Math.min(Math.max(0, Math.round(c.x)), w - 1)
  const y = Math.min(Math.max(0, Math.round(c.y)), h - 1)
  return {
    x,
    y,
    w: Math.max(1, Math.min(Math.round(c.w), w - x)),
    h: Math.max(1, Math.min(Math.round(c.h), h - y)),
  }
}

/** The largest centred rect of a given aspect ratio (w/h) inside a w×h image. */
export function centeredCrop(w: number, h: number, ratio: number): CropRect {
  let cw = w
  let ch = w / ratio
  if (ch > h) {
    ch = h
    cw = h * ratio
  }
  return clampCrop({ x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch }, w, h)
}

/** A crop corner: x/y say which edge moves (+1 = right/bottom). */
export interface CropHandle {
  sx: 1 | -1
  sy: 1 | -1
}

/**
 * Drags one corner of a crop by (dx, dy) image px, keeping the opposite corner
 * fixed, the rect inside the w×h image, at least `min` px, and at `ratio`
 * (w/h) when given.
 */
export function resizeCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  w: number,
  h: number,
  ratio: number | null,
  min: number,
): CropRect {
  const { sx, sy } = handle
  const anchorX = sx > 0 ? start.x : start.x + start.w
  const anchorY = sy > 0 ? start.y : start.y + start.h
  const cornerX = (sx > 0 ? start.x + start.w : start.x) + dx
  const cornerY = (sy > 0 ? start.y + start.h : start.y) + dy
  const availW = sx > 0 ? w - anchorX : anchorX
  const availH = sy > 0 ? h - anchorY : anchorY
  const minW = Math.min(min, availW)
  const minH = Math.min(min, availH)
  let cw = Math.min(Math.max((cornerX - anchorX) * sx, minW), availW)
  let ch = Math.min(Math.max((cornerY - anchorY) * sy, minH), availH)
  if (ratio) {
    // Shrink the longer side to the ratio, so the rect stays inside.
    if (cw / ch > ratio) cw = ch * ratio
    else ch = cw / ratio
  }
  return {
    x: sx > 0 ? anchorX : anchorX - cw,
    y: sy > 0 ? anchorY : anchorY - ch,
    w: cw,
    h: ch,
  }
}

/** Moves a crop by (dx, dy) image px, keeping it inside the w×h image. */
export function moveCrop(start: CropRect, dx: number, dy: number, w: number, h: number): CropRect {
  return {
    ...start,
    x: Math.min(Math.max(0, start.x + dx), w - start.w),
    y: Math.min(Math.max(0, start.y + dy), h - start.h),
  }
}

export function isIdentityEdit(edit: ImageEdit | null, w: number, h: number): boolean {
  if (!edit) return true
  if (edit.rotation !== 0) return false
  const c = edit.crop
  return !c || (c.x === 0 && c.y === 0 && c.w === w && c.h === h)
}

function outputType(file: File): string {
  return KEEP_TYPES.has(file.type) ? file.type : "image/png"
}

function outputName(name: string, type: string): string {
  const ext = type === "image/jpeg" ? "jpg" : type.slice("image/".length)
  const dot = name.lastIndexOf(".")
  const base = dot > 0 ? name.slice(0, dot) : name || "image"
  const cur = dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
  const same = cur === ext || (ext === "jpg" && cur === "jpeg")
  return same ? name : `${base}.${ext}`
}

/** Applies an edit to an image file; returns the file itself for a no-op edit. */
export async function editImage(file: File, edit: ImageEdit): Promise<File> {
  // from-image applies the EXIF orientation, so edits match what the user saw.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const [rw, rh] = rotatedSize(bitmap.width, bitmap.height, edit.rotation)
    if (isIdentityEdit(edit, rw, rh)) return file
    const crop = clampCrop(edit.crop ?? { x: 0, y: 0, w: rw, h: rh }, rw, rh)
    const canvas = document.createElement("canvas")
    canvas.width = crop.w
    canvas.height = crop.h
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no 2d context")
    ctx.imageSmoothingQuality = "high"
    ctx.translate(-crop.x + rw / 2, -crop.y + rh / 2)
    ctx.rotate((edit.rotation * Math.PI) / 180)
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
    const type = outputType(file)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, EDIT_QUALITY),
    )
    if (!blob) throw new Error("encode failed")
    // A browser without an encoder for the type (WebP on Safari) returns PNG.
    return new File([blob], outputName(file.name, blob.type), {
      type: blob.type,
      lastModified: Date.now(),
    })
  } finally {
    bitmap.close()
  }
}
