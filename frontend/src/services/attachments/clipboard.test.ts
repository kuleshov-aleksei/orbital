import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ getAttachmentFile: vi.fn() }))
vi.mock("@/services/api", () => ({ apiService: api }))

const platform = vi.hoisted(() => ({ isCapacitor: vi.fn(() => false) }))
vi.mock("@/services/platform", () => platform)

import {
  CopyImageError,
  clipboardImageSupported,
  copyImageToClipboard,
  copyImageErrorText,
  toPngBlob,
} from "./clipboard"

class FakeClipboardItem {
  static supports = vi.fn(() => true)
  items: Record<string, unknown>

  constructor(items: Record<string, unknown>) {
    this.items = items
  }
}

const writeMock = vi.fn()
const fetchMock = vi.fn()

/** Like a browser: write() awaits the item's promise values. */
async function consumeItems(items: FakeClipboardItem[]) {
  for (const item of items) {
    for (const value of Object.values(item.items)) await value
  }
}

const pngBlob = (text = "png") => new Blob([text], { type: "image/png" })

function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status })
}

beforeEach(() => {
  vi.clearAllMocks()
  writeMock.mockReset().mockImplementation(consumeItems)
  fetchMock.mockReset()
  api.getAttachmentFile.mockReset()
  vi.stubGlobal("ClipboardItem", FakeClipboardItem)
  vi.stubGlobal("navigator", { clipboard: { write: writeMock } })
  vi.stubGlobal("fetch", fetchMock)
  Object.assign(window as object, { isSecureContext: true })
  FakeClipboardItem.supports.mockReturnValue(true)
  platform.isCapacitor.mockReturnValue(false)
})

describe("clipboardImageSupported", () => {
  it("is true on the web and in Electron", () => {
    expect(clipboardImageSupported()).toBe(true)
  })

  it("is false in the Android app", () => {
    platform.isCapacitor.mockReturnValue(true)
    expect(clipboardImageSupported()).toBe(false)
  })

  it("is false in an insecure context", () => {
    Object.assign(window as object, { isSecureContext: false })
    expect(clipboardImageSupported()).toBe(false)
  })

  it("is false when the browser cannot write PNG", () => {
    FakeClipboardItem.supports.mockReturnValue(false)
    expect(clipboardImageSupported()).toBe(false)
  })

  it("is false without the Clipboard API", () => {
    vi.stubGlobal("ClipboardItem", undefined)
    expect(clipboardImageSupported()).toBe(false)
  })
})

describe("copyImageToClipboard", () => {
  it("writes a PNG unchanged", async () => {
    api.getAttachmentFile.mockResolvedValue(pngBlob())

    await copyImageToClipboard("qkUrdzLDoqslx8EEy2cM7Q==")

    expect(api.getAttachmentFile).toHaveBeenCalledWith("qkUrdzLDoqslx8EEy2cM7Q==")
    const item = writeMock.mock.calls[0][0][0]
    const written = (await item.items["image/png"]) as Blob
    expect(written.type).toBe("image/png")
  })

  it("rasterizes a JPEG before writing it", async () => {
    api.getAttachmentFile.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }))
    const drawImage = vi.fn()
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2, height: 2, close: vi.fn() })),
    )
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { drawImage }
        }
        async convertToBlob() {
          return pngBlob("converted")
        }
      },
    )

    await copyImageToClipboard("qkUrdzLDoqslx8EEy2cM7Q==")

    expect(drawImage).toHaveBeenCalled()
    const item = writeMock.mock.calls[0][0][0]
    const written = (await item.items["image/png"]) as Blob
    expect(written.type).toBe("image/png")
    expect(await written.text()).toBe("converted")
  })

  it.each([404, 410])("reports a %d as a removed image", async (status) => {
    api.getAttachmentFile.mockRejectedValue(apiError(status))

    const err = await copyImageToClipboard("20261110145113MiTbtB").catch((e) => e)

    expect(err).toBeInstanceOf(CopyImageError)
    expect(err.reason).toBe("gone")
    expect(copyImageErrorText(err)).toBe("This image is no longer available.")
  })

  it("reports a server failure", async () => {
    api.getAttachmentFile.mockRejectedValue(apiError(503))

    const err = await copyImageToClipboard("qkUrdzLDoqslx8EEy2cM7Q==").catch((e) => e)

    expect(err).toBeInstanceOf(CopyImageError)
    expect(err.reason).toBe("failed")
  })

  it("reports a blocked clipboard write", async () => {
    api.getAttachmentFile.mockResolvedValue(pngBlob())
    writeMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))

    const err = await copyImageToClipboard("qkUrdzLDoqslx8EEy2cM7Q==").catch((e) => e)

    expect(err).toBeInstanceOf(CopyImageError)
    expect(err.reason).toBe("blocked")
    expect(copyImageErrorText(err)).toMatch(/blocked clipboard access/)
  })
})

describe("toPngBlob", () => {
  it("passes PNG bytes through untouched", async () => {
    const blob = pngBlob()
    expect(await toPngBlob(blob)).toBe(blob)
  })
})
