<template>
  <div class="flex flex-wrap gap-1 mt-1" data-testid="reaction-bar">
    <button
      v-for="r in reactions"
      :key="r.emoji"
      type="button"
      class="reaction-chip h-6 px-1.5 flex items-center gap-1 rounded-md border text-xs transition-colors select-none"
      :class="[
        mine(r)
          ? 'border-theme-accent bg-theme-accent/15 text-theme-text-primary'
          : 'border-transparent bg-theme-bg-tertiary text-theme-text-secondary hover:border-theme-border',
        canReact ? '' : 'cursor-default',
      ]"
      :aria-label="`${r.user_ids.length} ${r.user_ids.length === 1 ? 'reaction' : 'reactions'}, ${whoReacted(r)}`"
      :aria-pressed="mine(r)"
      :aria-disabled="!canReact"
      data-testid="reaction-chip"
      data-no-long-press
      @mouseenter="showPreview(r.emoji, $event)"
      @mouseleave="hidePreview"
      @focus="showPreview(r.emoji, $event)"
      @blur="hidePreview"
      @pointerdown="onChipPointerdown(r.emoji, $event)"
      @pointermove="longPress.onPointermove"
      @pointerup="longPress.onPointerup"
      @pointercancel="longPress.onPointercancel"
      @click.capture="longPress.onClickCapture"
      @contextmenu="onChipContextMenu"
      @click="onChipClick(r.emoji)">
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

    <!-- Teleported by EmojiHoverPreview so the message list can't clip it -->
    <EmojiHoverPreview
      :emoji-ref="previewRef"
      :anchor="anchorEl"
      :caption="previewCaption"
      test-id="reaction-preview" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import EmojiHoverPreview from "@/components/common/EmojiHoverPreview.vue"
import SmileyPlusIcon from "./SmileyPlusIcon.vue"
import { useAppStore, useUsersStore } from "@/stores"
import { resolveEmoji } from "@/services/emoji"
import { useLongPress } from "@/composables/useLongPress"
import { orderReactors } from "@/utils/reactions"
import type { TextReaction } from "@/types/textChat"

const props = defineProps<{
  reactions: TextReaction[]
  myUserId: string
  canReact: boolean
}>()

const emit = defineEmits<{
  toggle: [emoji: string]
  add: [event: MouseEvent]
  /** Mobile long press on a chip: show who reacted. */
  "show-reactors": [emoji: string]
}>()

const MAX_REACTIONS = 20
// Names listed in the hover preview before collapsing to "and N more"
const MAX_PREVIEW_NAMES = 15
const usersStore = useUsersStore()
const appStore = useAppStore()

function mine(r: TextReaction): boolean {
  return r.user_ids.includes(props.myUserId)
}

// --- Mobile long press: who reacted -------------------------------------
// One detector for all chips; the pressed chip's emoji is remembered on
// pointerdown. The chips carry data-no-long-press so the message's own long
// press (action sheet) stays out of it.
let pressedEmoji = ""
const longPress = useLongPress(() => emit("show-reactors", pressedEmoji), {
  enabled: () => appStore.isMobile,
})

function onChipPointerdown(emoji: string, e: PointerEvent) {
  pressedEmoji = emoji
  // Without the target: data-no-long-press on the chip opts it out of the
  // message press, not out of its own.
  longPress.onPointerdown({
    pointerType: e.pointerType,
    button: e.button,
    isPrimary: e.isPrimary,
    clientX: e.clientX,
    clientY: e.clientY,
    target: null,
  })
}

// Android also reports the long press as contextmenu (callout).
function onChipContextMenu(e: MouseEvent) {
  if (appStore.isMobile) e.preventDefault()
}

function onChipClick(emoji: string) {
  // aria-disabled instead of disabled, so the chip still gets the long press
  if (props.canReact) emit("toggle", emoji)
}

// "You", "You and Alice", "Alice, Bob and Carol", "Alice, Bob and 5 more"
function reactorNames(userIds: string[]): string[] {
  // The current user first, as "You"
  const ordered = orderReactors(userIds, props.myUserId)
  const names = ordered
    .slice(0, MAX_PREVIEW_NAMES)
    .map((id) => (id === props.myUserId ? "You" : usersStore.displayName(id)))
  const more = ordered.length - names.length
  if (more > 0) names.push(`${more} more`)
  return names
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

function whoReacted(r: TextReaction): string {
  return joinNames(reactorNames(r.user_ids))
}

// Hover preview: the emoji enlarged plus everyone who reacted with it.
// Keyed by emoji so live reaction updates refresh the open preview.
const previewEmoji = ref<string | null>(null)
const anchorEl = ref<HTMLElement | null>(null)

const preview = computed(() => {
  const reaction = props.reactions.find((r) => r.emoji === previewEmoji.value)
  return reaction ? { reaction } : null
})

// Null once the last reactor removes the emoji: the chip is gone, so the card
// must go with it.
const previewRef = computed(() => preview.value?.reaction.emoji ?? null)

// "You and Alice reacted with thumbs up" — the card's caption for a reaction.
const previewCaption = computed(() => {
  const reaction = preview.value?.reaction
  if (!reaction) return ""
  const title = resolveEmoji(reaction.emoji)?.name ?? reaction.emoji
  return `${joinNames(reactorNames(reaction.user_ids))} reacted with ${title}`
})

function showPreview(emoji: string, event: Event) {
  // No hover on touch: the long-press action sheet covers mobile
  if (appStore.isMobile) return
  previewEmoji.value = emoji
  anchorEl.value = event.currentTarget as HTMLElement
}

function hidePreview() {
  previewEmoji.value = null
  anchorEl.value = null
}
</script>

<style scoped>
/* No Android callout on a long press: it opens the reactors sheet instead. */
.reaction-chip {
  -webkit-touch-callout: none;
}
</style>
