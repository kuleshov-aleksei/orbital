import { CUSTOM_EMOJI_PREFIX, type EmojiRef } from "./types"

/**
 * Custom emojis inside plain-text fields (e.g. room names) are stored as
 * `<:shortcode:id>` tokens. The id keeps the reference stable across renames;
 * the shortcode is the plain-text fallback (deleted emoji, titles, logs).
 * In text inputs tokens are edited as `:shortcode:`.
 * Keep the token pattern in sync with customEmojiTokenRe in
 * backend/internal/handlers/roomhandler.go.
 */
const TOKEN_SRC = String.raw`<:([\p{L}\p{N}_]{1,64}):([0-9a-f-]{36})>`
const tokenRe = () => new RegExp(TOKEN_SRC, "gu")
const shortcodeRe = () => /:([\p{L}\p{N}_]{1,64}):/gu

export type EmojiTextSegment =
  { kind: "text"; text: string } | { kind: "emoji"; ref: EmojiRef; shortcode: string }

/** Shortcode for a custom emoji name: "Party Parrot!" -> "party_parrot". */
export function emojiShortcode(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
  return slug || "emoji"
}

export function parseEmojiText(text: string): EmojiTextSegment[] {
  const segments: EmojiTextSegment[] = []
  let last = 0
  for (const m of text.matchAll(tokenRe())) {
    if (m.index > last) segments.push({ kind: "text", text: text.slice(last, m.index) })
    segments.push({ kind: "emoji", ref: `${CUSTOM_EMOJI_PREFIX}${m[2]}`, shortcode: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) })
  return segments
}

/** Plain-text form (tokens become `:shortcode:`), for titles and editing. */
export function emojiTextToPlain(text: string): string {
  return text.replace(tokenRe(), (_, shortcode: string) => `:${shortcode}:`)
}

/** Length in characters with each custom emoji counted as one. */
export function emojiTextLength(text: string): number {
  return Array.from(text.replace(tokenRe(), "\u{FFFC}")).length
}

/** Custom emoji ids referenced by tokens, keyed by shortcode (first wins). */
export function tokenIdsByShortcode(text: string): Map<string, string> {
  const ids = new Map<string, string>()
  for (const m of text.matchAll(tokenRe())) {
    if (!ids.has(m[1])) ids.set(m[1], m[2])
  }
  return ids
}

/**
 * Turns `:shortcode:` into tokens when `lookup` knows the shortcode (returns a
 * custom emoji id). Existing tokens are left untouched.
 */
export function encodeShortcodes(
  text: string,
  lookup: (shortcode: string) => string | null,
): string {
  return text
    .split(tokenRe())
    .map((part, i) => {
      // split() with 2 capture groups yields [text, shortcode, id, text, ...]
      const pos = i % 3
      if (pos === 1) return `<:${part}:`
      if (pos === 2) return `${part}>`
      return part.replace(shortcodeRe(), (match, shortcode: string) => {
        const id = lookup(shortcode)
        return id ? `<:${shortcode}:${id}>` : match
      })
    })
    .join("")
}
