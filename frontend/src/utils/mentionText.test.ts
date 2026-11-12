import { describe, expect, it } from "vitest"
import {
  activeEmojiQuery,
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  type MentionMap,
} from "./mentionText"

describe("encodeMentions", () => {
  const map: MentionMap = new Map([
    ["@Bob", "<@u1>"],
    ["@Bob Smith", "<@u2>"],
    ["@Mods", "<@&r1>"],
  ])

  it("replaces picked names with tokens, longest first", () => {
    expect(encodeMentions("hi @Bob Smith and @Bob, @Mods!", map)).toBe(
      "hi <@u2> and <@u1>, <@&r1>!",
    )
  })

  it("does not match inside a longer word", () => {
    expect(encodeMentions("@Bobby and email@Bob", map)).toBe("@Bobby and email<@u1>")
  })

  it("leaves text alone without picks", () => {
    expect(encodeMentions("@Bob", new Map())).toBe("@Bob")
  })
})

describe("decodeMentions", () => {
  const users: Record<string, string> = { u1: "Bob", u2: "Alice" }
  const roles: Record<string, string> = { r1: "Mods" }

  it("round-trips through encodeMentions", () => {
    const content = "<@u1> ping <@&r1> and <@u2>"
    const { text, map } = decodeMentions(
      content,
      (id) => users[id],
      (id) => roles[id],
    )
    expect(text).toBe("@Bob ping @Mods and @Alice")
    expect(encodeMentions(text, map)).toBe(content)
  })

  it("handles real (padded base64) user ids", () => {
    const id = "qkUrdzLDoqslx8EEy2cM7Q=="
    const { text, map } = decodeMentions(
      `hi <@${id}>`,
      (x) => (x === id ? "Bob" : undefined),
      () => undefined,
    )
    expect(text).toBe("hi @Bob")
    expect(encodeMentions(text, map)).toBe(`hi <@${id}>`)
  })

  it("keeps unknown ids and duplicate names as tokens", () => {
    const { text } = decodeMentions(
      "<@ghost> <@u1> <@u3>",
      (id) => (id === "ghost" ? undefined : "Bob"),
      () => undefined,
    )
    expect(text).toBe("<@ghost> @Bob <@u3>")
  })
})

describe("active queries", () => {
  it("finds an @ query before the caret", () => {
    expect(activeMentionQuery("hey @bo", 7)).toEqual({ start: 4, query: "bo" })
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" })
    expect(activeMentionQuery("mail@bo", 7)).toBeNull()
    expect(activeMentionQuery("hey @bo there", 13)).toBeNull()
  })

  it("finds a :emoji query of at least two characters", () => {
    expect(activeEmojiQuery("nice :th", 8)).toEqual({ start: 5, query: "th" })
    expect(activeEmojiQuery("nice :t", 7)).toBeNull()
    expect(activeEmojiQuery("12:30", 5)).toBeNull()
  })
})
