<template>
  <CustomEmojiImage
    v-if="emoji?.kind === 'custom'"
    :emoji="emoji"
    :pausable="pausable"
    :alt="emoji.name"
    :title="emoji.name"
    class="inline-block object-contain align-[-0.15em]"
    :style="{ width: `${size}px`, height: `${size}px` }" />
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
import CustomEmojiImage from "@/components/emoji/CustomEmojiImage.vue"
import { resolveEmoji, type EmojiRef } from "@/services/emoji"

// pausable: honour the reduce-motion setting (see CustomEmojiImage).
const props = withDefaults(
  defineProps<{ emojiRef?: EmojiRef | null; size?: number; pausable?: boolean }>(),
  { emojiRef: null, size: 16, pausable: false },
)

const emoji = computed(() => resolveEmoji(props.emojiRef))
</script>
