import { afterEach, describe, expect, it, vi } from "vitest"
import {
  centeredCrop,
  clampCrop,
  editImage,
  isIdentityEdit,
  moveCrop,
  resizeCrop,
  rotateBy,
  rotatedSize,
} from "./editImage"

describe("rotation", () => {
  it("swaps sides on quarter turns", () => {
    expect(rotatedSize(400, 300, 0)).toEqual([400, 300])
    expect(rotatedSize(400, 300, 90)).toEqual([300, 400])
    expect(rotatedSize(400, 300, 180)).toEqual([400, 300])
    expect(rotatedSize(400, 300, 270)).toEqual([300, 400])
  })

  it("wraps around", () => {
    expect(rotateBy(0, -90)).toBe(270)
    expect(rotateBy(270, 90)).toBe(0)
    expect(rotateBy(90, 90)).toBe(180)
  })
})

describe("crop geometry", () => {
  it("centres the largest rect of a ratio", () => {
    expect(centeredCrop(400, 300, 1)).toEqual({ x: 50, y: 0, w: 300, h: 300 })
    expect(centeredCrop(300, 400, 16 / 9)).toEqual({ x: 0, y: 116, w: 300, h: 169 })
  })

  it("clamps a crop into the image", () => {
    expect(clampCrop({ x: -10, y: 20.4, w: 500, h: 50.6 }, 400, 300)).toEqual({
      x: 0,
      y: 20,
      w: 400,
      h: 51,
    })
  })

  it("resizes from the bottom-right corner, bounded by the image", () => {
    const start = { x: 100, y: 100, w: 100, h: 100 }
    expect(resizeCrop(start, { sx: 1, sy: 1 }, 50, 20, 400, 300, null, 10)).toEqual({
      x: 100,
      y: 100,
      w: 150,
      h: 120,
    })
    expect(resizeCrop(start, { sx: 1, sy: 1 }, 1000, 1000, 400, 300, null, 10)).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 200,
    })
  })

  it("resizes from the top-left corner keeping the opposite corner", () => {
    const start = { x: 100, y: 100, w: 100, h: 100 }
    const r = resizeCrop(start, { sx: -1, sy: -1 }, -500, 90, 400, 300, null, 20)
    // Left edge stops at 0; the top edge can't pass the minimum size.
    expect(r).toEqual({ x: 0, y: 180, w: 200, h: 20 })
  })

  it("keeps a locked ratio inside the image", () => {
    const start = { x: 0, y: 0, w: 100, h: 100 }
    const r = resizeCrop(start, { sx: 1, sy: 1 }, 1000, 50, 400, 300, 1, 10)
    expect(r).toEqual({ x: 0, y: 0, w: 150, h: 150 })
    const wide = resizeCrop(start, { sx: 1, sy: 1 }, 1000, 1000, 400, 300, 16 / 9, 10)
    expect(wide.w / wide.h).toBeCloseTo(16 / 9)
    expect(wide.w).toBeLessThanOrEqual(400)
    expect(wide.h).toBeLessThanOrEqual(300)
  })

  it("moves without leaving the image", () => {
    const start = { x: 100, y: 100, w: 100, h: 100 }
    expect(moveCrop(start, 500, -500, 400, 300)).toEqual({ x: 300, y: 0, w: 100, h: 100 })
  })

  it("treats a full, unrotated crop as no edit", () => {
    expect(isIdentityEdit(null, 400, 300)).toBe(true)
    expect(isIdentityEdit({ rotation: 0, crop: { x: 0, y: 0, w: 400, h: 300 } }, 400, 300)).toBe(
      true,
    )
    expect(isIdentityEdit({ rotation: 90, crop: null }, 300, 400)).toBe(false)
    expect(isIdentityEdit({ rotation: 0, crop: { x: 1, y: 0, w: 399, h: 300 } }, 400, 300)).toBe(
      false,
    )
  })
})

describe("editImage", () => {
  afterEach(() => vi.unstubAllGlobals())

  function stub(w: number, h: number, outType: string) {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        translate: vi.fn(),
        rotate: vi.fn(),
        drawImage: vi.fn(),
        imageSmoothingQuality: "",
      }),
      toBlob: (cb: (b: Blob) => void) => cb(new Blob(["x"], { type: outType })),
    }
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: w, height: h, close: vi.fn() })),
    )
    vi.stubGlobal("document", { createElement: () => canvas })
    return canvas
  }

  it("returns the file itself for a no-op edit", async () => {
    stub(400, 300, "image/jpeg")
    const file = new File(["abc"], "a.jpg", { type: "image/jpeg" })
    expect(await editImage(file, { rotation: 0, crop: null })).toBe(file)
  })

  it("outputs the crop size in the source type", async () => {
    const canvas = stub(400, 300, "image/jpeg")
    const file = new File(["abc"], "photo.jpeg", { type: "image/jpeg" })
    const out = await editImage(file, { rotation: 90, crop: { x: 10, y: 20, w: 200, h: 100 } })
    expect([canvas.width, canvas.height]).toEqual([200, 100])
    expect(out.type).toBe("image/jpeg")
    expect(out.name).toBe("photo.jpeg")
  })

  it("renames when the browser falls back to PNG", async () => {
    stub(400, 300, "image/png")
    const file = new File(["abc"], "shot.webp", { type: "image/webp" })
    const out = await editImage(file, { rotation: 180, crop: null })
    expect(out.name).toBe("shot.png")
  })
})
