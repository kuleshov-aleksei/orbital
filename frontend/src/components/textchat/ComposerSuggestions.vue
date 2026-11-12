<template>
  <div
    class="absolute bottom-full left-0 right-0 mb-2 z-20 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-lg py-1 max-h-72 overflow-y-auto"
    role="listbox"
    :aria-label="title"
    data-testid="composer-suggestions">
    <div
      class="px-3 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted">
      {{ title }}
    </div>
    <button
      v-for="(item, i) in items"
      :key="item.key"
      type="button"
      role="option"
      :aria-selected="i === active"
      class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left"
      :class="
        i === active
          ? 'bg-theme-bg-hover text-theme-text-primary'
          : 'text-theme-text-secondary hover:bg-theme-bg-hover/60'
      "
      @mousedown.prevent
      @mouseenter="$emit('hover', i)"
      @click="$emit('pick', item)">
      <UserAvatar v-if="item.kind === 'user'" :user-id="item.id" :size="20" :show-status="false" />
      <PhAt v-else-if="item.kind === 'role'" class="w-5 h-5" :style="{ color: item.color }" />
      <EmojiGlyph v-else :emoji-ref="item.id" :size="20" />
      <span class="truncate font-medium" :style="item.color ? { color: item.color } : undefined">{{
        item.label
      }}</span>
      <span v-if="item.hint" class="ml-auto text-xs text-theme-text-muted truncate">{{
        item.hint
      }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { PhAt } from "@phosphor-icons/vue"
import UserAvatar from "@/components/UserAvatar.vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"

export interface Suggestion {
  key: string
  kind: "user" | "role" | "emoji"
  /** User id, role id, or emoji ref. */
  id: string
  label: string
  /** Text inserted into the textarea. */
  insert: string
  /** Token the inserted "@Name" stands for (mentions only). */
  token?: string
  hint?: string
  color?: string
}

defineProps<{ items: Suggestion[]; active: number; title: string }>()
defineEmits<{ pick: [item: Suggestion]; hover: [index: number] }>()
</script>
