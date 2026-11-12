import { beforeEach, describe, expect, it, vi } from "vitest"

describe("recent reactions", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it("starts with defaults and moves added reactions to the front", async () => {
    const { recentReactions, addRecentReaction } = await import("./recentReactions")
    expect(recentReactions.value).toEqual(["👍", "❤️", "😂"])
    addRecentReaction("🔥")
    expect(recentReactions.value).toEqual(["🔥", "👍", "❤️"])
    addRecentReaction("🎮")
    addRecentReaction("🔥")
    expect(recentReactions.value).toEqual(["🔥", "🎮", "👍"])
  })

  it("restores the stored list", async () => {
    localStorage.setItem("orbital_recent_reactions", JSON.stringify(["🎮", "custom:abc"]))
    const { recentReactions } = await import("./recentReactions")
    expect(recentReactions.value).toEqual(["🎮", "custom:abc", "👍"])
  })
})
