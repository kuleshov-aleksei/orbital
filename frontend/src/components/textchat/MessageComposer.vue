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
        @input="onInput"
        @click="updateSuggestions"
        @keydown="onKeydown"
        @blur="closeSuggestions" />
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
      <ComposerSuggestions
        v-if="suggestions.length"
        :items="suggestions"
        :active="activeSuggestion"
        :title="suggestionTitle"
        @hover="(i) => (activeSuggestion = i)"
        @pick="applySuggestion" />
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
import ComposerSuggestions, { type Suggestion } from "./ComposerSuggestions.vue"
import {
  activeEmojiQuery,
  activeMentionQuery,
  encodeMentions,
  roleMentionToken,
  userMentionToken,
  type MentionMap,
} from "@/utils/mentionText"
import {
  CUSTOM_EMOJI_PREFIX,
  emojiShortcode,
  emojiTextLength,
  emojiTextToPlain,
  encodeShortcodes,
  resolveEmoji,
  searchEmojis,
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
    closeSuggestions()
    await nextTick()
    autosize()
    focus()
  },
)

/** "@Name" texts picked from the autocomplete in this channel's draft. */
function mentionMap(): MentionMap {
  let map = mentionMaps.get(props.roomId)
  if (!map) {
    map = new Map()
    mentionMaps.set(props.roomId, map)
  }
  return map
}
watch(draft, (value) => drafts.set(props.roomId, value))

const replyTarget = computed(() =>
  textChatStore.replyTarget?.room_id === props.roomId ? textChatStore.replyTarget : null,
)
watch(replyTarget, (target) => {
  if (target) focus()
})

const plainChannelName = computed(() => emojiTextToPlain(props.channelName))

// The textarea shows custom emojis as :shortcode: and "@Name" mentions;
// both become tokens on send.
const encode = (text: string) =>
  encodeMentions(
    encodeShortcodes(text, (code) => customEmojisStore.idForShortcode(code)),
    mentionMap(),
  )
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
  mentionMap().clear()
  closeSuggestions()
  void nextTick(autosize)
}

function onInput() {
  autosize()
  updateSuggestions()
  if (draft.value.trim()) textChatStore.notifyTyping(props.roomId)
}

// --- Autocomplete (@mentions, :emoji) ----------------------------------

const MAX_SUGGESTIONS = 8
const suggestions = ref<Suggestion[]>([])
const suggestionTitle = ref("")
const activeSuggestion = ref(0)
let suggestionStart = -1

function closeSuggestions() {
  suggestions.value = []
  suggestionStart = -1
}

function mentionSuggestions(query: string): Suggestion[] {
  const q = query.toLowerCase()
  const rank = (name: string) => {
    const n = name.toLowerCase()
    return n.startsWith(q) ? 0 : n.includes(q) ? 1 : -1
  }
  const users = usersStore.allUsers
    .map((u) => ({ u, r: rank(u.nickname) }))
    .filter((x) => x.r >= 0 && x.u.id !== props.myUserId)
    .sort((a, b) => a.r - b.r || a.u.nickname.localeCompare(b.u.nickname))
    .map(({ u }): Suggestion => ({
      key: `u:${u.id}`,
      kind: "user",
      id: u.id,
      label: u.nickname,
      insert: `@${u.nickname}`,
      token: userMentionToken(u.id),
      color: permissionsStore.colorOf(u.id) || undefined,
    }))
  const roles = permissionsStore.customRoles
    .filter((r) => rank(r.name) >= 0)
    .map((r): Suggestion => ({
      key: `r:${r.id}`,
      kind: "role",
      id: r.id,
      label: r.name,
      insert: `@${r.name}`,
      token: roleMentionToken(r.id),
      hint: "Role",
      color: r.color || undefined,
    }))
  return [...users.slice(0, MAX_SUGGESTIONS - Math.min(roles.length, 3)), ...roles].slice(
    0,
    MAX_SUGGESTIONS,
  )
}

function emojiSuggestions(query: string): Suggestion[] {
  return searchEmojis(query, MAX_SUGGESTIONS).map((e) => ({
    key: `e:${e.ref}`,
    kind: "emoji",
    id: e.ref,
    label: `:${emojiShortcode(e.name)}:`,
    insert: e.kind === "custom" ? `:${emojiShortcode(e.name)}:` : (e.char ?? e.ref),
  }))
}

function updateSuggestions() {
  const el = input.value
  if (!el || el.selectionStart !== el.selectionEnd) return closeSuggestions()
  const caret = el.selectionStart
  const mention = activeMentionQuery(draft.value, caret)
  if (mention) {
    suggestions.value = mentionSuggestions(mention.query)
    suggestionTitle.value = "Members and roles"
    suggestionStart = mention.start
  } else {
    const emoji = activeEmojiQuery(draft.value, caret)
    if (emoji) {
      suggestions.value = emojiSuggestions(emoji.query)
      suggestionTitle.value = "Emoji"
      suggestionStart = emoji.start
    } else {
      closeSuggestions()
    }
  }
  activeSuggestion.value = 0
}

async function applySuggestion(item: Suggestion) {
  const el = input.value
  if (!el || suggestionStart < 0) return
  const caret = el.selectionStart
  const text = `${item.insert} `
  if (item.token) mentionMap().set(item.insert, item.token)
  draft.value = draft.value.slice(0, suggestionStart) + text + draft.value.slice(caret)
  const next = suggestionStart + text.length
  closeSuggestions()
  await nextTick()
  el.focus()
  el.setSelectionRange(next, next)
  autosize()
}

/** Keys for the open suggestion list; true when handled. */
function onSuggestionKey(event: KeyboardEvent): boolean {
  if (!suggestions.value.length) return false
  const n = suggestions.value.length
  switch (event.key) {
    case "ArrowDown":
      activeSuggestion.value = (activeSuggestion.value + 1) % n
      break
    case "ArrowUp":
      activeSuggestion.value = (activeSuggestion.value - 1 + n) % n
      break
    case "Enter":
    case "Tab":
      if (event.shiftKey) return false
      void applySuggestion(suggestions.value[activeSuggestion.value])
      break
    case "Escape":
      closeSuggestions()
      break
    default:
      return false
  }
  event.preventDefault()
  return true
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (onSuggestionKey(event)) return
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    void nextTick(updateSuggestions)
  }
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
const mentionMaps = new Map<string, Map<string, string>>()
function draftStore() {
  return sessionDrafts
}
</script>
