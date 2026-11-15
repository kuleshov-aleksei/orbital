import { afterEach, describe, expect, it, vi } from "vitest"
import { compressImage, fitBox, isAnimatedWebP, MAX_STORED_EDGE } from "./compressImage"

function bytes(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/** RIFF/WEBP/VP8X header with the given flags byte. */
function vp8x(flags: number): Uint8Array<ArrayBuffer> {
  const head = bytes("RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0\0\0\0\0\0\0")
  head[20] = flags
  return head
}

/** Stubs the canvas pipeline: a bitmap of w×h encoding to a blob of the given size and type. */
function stubCanvas(w: number, h: number, outSize: number, outType = "image/webp") {
  const drawn: number[][] = []
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: w, height: h, close: vi.fn() })),
  )
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return {
          imageSmoothingQuality: "low",
          drawImage: (_b: unknown, _x: number, _y: number, dw: number, dh: number) =>
            drawn.push([dw, dh]),
        }
      }
      async convertToBlob() {
        return new Blob([new Uint8Array(outSize)], { type: outType })
      }
    },
  )
  return drawn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("fitBox", () => {
  it("scales down to the long edge and never up", () => {
    expect(fitBox(4000, 3000, MAX_STORED_EDGE)).toEqual([2560, 1920])
    expect(fitBox(1000, 5000, MAX_STORED_EDGE)).toEqual([512, 2560])
    expect(fitBox(800, 600, MAX_STORED_EDGE)).toEqual([800, 600])
  })
})

describe("isAnimatedWebP", () => {
  it("reads the VP8X animation flag", () => {
    expect(isAnimatedWebP(vp8x(0x02))).toBe(true)
    expect(isAnimatedWebP(vp8x(0x10))).toBe(false)
    expect(isAnimatedWebP(bytes("RIFF\0\0\0\0WEBPVP8 \0\0\0\0\0\0\0\0\0\0"))).toBe(false)
  })
})

describe("compressImage", () => {
  it("leaves GIFs and animated WebPs alone", async () => {
    stubCanvas(100, 100, 10)
    const gif = new File([bytes("GIF89a....")], "a.gif", { type: "image/gif" })
    const anim = new File([vp8x(0x02)], "a.webp", { type: "image/webp" })
    expect(await compressImage(gif)).toBeNull()
    expect(await compressImage(anim)).toBeNull()
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it("resizes into the box and renames to .webp", async () => {
    const drawn = stubCanvas(4000, 3000, 500)
    const photo = new File([new Uint8Array(5000)], "IMG_1.jpeg", { type: "image/jpeg" })
    const out = await compressImage(photo)
    expect(out?.name).toBe("IMG_1.webp")
    expect(out?.type).toBe("image/webp")
    expect(out?.size).toBe(500)
    expect(drawn).toEqual([[2560, 1920]])
  })

  it("sends the original when the result is not smaller", async () => {
    stubCanvas(100, 100, 5000)
    const small = new File([new Uint8Array(1000)], "s.png", { type: "image/png" })
    expect(await compressImage(small)).toBeNull()
  })

  it("sends the original without a WebP encoder", async () => {
    stubCanvas(100, 100, 10, "image/png")
    const png = new File([new Uint8Array(1000)], "s.png", { type: "image/png" })
    expect(await compressImage(png)).toBeNull()
  })

  it("sends the original when decoding fails", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("decode")
      }),
    )
    const bad = new File([new Uint8Array(10)], "x.png", { type: "image/png" })
    expect(await compressImage(bad)).toBeNull()
  })
})
