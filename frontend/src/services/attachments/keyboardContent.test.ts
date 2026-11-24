import { afterEach, describe, expect, it, vi } from "vitest"

const platform = vi.hoisted(() => ({ releaseKeyboardImage: vi.fn(async () => {}) }))
vi.mock("@/services/platform", () => platform)
vi.mock("@capacitor/core", () => ({
  Capacitor: { convertFileSrc: vi.fn((uri: string) => `https://localhost/_capacitor_file_${uri}`) },
}))

import { Capacitor } from "@capacitor/core"
import { keyboardImageName, readKeyboardImage } from "./keyboardContent"

const IMAGE = {
  uri: "file:///data/user/0/app.orbital/cache/keyboard-content/keyboard-1.gif",
  name: "Reaction.gif",
  mime: "image/gif",
  size: 6,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("keyboard image attachments", () => {
  it("uses a safe filename and the actual image extension", () => {
    expect(keyboardImageName("folder/reaction.png", "image/gif")).toBe("reaction.gif")
    expect(keyboardImageName("sticker.gif", "image/webp")).toBe("sticker.webp")
    expect(keyboardImageName("photo.webp", "image/png")).toBe("photo.png")
    expect(keyboardImageName("photo.png", "image/jpeg")).toBe("photo.jpg")
    expect(keyboardImageName("../..", "image/webp")).toBe("keyboard.webp")
  })

  it("reads the native file and always releases it", async () => {
    const bytes = new TextEncoder().encode("GIF89a")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes)),
    )

    const file = await readKeyboardImage(IMAGE)

    expect(Capacitor.convertFileSrc).toHaveBeenCalledWith(IMAGE.uri)
    expect(file.name).toBe("Reaction.gif")
    expect(file.type).toBe("image/gif")
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    expect(platform.releaseKeyboardImage).toHaveBeenCalledWith(IMAGE.uri)
  })

  it("preserves the native MIME type for stickers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(6))),
    )
    const sticker = { ...IMAGE, name: "Sticker.png", mime: "image/webp" }

    const file = await readKeyboardImage(sticker)

    expect(file.name).toBe("Sticker.webp")
    expect(file.type).toBe("image/webp")
    expect(platform.releaseKeyboardImage).toHaveBeenCalledWith(sticker.uri)
  })

  it("releases the native file after a failed read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    )

    await expect(readKeyboardImage(IMAGE)).rejects.toThrow("404")
    expect(platform.releaseKeyboardImage).toHaveBeenCalledWith(IMAGE.uri)
  })

  it("rejects a truncated file and releases it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(3))),
    )

    await expect(readKeyboardImage(IMAGE)).rejects.toThrow("truncated")
    expect(platform.releaseKeyboardImage).toHaveBeenCalledWith(IMAGE.uri)
  })
})
