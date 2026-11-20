<template>
  <div
    class="w-full rounded-lg border border-theme-border bg-theme-bg-primary shadow-lg flex flex-col"
    data-testid="gif-picker"
    @keydown.escape.stop="emit('close')">
    <div class="p-2 border-b border-theme-border">
      <input
        ref="searchInput"
        v-model="query"
        type="text"
        :placeholder="provider.searchPlaceholder"
        class="w-full px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary"
        data-testid="gif-search"
        aria-label="Search GIFs" />
    </div>

    <div
      ref="scroller"
      class="h-60 overflow-y-auto p-2"
      data-testid="gif-results"
      @scroll.passive="onScroll">
      <div
        v-if="error"
        class="h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
        <span class="text-xs text-theme-text-muted" data-testid="gif-error">{{ error }}</span>
        <button
          type="button"
          class="text-xs font-semibold text-theme-accent hover:underline"
          data-testid="gif-retry"
          @click="reload">
          Retry
        </button>
      </div>
      <div
        v-else-if="loading"
        class="h-full flex items-center justify-center text-xs text-theme-text-muted">
        Loading…
      </div>
      <div
        v-else-if="!items.length"
        class="h-full flex items-center justify-center text-xs text-theme-text-muted">
        No GIFs found
      </div>
      <div v-else class="grid grid-cols-2 gap-2">
        <button
          v-for="gif in items"
          :key="`${gif.provider}:${gif.id}`"
          type="button"
          class="relative overflow-hidden rounded-md bg-theme-bg-tertiary hover:ring-2 hover:ring-theme-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent"
          :title="gif.title || 'GIF'"
          :aria-label="gif.title || 'Send GIF'"
          data-testid="gif-result"
          @click="pick(gif)">
          <img
            :src="gif.picker_url"
            :alt="gif.title || ''"
            loading="lazy"
            class="w-full aspect-square object-cover" />
        </button>
      </div>
      <div v-if="loadingMore" class="py-2 text-center text-xs text-theme-text-muted">Loading…</div>
    </div>

    <div
      class="flex items-center gap-1 px-2.5 pb-1.5 text-[10px] text-theme-text-muted select-none"
      data-testid="gif-attribution">
      <span>Powered by</span>
      <img
        v-if="provider.attributionLogo"
        :src="provider.attributionLogo"
        :alt="provider.name.toUpperCase()"
        class="h-3.5 w-auto flex-shrink-0"
        data-testid="gif-attribution-logo" />
      <span v-else class="font-semibold">{{ provider.name.toUpperCase() }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue"
import {
  GifSearchError,
  type Gif,
  type GifPage,
  type GifProvider,
  type GifTile,
} from "@/services/gif"

const props = defineProps<{ provider: GifProvider }>()
const emit = defineEmits<{ select: [gif: Gif]; close: [] }>()

/** Typing pause before a search request (the KLIPY dev key allows 100/h). */
const SEARCH_DEBOUNCE_MS = 350
/** Distance from the bottom that loads the next page. */
const LOAD_MORE_PX = 120

const searchInput = useTemplateRef<HTMLInputElement>("searchInput")
const scroller = useTemplateRef<HTMLDivElement>("scroller")

const query = ref("")
const items = ref<GifTile[]>([])
const page = ref(1)
const hasNext = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref<string | null>(null)

// Pages already fetched in this picker session, so toggling the query does
// not spend provider requests again.
const cache = new Map<string, GifPage>()
// Guards against out-of-order responses while the query changes.
let requestId = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined

function errorText(error: unknown): string {
  if (error instanceof GifSearchError) {
    switch (error.code) {
      case "rate_limited":
        return "GIF search is busy. Try again in a minute."
      case "timeout":
        return "GIF search timed out."
    }
  }
  return "GIF search is unavailable."
}

async function fetchPage(target: number): Promise<GifPage> {
  const q = query.value.trim()
  const key = `${q ? `s:${q}` : "t"}:${target}`
  const hit = cache.get(key)
  if (hit) return hit
  const result = q ? await props.provider.search(q, target) : await props.provider.trending(target)
  cache.set(key, result)
  return result
}

function applyPage(result: GifPage, target: number) {
  page.value = target
  hasNext.value = result.hasNext
  items.value = target === 1 ? result.items : [...items.value, ...result.items]
}

async function load(target: number) {
  const id = ++requestId
  error.value = null
  if (target === 1) {
    loading.value = true
    items.value = []
  } else {
    loadingMore.value = true
  }
  try {
    const result = await fetchPage(target)
    if (id !== requestId) return // a newer query won
    applyPage(result, target)
  } catch (err) {
    if (id !== requestId) return
    error.value = errorText(err)
  } finally {
    if (id === requestId) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function reload() {
  void load(1)
}

/** Sends the message reference only: the picker rendition is local. */
function pick(tile: GifTile) {
  const gif: Gif = {
    provider: tile.provider,
    id: tile.id,
    url: tile.url,
    preview_url: tile.preview_url,
    width: tile.width,
    height: tile.height,
    title: tile.title,
  }
  emit("select", gif)
}

function onScroll() {
  const el = scroller.value
  if (!el || loading.value || loadingMore.value || !hasNext.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_PX) {
    void load(page.value + 1)
  }
}

watch(query, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(reload, SEARCH_DEBOUNCE_MS)
})

onMounted(() => {
  void load(1)
  if (!window.matchMedia?.("(pointer: coarse)").matches) searchInput.value?.focus()
})

onBeforeUnmount(() => clearTimeout(debounceTimer))
</script>
