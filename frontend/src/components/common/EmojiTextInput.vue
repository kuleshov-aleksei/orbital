<template>
  <div>
    <div class="relative">
      <input
        ref="input"
        v-bind="$attrs"
        v-model="display"
        type="text"
        :class="['pr-10', inputClass]"
        @keydown.escape="onInputEscape" />
      <button
        type="button"
        class="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
        :class="{ 'bg-theme-bg-hover text-theme-text-primary': isPickerOpen }"
        title="Insert emoji"
        aria-label="Insert emoji"
        :aria-expanded="isPickerOpen"
        data-testid="emoji-insert-button"
        @mousedown.prevent
        @click="isPickerOpen = !isPickerOpen">
        <PhSmiley class="w-5 h-5" />
      </button>
    </div>
    <p
      v-if="hasCustomEmojis"
      class="mt-1 text-xs text-theme-text-muted truncate"
      data-testid="emoji-text-preview">
      Preview: <EmojiText :text="model" class="text-theme-text-primary" />
    </p>
    <EmojiPicker
      v-if="isPickerOpen"
      class="mt-1.5"
      :unicode-only="!allowCustom"
      @select="insert"
      @close="closePicker" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue"
import { PhSmiley } from "@phosphor-icons/vue"
import EmojiPicker from "@/components/EmojiPicker.vue"
import EmojiText from "@/components/common/EmojiText.vue"
import {
  CUSTOM_EMOJI_PREFIX,
  emojiShortcode,
  emojiTextToPlain,
  extractShortcodes,
  encodeShortcodes,
  parseEmojiText,
  resolveEmoji,
  tokenIdsByShortcode,
  type EmojiRef,
} from "@/services/emoji"
import { useCustomEmojisStore } from "@/stores"

const props = defineProps<{ inputClass?: string; allowCustom?: boolean }>()
// A text input with an emoji picker that inserts at the caret. Extra
// attributes (id, placeholder, data-testid…) go to the <input>.
// With allowCustom, custom emojis are stored in the model as `<:shortcode:id>`
// tokens (see services/emoji/inlineText.ts) and edited as `:shortcode:`.
defineOptions({ inheritAttrs: false })
const model = defineModel<string>({ required: true })
const input = useTemplateRef<HTMLInputElement>("input")
const isPickerOpen = ref(false)
const customEmojisStore = useCustomEmojisStore()

// Shortcodes this field already resolved (from the initial value or the
// picker), so an edit round-trip keeps the exact emoji even if names collide.
const pinned = new Map<string, string>()
const lookup = (shortcode: string) =>
  props.allowCustom ? (pinned.get(shortcode) ?? customEmojisStore.idForShortcode(shortcode)) : null
const encode = (text: string) => encodeShortcodes(text, lookup)

const display = ref("")
watch(
  model,
  (value) => {
    if (encode(display.value) === value) return
    for (const [code, id] of tokenIdsByShortcode(value)) pinned.set(code, id)
    display.value = emojiTextToPlain(value)
  },
  { immediate: true },
)
watch(display, (value) => {
  if (props.allowCustom) void customEmojisStore.requestShortcodes(extractShortcodes(value))
  const encoded = encode(value)
  if (encoded !== model.value) model.value = encoded
})
// Shortcodes resolve asynchronously (custom emojis load on demand):
// re-encode typed shortcodes once they do.
watch(
  () => customEmojisStore.version,
  () => {
    const encoded = encode(display.value)
    if (encoded !== model.value) model.value = encoded
  },
)

const hasCustomEmojis = computed(() => parseEmojiText(model.value).some((s) => s.kind === "emoji"))

function textFor(ref: EmojiRef): string {
  if (!ref.startsWith(CUSTOM_EMOJI_PREFIX)) return ref
  const emoji = resolveEmoji(ref)
  if (!emoji) return ""
  const code = emojiShortcode(emoji.name)
  pinned.set(code, ref.slice(CUSTOM_EMOJI_PREFIX.length))
  return `:${code}:`
}

async function insert(ref: EmojiRef) {
  isPickerOpen.value = false
  const text = textFor(ref)
  if (!text) return
  const el = input.value
  const value = display.value
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? value.length
  display.value = value.slice(0, start) + text + value.slice(end)
  await nextTick()
  const caret = start + text.length
  el?.focus()
  el?.setSelectionRange(caret, caret)
}

function closePicker() {
  isPickerOpen.value = false
  input.value?.focus()
}

function onInputEscape(event: KeyboardEvent) {
  // First Escape closes the picker, not the surrounding modal.
  if (isPickerOpen.value) {
    event.stopPropagation()
    isPickerOpen.value = false
  }
}
</script>
