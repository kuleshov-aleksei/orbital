<template>
  <div
    class="message-content whitespace-pre-wrap break-words text-theme-text-primary leading-relaxed"
    :class="{ 'jumbo leading-tight py-0.5': jumbo }"
    data-testid="message-content">
    <MessageNodes :nodes="nodes" :emoji-size="jumbo ? 44 : 22" />
    <span
      v-if="editedAt"
      class="ml-1 text-[11px] text-theme-text-muted select-none"
      :title="`Edited ${formatFullTime(editedAt)}`"
      >(edited)</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import MessageNodes from "./MessageNodes.vue"
import { emojiOnlyCount, JUMBO_EMOJI_MAX, parseMessage } from "@/utils/messageMarkup"
import { formatFullTime } from "@/utils/messageGrouping"

const props = defineProps<{ content: string; editedAt?: number | null }>()

const nodes = computed(() => parseMessage(props.content))
// Emoji-only messages render large, as in Discord.
const jumbo = computed(() => {
  const n = emojiOnlyCount(nodes.value)
  return n > 0 && n <= JUMBO_EMOJI_MAX
})
</script>

<style scoped>
.jumbo {
  font-size: 2.5rem;
}
</style>
