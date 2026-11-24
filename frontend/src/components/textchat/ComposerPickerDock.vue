<template>
  <div class="flex flex-1 flex-col min-h-0" data-testid="composer-picker-dock">
    <!-- Emoji / GIF tabs. The GIF tab only exists when the server offers search. -->
    <div
      class="flex items-center gap-1 px-2 pt-1.5 pb-1.5 shrink-0"
      role="tablist"
      aria-label="Emoji and GIF">
      <button
        id="composer-tab-emoji"
        type="button"
        role="tab"
        aria-controls="composer-picker-panel"
        :aria-selected="tab === 'emoji'"
        class="picker-tab"
        :class="tab === 'emoji' ? 'picker-tab--active' : ''"
        data-testid="composer-tab-emoji"
        @click="selectTab('emoji')">
        <PhSmiley class="w-4 h-4" aria-hidden="true" />
        Emoji
      </button>
      <button
        v-if="gifProvider"
        id="composer-tab-gif"
        type="button"
        role="tab"
        aria-controls="composer-picker-panel"
        :aria-selected="tab === 'gif'"
        class="picker-tab"
        :class="tab === 'gif' ? 'picker-tab--active' : ''"
        data-testid="composer-tab-gif"
        @click="selectTab('gif')">
        <PhFilmStrip class="w-4 h-4" aria-hidden="true" />
        GIF
      </button>
      <button
        type="button"
        class="ml-auto w-9 h-9 flex items-center justify-center rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
        title="Close picker"
        aria-label="Close picker"
        data-testid="composer-picker-close"
        @click="emit('close')">
        <PhX class="w-4 h-4" />
      </button>
    </div>

    <div
      id="composer-picker-panel"
      class="flex-1 min-h-0"
      role="tabpanel"
      :aria-labelledby="tab === 'gif' ? 'composer-tab-gif' : 'composer-tab-emoji'">
      <!-- Each tab is mounted on its first visit and then kept, so switching
           back keeps the search, scroll and loaded pages. -->
      <EmojiPicker
        v-if="mounted.emoji"
        v-show="tab === 'emoji'"
        docked
        @select="emit('select-emoji', $event)"
        @close="emit('close')" />
      <GifPicker
        v-if="gifProvider && mounted.gif"
        v-show="tab === 'gif'"
        docked
        :provider="gifProvider"
        @select="emit('select-gif', $event)"
        @close="emit('close')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from "vue"
import { PhFilmStrip, PhSmiley, PhX } from "@phosphor-icons/vue"
import EmojiPicker from "@/components/EmojiPicker.vue"
import GifPicker from "./GifPicker.vue"
import type { EmojiRef } from "@/services/emoji"
import type { Gif, GifProvider } from "@/services/gif"

const props = defineProps<{ tab: "emoji" | "gif"; gifProvider: GifProvider | null }>()

const emit = defineEmits<{
  "update:tab": [tab: "emoji" | "gif"]
  "select-emoji": [ref: EmojiRef]
  "select-gif": [gif: Gif]
  close: []
}>()

// Mounting a picker costs work (the emoji library, a KLIPY/GIPHY request), so
// only the tabs the user actually opened are created.
const mounted = reactive({ emoji: false, gif: false })

function selectTab(tab: "emoji" | "gif") {
  emit("update:tab", tab)
}

watch(
  () => props.tab,
  (tab) => {
    mounted[tab] = true
  },
  { immediate: true },
)

// GIF search can be turned off by the server: never leave a dead tab open.
watch(
  () => props.gifProvider,
  (provider) => {
    if (!provider && props.tab === "gif") emit("update:tab", "emoji")
  },
)
</script>

<style scoped>
.picker-tab {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  height: 2.25rem;
  padding: 0 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-theme-text-muted);
  transition:
    background-color 150ms ease-out,
    color 150ms ease-out;
}

.picker-tab:active,
.picker-tab--active {
  background-color: var(--color-theme-bg-hover);
  color: var(--color-theme-text-primary);
}

@media (hover: hover) {
  .picker-tab:hover {
    color: var(--color-theme-text-primary);
  }
}
</style>
