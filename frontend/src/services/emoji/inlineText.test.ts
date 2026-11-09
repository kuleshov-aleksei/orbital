import { describe, expect, it } from "vitest"
import {
  emojiShortcode,
  emojiTextLength,
  emojiTextToPlain,
  encodeShortcodes,
  parseEmojiText,
  tokenIdsByShortcode,
} from "./inlineText"

const ID = "0b6f1c1e-3c7a-4d0e-9a52-6c1f0d6f7a11"
const ID2 = "11111111-2222-4333-8444-555555555555"
const token = `<:party_parrot:${ID}>`

describe("inline custom emoji text", () => {
  it("builds shortcodes from names, keeping non-Latin letters", () => {
    expect(emojiShortcode("Party Parrot!")).toBe("party_parrot")
    expect(emojiShortcode("Котик")).toBe("котик")
    expect(emojiShortcode("!!!")).toBe("emoji")
  })

  it("parses tokens into segments", () => {
    expect(parseEmojiText(`Hi ${token}!`)).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "emoji", ref: `custom:${ID}`, shortcode: "party_parrot" },
      { kind: "text", text: "!" },
    ])
    expect(parseEmojiText("<:bad:not-an-id>")).toEqual([{ kind: "text", text: "<:bad:not-an-id>" }])
  })

  it("round-trips between stored and editable forms", () => {
    const stored = `Lobby ${token} 🎮`
    const plain = emojiTextToPlain(stored)
    expect(plain).toBe("Lobby :party_parrot: 🎮")
    const lookup = (code: string) => tokenIdsByShortcode(stored).get(code) ?? null
    expect(encodeShortcodes(plain, lookup)).toBe(stored)
  })

  it("encodes only known shortcodes and leaves existing tokens alone", () => {
    const lookup = (code: string) => (code === "blob" ? ID2 : null)
    expect(encodeShortcodes(":blob: :nope: 10:30", lookup)).toBe(`<:blob:${ID2}> :nope: 10:30`)
    expect(encodeShortcodes(`${token} :blob:`, lookup)).toBe(`${token} <:blob:${ID2}>`)
  })

  it("counts a token as one character", () => {
    expect(emojiTextLength(`ab${token}🎮`)).toBe(4)
  })
})
