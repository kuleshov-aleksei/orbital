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
      :aria-label="`${r.user_ids.length} ${r.user_ids.length === 1 ? 'reaction' : 'reactions'}, ${whoReacted(r)}`"
      :aria-pressed="mine(r)"
      :disabled="!canReact"
      data-testid="reaction-chip"
      @mouseenter="showPreview(r.emoji, $event)"
      @mouseleave="hidePreview"
      @focus="showPreview(r.emoji, $event)"
      @blur="hidePreview"
      @click="$emit('toggle', r.emoji)">
      <EmojiGlyph :emoji-ref="r.emoji" :size="16" />
      <span class="font-semibold tabular-nums">{{ r.user_ids.length }}</span>
    </button>
    <button
      v-if="canReact && reactions.length < MAX_REACTIONS"
      type="button"
      class="flex items-center justify-center rounded-md bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary"
      :class="
        appStore.isMobile
          ? 'h-6 w-9'
          : 'h-6 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity'
      "
      title="Add reaction"
      aria-label="Add reaction"
      data-testid="reaction-bar-add"
      @click="$emit('add', $event)">
      <SmileyPlusIcon :size="16" />
    </button>

    <!-- Teleported so the scrolling message list doesn't clip it -->
    <Teleport v-if="preview" to="body">
      <div
        ref="popupEl"
        role="tooltip"
        class="fixed z-50 max-w-64 px-3 py-2 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-lg pointer-events-none"
        :style="{
          left: `${popupPos.left}px`,
          top: `${popupPos.top}px`,
          visibility: popupPos.ready ? 'visible' : 'hidden',
        }"
        data-testid="reaction-preview">
        <div class="flex flex-col items-center gap-1">
          <span class="max-w-full text-xs text-theme-text-muted truncate">{{
            shortcode(preview.reaction.emoji)
          }}</span>
          <EmojiGlyph :emoji-ref="preview.reaction.emoji" :size="64" class="shrink-0" />
        </div>
        <ul
          class="mt-1.5 text-sm text-theme-text-primary space-y-0.5"
          data-testid="reaction-preview-users">
          <li v-for="name in previewNames.names" :key="name.id" class="truncate">
            {{ name.label }}
          </li>
          <li v-if="previewNames.more > 0" class="text-xs text-theme-text-muted">
            and {{ previewNames.more }} more
          </li>
        </ul>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, useTemplateRef } from "vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import SmileyPlusIcon from "./SmileyPlusIcon.vue"
import { useAppStore, useUsersStore } from "@/stores"
import { emojiShortcode, resolveEmoji } from "@/services/emoji"
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
// Names listed in the hover preview before collapsing to "and N more"
const MAX_PREVIEW_NAMES = 15
const HOVER_DELAY_MS = 250
const VIEWPORT_MARGIN = 8
const usersStore = useUsersStore()
const appStore = useAppStore()

function mine(r: TextReaction): boolean {
  return r.user_ids.includes(props.myUserId)
}

function whoReacted(r: TextReaction): string {
  const names = r.user_ids.slice(0, 10).map((id) => usersStore.displayName(id))
  const more = r.user_ids.length - names.length
  return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ")
}

function shortcode(emojiRef: string): string {
  const emoji = resolveEmoji(emojiRef)
  return emoji ? `:${emojiShortcode(emoji.name)}:` : emojiRef
}

// Hover preview: the emoji at 2x size plus everyone who reacted with it.
// Keyed by emoji so live reaction updates refresh the open preview.
const previewEmoji = ref<string | null>(null)
const anchorEl = ref<HTMLElement | null>(null)
const popupEl = useTemplateRef<HTMLElement>("popupEl")
const popupPos = reactive({ left: 0, top: 0, ready: false })
let showTimer: ReturnType<typeof setTimeout> | undefined

const preview = computed(() => {
  const reaction = props.reactions.find((r) => r.emoji === previewEmoji.value)
  return reaction ? { reaction } : null
})

const previewNames = computed(() => {
  const ids = preview.value?.reaction.user_ids ?? []
  // The current user first, as "You"
  const ordered = ids.includes(props.myUserId)
    ? [props.myUserId, ...ids.filter((id) => id !== props.myUserId)]
    : ids
  const names = ordered.slice(0, MAX_PREVIEW_NAMES).map((id) => ({
    id,
    label: id === props.myUserId ? "You" : usersStore.displayName(id),
  }))
  return { names, more: ids.length - names.length }
})

function showPreview(emoji: string, event: Event) {
  // No hover on touch: the long-press action sheet covers mobile
  if (appStore.isMobile) return
  clearTimeout(showTimer)
  const target = event.currentTarget as HTMLElement
  showTimer = setTimeout(async () => {
    anchorEl.value = target
    previewEmoji.value = emoji
    popupPos.ready = false
    await nextTick()
    positionPopup()
  }, HOVER_DELAY_MS)
}

function hidePreview() {
  clearTimeout(showTimer)
  previewEmoji.value = null
  anchorEl.value = null
}

// Centered above the chip, flipped below when there's no room, clamped to the viewport
function positionPopup() {
  const anchor = anchorEl.value
  const popup = popupEl.value
  if (!anchor || !popup || !anchor.isConnected) return hidePreview()
  const a = anchor.getBoundingClientRect()
  const p = popup.getBoundingClientRect()
  let top = a.top - p.height - 6
  if (top < VIEWPORT_MARGIN) top = a.bottom + 6
  const maxLeft = window.innerWidth - p.width - VIEWPORT_MARGIN
  const left = Math.min(Math.max(a.left + a.width / 2 - p.width / 2, VIEWPORT_MARGIN), maxLeft)
  popupPos.left = left
  popupPos.top = top
  popupPos.ready = true
}

onBeforeUnmount(hidePreview)
</script>
