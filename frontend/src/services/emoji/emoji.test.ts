import { afterEach, describe, expect, it } from "vitest"
import {
  getEmojiCategories,
  registerEmojiProvider,
  resolveEmoji,
  searchEmojis,
  unregisterEmojiProvider,
  type EmojiProvider,
} from "@/services/emoji"
import { addRecentEmoji, getRecentEmojis } from "./recent"

// Mirror of validateStatusEmoji in backend/internal/handlers/usershandler.go
function backendAccepts(emoji: string): boolean {
  if (new TextEncoder().encode(emoji).length > 32 || [...emoji].length > 12) return false
  if (/[\s\p{Cc}\p{L}]/u.test(emoji)) return false
  return /[\p{So}⃣]/u.test(emoji)
}

describe("unicode emoji set", () => {
  const all = getEmojiCategories().flatMap((c) => c.emojis)

  it("has unique refs", () => {
    const refs = all.map((e) => e.ref)
    expect(new Set(refs).size).toBe(refs.length)
  })

  it("only contains emojis the backend accepts", () => {
    const rejected = all.filter((e) => !backendAccepts(e.ref)).map((e) => e.ref)
    expect(rejected).toEqual([])
  })
})

describe("emoji registry", () => {
  afterEach(() => unregisterEmojiProvider("test-custom"))

  it("searches by name and keywords, prefix matches first", () => {
    expect(searchEmojis("gaming").map((e) => e.ref)).toContain("🎮")
    expect(searchEmojis("coffee").map((e) => e.ref)).toContain("☕")
    expect(searchEmojis("heart")[0].keywords.some((k) => k.startsWith("heart"))).toBe(true)
    expect(searchEmojis("   ")).toEqual([])
  })

  it("resolves curated, unknown unicode, and unknown custom refs", () => {
    expect(resolveEmoji("🎮")).toMatchObject({ kind: "unicode", name: "video game" })
    expect(resolveEmoji("🦖")).toMatchObject({ kind: "unicode", char: "🦖" })
    expect(resolveEmoji("custom:party")).toBeNull()
    expect(resolveEmoji("")).toBeNull()
  })

  it("supports registering a custom emoji provider", () => {
    const party = {
      kind: "custom" as const,
      ref: "custom:party",
      name: "party parrot",
      keywords: ["party", "parrot"],
      imageUrl: "/api/emojis/party.png",
    }
    const provider: EmojiProvider = {
      id: "test-custom",
      getCategories: () => [{ id: "server", label: "Server", icon: "⭐", emojis: [party] }],
      resolve: (ref) => (ref === party.ref ? party : null),
    }
    registerEmojiProvider(provider)

    expect(resolveEmoji("custom:party")).toBe(party)
    expect(searchEmojis("parrot")).toEqual([party])
    const categories = getEmojiCategories()
    expect(categories[categories.length - 1].id).toBe("server")
  })
})

describe("recent emojis", () => {
  it("keeps most recent first without duplicates", () => {
    localStorage.removeItem("orbital_recent_emojis")
    addRecentEmoji("🎮")
    addRecentEmoji("🔥")
    addRecentEmoji("🎮")
    expect(getRecentEmojis()).toEqual(["🎮", "🔥"])
  })
})
