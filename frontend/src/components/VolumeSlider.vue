<template>
  <div class="flex items-center space-x-2">
    <button
      type="button"
      class="p-1 hover:bg-theme-bg-hover/50 rounded transition-colors"
      :title="isMuted ? 'Unmute' : 'Mute'"
      @click="$emit('toggle-mute')">
      <PhSpeakerHigh v-if="volume > 50 && !isMuted" class="w-4 h-4 text-theme-text-primary" />
      <PhSpeakerLow v-else-if="volume > 0 && !isMuted" class="w-4 h-4 text-theme-text-primary" />
      <PhSpeakerNone v-else class="w-4 h-4 text-red-400" />
    </button>
    <input
      :value="volume"
      type="range"
      min="0"
      max="100"
      class="w-20 h-1 bg-theme-bg-hover rounded-lg appearance-none cursor-pointer"
      :class="accent"
      @input="onInput" />
  </div>
</template>

<script setup lang="ts">
import { PhSpeakerHigh, PhSpeakerLow, PhSpeakerNone } from "@phosphor-icons/vue"

defineProps<{
  volume: number
  isMuted: boolean
  accent?: string
}>()

const emit = defineEmits<{
  "update:volume": [volume: number]
  "toggle-mute": []
}>()

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit("update:volume", Number(target.value))
}
</script>
