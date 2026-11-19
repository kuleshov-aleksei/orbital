<template>
  <Teleport to="body">
    <div
      v-if="shown && emoji"
      ref="popupEl"
      role="tooltip"
      class="fixed z-50 max-w-64 px-3 py-2 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-lg pointer-events-none"
      :style="{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        visibility: pos.ready ? 'visible' : 'hidden',
      }"
      :data-testid="testId">
      <div class="flex flex-col items-center gap-1">
        <span class="max-w-full text-xs text-theme-text-muted">{{ label }}</span>
        <EmojiGlyph :emoji-ref="emoji.ref" :size="size" class="shrink-0" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useTemplateRef,
  watch,
} from "vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import { resolveEmoji, type EmojiRef } from "@/services/emoji"

// Hover card for an emoji: the glyph enlarged under a one-line caption.
// Callers only point `anchor` at the hovered element and clear it on leave —
// the hover delay, the viewport fitting and the teleport (so scroll containers
// can't clip it) live here.
const props = withDefaults(
  defineProps<{
    emojiRef: EmojiRef | null
    // Element the card is attached to; null hides it.
    anchor: HTMLElement | null
    // Text above the glyph; the emoji name by default.
    caption?: string
    size?: number
    testId?: string
  }>(),
  { caption: "", size: 64, testId: "emoji-hover-preview" },
)

// Same feel as the reaction chips: a short pause before showing, so sweeping
// across a grid of emojis doesn't flash a card per cell.
const HOVER_DELAY_MS = 250
const VIEWPORT_MARGIN = 8

const emoji = computed(() => resolveEmoji(props.emojiRef))
const label = computed(() => props.caption || emoji.value?.name || "")

const popupEl = useTemplateRef<HTMLElement>("popupEl")
const pos = reactive({ left: 0, top: 0, ready: false })
const shown = ref(false)
let showTimer: ReturnType<typeof setTimeout> | undefined

function hide() {
  clearTimeout(showTimer)
  shown.value = false
  pos.ready = false
}

watch(
  () => [props.anchor, props.emojiRef] as const,
  ([anchor, emojiRef]) => {
    hide()
    if (!anchor || !emojiRef) return
    showTimer = setTimeout(async () => {
      // The pointer may have moved on, or the row been recycled, meanwhile.
      if (props.anchor !== anchor || !anchor.isConnected) return
      shown.value = true
      await nextTick()
      position()
    }, HOVER_DELAY_MS)
  },
  { immediate: true },
)

// Centered above the anchor, flipped below when there's no room, clamped to
// the viewport.
function position() {
  const anchor = props.anchor
  const popup = popupEl.value
  if (!anchor || !popup || !anchor.isConnected) return hide()
  const a = anchor.getBoundingClientRect()
  const p = popup.getBoundingClientRect()
  let top = a.top - p.height - 6
  if (top < VIEWPORT_MARGIN) top = a.bottom + 6
  const centered = a.left + a.width / 2 - p.width / 2
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - p.width - VIEWPORT_MARGIN)
  pos.left = Math.min(Math.max(centered, VIEWPORT_MARGIN), maxLeft)
  pos.top = top
  pos.ready = true
}

// Any scroll moves the anchor out from under the card. Capture, so scrolling
// inside a list or the picker's virtual scroller counts too.
onMounted(() => {
  window.addEventListener("scroll", hide, true)
  window.addEventListener("resize", hide)
})
onBeforeUnmount(() => {
  hide()
  window.removeEventListener("scroll", hide, true)
  window.removeEventListener("resize", hide)
})
</script>
