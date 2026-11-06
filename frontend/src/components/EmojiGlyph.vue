<template>
  <img
    v-if="emoji?.kind === 'custom'"
    :src="emoji.imageUrl"
    :alt="emoji.name"
    :title="emoji.name"
    class="inline-block object-contain align-[-0.15em]"
    :style="{ width: `${size}px`, height: `${size}px` }"
    draggable="false" />
  <span
    v-else-if="emoji"
    class="inline-block leading-none align-[-0.1em]"
    :style="{ fontSize: `${size}px` }"
    role="img"
    :aria-label="emoji.name"
    >{{ emoji.char }}</span
  >
</template>

<script setup lang="ts">
import { computed } from "vue"
import { resolveEmoji, type EmojiRef } from "@/services/emoji"

const props = withDefaults(defineProps<{ emojiRef?: EmojiRef | null; size?: number }>(), {
  emojiRef: null,
  size: 16,
})

const emoji = computed(() => resolveEmoji(props.emojiRef))
</script>
