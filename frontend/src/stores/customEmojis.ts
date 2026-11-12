import { defineStore } from "pinia"
import { computed, ref } from "vue"
import type { CustomEmojiDto } from "@/types"
import { apiService } from "@/services/api"
import {
  CUSTOM_EMOJI_PREFIX,
  emojiShortcode,
  registerEmojiProvider,
  unregisterEmojiProvider,
  type CustomEmoji,
  type EmojiProvider,
} from "@/services/emoji"

export const CUSTOM_EMOJI_PROVIDER_ID = "custom"

/** Maps a backend emoji to the picker model; name words and aliases are search keywords. */
export function toCustomEmoji(dto: CustomEmojiDto): CustomEmoji {
  const name = dto.name.toLowerCase()
  const keywords = [...new Set([name, ...name.split(/\s+/), ...dto.aliases])].filter(Boolean)
  const imageUrl = apiService.getCustomEmojiImageUrl(dto)
  return {
    kind: "custom",
    ref: `${CUSTOM_EMOJI_PREFIX}${dto.id}`,
    name: dto.name,
    keywords,
    imageUrl,
    ...(dto.animated ? { stillUrl: `${imageUrl}&still=1` } : {}),
  }
}

export function createCustomEmojiProvider(list: CustomEmojiDto[]): EmojiProvider {
  const emojis = list.map(toCustomEmoji)
  const byRef = new Map(emojis.map((e) => [e.ref, e]))
  return {
    id: CUSTOM_EMOJI_PROVIDER_ID,
    getCategories: () =>
      emojis.length ? [{ id: "custom", label: "Server", icon: emojis[0].ref, emojis }] : [],
    resolve: (ref) => byRef.get(ref) ?? null,
  }
}

export const useCustomEmojisStore = defineStore("customEmojis", () => {
  const emojis = ref<CustomEmojiDto[]>([])
  const isLoaded = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  // The upload modal lives in App.vue so it survives pickers inside popovers closing.
  const isUploadOpen = ref(false)

  // Shortcode -> id for `:shortcode:` in text fields. Name shortcodes win over
  // alias shortcodes; among equal names the oldest emoji wins.
  const idsByShortcode = computed(() => {
    const map = new Map<string, string>()
    for (const e of emojis.value) {
      const code = emojiShortcode(e.name)
      if (!map.has(code)) map.set(code, e.id)
    }
    for (const e of emojis.value) {
      for (const alias of e.aliases) {
        const code = emojiShortcode(alias)
        if (!map.has(code)) map.set(code, e.id)
      }
    }
    return map
  })

  function idForShortcode(shortcode: string): string | null {
    return idsByShortcode.value.get(shortcode) ?? null
  }

  let inflight: Promise<void> | null = null
  function fetchEmojis(): Promise<void> {
    if (inflight) return inflight
    isLoading.value = true
    inflight = apiService
      .getCustomEmojis()
      .then((list) => {
        emojis.value = list
        isLoaded.value = true
        error.value = null
        registerEmojiProvider(createCustomEmojiProvider(list))
      })
      .catch((err) => {
        console.error("[CustomEmojis] Failed to load emojis:", err)
        error.value = "Failed to load emojis"
      })
      .finally(() => {
        isLoading.value = false
        inflight = null
      })
    return inflight
  }

  /** Loads the library once (pickers call this in case nothing else did). */
  async function ensureLoaded(): Promise<void> {
    if (!isLoaded.value) await fetchEmojis()
  }

  /** custom_emojis_updated: refresh only once the library has been loaded. */
  function onLibraryChanged(): void {
    if (isLoaded.value) void fetchEmojis()
  }

  /** Uploads one emoji. Batch uploads pass refresh: false and call fetchEmojis once at the end. */
  async function upload(
    input: { file: File; name: string; aliases: string[] },
    { refresh = true }: { refresh?: boolean } = {},
  ): Promise<CustomEmojiDto> {
    const emoji = await apiService.uploadCustomEmoji(input)
    if (refresh) await fetchEmojis()
    return emoji
  }

  async function update(id: string, patch: { name?: string; aliases?: string[] }): Promise<void> {
    await apiService.updateCustomEmoji(id, patch)
    await fetchEmojis()
  }

  async function remove(id: string): Promise<void> {
    await apiService.deleteCustomEmoji(id)
    await fetchEmojis()
  }

  /** On logout: forget the library so the next user loads their own view. */
  function reset(): void {
    emojis.value = []
    isLoaded.value = false
    isUploadOpen.value = false
    unregisterEmojiProvider(CUSTOM_EMOJI_PROVIDER_ID)
  }

  return {
    emojis,
    isLoaded,
    isLoading,
    error,
    isUploadOpen,
    fetchEmojis,
    ensureLoaded,
    idForShortcode,
    onLibraryChanged,
    upload,
    update,
    remove,
    reset,
  }
})
