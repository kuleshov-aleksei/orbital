<template>
  <div class="pt-4 border-t border-theme-border space-y-3" data-testid="mention-sound-settings">
    <div class="flex items-center justify-between gap-4">
      <div>
        <label id="mention-sound-label" class="text-sm font-medium text-theme-text-primary block">
          Mention sound
        </label>
        <p class="text-xs text-theme-text-muted mt-0.5">
          Play a sound when someone mentions you in a text channel. Per-channel settings (mute,
          mentions off) still apply.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        :aria-checked="enabled"
        aria-labelledby="mention-sound-label"
        data-testid="mention-sound-toggle"
        class="relative inline-flex h-6 w-12 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
        :class="enabled ? 'bg-theme-accent' : 'bg-theme-bg-hover'"
        @click="appSettingsStore.setMentionSound(!enabled)">
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="enabled ? 'translate-x-7' : 'translate-x-1'" />
      </button>
    </div>
    <div v-if="enabled" class="flex items-center gap-3">
      <label for="mention-volume" class="text-xs text-theme-text-secondary w-14">Volume</label>
      <input
        id="mention-volume"
        type="range"
        min="0"
        max="100"
        :value="Math.round(volume * 100)"
        class="flex-1 accent-theme-accent"
        @input="onVolume"
        @change="preview" />
      <button
        type="button"
        class="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary"
        @click="preview">
        Test
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useAppSettingsStore } from "@/stores/appSettings"
import { playMention } from "@/services/sounds"

const appSettingsStore = useAppSettingsStore()
const enabled = computed(() => appSettingsStore.mentionSound)
const volume = computed(() => appSettingsStore.mentionSoundVolume)

function onVolume(event: Event) {
  appSettingsStore.setMentionSoundVolume(Number((event.target as HTMLInputElement).value) / 100)
}

function preview() {
  playMention(volume.value)
}
</script>
