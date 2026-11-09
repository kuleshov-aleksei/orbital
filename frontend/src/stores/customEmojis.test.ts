import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { CustomEmojiDto } from "@/types"

const api = vi.hoisted(() => ({
  getCustomEmojis: vi.fn(),
  getCustomEmojiImageUrl: vi.fn((e: { image_url: string }) => `http://backend${e.image_url}`),
}))
vi.mock("@/services/api", () => ({ apiService: api }))

import { getEmojiCategories, resolveEmoji, searchEmojis } from "@/services/emoji"
import { toCustomEmoji, useCustomEmojisStore } from "./customEmojis"

const dto = (id: string, name: string, aliases: string[] = []): CustomEmojiDto => ({
  id,
  name,
  aliases,
  file_size: 1,
  created_at: "",
  image_url: `/api/emojis/${id}/image?v=1`,
})

describe("custom emojis store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => useCustomEmojisStore().reset())

  it("maps name words and aliases to keywords", () => {
    const emoji = toCustomEmoji(dto("a", "Party Parrot", ["pp"]))
    expect(emoji).toMatchObject({
      kind: "custom",
      ref: "custom:a",
      name: "Party Parrot",
      imageUrl: "http://backend/api/emojis/a/image?v=1",
    })
    expect(emoji.keywords).toEqual(["party parrot", "party", "parrot", "pp"])
  })

  it("gives animated emojis a still first-frame URL", () => {
    expect(toCustomEmoji(dto("a", "Blob")).stillUrl).toBeUndefined()
    expect(toCustomEmoji({ ...dto("g", "Spin"), animated: true }).stillUrl).toBe(
      "http://backend/api/emojis/g/image?v=1&still=1",
    )
  })

  it("registers a Server category that the picker can search and resolve", async () => {
    api.getCustomEmojis.mockResolvedValue([dto("a", "Party Parrot", ["pp"]), dto("b", "Blob")])
    const store = useCustomEmojisStore()
    await store.fetchEmojis()

    const server = getEmojiCategories().find((c) => c.id === "custom")
    expect(server?.emojis.map((e) => e.ref)).toEqual(["custom:a", "custom:b"])
    expect(server?.icon).toBe("custom:a")
    expect(searchEmojis("pp")[0].ref).toBe("custom:a")
    expect(searchEmojis("parrot")[0].ref).toBe("custom:a")
    expect(resolveEmoji("custom:b")).toMatchObject({ name: "Blob" })

    store.reset()
    expect(resolveEmoji("custom:b")).toBeNull()
    expect(getEmojiCategories().some((c) => c.id === "custom")).toBe(false)
  })

  it("ranks a custom emoji's exact alias above unicode prefix matches", async () => {
    // 🥳 has the keyword "party"; "partying" etc. are prefix matches.
    api.getCustomEmojis.mockResolvedValue([dto("p", "Parrot", ["party"])])
    await useCustomEmojisStore().fetchEmojis()
    expect(searchEmojis("party")[0].ref).toBe("custom:p")
  })

  it("only refetches on library changes once loaded", async () => {
    const store = useCustomEmojisStore()
    store.onLibraryChanged()
    expect(api.getCustomEmojis).not.toHaveBeenCalled()
    api.getCustomEmojis.mockResolvedValue([])
    await store.ensureLoaded()
    store.onLibraryChanged()
    expect(api.getCustomEmojis).toHaveBeenCalledTimes(2)
  })
})
