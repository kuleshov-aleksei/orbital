<template>
  <div
    v-if="visible"
    class="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-theme-bg-secondary rounded-xl border border-theme-border shadow-2xl p-4 z-40 min-w-105 max-h-[70vh] overflow-y-auto">
    <div class="grid grid-cols-3 gap-3">
      <button
        v-for="c in characters"
        :key="c.key"
        type="button"
        :class="[
          'flex flex-col items-center gap-1.5 rounded-xl p-3 transition-all duration-200 border-2',
          selected === c.key
            ? 'border-theme-accent bg-theme-accent/10'
            : 'border-transparent bg-theme-bg-tertiary hover:bg-theme-bg-hover',
        ]"
        @click="$emit('select', c.key)">
        <div
          class="image-rendering-pixelated w-16 h-16 rounded-lg overflow-hidden bg-theme-bg-primary flex items-center justify-center">
          <img
            :src="previewSrc(c.key)"
            :alt="c.key"
            class="w-full h-full object-contain"
            style="image-rendering: pixelated; image-rendering: crisp-edges" />
        </div>
        <span class="text-sm font-medium text-theme-text-primary capitalize">{{ c.key }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getAvailableCharacters } from "@/world/ResourceManager"
import { assetPath } from "@/utils/assetPath"
import { computed } from "vue"

const props = defineProps<Props>()
defineEmits<{
  select: [character: CharacterKey]
}>()
export type CharacterKey = string

function previewSrc(key: string): string {
  return assetPath(`/assets/characters/${key}_preview.png`)
}

interface Props {
  visible: boolean
  selected: CharacterKey
  allowedCharacters?: string[]
}

const characters = computed(() => {
  const available = getAvailableCharacters(props.allowedCharacters)
  return available.map((key) => ({ key })) as { key: CharacterKey }[]
})
</script>
