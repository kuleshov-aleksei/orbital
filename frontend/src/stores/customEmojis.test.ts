import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { CustomEmojiDto, CustomEmojiPageDto } from "@/types"

const api = vi.hoisted(() => ({
  getCustomEmojiPage: vi.fn(),
  getCustomEmojisByIds: vi.fn(),
  getCustomEmojisByShortcodes: vi.fn(),
  deleteCustomEmoji: vi.fn(),
  getCustomEmojiImageUrl: vi.fn((e: { image_url: string }) => `http://backend${e.image_url}`),
}))
vi.mock("@/services/api", () => ({ apiService: api }))

import { getEmojiCategories, resolveEmoji, searchEmojis } from "@/services/emoji"
import { toCustomEmoji, useCustomEmojisStore } from "./customEmojis"

// Realistic ids: custom emoji ids are UUIDs.
const ID_A = "0b6f3a52-6a47-4d0e-9a51-0f3e8c1d2a11"
const ID_B = "7c1e9f04-2b3d-4c5a-8e6f-1a2b3c4d5e6f"
const ID_C = "f2d4b6a8-1c3e-4f5a-9b7d-2e4f6a8b0c1d"

const dto = (id: string, name: string, aliases: string[] = []): CustomEmojiDto => ({
  id,
  name,
  aliases,
  file_size: 1,
  created_at: "",
  image_url: `/api/emojis/${id}/image?v=1`,
})

const page = (
  emojis: CustomEmojiDto[],
  next_cursor = "",
  extra: Partial<CustomEmojiPageDto> = {},
): CustomEmojiPageDto => ({ emojis, next_cursor, total: emojis.length, max: 2000, ...extra })

// Lets queued batch lookups (setTimeout 0) run and settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

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

  it("lists loaded pages as the Server category, paging with the cursor", async () => {
    api.getCustomEmojiPage
      .mockResolvedValueOnce(page([dto(ID_A, "Party Parrot", ["pp"])], "c1", { total: 2 }))
      .mockResolvedValueOnce(page([dto(ID_B, "Blob")], "", { total: 2 }))
    const store = useCustomEmojisStore()
    await store.ensureLoaded()

    let server = getEmojiCategories().find((c) => c.id === "custom")
    expect(server?.emojis.map((e) => e.ref)).toEqual([`custom:${ID_A}`])
    expect(server?.icon).toBe(`custom:${ID_A}`)
    expect(store.hasMore).toBe(true)
    expect(store.total).toBe(2)
    expect(store.max).toBe(2000)

    await store.loadMore()
    expect(api.getCustomEmojiPage).toHaveBeenLastCalledWith({ limit: 100, cursor: "c1" })
    server = getEmojiCategories().find((c) => c.id === "custom")
    expect(server?.emojis.map((e) => e.ref)).toEqual([`custom:${ID_A}`, `custom:${ID_B}`])
    expect(store.hasMore).toBe(false)

    await store.loadMore() // at the end: no request
    expect(api.getCustomEmojiPage).toHaveBeenCalledTimes(2)
    expect(searchEmojis("pp")[0].ref).toBe(`custom:${ID_A}`)

    store.reset()
    expect(resolveEmoji(`custom:${ID_B}`)).toBeNull()
    expect(getEmojiCategories().some((c) => c.id === "custom")).toBe(false)
  })

  it("does not look up unknown refs before the first page is loaded", async () => {
    useCustomEmojisStore()
    expect(resolveEmoji(`custom:${ID_A}`)).toBeNull()
    await flush()
    expect(api.getCustomEmojisByIds).not.toHaveBeenCalled()
  })

  it("batches unknown refs into one lookup and remembers missing ids", async () => {
    api.getCustomEmojiPage.mockResolvedValue(page([]))
    api.getCustomEmojisByIds.mockResolvedValue({ emojis: [dto(ID_B, "Blob")] })
    const store = useCustomEmojisStore()
    await store.ensureLoaded()

    expect(resolveEmoji(`custom:${ID_B}`)).toBeNull()
    expect(resolveEmoji(`custom:${ID_C}`)).toBeNull()
    expect(resolveEmoji(`custom:${ID_B}`)).toBeNull() // same tick: deduped
    await flush()
    expect(api.getCustomEmojisByIds).toHaveBeenCalledTimes(1)
    expect(api.getCustomEmojisByIds).toHaveBeenCalledWith([ID_B, ID_C])
    expect(resolveEmoji(`custom:${ID_B}`)).toMatchObject({ name: "Blob" })

    // ID_C was not found: it is not requested again.
    expect(resolveEmoji(`custom:${ID_C}`)).toBeNull()
    await flush()
    expect(api.getCustomEmojisByIds).toHaveBeenCalledTimes(1)
  })

  it("resolves shortcodes through the server, once per shortcode", async () => {
    api.getCustomEmojisByShortcodes.mockResolvedValue({
      emojis: [dto(ID_A, "Party Parrot")],
      shortcodes: { party_parrot: ID_A },
    })
    const store = useCustomEmojisStore()
    await Promise.all([
      store.resolveShortcodes(["party_parrot", "nope"]),
      store.resolveShortcodes(["party_parrot"]),
    ])
    expect(api.getCustomEmojisByShortcodes).toHaveBeenCalledTimes(1)
    expect(store.idForShortcode("party_parrot")).toBe(ID_A)
    expect(store.idForShortcode("nope")).toBeNull()

    await store.resolveShortcodes(["party_parrot", "nope"])
    expect(api.getCustomEmojisByShortcodes).toHaveBeenCalledTimes(1)
  })

  it("searches the whole library on the server and caches the query", async () => {
    api.getCustomEmojiPage.mockResolvedValue(page([dto(ID_C, "Sad Cat", ["crying"])]))
    const store = useCustomEmojisStore()
    const results = await store.search("  Crying ")
    expect(api.getCustomEmojiPage).toHaveBeenCalledWith({ limit: 80, q: "crying" })
    expect(results.map((e) => e.ref)).toEqual([`custom:${ID_C}`])
    // Server results rank like local ones and beat unicode on ties.
    expect(searchEmojis("crying", 80, results)[0].ref).toBe(`custom:${ID_C}`)

    await store.search("crying")
    expect(api.getCustomEmojiPage).toHaveBeenCalledTimes(1)
  })

  it("ranks a custom emoji's exact alias above unicode prefix matches", async () => {
    // 🥳 has the keyword "party"; "partying" etc. are prefix matches.
    api.getCustomEmojiPage.mockResolvedValue(page([dto(ID_A, "Parrot", ["party"])]))
    await useCustomEmojisStore().ensureLoaded()
    expect(searchEmojis("party")[0].ref).toBe(`custom:${ID_A}`)
  })

  it("swaps in fresh data on library changes and drops deleted emojis", async () => {
    const store = useCustomEmojisStore()
    store.onLibraryChanged() // not loaded yet: nothing happens
    expect(api.getCustomEmojiPage).not.toHaveBeenCalled()

    api.getCustomEmojiPage.mockResolvedValue(page([dto(ID_A, "Old name"), dto(ID_B, "Doomed")]))
    await store.ensureLoaded()

    api.getCustomEmojisByIds.mockResolvedValue({ emojis: [dto(ID_A, "New name")] })
    api.getCustomEmojiPage.mockResolvedValue(page([dto(ID_A, "New name")]))
    await store.onLibraryChanged()

    expect(api.getCustomEmojisByIds).toHaveBeenCalledWith([ID_A, ID_B])
    expect(resolveEmoji(`custom:${ID_A}`)).toMatchObject({ name: "New name" })
    expect(store.browseEmojis.map((e) => e.ref)).toEqual([`custom:${ID_A}`])
    expect(store.total).toBe(1)
  })

  it("removes a deleted emoji from the cache and the loaded pages", async () => {
    api.getCustomEmojiPage.mockResolvedValue(page([dto(ID_A, "Keep"), dto(ID_B, "Delete me")]))
    api.deleteCustomEmoji.mockResolvedValue(undefined)
    const store = useCustomEmojisStore()
    await store.ensureLoaded()

    await store.remove(ID_B)
    expect(store.browseEmojis.map((e) => e.ref)).toEqual([`custom:${ID_A}`])
    expect(store.total).toBe(1)
    expect(resolveEmoji(`custom:${ID_B}`)).toBeNull()
    await flush()
    expect(api.getCustomEmojisByIds).not.toHaveBeenCalled()
  })
})
