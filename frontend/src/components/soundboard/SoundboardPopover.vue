<template>
  <div
    data-testid="soundboard-popover"
    class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 max-w-[calc(100vw-2rem)] bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg z-50 flex flex-col"
    @click.stop
    @keydown.esc="$emit('close')">
    <div class="p-2 flex items-center gap-2 border-b border-theme-border">
      <div class="relative flex-1">
        <PhMagnifyingGlass
          class="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          placeholder="Search sounds"
          class="w-full pl-7 pr-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary"
          @keydown.enter.prevent="playFirst" />
      </div>
      <button
        v-if="canUpload"
        type="button"
        class="h-8 w-8 shrink-0 rounded flex items-center justify-center bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary"
        title="Upload a sound"
        @click="$emit('upload')">
        <PhPlus class="w-4 h-4" />
      </button>
    </div>

    <p
      v-if="!soundboardStore.enabled || soundboardStore.volume === 0"
      class="px-3 pt-2 text-[11px] text-theme-text-muted">
      Soundboard is muted for you. Others will still hear what you play. Change this in Settings →
      Sounds.
    </p>

    <div class="p-2 max-h-72 overflow-y-auto">
      <div
        v-if="soundboardStore.isLoading && !soundboardStore.isLoaded"
        class="py-6 text-center text-sm text-theme-text-muted">
        Loading…
      </div>
      <div v-else-if="soundboardStore.error" class="py-6 text-center text-sm text-red-400">
        {{ soundboardStore.error }}
      </div>
      <div v-else-if="results.length === 0" class="py-6 text-center text-sm text-theme-text-muted">
        {{ query ? "No sounds match your search" : "No sounds yet" }}
        <button
          v-if="canUpload && !query"
          type="button"
          class="block mx-auto mt-2 text-theme-accent hover:underline"
          @click="$emit('upload')">
          Upload the first one
        </button>
      </div>
      <div v-else class="grid grid-cols-3 gap-1.5">
        <button
          v-for="sound in results"
          :key="sound.id"
          type="button"
          class="flex flex-col items-center gap-1 px-1 py-2 rounded-md bg-theme-bg-tertiary transition-colors"
          :class="
            isCoolingDown
              ? 'opacity-50 cursor-wait'
              : 'hover:bg-theme-bg-hover text-theme-text-primary cursor-pointer'
          "
          :title="tileTitle(sound)"
          :disabled="isCoolingDown"
          @click="play(sound.id)">
          <EmojiGlyph v-if="sound.emoji" :emoji-ref="sound.emoji" :size="22" />
          <PhSpeakerHigh v-else class="w-[22px] h-[22px] text-theme-text-muted" />
          <span class="text-xs w-full truncate text-center text-theme-text-secondary">
            {{ sound.name }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import { PhMagnifyingGlass, PhPlus, PhSpeakerHigh } from "@phosphor-icons/vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import { usePermissionsStore, useSoundboardStore, useUserStore } from "@/stores"
import { Permission } from "@/types/permissions"
import type { SoundboardSound } from "@/types"

defineEmits<{ close: []; upload: [] }>()

const soundboardStore = useSoundboardStore()
const permissionsStore = usePermissionsStore()
const userStore = useUserStore()

const query = ref("")
const searchInput = useTemplateRef<HTMLInputElement>("searchInput")

const canUpload = computed(
  () => !userStore.isGuest && permissionsStore.can(Permission.UploadSounds),
)
const results = computed(() => soundboardStore.search(query.value))

// Mirror the shared cooldown so tiles look disabled while it runs.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
const isCoolingDown = computed(() => now.value < soundboardStore.cooldownUntil)

const tileTitle = (sound: SoundboardSound) =>
  sound.aliases.length ? `${sound.name} (${sound.aliases.join(", ")})` : sound.name

const play = (id: string) => {
  if (soundboardStore.play(id)) now.value = Date.now()
}

const playFirst = () => {
  const first = results.value[0]
  if (first && !isCoolingDown.value) play(first.id)
}

onMounted(() => {
  searchInput.value?.focus()
  void soundboardStore.ensureLoaded()
  timer = setInterval(() => (now.value = Date.now()), 250)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
