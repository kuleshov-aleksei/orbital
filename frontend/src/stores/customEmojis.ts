import { defineStore } from "pinia"
import { computed, ref, shallowRef } from "vue"
import type { CustomEmojiDto } from "@/types"
import { apiService } from "@/services/api"
import {
  CUSTOM_EMOJI_PREFIX,
  registerEmojiProvider,
  type CustomEmoji,
  type EmojiProvider,
} from "@/services/emoji"

export const CUSTOM_EMOJI_PROVIDER_ID = "custom"

// The picker's "Server" section loads the library in pages of this size.
export const CUSTOM_EMOJI_PAGE_SIZE = 100
// Server-side search results per query (matches searchEmojis' default limit).
const SEARCH_LIMIT = 80
// Backend cap for one ?ids= / ?shortcodes= lookup.
const LOOKUP_BATCH = 100
// Recent search queries kept so typing back and forth doesn't refetch.
const SEARCH_CACHE_SIZE = 20

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

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Collects keys requested in the same tick and fetches them together, in
 * chunks of LOOKUP_BATCH. The returned promise settles once every requested
 * key has been fetched (or failed), including keys already in flight.
 */
function createBatcher(fetchChunk: (keys: string[]) => Promise<void>) {
  let pending = new Set<string>()
  let scheduled: Promise<void> | null = null
  const inflight = new Map<string, Promise<void>>()

  return (keys: string[]): Promise<void> => {
    const waits: Promise<void>[] = []
    for (const key of keys) {
      const running = inflight.get(key)
      if (running) waits.push(running)
      else pending.add(key)
    }
    if (pending.size > 0 && !scheduled) {
      scheduled = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(async () => {
        const batch = [...pending]
        pending = new Set()
        scheduled = null
        const done = Promise.all(
          chunks(batch, LOOKUP_BATCH).map((chunk) =>
            fetchChunk(chunk).catch((err) => console.error("[CustomEmojis] Lookup failed:", err)),
          ),
        ).then(() => undefined)
        for (const key of batch) inflight.set(key, done)
        await done
        for (const key of batch) inflight.delete(key)
      })
    }
    if (scheduled && keys.some((k) => pending.has(k))) waits.push(scheduled)
    return Promise.all(waits).then(() => undefined)
  }
}

/**
 * The custom emoji library, loaded on demand: the picker pages through it,
 * search runs on the server, and `custom:<id>` refs / `:shortcode:`s that
 * aren't cached yet are looked up in batches.
 */
export const useCustomEmojisStore = defineStore("customEmojis", () => {
  // id -> emoji for everything seen so far. Replaced (not mutated) so the
  // emoji registry's consumers re-render when a batch lands.
  const byId = shallowRef(new Map<string, CustomEmoji>())
  // Shortcode -> id, only as resolved by the server (it alone knows which
  // emoji wins a shortcode across the whole library).
  const shortcodeIds = shallowRef(new Map<string, string>())
  // Bumped on every cache change; watch it to react to newly resolved emojis.
  const version = ref(0)
  // Lookups the server answered with "not found", so they aren't retried.
  let missingIds = new Set<string>()
  let missingShortcodes = new Set<string>()
  const searchCache = new Map<string, string[]>()

  // Browsing: ids of the pages loaded so far, in upload order.
  const browseIds = ref<string[]>([])
  // null: no page loaded yet; "": the last page has been loaded.
  const nextCursor = ref<string | null>(null)
  const total = ref(0)
  const max = ref(0)
  const isLoaded = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  // The upload modal lives in App.vue so it survives pickers inside popovers closing.
  const isUploadOpen = ref(false)

  // Bumped on reset (logout) so late responses for the previous user are dropped.
  let generation = 0

  const hasMore = computed(() => nextCursor.value !== "")
  const browseEmojis = computed(() => {
    const cache = byId.value
    return browseIds.value.map((id) => cache.get(id)).filter((e): e is CustomEmoji => !!e)
  })

  function merge(dtos: CustomEmojiDto[]): void {
    if (dtos.length === 0) return
    const next = new Map(byId.value)
    for (const dto of dtos) {
      next.set(dto.id, toCustomEmoji(dto))
      missingIds.delete(dto.id)
    }
    byId.value = next
    version.value++
  }

  const fetchIds = createBatcher(async (ids) => {
    const gen = generation
    const res = await apiService.getCustomEmojisByIds(ids)
    if (gen !== generation) return
    merge(res.emojis)
    const found = new Set(res.emojis.map((e) => e.id))
    for (const id of ids) if (!found.has(id)) missingIds.add(id)
  })

  const fetchShortcodes = createBatcher(async (codes) => {
    const gen = generation
    const res = await apiService.getCustomEmojisByShortcodes(codes)
    if (gen !== generation) return
    merge(res.emojis)
    const matched = res.shortcodes ?? {}
    const next = new Map(shortcodeIds.value)
    for (const code of codes) {
      const id = matched[code]
      if (id) next.set(code, id)
      else missingShortcodes.add(code)
    }
    shortcodeIds.value = next
    version.value++
  })

  /** Queues ids that aren't cached (or known missing) for a batched lookup. */
  function requestIds(ids: string[]): Promise<void> {
    const wanted = ids.filter((id) => !byId.value.has(id) && !missingIds.has(id))
    return wanted.length ? fetchIds(wanted) : Promise.resolve()
  }

  /** Queues shortcodes that aren't resolved (or known missing) for a batched lookup. */
  function requestShortcodes(codes: string[]): Promise<void> {
    const wanted = [...new Set(codes)].filter(
      (c) => !shortcodeIds.value.has(c) && !missingShortcodes.has(c),
    )
    return wanted.length ? fetchShortcodes(wanted) : Promise.resolve()
  }

  /** Resolves shortcodes before encoding text (send, edit), so idForShortcode knows them. */
  function resolveShortcodes(codes: string[]): Promise<void> {
    return requestShortcodes(codes)
  }

  function idForShortcode(shortcode: string): string | null {
    return shortcodeIds.value.get(shortcode) ?? null
  }

  const provider: EmojiProvider = {
    id: CUSTOM_EMOJI_PROVIDER_ID,
    getCategories: () => {
      const emojis = browseEmojis.value
      return emojis.length ? [{ id: "custom", label: "Server", icon: emojis[0].ref, emojis }] : []
    },
    resolve: (ref) => {
      if (!ref.startsWith(CUSTOM_EMOJI_PREFIX)) return null
      const id = ref.slice(CUSTOM_EMOJI_PREFIX.length)
      const emoji = byId.value.get(id)
      if (emoji) return emoji
      // Called from render/computed: only queue the lookup (it runs next tick).
      // Wait for the first page so a signed-out client never calls the API;
      // loading it replaces byId, which re-runs this resolve.
      if (isLoaded.value) void requestIds([id])
      return null
    },
  }
  registerEmojiProvider(provider)

  let browseRequest: Promise<void> | null = null
  /** Loads the next page of the library for browsing (no-op at the end). */
  function loadMore(): Promise<void> {
    if (browseRequest) return browseRequest
    if (!hasMore.value) return Promise.resolve()
    const gen = generation
    isLoading.value = true
    browseRequest = apiService
      .getCustomEmojiPage({
        limit: CUSTOM_EMOJI_PAGE_SIZE,
        cursor: nextCursor.value || undefined,
      })
      .then((page) => {
        if (gen !== generation) return
        merge(page.emojis)
        browseIds.value = [...browseIds.value, ...page.emojis.map((e) => e.id)]
        nextCursor.value = page.next_cursor
        total.value = page.total
        max.value = page.max
        isLoaded.value = true
        error.value = null
      })
      .catch((err) => {
        console.error("[CustomEmojis] Failed to load emojis:", err)
        error.value = "Failed to load emojis"
      })
      .finally(() => {
        isLoading.value = false
        browseRequest = null
      })
    return browseRequest
  }

  /** Reloads the first page (and the library size); later pages load on scroll. */
  async function refresh(): Promise<void> {
    if (browseRequest) await browseRequest
    browseIds.value = []
    nextCursor.value = null
    await loadMore()
  }

  /** Loads the first page once (pickers call this in case nothing else did). */
  async function ensureLoaded(): Promise<void> {
    if (!isLoaded.value) await loadMore()
  }

  /** Custom emojis matching a query, searched across the whole library. */
  async function search(query: string): Promise<CustomEmoji[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const gen = generation
    let ids = searchCache.get(q)
    if (!ids) {
      const page = await apiService.getCustomEmojiPage({ limit: SEARCH_LIMIT, q })
      if (gen !== generation) return []
      merge(page.emojis)
      ids = page.emojis.map((e) => e.id)
      searchCache.set(q, ids)
      if (searchCache.size > SEARCH_CACHE_SIZE) {
        searchCache.delete(searchCache.keys().next().value as string)
      }
    }
    const cache = byId.value
    return ids.map((id) => cache.get(id)).filter((e): e is CustomEmoji => !!e)
  }

  /**
   * custom_emojis_updated: re-fetch what is cached and swap it in at once
   * (renames apply, deleted emojis disappear, nothing flickers), then reload
   * the first page.
   */
  async function onLibraryChanged(): Promise<void> {
    if (!isLoaded.value) return
    const gen = generation
    searchCache.clear()
    missingIds = new Set()
    missingShortcodes = new Set()
    const ids = [...byId.value.keys()]
    const codes = [...shortcodeIds.value.keys()]
    try {
      const [byIdRes, byCodeRes] = await Promise.all([
        Promise.all(chunks(ids, LOOKUP_BATCH).map((c) => apiService.getCustomEmojisByIds(c))),
        Promise.all(
          chunks(codes, LOOKUP_BATCH).map((c) => apiService.getCustomEmojisByShortcodes(c)),
        ),
      ])
      if (gen !== generation) return
      const next = new Map<string, CustomEmoji>()
      const nextCodes = new Map<string, string>()
      for (const res of [...byIdRes, ...byCodeRes]) {
        for (const dto of res.emojis) next.set(dto.id, toCustomEmoji(dto))
        for (const [code, id] of Object.entries(res.shortcodes ?? {})) nextCodes.set(code, id)
      }
      byId.value = next
      shortcodeIds.value = nextCodes
      version.value++
    } catch (err) {
      console.error("[CustomEmojis] Failed to refresh emojis:", err)
    }
    await refresh()
  }

  /** Uploads one emoji. Batch uploads pass refresh: false and call refresh once at the end. */
  async function upload(
    input: { file: File; name: string; aliases: string[] },
    { refresh: reload = true }: { refresh?: boolean } = {},
  ): Promise<CustomEmojiDto> {
    const emoji = await apiService.uploadCustomEmoji(input)
    merge([emoji])
    if (reload) await refresh()
    return emoji
  }

  async function update(
    id: string,
    patch: { name?: string; aliases?: string[] },
  ): Promise<CustomEmojiDto> {
    const emoji = await apiService.updateCustomEmoji(id, patch)
    merge([emoji])
    return emoji
  }

  async function remove(id: string): Promise<void> {
    await apiService.deleteCustomEmoji(id)
    const next = new Map(byId.value)
    next.delete(id)
    byId.value = next
    missingIds.add(id)
    browseIds.value = browseIds.value.filter((b) => b !== id)
    total.value = Math.max(0, total.value - 1)
    version.value++
  }

  /** On logout: forget the library so the next user loads their own view. */
  function reset(): void {
    generation++
    byId.value = new Map()
    shortcodeIds.value = new Map()
    missingIds = new Set()
    missingShortcodes = new Set()
    searchCache.clear()
    browseIds.value = []
    nextCursor.value = null
    browseRequest = null
    total.value = 0
    max.value = 0
    isLoaded.value = false
    isUploadOpen.value = false
    version.value++
  }

  return {
    browseEmojis,
    hasMore,
    total,
    max,
    version,
    isLoaded,
    isLoading,
    error,
    isUploadOpen,
    loadMore,
    refresh,
    ensureLoaded,
    search,
    requestIds,
    requestShortcodes,
    resolveShortcodes,
    idForShortcode,
    onLibraryChanged,
    upload,
    update,
    remove,
    reset,
  }
})
