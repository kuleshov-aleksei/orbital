<template>
  <div class="px-4 pb-4 pt-1 flex-shrink-0">
    <!-- Reply bar -->
    <div
      v-if="replyTarget"
      class="flex items-center gap-2 px-3 py-1.5 rounded-t-lg bg-theme-bg-tertiary/70 border border-b-0 border-theme-border text-xs text-theme-text-secondary"
      data-testid="reply-bar">
      <span class="truncate flex-1">
        Replying to
        <span class="font-semibold" :style="permissionsStore.nameStyleOf(replyTarget.sender_id)">{{
          nameOf(replyTarget.sender_id)
        }}</span>
      </span>
      <button
        v-if="replyTarget.sender_id !== myUserId"
        type="button"
        class="font-semibold px-1.5 rounded transition-colors"
        :class="textChatStore.replyPing ? 'text-theme-accent' : 'text-theme-text-muted'"
        :title="textChatStore.replyPing ? 'Mention is on: they get notified' : 'Mention is off'"
        :aria-pressed="textChatStore.replyPing"
        data-testid="reply-ping-toggle"
        @click="textChatStore.replyPing = !textChatStore.replyPing">
        @ {{ textChatStore.replyPing ? "ON" : "OFF" }}
      </button>
      <button
        type="button"
        class="w-5 h-5 flex items-center justify-center rounded-full hover:bg-theme-bg-hover"
        aria-label="Cancel reply"
        @click="textChatStore.cancelReply()">
        <PhX class="w-3.5 h-3.5" />
      </button>
    </div>

    <div
      class="relative flex items-end gap-2 bg-theme-bg-tertiary border border-theme-border px-3 py-2 focus-within:border-theme-accent transition-colors"
      :class="replyTarget ? 'rounded-b-lg' : 'rounded-lg'">
      <textarea
        ref="input"
        v-model="draft"
        rows="1"
        :disabled="!canSend"
        :placeholder="
          canSend
            ? `Message #${plainChannelName}`
            : 'You do not have permission to send messages in this channel'
        "
        :maxlength="MAX_CHARS * 2"
        class="flex-1 resize-none bg-transparent text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none py-1 max-h-[50vh] disabled:cursor-not-allowed"
        data-testid="text-composer"
        aria-label="Message"
        @input="autosize"
        @keydown="onKeydown" />
      <span
        v-if="charCount > MAX_CHARS - 200"
        class="text-[11px] self-center"
        :class="charCount > MAX_CHARS ? 'text-red-400' : 'text-theme-text-muted'"
        >{{ MAX_CHARS - charCount }}</span
      >
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
        :class="{ 'text-theme-text-primary bg-theme-bg-hover': isPickerOpen }"
        title="Emoji"
        aria-label="Insert emoji"
        :aria-expanded="isPickerOpen"
        :disabled="!canSend"
        @mousedown.prevent
        @click="isPickerOpen = !isPickerOpen">
        <PhSmiley class="w-5 h-5" />
      </button>
      <EmojiPicker
        v-if="isPickerOpen"
        class="absolute bottom-full right-0 mb-2 z-20"
        @select="insertEmoji"
        @close="closePicker" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue"
import { PhSmiley, PhX } from "@phosphor-icons/vue"
import EmojiPicker from "@/components/EmojiPicker.vue"
import {
  CUSTOM_EMOJI_PREFIX,
  emojiShortcode,
  emojiTextLength,
  emojiTextToPlain,
  encodeShortcodes,
  resolveEmoji,
  type EmojiRef,
} from "@/services/emoji"
import {
  useCustomEmojisStore,
  usePermissionsStore,
  useTextChatStore,
  useUsersStore,
} from "@/stores"

const props = defineProps<{
  roomId: string
  channelName: string
  canSend: boolean
  myUserId: string
}>()

const emit = defineEmits<{
  /** ↑ in an empty composer: edit your last message. */
  "edit-last": []
  /** Esc with nothing to cancel: mark the channel read. */
  escape: []
}>()

const MAX_CHARS = 2000

const textChatStore = useTextChatStore()
const customEmojisStore = useCustomEmojisStore()
const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()

const input = useTemplateRef<HTMLTextAreaElement>("input")
const isPickerOpen = ref(false)

// Drafts survive switching channels (kept for this app session).
const drafts = draftStore()
const draft = ref(drafts.get(props.roomId) ?? "")
watch(
  () => props.roomId,
  async (roomId, previous) => {
    if (previous) drafts.set(previous, draft.value)
    draft.value = drafts.get(roomId) ?? ""
    await nextTick()
    autosize()
    focus()
  },
)
watch(draft, (value) => drafts.set(props.roomId, value))

const replyTarget = computed(() =>
  textChatStore.replyTarget?.room_id === props.roomId ? textChatStore.replyTarget : null,
)
watch(replyTarget, (target) => {
  if (target) focus()
})

const plainChannelName = computed(() => emojiTextToPlain(props.channelName))

// The textarea shows custom emojis as :shortcode: and sends tokens.
const encode = (text: string) =>
  encodeShortcodes(text, (code) => customEmojisStore.idForShortcode(code))
const charCount = computed(() => emojiTextLength(encode(draft.value)))

function nameOf(userId: string): string {
  return usersStore.allUsers.find((u) => u.id === userId)?.nickname ?? "Unknown user"
}

function autosize() {
  const el = input.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${el.scrollHeight}px`
}

function focus() {
  input.value?.focus()
}

function send() {
  const content = encode(draft.value.trim())
  if (!content || charCount.value > MAX_CHARS || !props.canSend) return
  textChatStore.sendMessage(props.roomId, content)
  draft.value = ""
  void nextTick(autosize)
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    send()
  } else if (event.key === "ArrowUp" && draft.value === "") {
    event.preventDefault()
    emit("edit-last")
  } else if (event.key === "Escape") {
    // Handled here; the channel view ignores prevented Escapes.
    event.preventDefault()
    if (isPickerOpen.value) {
      isPickerOpen.value = false
    } else if (replyTarget.value) {
      textChatStore.cancelReply()
    } else {
      emit("escape")
    }
  }
}

function textFor(ref: EmojiRef): string {
  if (!ref.startsWith(CUSTOM_EMOJI_PREFIX)) return ref
  const emoji = resolveEmoji(ref)
  return emoji ? `:${emojiShortcode(emoji.name)}:` : ""
}

async function insertEmoji(ref: EmojiRef) {
  isPickerOpen.value = false
  const text = textFor(ref)
  if (!text) return
  const el = input.value
  const value = draft.value
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? value.length
  draft.value = value.slice(0, start) + text + value.slice(end)
  await nextTick()
  const caret = start + text.length
  el?.focus()
  el?.setSelectionRange(caret, caret)
  autosize()
}

function closePicker() {
  isPickerOpen.value = false
  focus()
}

defineExpose({ focus })
</script>

<script lang="ts">
const sessionDrafts = new Map<string, string>()
function draftStore() {
  return sessionDrafts
}
</script>
