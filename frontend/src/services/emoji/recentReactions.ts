import { ref } from "vue"
import type { EmojiRef } from "./types"

const STORAGE_KEY = "orbital_recent_reactions"
const MAX_RECENT = 3
const DEFAULTS: EmojiRef[] = ["👍", "❤️", "😂"]

// Per-device convenience only; storage may be unavailable (private mode), so never throw.
function readStored(): EmojiRef[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : []
  } catch {
    return []
  }
}

/** Tops a short list up with defaults so there are always three quick reactions. */
function withDefaults(refs: EmojiRef[]): EmojiRef[] {
  const out = refs.slice(0, MAX_RECENT)
  for (const d of DEFAULTS) {
    if (out.length >= MAX_RECENT) break
    if (!out.includes(d)) out.push(d)
  }
  return out
}

/** The last three reactions added on this device, newest first. */
export const recentReactions = ref<EmojiRef[]>(withDefaults(readStored()))

export function addRecentReaction(emoji: EmojiRef) {
  const next = [emoji, ...readStored().filter((r) => r !== emoji)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  recentReactions.value = withDefaults(next)
}
