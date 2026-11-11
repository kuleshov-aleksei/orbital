<template>
  <div
    class="message-item group relative px-4 transition-colors"
    :class="[
      compact ? 'py-0.5' : 'pt-2 pb-0.5 mt-2',
      highlighted ? 'message-flash' : 'hover:bg-theme-bg-secondary/60',
      pendingStatus === 'sending' ? 'opacity-60' : '',
      mentionsMe ? 'mention-me' : '',
    ]"
    :data-message-id="message.id"
    data-testid="text-message">
    <!-- Reply quote -->
    <div
      v-if="message.reply_to_id"
      class="reply-quote flex items-center gap-1.5 ml-[52px] mb-0.5 text-xs text-theme-text-muted min-w-0">
      <button
        v-if="replied"
        type="button"
        class="flex items-center gap-1.5 min-w-0 hover:text-theme-text-primary"
        data-testid="reply-quote"
        @click="$emit('jump-to-reply', replied.id)">
        <UserAvatar :user-id="replied.sender_id" :size="16" :show-status="false" />
        <span
          class="font-medium flex-shrink-0"
          :style="permissionsStore.nameStyleOf(replied.sender_id)"
          >@{{ nameOf(replied.sender_id) }}</span
        >
        <span class="truncate">{{ replyPreview }}</span>
      </button>
      <span v-else class="italic" data-testid="reply-quote-deleted"
        >Original message was deleted</span
      >
    </div>

    <div class="flex gap-3 min-w-0">
      <!-- Gutter: avatar or hover time -->
      <div class="w-10 flex-shrink-0">
        <UserAvatar v-if="!compact" :user-id="message.sender_id" :size="40" :show-status="false" />
        <span
          v-else
          class="block whitespace-nowrap text-[10px] leading-5 tabular-nums text-right text-theme-text-muted opacity-0 group-hover:opacity-100 select-none"
          :title="formatFullTime(message.created_at_ts)"
          >{{ formatShortTime(message.created_at_ts) }}</span
        >
      </div>

      <div class="flex-1 min-w-0">
        <div v-if="!compact" class="flex items-baseline gap-2">
          <span
            class="font-semibold text-sm text-theme-text-primary truncate"
            :style="permissionsStore.nameStyleOf(message.sender_id)"
            >{{ nameOf(message.sender_id) }}</span
          >
          <span
            class="text-[11px] text-theme-text-muted flex-shrink-0"
            :title="formatFullTime(message.created_at_ts)"
            >{{ formatMessageTime(message.created_at_ts) }}</span
          >
          <PhPushPin
            v-if="message.pinned"
            class="w-3 h-3 text-theme-text-muted self-center flex-shrink-0"
            weight="fill"
            aria-label="Pinned"
            data-testid="pinned-marker" />
        </div>

        <!-- Inline edit -->
        <div v-if="editing" class="mt-1">
          <textarea
            ref="editInput"
            v-model="draft"
            rows="1"
            class="w-full resize-none rounded-md bg-theme-bg-tertiary border border-theme-border px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus-visible:outline-none focus:border-theme-accent"
            data-testid="edit-message-input"
            @input="autosize"
            @keydown.enter.exact.prevent="saveEdit"
            @keydown.escape.prevent.stop="$emit('cancel-edit')" />
          <p class="text-[11px] text-theme-text-muted mt-0.5">
            Escape to
            <button
              type="button"
              class="text-theme-accent hover:underline"
              @click="$emit('cancel-edit')">
              cancel
            </button>
            · Enter to
            <button type="button" class="text-theme-accent hover:underline" @click="saveEdit">
              save
            </button>
            <span v-if="editError" class="text-red-400 ml-2">{{ editError }}</span>
          </p>
        </div>
        <MessageContent v-else :content="message.content" :edited-at="message.edited_at_ts" />

        <ReactionBar
          v-if="message.reactions.length && !pendingStatus"
          :reactions="message.reactions"
          :my-user-id="myUserId"
          :can-react="canReply"
          @toggle="(emoji) => $emit('react', emoji)"
          @add="(e) => $emit('add-reaction', e)" />

        <div v-if="pendingStatus === 'failed'" class="text-xs text-red-400 mt-0.5 flex gap-2">
          <span>{{ pendingError || "Not delivered." }}</span>
          <button
            type="button"
            class="underline hover:text-red-300"
            data-testid="retry-message"
            @click="$emit('retry')">
            Retry
          </button>
          <button type="button" class="underline hover:text-red-300" @click="$emit('discard')">
            Discard
          </button>
        </div>
      </div>
    </div>

    <!-- Hover toolbar -->
    <div
      v-if="!pendingStatus && !editing"
      class="message-toolbar absolute -top-3 right-4 hidden group-hover:flex group-focus-within:flex items-center rounded-md border border-theme-border bg-theme-bg-secondary shadow-md"
      role="toolbar"
      aria-label="Message actions">
      <template v-if="canReply">
        <button
          v-for="emoji in recentReactions"
          :key="emoji"
          type="button"
          :class="toolbarBtn"
          :title="`React with ${emojiLabel(emoji)}`"
          :aria-label="`React with ${emojiLabel(emoji)}`"
          data-testid="quick-reaction"
          @click="$emit('react', emoji)">
          <EmojiGlyph :emoji-ref="emoji" :size="18" />
        </button>
        <span class="w-px h-5 bg-theme-border mx-0.5" aria-hidden="true" />
      </template>
      <button
        v-if="canReply"
        type="button"
        :class="toolbarBtn"
        title="Add reaction"
        aria-label="Add reaction"
        data-testid="add-reaction"
        @click="$emit('add-reaction', $event)">
        <PhSmileyWink class="w-4 h-4" />
      </button>
      <button
        v-if="canReply"
        type="button"
        :class="toolbarBtn"
        title="Reply"
        aria-label="Reply"
        data-testid="reply-message"
        @click="$emit('reply')">
        <PhArrowBendUpLeft class="w-4 h-4" />
      </button>
      <button
        v-if="isOwn"
        type="button"
        :class="toolbarBtn"
        title="Edit"
        aria-label="Edit"
        data-testid="edit-message"
        @click="$emit('edit')">
        <PhPencilSimple class="w-4 h-4" />
      </button>
      <button
        v-if="canManage"
        type="button"
        :class="toolbarBtn"
        :title="message.pinned ? 'Unpin' : 'Pin'"
        :aria-label="message.pinned ? 'Unpin' : 'Pin'"
        data-testid="pin-message"
        @click="$emit('pin', !message.pinned)">
        <PhPushPinSlash v-if="message.pinned" class="w-4 h-4" />
        <PhPushPin v-else class="w-4 h-4" />
      </button>
      <button
        type="button"
        :class="toolbarBtn"
        title="Copy text"
        aria-label="Copy text"
        @click="copyText">
        <PhCopy class="w-4 h-4" />
      </button>
      <button
        v-if="isOwn || canManage"
        type="button"
        :class="[toolbarBtn, '!text-red-400 hover:!text-red-300']"
        title="Delete (Shift+click skips confirmation)"
        aria-label="Delete"
        data-testid="delete-message"
        @click="$emit('delete', $event.shiftKey)">
        <PhTrash class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue"
import {
  PhArrowBendUpLeft,
  PhCopy,
  PhPencilSimple,
  PhPushPin,
  PhPushPinSlash,
  PhSmileyWink,
  PhTrash,
} from "@phosphor-icons/vue"
import UserAvatar from "@/components/UserAvatar.vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import MessageContent from "./MessageContent.vue"
import ReactionBar from "./ReactionBar.vue"
import { useCustomEmojisStore, usePermissionsStore, useUsersStore } from "@/stores"
import {
  emojiShortcode,
  emojiTextToPlain,
  encodeShortcodes,
  recentReactions,
  resolveEmoji,
} from "@/services/emoji"
import { markupToPlain, parseMessage } from "@/utils/messageMarkup"
import { decodeMentions, encodeMentions, type MentionMap } from "@/utils/mentionText"
import { formatFullTime, formatMessageTime, formatShortTime } from "@/utils/messageGrouping"
import type { TextMessage } from "@/types/textChat"

const props = withDefaults(
  defineProps<{
    message: TextMessage
    compact?: boolean
    /** Parent of a reply; null when the parent was deleted. */
    replied?: TextMessage | null
    isOwn?: boolean
    canManage?: boolean
    canReply?: boolean
    highlighted?: boolean
    editing?: boolean
    pendingStatus?: "sending" | "failed" | null
    pendingError?: string
    myUserId?: string
  }>(),
  {
    compact: false,
    replied: null,
    isOwn: false,
    canManage: false,
    canReply: true,
    highlighted: false,
    editing: false,
    pendingStatus: null,
    pendingError: "",
    myUserId: "",
  },
)

const emit = defineEmits<{
  reply: []
  edit: []
  delete: [skipConfirm: boolean]
  "jump-to-reply": [messageId: string]
  "save-edit": [content: string]
  "cancel-edit": []
  retry: []
  discard: []
  react: [emoji: string]
  "add-reaction": [event: MouseEvent]
  pin: [pinned: boolean]
}>()

const toolbarBtn =
  "w-8 h-8 flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover first:rounded-l-md last:rounded-r-md transition-colors"

const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()
const customEmojisStore = useCustomEmojisStore()

function nameOf(userId: string): string {
  return usersStore.allUsers.find((u) => u.id === userId)?.nickname ?? "Unknown user"
}

// Highlighted when it mentions you directly or through one of your roles.
const mentionsMe = computed(() => {
  const me = props.myUserId
  if (!me || props.message.sender_id === me) return false
  if (props.message.mention_user_ids.includes(me)) return true
  const mine = permissionsStore.roleIdsOf(me)
  return props.message.mention_role_ids.some((id) => mine.includes(id))
})

function emojiLabel(ref: string): string {
  const emoji = resolveEmoji(ref)
  return emoji ? `:${emojiShortcode(emoji.name)}:` : ref
}

function roleName(id: string): string | undefined {
  return permissionsStore.roles.find((r) => r.id === id)?.name
}

const replyPreview = computed(() =>
  props.replied
    ? markupToPlain(parseMessage(props.replied.content), (kind, id) =>
        kind === "user" ? nameOf(id) : (roleName(id) ?? "unknown-role"),
      ).slice(0, 200)
    : "",
)

// --- Inline edit -------------------------------------------------------
// The textarea shows custom emojis as :shortcode: and saves tokens.
const draft = ref("")
const editError = ref("")
let editMentions: MentionMap = new Map()
const editInput = useTemplateRef<HTMLTextAreaElement>("editInput")

function autosize() {
  const el = editInput.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 300)}px`
}

watch(
  () => props.editing,
  async (editing) => {
    if (!editing) return
    const decoded = decodeMentions(
      props.message.content,
      (id) => usersStore.allUsers.find((u) => u.id === id)?.nickname,
      roleName,
    )
    editMentions = decoded.map
    draft.value = emojiTextToPlain(decoded.text)
    editError.value = ""
    await nextTick()
    autosize()
    const el = editInput.value
    el?.focus()
    el?.setSelectionRange(draft.value.length, draft.value.length)
  },
  { immediate: true },
)

function saveEdit() {
  const content = encodeMentions(
    encodeShortcodes(draft.value.trim(), (code) => customEmojisStore.idForShortcode(code)),
    editMentions,
  )
  if (!content) {
    editError.value = "A message can't be empty. Delete it instead."
    return
  }
  if (Array.from(content).length > 2000) {
    editError.value = "Messages are limited to 2000 characters."
    return
  }
  if (content === props.message.content) {
    emit("cancel-edit")
    return
  }
  emit("save-edit", content)
}

function copyText() {
  void navigator.clipboard?.writeText(emojiTextToPlain(props.message.content))
}
</script>

<style scoped>
.message-flash {
  animation: message-flash 2s ease-out;
}

@keyframes message-flash {
  0%,
  40% {
    background-color: color-mix(in srgb, var(--color-theme-accent) 22%, transparent);
  }
  100% {
    background-color: transparent;
  }
}

.mention-me {
  background-color: color-mix(in srgb, #f0b232 9%, transparent);
  box-shadow: inset 2px 0 0 #f0b232;
}

@media (prefers-reduced-motion: reduce) {
  .message-flash {
    animation: none;
    background-color: color-mix(in srgb, var(--color-theme-accent) 15%, transparent);
  }
}
</style>
