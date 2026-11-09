<template>
  <span v-if="paused" class="group/emoji">
    <span class="group-hover:hidden group-hover/emoji:hidden"
      ><img v-bind="$attrs" :src="emoji.stillUrl" :alt="alt" :title="title" draggable="false"
    /></span>
    <span class="hidden group-hover:inline group-hover/emoji:inline"
      ><img v-bind="$attrs" :src="emoji.imageUrl" :alt="alt" :title="title" draggable="false"
    /></span>
  </span>
  <img v-else v-bind="$attrs" :src="emoji.imageUrl" :alt="alt" :title="title" draggable="false" />
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { CustomEmoji } from "@/services/emoji"
import { useAppSettingsStore } from "@/stores/appSettings"

// A custom emoji image. With `pausable` and the reduce-motion setting on, an
// animated emoji shows its still first frame until the nearest `group`
// ancestor (room card, user row) or the emoji itself is hovered.
const props = defineProps<{
  emoji: CustomEmoji
  pausable?: boolean
  alt?: string
  title?: string
}>()
defineOptions({ inheritAttrs: false })

const appSettings = useAppSettingsStore()
const paused = computed(
  () => !!props.pausable && !!props.emoji.stillUrl && appSettings.reduceEmojiMotion,
)
</script>
