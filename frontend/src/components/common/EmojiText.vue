<template>
  <span
    ><template v-for="(segment, i) in segments" :key="i"
      ><template v-if="segment.kind === 'text'">{{ segment.text }}</template
      ><img
        v-else-if="segment.emoji"
        :src="segment.emoji.imageUrl"
        :alt="`:${segment.shortcode}:`"
        class="inline-block object-contain align-[-0.2em] h-[1.25em] w-[1.25em]"
        draggable="false" /><template v-else>:{{ segment.shortcode }}:</template></template
    ></span
  >
</template>

<script setup lang="ts">
import { computed } from "vue"
import {
  parseEmojiText,
  resolveEmoji,
  type CustomEmoji,
  type EmojiTextSegment,
} from "@/services/emoji"

// Renders plain text that may contain `<:shortcode:id>` custom emoji tokens
// (room names). Unknown/deleted emojis fall back to `:shortcode:`.
const props = defineProps<{ text: string }>()

type Segment = EmojiTextSegment & { emoji?: CustomEmoji | null }

const segments = computed<Segment[]>(() =>
  parseEmojiText(props.text).map((s) => {
    if (s.kind === "text") return s
    const emoji = resolveEmoji(s.ref)
    return { ...s, emoji: emoji?.kind === "custom" ? emoji : null }
  }),
)
</script>
