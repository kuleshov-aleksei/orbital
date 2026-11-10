// Mentions in the composer: the textarea shows "@Name" while messages carry
// "<@user_id>" / "<@&role_id>" tokens (docs/specs/CHAT_SYSTEM.md §7.4).
// A per-draft map remembers which "@Name" texts were picked from the
// autocomplete, so typed "@" text that was never picked stays plain text.

import { MENTION_ID } from "./messageMarkup"

export type MentionMap = Map<string, string> // "@Name" -> "<@id>"

const MENTION_TOKEN_RE = new RegExp(`<@(&?)(${MENTION_ID})>`, "g")

export function userMentionToken(userId: string): string {
  return `<@${userId}>`
}

export function roleMentionToken(roleId: string): string {
  return `<@&${roleId}>`
}

/** True when the character after a mention ends it (not part of a name). */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[\p{L}\p{N}_]/u.test(ch)
}

/** Replaces picked "@Name" texts with their tokens; longest names first. */
export function encodeMentions(text: string, map: MentionMap): string {
  if (map.size === 0) return text
  const names = [...map.keys()].sort((a, b) => b.length - a.length)
  let out = ""
  let i = 0
  outer: while (i < text.length) {
    if (text[i] === "@") {
      for (const name of names) {
        if (text.startsWith(name, i) && isBoundary(text[i + name.length])) {
          out += map.get(name)
          i += name.length
          continue outer
        }
      }
    }
    out += text[i]
    i++
  }
  return out
}

/**
 * Turns tokens back into "@Name" for editing and returns the map that
 * re-encodes them. Unknown ids keep their raw token.
 */
export function decodeMentions(
  content: string,
  userName: (id: string) => string | undefined,
  roleName: (id: string) => string | undefined,
): { text: string; map: MentionMap } {
  const map: MentionMap = new Map()
  const text = content.replace(MENTION_TOKEN_RE, (token, amp: string, id: string) => {
    const name = amp ? roleName(id) : userName(id)
    if (!name) return token
    const label = `@${name}`
    // Two different ids with one name: keep the later as a raw token.
    if (map.has(label) && map.get(label) !== token) return token
    map.set(label, token)
    return label
  })
  return { text, map }
}

/** The "@query" being typed right before the caret, or null. */
export function activeMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|[\s(])@([^\s@<>]{0,32})$/u.exec(before)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

/** The ":query" being typed right before the caret (2+ chars), or null. */
export function activeEmojiQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s):([\p{L}\p{N}_+-]{2,32})$/u.exec(before)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}
