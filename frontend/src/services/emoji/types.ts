/**
 * Emoji references are opaque strings stored by the backend (`custom_status_emoji`):
 *  - unicode emoji: the emoji itself, e.g. "🎮"
 *  - custom emoji:  "custom:<id>" (reserved for a future provider)
 * Keep this format in sync with validateStatusEmoji in backend/internal/handlers/usershandler.go.
 */
export type EmojiRef = string

export const CUSTOM_EMOJI_PREFIX = "custom:"

interface EmojiBase {
  ref: EmojiRef
  name: string
  keywords: string[]
}

export interface UnicodeEmoji extends EmojiBase {
  kind: "unicode"
  char: string
}

export interface CustomEmoji extends EmojiBase {
  kind: "custom"
  imageUrl: string
  // First frame of an animated emoji, for the reduce-motion setting
  stillUrl?: string
}

export type Emoji = UnicodeEmoji | CustomEmoji

export interface EmojiCategory {
  id: string
  label: string
  // Emoji shown on the category tab
  icon: string
  emojis: Emoji[]
}

/**
 * A source of emojis. The built-in unicode set is one provider; a custom emoji
 * provider (e.g. backed by an API) can be registered later via registerEmojiProvider.
 */
export interface EmojiProvider {
  id: string
  getCategories(): EmojiCategory[]
  // Return the emoji for a ref this provider owns, or null
  resolve(ref: EmojiRef): Emoji | null
}
