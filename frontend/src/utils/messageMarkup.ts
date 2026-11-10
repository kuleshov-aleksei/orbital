/**
 * Text channel message markup (docs/specs/CHAT_SYSTEM.md §7.6).
 *
 * A small tokenizer for the subset we support: **bold**, *italic* / _italic_,
 * ~~strike~~, ||spoiler||, autolinked http(s) URLs, custom emoji tokens
 * (`<:shortcode:id>`), mention tokens (`<@user_id>`, `<@&role_id>`) and line
 * breaks. Everything else is literal text. A backslash escapes a marker.
 *
 * The output is a node tree rendered by MessageNodes.vue (no v-html), so
 * message text can never inject markup.
 */

export type MarkupNode =
  | { type: "text"; text: string }
  | { type: "br" }
  | { type: "bold" | "italic" | "strike" | "spoiler"; children: MarkupNode[] }
  | { type: "link"; href: string; text: string }
  | { type: "emoji"; id: string; shortcode: string }
  | { type: "mention"; kind: "user" | "role"; id: string }

type Container = "bold" | "italic" | "strike" | "spoiler"

const MARKERS: Array<{ marker: string; type: Container }> = [
  { marker: "**", type: "bold" },
  { marker: "~~", type: "strike" },
  { marker: "||", type: "spoiler" },
  { marker: "*", type: "italic" },
  { marker: "_", type: "italic" },
]

const ESCAPABLE = new Set(["*", "_", "~", "|", "\\", "<"])
const EMOJI_RE = /^<:([\p{L}\p{N}_]{1,64}):([0-9a-f-]{36})>/u
const MENTION_RE = /^<@(&?)([A-Za-z0-9_-]{1,64})>/
const URL_RE = /^https?:\/\/[^\s<>]+/i
// Trailing punctuation is usually sentence punctuation, not part of the URL.
const URL_TRAILING_RE = /[.,:;!?'")\]}*~|]+$/

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch)
const isSpace = (ch: string | undefined) => !ch || /\s/.test(ch)

interface ParseResult {
  nodes: MarkupNode[]
  end: number
  closed: boolean
}

class Parser {
  constructor(private readonly src: string) {}

  parse(): MarkupNode[] {
    return this.parseUntil(0, null).nodes
  }

  /** Parses from `pos` until `closer` (or the end of input when null). */
  private parseUntil(pos: number, closer: { marker: string; type: Container } | null): ParseResult {
    const nodes: MarkupNode[] = []
    let text = ""
    const flush = () => {
      if (text) {
        nodes.push({ type: "text", text })
        text = ""
      }
    }
    const src = this.src
    let i = pos
    while (i < src.length) {
      const ch = src[i]

      if (closer && this.isCloser(i, closer)) {
        flush()
        return { nodes, end: i + closer.marker.length, closed: true }
      }

      if (ch === "\\" && ESCAPABLE.has(src[i + 1] ?? "")) {
        text += src[i + 1]
        i += 2
        continue
      }

      if (ch === "\n") {
        flush()
        nodes.push({ type: "br" })
        i++
        continue
      }

      if (ch === "<") {
        const rest = src.slice(i)
        const emoji = EMOJI_RE.exec(rest)
        if (emoji) {
          flush()
          nodes.push({ type: "emoji", shortcode: emoji[1], id: emoji[2] })
          i += emoji[0].length
          continue
        }
        const mention = MENTION_RE.exec(rest)
        if (mention) {
          flush()
          nodes.push({ type: "mention", kind: mention[1] ? "role" : "user", id: mention[2] })
          i += mention[0].length
          continue
        }
      }

      if ((ch === "h" || ch === "H") && !isWordChar(src[i - 1])) {
        const url = URL_RE.exec(src.slice(i))
        if (url) {
          const href = url[0].replace(URL_TRAILING_RE, "")
          if (href.length > "https://".length - 1) {
            flush()
            nodes.push({ type: "link", href, text: href })
            i += href.length
            continue
          }
        }
      }

      const opened = this.tryOpen(i)
      if (opened) {
        flush()
        nodes.push(opened.node)
        i = opened.end
        continue
      }

      text += ch
      i++
    }
    flush()
    return { nodes, end: i, closed: false }
  }

  private isCloser(i: number, closer: { marker: string; type: Container }): boolean {
    const { marker } = closer
    if (!this.src.startsWith(marker, i)) return false
    // "**" inside italic is a bold opener, not two italic closers.
    if (marker === "*" && this.src[i + 1] === "*" && this.src[i + 2] !== "*") {
      const next = this.src.indexOf("**", i + 2)
      if (next !== -1) return false
    }
    if (isSpace(this.src[i - 1])) return false
    // Underscores close only at a word boundary (snake_case stays literal).
    if (marker === "_" && isWordChar(this.src[i + 1])) return false
    return true
  }

  private tryOpen(i: number): { node: MarkupNode; end: number } | null {
    const src = this.src
    for (const m of MARKERS) {
      if (!src.startsWith(m.marker, i)) continue
      const after = src[i + m.marker.length]
      // An opener must be followed by content, not whitespace.
      if (isSpace(after)) continue
      if (m.marker === "_" && isWordChar(src[i - 1])) continue
      // Skip quickly when no closer exists at all.
      if (src.indexOf(m.marker, i + m.marker.length + 1) === -1) continue
      const inner = this.parseUntil(i + m.marker.length, m)
      if (!inner.closed || inner.nodes.length === 0) continue
      return { node: { type: m.type, children: inner.nodes }, end: inner.end }
    }
    return null
  }
}

/** Parses message content into a node tree. */
export function parseMessage(content: string): MarkupNode[] {
  return new Parser(content).parse()
}

/** Plain text of a node tree (reply previews, notifications, titles). */
export function markupToPlain(
  nodes: MarkupNode[],
  resolveMention?: (kind: "user" | "role", id: string) => string,
): string {
  let out = ""
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += n.text
        break
      case "br":
        out += " "
        break
      case "link":
        out += n.text
        break
      case "emoji":
        out += `:${n.shortcode}:`
        break
      case "mention":
        out += `@${resolveMention?.(n.kind, n.id) ?? n.id}`
        break
      case "spoiler":
        out += "▒▒▒"
        break
      default:
        out += markupToPlain(n.children, resolveMention)
    }
  }
  return out
}

// Unicode emoji (pictographs, with variation selectors, ZWJ sequences, skin
// tones, keycaps and flags).
const UNICODE_EMOJI_RE =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u200D|\uFE0F|\u20E3|[#*0-9])+$/u

/** Max emoji count for the large "jumbo" rendering (as Discord). */
export const JUMBO_EMOJI_MAX = 27

/**
 * Number of emoji when a message consists only of emoji and whitespace,
 * otherwise 0. Used to render emoji-only messages larger.
 */
export function emojiOnlyCount(nodes: MarkupNode[]): number {
  let count = 0
  for (const n of nodes) {
    if (n.type === "emoji") {
      count++
    } else if (n.type === "br") {
      continue
    } else if (n.type === "text") {
      for (const part of n.text.split(/\s+/)) {
        if (!part) continue
        if (!UNICODE_EMOJI_RE.test(part) || /^[#*0-9]+$/.test(part)) return 0
        count += countGraphemes(part)
      }
    } else {
      return 0
    }
  }
  return count
}

// Intl.Segmenter is ES2022 (the tsconfig lib is older); every supported
// browser and Electron has it. The fallback overcounts ZWJ sequences.
type SegmenterCtor = new (
  locale: undefined,
  opts: { granularity: "grapheme" },
) => { segment(s: string): Iterable<unknown> }

function countGraphemes(s: string): number {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(s)).length
  }
  return Array.from(s).length
}
