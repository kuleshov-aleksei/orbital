import type { EmojiRef } from "./types"

const STORAGE_KEY = "orbital_recent_emojis"
const MAX_RECENT = 16

// Per-device convenience only; storage may be unavailable (private mode), so never throw
export function getRecentEmojis(): EmojiRef[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : []
  } catch {
    return []
  }
}

export function addRecentEmoji(ref: EmojiRef): EmojiRef[] {
  const next = [ref, ...getRecentEmojis().filter((r) => r !== ref)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  return next
}
