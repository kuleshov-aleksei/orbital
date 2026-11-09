import { shallowRef } from "vue"
import { CUSTOM_EMOJI_PREFIX } from "./types"
import type { Emoji, EmojiCategory, EmojiProvider, EmojiRef } from "./types"
import { unicodeEmojiProvider } from "./unicodeSet"

// Reactive so pickers re-render when a provider (e.g. custom emojis) is registered later
const providers = shallowRef<EmojiProvider[]>([unicodeEmojiProvider])

/** Register an additional emoji source. Re-registering the same id replaces it. */
export function registerEmojiProvider(provider: EmojiProvider) {
  providers.value = [...providers.value.filter((p) => p.id !== provider.id), provider]
}

export function unregisterEmojiProvider(id: string) {
  providers.value = providers.value.filter((p) => p.id !== id)
}

export function getEmojiCategories(): EmojiCategory[] {
  return providers.value.flatMap((p) => p.getCategories())
}

/**
 * Resolve a stored ref to an emoji. Unicode refs that aren't in any curated set
 * (e.g. set by a client with a bigger emoji list) still render as plain text.
 * Unknown custom refs resolve to null so callers can hide them.
 */
export function resolveEmoji(ref: EmojiRef | null | undefined): Emoji | null {
  if (!ref) return null
  for (const provider of providers.value) {
    const emoji = provider.resolve(ref)
    if (emoji) return emoji
  }
  if (ref.startsWith(CUSTOM_EMOJI_PREFIX)) return null
  return { kind: "unicode", ref, char: ref, name: ref, keywords: [] }
}

/**
 * Match every query word against an emoji's keywords: exact keyword matches
 * first, then prefix, then substring. Custom emojis win ties so a server
 * emoji's alias beats a unicode emoji with the same keyword.
 */
export function searchEmojis(query: string, limit = 80): Emoji[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const scored: { emoji: Emoji; score: number }[] = []
  const seen = new Set<EmojiRef>()
  for (const category of getEmojiCategories()) {
    for (const emoji of category.emojis) {
      if (seen.has(emoji.ref)) continue
      let score = 0
      const matchesAll = words.every((word) => {
        if (emoji.keywords.includes(word)) {
          score += 3
          return true
        }
        if (emoji.keywords.some((k) => k.startsWith(word))) {
          score += 2
          return true
        }
        if (emoji.keywords.some((k) => k.includes(word))) {
          score += 1
          return true
        }
        return false
      })
      if (matchesAll) {
        seen.add(emoji.ref)
        scored.push({ emoji, score })
      }
    }
  }
  // Array.prototype.sort is stable, so equal scores keep category order
  return scored
    .sort(
      (a, b) =>
        b.score - a.score || Number(b.emoji.kind === "custom") - Number(a.emoji.kind === "custom"),
    )
    .slice(0, limit)
    .map((s) => s.emoji)
}
