<template>
  <!-- Mobile long-press menu for a message: quick reactions + the hover toolbar's actions. -->
  <Teleport to="body">
    <Transition name="sheet" appear>
      <div
        v-if="message"
        class="fixed inset-0 z-50 flex flex-col justify-end"
        @keydown.escape.prevent.stop="close">
        <div class="absolute inset-0 bg-black/50" @click="close" />
        <div
          ref="panel"
          class="sheet-panel relative rounded-t-2xl border-t border-theme-border bg-theme-bg-secondary shadow-2xl"
          role="menu"
          aria-label="Message actions"
          tabindex="-1"
          data-testid="message-action-sheet">
          <div class="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-theme-border" aria-hidden="true" />

          <div v-if="canReply" class="flex items-center justify-between gap-1 px-3 py-2">
            <button
              v-for="emoji in recentReactions"
              :key="emoji"
              type="button"
              :class="reactionBtn"
              :aria-label="`React with ${emojiLabel(emoji)}`"
              data-testid="sheet-quick-reaction"
              @click="act('react', emoji)">
              <EmojiGlyph :emoji-ref="emoji" :size="26" />
            </button>
            <button
              type="button"
              :class="[reactionBtn, 'text-theme-text-secondary']"
              aria-label="Add reaction"
              data-testid="sheet-add-reaction"
              @click="act('add-reaction')">
              <SmileyPlusIcon :size="24" />
            </button>
          </div>

          <div class="px-2 pb-2 border-t border-theme-border pt-1">
            <button
              v-if="canReply"
              type="button"
              role="menuitem"
              :class="row"
              @click="act('reply')">
              <PhArrowBendUpLeft class="w-5 h-5" /> Reply
            </button>
            <button
              v-if="isOwn && !message.command"
              type="button"
              role="menuitem"
              :class="row"
              @click="act('edit')">
              <PhPencilSimple class="w-5 h-5" /> Edit
            </button>
            <button
              v-if="canManage"
              type="button"
              role="menuitem"
              :class="row"
              @click="act('pin', !message.pinned)">
              <template v-if="message.pinned"><PhPushPinSlash class="w-5 h-5" /> Unpin</template>
              <template v-else><PhPushPin class="w-5 h-5" /> Pin</template>
            </button>
            <button
              v-if="message.content"
              type="button"
              role="menuitem"
              :class="row"
              @click="act('copy')">
              <PhCopy class="w-5 h-5" /> Copy text
            </button>
            <button
              v-if="isOwn || canManage || isMyReminder"
              type="button"
              role="menuitem"
              :class="[row, '!text-red-400']"
              data-testid="sheet-delete"
              @click="act('delete')">
              <PhTrash class="w-5 h-5" /> Delete
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from "vue"
import {
  PhArrowBendUpLeft,
  PhCopy,
  PhPencilSimple,
  PhPushPin,
  PhPushPinSlash,
  PhTrash,
} from "@phosphor-icons/vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import SmileyPlusIcon from "./SmileyPlusIcon.vue"
import { emojiShortcode, recentReactions, resolveEmoji } from "@/services/emoji"
import type { TextMessage } from "@/types/textChat"
import { useUserStore } from "@/stores"

const props = defineProps<{
  message: TextMessage | null
  isOwn: boolean
  canManage: boolean
  canReply: boolean
}>()

const emit = defineEmits<{
  react: [emoji: string]
  "add-reaction": []
  reply: []
  edit: []
  pin: [pinned: boolean]
  copy: []
  delete: []
  close: []
}>()

const userStore = useUserStore()
// A fired reminder may be dismissed by the user it reminds.
const isMyReminder = computed(
  () =>
    props.message?.command?.name === "reminder" &&
    props.message.command.reminder_for === userStore.userId,
)

const reactionBtn =
  "w-11 h-11 flex items-center justify-center rounded-full bg-theme-bg-tertiary active:bg-theme-bg-hover transition-colors"
const row =
  "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-[15px] text-theme-text-primary active:bg-theme-bg-hover transition-colors"

const panel = useTemplateRef<HTMLDivElement>("panel")

watch(
  () => props.message,
  async (m) => {
    if (!m) return
    await nextTick()
    panel.value?.focus()
  },
)

function emojiLabel(ref: string): string {
  const emoji = resolveEmoji(ref)
  return emoji ? `:${emojiShortcode(emoji.name)}:` : ref
}

function close() {
  emit("close")
}

type Action = "react" | "add-reaction" | "reply" | "edit" | "pin" | "copy" | "delete"

// The action goes out before close: the parent still knows the message.
function act(action: Action, arg?: string | boolean) {
  switch (action) {
    case "react":
      emit("react", arg as string)
      break
    case "pin":
      emit("pin", arg as boolean)
      break
    case "add-reaction":
      emit("add-reaction")
      break
    case "reply":
      emit("reply")
      break
    case "edit":
      emit("edit")
      break
    case "copy":
      emit("copy")
      break
    case "delete":
      emit("delete")
      break
  }
  close()
}
</script>

<style scoped>
.sheet-panel {
  padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
}
.sheet-panel:focus-visible {
  outline: none;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 0.18s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-panel,
.sheet-leave-to .sheet-panel {
  transform: translateY(100%);
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active .sheet-panel,
  .sheet-leave-active .sheet-panel {
    transition: none;
  }
}
</style>
