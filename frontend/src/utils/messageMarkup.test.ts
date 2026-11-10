import { describe, expect, it } from "vitest"
import {
  applyHighlights,
  emojiOnlyCount,
  markupToPlain,
  parseMessage,
  type MarkupNode,
} from "./messageMarkup"

/** Compact form for assertions: text as-is, containers as type(children). */
function show(nodes: MarkupNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return n.text
        case "br":
          return "⏎"
        case "link":
          return `link(${n.href})`
        case "emoji":
          return `emoji(${n.shortcode})`
        case "mention":
          return `${n.kind}(${n.id})`
        case "highlight":
          return `[${n.text}]`
        default:
          return `${n.type}(${show(n.children)})`
      }
    })
    .join("")
}

const EMOJI_ID = "0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d"

describe("parseMessage", () => {
  it.each([
    ["plain text", "plain text"],
    ["**bold** and *it* and _it_", "bold(bold) and italic(it) and italic(it)"],
    ["~~gone~~ ||secret||", "strike(gone) spoiler(secret)"],
    ["**bold *italic***", "bold(bold italic(italic))"],
    ["***both***", "bold(italic(both))"],
    ["||**loud** secret||", "spoiler(bold(loud) secret)"],
    ["snake_case_name stays", "snake_case_name stays"],
    ["2 * 3 * 4", "2 * 3 * 4"],
    ["**unclosed", "**unclosed"],
    ["** spaced **", "** spaced **"],
    ["\\*not italic\\*", "*not italic*"],
    ["a\\\\b", "a\\b"],
    ["line one\nline two", "line one⏎line two"],
    ["see https://example.com/a?b=1.", "see link(https://example.com/a?b=1)."],
    ["(https://example.com)", "(link(https://example.com))"],
    ["**https://x.io**", "bold(link(https://x.io))"],
    ["javascript:alert(1)", "javascript:alert(1)"],
    [`hi <:wave:${EMOJI_ID}>!`, "hi emoji(wave)!"],
    ["<@user_1> and <@&mods>", "user(user_1) and role(mods)"],
    ["<b>html</b>", "<b>html</b>"],
  ])("%s", (input, expected) => {
    expect(show(parseMessage(input))).toBe(expected)
  })

  it("never produces links for non-http schemes", () => {
    const nodes = parseMessage("ftp://a data:text/html,x javascript://x")
    expect(nodes.every((n) => n.type !== "link")).toBe(true)
  })

  it("handles long adversarial input quickly", () => {
    const input = "*_~|".repeat(500)
    const start = performance.now()
    parseMessage(input)
    expect(performance.now() - start).toBeLessThan(500)
  })
})

describe("markupToPlain", () => {
  it("flattens formatting and hides spoilers", () => {
    const nodes = parseMessage(`**hi** ||secret|| <:wave:${EMOJI_ID}> <@u1>`)
    expect(markupToPlain(nodes, (_, id) => (id === "u1" ? "Alice" : id))).toBe(
      "hi ▒▒▒ :wave: @Alice",
    )
  })
})

describe("emojiOnlyCount", () => {
  it.each([
    ["😀", 1],
    ["😀 🎉👍🏽", 3],
    [`<:wave:${EMOJI_ID}> 🎉`, 2],
    ["👨‍👩‍👧", 1],
    ["🇫🇷", 1],
    ["hi 😀", 0],
    ["**😀**", 0],
    ["123", 0],
    ["", 0],
  ])("%s -> %d", (input, expected) => {
    expect(emojiOnlyCount(parseMessage(input))).toBe(expected)
  })
})

describe("applyHighlights", () => {
  it("splits search markers into highlight nodes across formatting", () => {
    const nodes = applyHighlights(
      parseMessage("say \u0001hel\u0002lo **bo\u0001ld\u0002** \u0001x"),
    )
    expect(nodes).toEqual([
      { type: "text", text: "say " },
      { type: "highlight", text: "hel" },
      { type: "text", text: "lo " },
      {
        type: "bold",
        children: [
          { type: "text", text: "bo" },
          { type: "highlight", text: "ld" },
        ],
      },
      { type: "text", text: " " },
      { type: "highlight", text: "x" },
    ])
  })

  it("strips markers from links", () => {
    const nodes = applyHighlights(parseMessage("see https://x.io/\u0001doc\u0002 ok"))
    expect(markupToPlain(nodes)).toBe("see https://x.io/doc ok")
    const link = nodes.find((n) => n.type === "link")
    expect(link && link.type === "link" && link.href).toBe("https://x.io/doc")
  })
})

describe("mention tokens with real ids", () => {
  it("parses padded base64 user ids", () => {
    expect(parseMessage("hi <@qkUrdzLDoqslx8EEy2cM7Q==>!")).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", kind: "user", id: "qkUrdzLDoqslx8EEy2cM7Q==" },
      { type: "text", text: "!" },
    ])
  })
})
