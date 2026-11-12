<template>
  <div class="flex flex-wrap gap-1 mt-1" data-testid="reaction-bar">
    <button
      v-for="r in reactions"
      :key="r.emoji"
      type="button"
      class="h-6 px-1.5 flex items-center gap-1 rounded-md border text-xs transition-colors"
      :class="
        mine(r)
          ? 'border-theme-accent bg-theme-accent/15 text-theme-text-primary'
          : 'border-transparent bg-theme-bg-tertiary text-theme-text-secondary hover:border-theme-border'
      "
      :title="whoReacted(r)"
      :aria-label="`${r.user_ids.length} ${r.user_ids.length === 1 ? 'reaction' : 'reactions'}, ${whoReacted(r)}`"
      :aria-pressed="mine(r)"
      :disabled="!canReact"
      data-testid="reaction-chip"
      @click="$emit('toggle', r.emoji)">
      <EmojiGlyph :emoji-ref="r.emoji" :size="16" />
      <span class="font-semibold tabular-nums">{{ r.user_ids.length }}</span>
    </button>
    <button
      v-if="canReact && reactions.length < MAX_REACTIONS"
      type="button"
      class="h-6 w-7 flex items-center justify-center rounded-md bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      title="Add reaction"
      aria-label="Add reaction"
      @click="$emit('add', $event)">
      <PhSmileyWink class="w-4 h-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { PhSmileyWink } from "@phosphor-icons/vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import { useUsersStore } from "@/stores"
import type { TextReaction } from "@/types/textChat"

const props = defineProps<{
  reactions: TextReaction[]
  myUserId: string
  canReact: boolean
}>()

defineEmits<{
  toggle: [emoji: string]
  add: [event: MouseEvent]
}>()

const MAX_REACTIONS = 20
const usersStore = useUsersStore()

function mine(r: TextReaction): boolean {
  return r.user_ids.includes(props.myUserId)
}

function whoReacted(r: TextReaction): string {
  const names = r.user_ids.slice(0, 10).map((id) => usersStore.displayName(id))
  const more = r.user_ids.length - names.length
  return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ")
}
</script>
