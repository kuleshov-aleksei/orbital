<template>
  <div class="mt-1.5 max-w-full" data-testid="message-gif">
    <div
      v-if="failed"
      class="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-theme-border bg-theme-bg-tertiary text-xs text-theme-text-muted"
      :title="gif.title">
      <PhImageBroken class="w-4 h-4" />
      GIF unavailable
    </div>
    <div v-else class="relative inline-block max-w-full" :style="boxStyle">
      <video
        v-if="isVideo && animated"
        :src="gif.url"
        :poster="gif.preview_url"
        class="block w-full h-full object-contain rounded-lg bg-theme-bg-tertiary"
        autoplay
        muted
        loop
        playsinline
        :aria-label="gif.title || 'GIF'"
        referrerpolicy="no-referrer"
        data-testid="message-gif-media"
        @error="failed = true" />
      <img
        v-else
        :src="animated ? gif.url : gif.preview_url"
        :alt="gif.title || 'GIF'"
        class="block w-full h-full object-contain rounded-lg bg-theme-bg-tertiary"
        loading="lazy"
        referrerpolicy="no-referrer"
        data-testid="message-gif-media"
        @error="failed = true" />
      <button
        v-if="!animated"
        type="button"
        class="absolute inset-0 grid place-items-center rounded-lg bg-black/30 text-white hover:bg-black/40"
        aria-label="Play GIF"
        data-testid="message-gif-play"
        @click="started = true">
        <PhPlay class="w-9 h-9" weight="fill" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { PhImageBroken, PhPlay } from "@phosphor-icons/vue"
import { useAppSettingsStore } from "@/stores/appSettings"
import type { TextGIF } from "@/types/textChat"

const props = defineProps<{ gif: TextGIF }>()

// mp4 renditions are a fraction of the gif's size (the adapters prefer them).
const isVideo = computed(() => /\.(mp4|webm)(\?|#|$)/i.test(props.gif.url))
// Honour the OS setting and the app's "Reduce emoji motion" toggle: the
// still shows instead, and pressing play animates this one.
const appSettings = useAppSettingsStore()
const reducedMotion =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
const started = ref(false)
const animated = computed(() => started.value || (!reducedMotion && !appSettings.reduceEmojiMotion))
const failed = ref(false)

// The box is sized from the stored rendition metadata (like attachments and
// link previews), so the media can't grow the list when its bytes arrive.
// Otherwise a page of GIFs expands after MessageList's scroll-to-bottom ran,
// pushing the newest message out of view on every channel open.
const MAX_H = 320
const boxStyle = computed(() => {
  const w = props.gif.width
  const h = props.gif.height
  // References without metadata (provider omitted it): a placeholder box is
  // still better than a 0-height one that jumps once the still loads.
  if (!w || !h) return { width: "300px", aspectRatio: "4 / 3", maxWidth: "100%" }
  const scale = Math.min(1, MAX_H / h)
  return { width: `${Math.round(w * scale)}px`, aspectRatio: `${w} / ${h}`, maxWidth: "100%" }
})
</script>
