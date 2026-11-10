<template>
  <div class="relative flex-1 min-h-0">
    <div
      ref="scroller"
      class="h-full overflow-y-auto overflow-x-hidden pb-4 [overflow-anchor:none]"
      data-testid="text-message-list"
      @scroll.passive="onScroll">
      <!-- Channel start -->
      <div
        v-if="!view.hasMoreBefore && !view.loading"
        class="px-4 pt-8 pb-4"
        data-testid="channel-start">
        <div
          class="w-16 h-16 rounded-full bg-theme-bg-tertiary flex items-center justify-center mb-3">
          <PhHash class="w-9 h-9 text-theme-text-secondary" />
        </div>
        <h2 class="text-2xl font-bold text-theme-text-primary">
          Welcome to #<EmojiText :text="channelName" />
        </h2>
        <p class="text-sm text-theme-text-muted mt-1">This is the start of the channel.</p>
      </div>
      <div v-else-if="view.loadingOlder" class="py-3 flex justify-center">
        <PhSpinner class="w-5 h-5 animate-spin text-theme-text-muted" />
      </div>
      <div v-else class="h-6" />

      <template v-for="item in timeline" :key="item.key">
        <div
          v-if="item.kind === 'day'"
          class="flex items-center gap-2 px-4 my-3 text-[11px] font-semibold text-theme-text-muted select-none"
          role="separator">
          <div class="flex-1 h-px bg-theme-border" />
          <span>{{ formatDay(item.ts) }}</span>
          <div class="flex-1 h-px bg-theme-border" />
        </div>
        <div
          v-else-if="item.kind === 'new'"
          ref="divider"
          class="flex items-center gap-2 px-4 my-2 text-[11px] font-bold text-red-400 select-none"
          role="separator"
          data-testid="new-messages-divider">
          <div class="flex-1 h-px bg-red-500/70" />
          <span>New messages</span>
        </div>
        <div
          v-else-if="item.kind === 'line'"
          class="flex items-center gap-2 px-4 py-1 ml-[52px] text-xs text-theme-text-muted"
          data-testid="pin-system-line">
          <PhPushPin class="w-3.5 h-3.5 flex-shrink-0" weight="fill" />
          <span>
            <span class="font-semibold" :style="permissionsStore.nameStyleOf(item.line.user_id)">{{
              nameOf(item.line.user_id)
            }}</span>
            pinned
            <button
              type="button"
              class="font-semibold text-theme-text-secondary hover:underline"
              @click="textChatStore.jumpToMessage(roomId, item.line.message_id)">
              a message</button
            >.
          </span>
        </div>
        <MessageItem
          v-else
          :message="item.message"
          :compact="item.compact"
          :replied="item.message.reply_to_id ? (repliedOf(item.message.reply_to_id) ?? null) : null"
          :is-own="item.message.sender_id === myUserId"
          :can-manage="canManage"
          :can-reply="canSend"
          :highlighted="view.highlightId === item.message.id"
          :editing="textChatStore.editingId === item.message.id"
          :pending-status="pendingById.get(item.message.id)?.status ?? null"
          :pending-error="pendingById.get(item.message.id)?.error"
          :my-user-id="myUserId"
          @react="(emoji) => textChatStore.toggleReaction(item.message.id, emoji)"
          @add-reaction="(e) => openReactionPicker(item.message.id, e)"
          @pin="(pinned) => textChatStore.setPinned(item.message.id, pinned)"
          @reply="textChatStore.startReply(item.message)"
          @edit="textChatStore.startEdit(item.message.id)"
          @delete="(skip) => requestDelete(item.message, skip)"
          @jump-to-reply="(id) => textChatStore.jumpToMessage(roomId, id)"
          @save-edit="(content) => textChatStore.editMessage(item.message.id, content)"
          @cancel-edit="textChatStore.cancelEdit()"
          @retry="textChatStore.retrySend(item.message.id)"
          @discard="textChatStore.discardPending(item.message.id)" />
      </template>

      <div v-if="view.loadingNewer" class="py-3 flex justify-center">
        <PhSpinner class="w-5 h-5 animate-spin text-theme-text-muted" />
      </div>
    </div>

    <div
      v-if="view.loading && !view.messages.length"
      class="absolute inset-0 flex items-center justify-center">
      <PhSpinner class="w-6 h-6 animate-spin text-theme-text-muted" />
    </div>
    <div
      v-else-if="view.error"
      class="absolute inset-x-0 top-4 mx-auto w-fit px-4 py-2 rounded-lg bg-red-900/60 border border-red-800 text-sm text-red-200">
      {{ view.error }}
      <button type="button" class="ml-2 underline" @click="textChatStore.openChannel(roomId)">
        Retry
      </button>
    </div>

    <button
      v-if="showJumpToPresent"
      type="button"
      class="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-theme-accent text-theme-text-on-accent text-xs font-semibold shadow-lg hover:bg-theme-accent-hover flex items-center gap-1"
      data-testid="jump-to-present"
      @click="jumpToPresent">
      Jump to present
      <PhArrowDown class="w-3.5 h-3.5" />
    </button>

    <Teleport v-if="reactionPicker" to="body">
      <div class="fixed inset-0 z-40" @pointerdown="closeReactionPicker" />
      <div
        class="fixed z-50 w-[320px]"
        :style="{ top: `${reactionPicker.top}px`, left: `${reactionPicker.left}px` }">
        <EmojiPicker @select="pickReaction" @close="closeReactionPicker" />
      </div>
    </Teleport>

    <DeleteMessageModal
      v-if="deleting"
      :message="deleting"
      @close="deleting = null"
      @confirm="confirmDelete" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue"
import { PhArrowDown, PhHash, PhPushPin, PhSpinner } from "@phosphor-icons/vue"
import EmojiText from "@/components/common/EmojiText.vue"
import EmojiPicker from "@/components/EmojiPicker.vue"
import { usePermissionsStore, useUsersStore } from "@/stores"
import MessageItem from "./MessageItem.vue"
import DeleteMessageModal from "./DeleteMessageModal.vue"
import { useTextChatStore, type ChannelView, type PendingTextMessage } from "@/stores/textChat"
import { buildTimeline, formatDay } from "@/utils/messageGrouping"
import type { TextMessage } from "@/types/textChat"

const props = defineProps<{
  roomId: string
  channelName: string
  view: ChannelView
  pending: PendingTextMessage[]
  myUserId: string
  canManage: boolean
  canSend: boolean
}>()

const textChatStore = useTextChatStore()
const permissionsStore = usePermissionsStore()
const usersStore = useUsersStore()

function nameOf(userId: string): string {
  return usersStore.allUsers.find((u) => u.id === userId)?.nickname ?? "Unknown user"
}
const scroller = useTemplateRef<HTMLDivElement>("scroller")
const divider = useTemplateRef<HTMLDivElement[]>("divider")

const LOAD_THRESHOLD_PX = 400
const BOTTOM_THRESHOLD_PX = 40

// Optimistic messages render after the real ones, styled as pending.
const pendingAsMessages = computed<TextMessage[]>(() =>
  props.view.hasMoreAfter
    ? []
    : props.pending.map((p) => ({
        id: p.nonce,
        seq: Number.MAX_SAFE_INTEGER,
        room_id: p.room_id,
        sender_id: props.myUserId,
        content: p.content,
        created_at_ts: p.created_at_ts,
        edited_at_ts: null,
        reply_to_id: p.reply_to_id,
        mention_user_ids: [],
        mention_role_ids: [],
        reactions: [],
        pinned: false,
        pinned_at_ts: null,
        pinned_by: null,
        attachments: [],
      })),
)
const pendingById = computed(() => new Map(props.pending.map((p) => [p.nonce, p])))

// Pin lines only make sense next to the newest messages.
const systemLines = computed(() =>
  props.view.hasMoreAfter ? [] : (textChatStore.systemLines[props.roomId] ?? []),
)

const timeline = computed(() =>
  buildTimeline(
    [...props.view.messages, ...pendingAsMessages.value],
    props.view.dividerSeq,
    systemLines.value,
  ),
)

function repliedOf(id: string): TextMessage | undefined {
  return (
    props.view.replied[id] ?? props.view.messages.find((m) => m.id === id) // parent may be on screen
  )
}

// --- Scroll state --------------------------------------------------------

const distanceFromBottom = ref(0)
const showJumpToPresent = computed(
  () =>
    props.view.hasMoreAfter ||
    distanceFromBottom.value > (scroller.value?.clientHeight ?? 600) * 1.5,
)

function measure() {
  const el = scroller.value
  if (!el) return
  distanceFromBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight
  textChatStore.setAtBottom(
    props.roomId,
    distanceFromBottom.value < BOTTOM_THRESHOLD_PX && !props.view.hasMoreAfter,
  )
}

/** Keeps the first visible message in place while content changes above it. */
async function withAnchor(update: () => Promise<void> | void) {
  const el = scroller.value
  if (!el) return update()
  const box = el.getBoundingClientRect()
  let anchor: HTMLElement | null = null
  for (const node of el.querySelectorAll<HTMLElement>("[data-message-id]")) {
    if (node.getBoundingClientRect().bottom > box.top) {
      anchor = node
      break
    }
  }
  const id = anchor?.dataset.messageId
  const before = anchor?.getBoundingClientRect().top ?? 0
  await update()
  await nextTick()
  if (!id) return
  const same = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
  if (same) el.scrollTop += same.getBoundingClientRect().top - before
}

let scrollFrame = 0
function onScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    measure()
    maybeLoad()
    updateReadPosition()
  })
}

function maybeLoad() {
  const el = scroller.value
  if (!el || props.view.loading) return
  if (el.scrollTop < LOAD_THRESHOLD_PX && props.view.hasMoreBefore && !props.view.loadingOlder) {
    void withAnchor(() => textChatStore.loadOlder(props.roomId))
  } else if (
    distanceFromBottom.value < LOAD_THRESHOLD_PX &&
    props.view.hasMoreAfter &&
    !props.view.loadingNewer
  ) {
    void withAnchor(() => textChatStore.loadNewer(props.roomId))
  }
}

/** Reports the newest message the user has actually seen (window focused). */
function updateReadPosition() {
  const el = scroller.value
  if (!el || !document.hasFocus() || !props.view.messages.length) return
  const bottom = el.getBoundingClientRect().bottom
  const nodes = el.querySelectorAll<HTMLElement>("[data-message-id]")
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].getBoundingClientRect().top < bottom) {
      const id = nodes[i].dataset.messageId
      const msg = props.view.messages.find((m) => m.id === id)
      if (msg) textChatStore.markRead(props.roomId, msg.seq)
      return
    }
  }
}

function scrollToBottom() {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

// Scroll requests from the store (open, jump, send).
watch(
  () => props.view.scrollRequest,
  async (req) => {
    if (!req) return
    await nextTick()
    const el = scroller.value
    if (!el) return
    if (req.kind === "bottom") {
      scrollToBottom()
    } else if (req.kind === "divider") {
      const d = divider.value?.[0]
      if (d) el.scrollTop = Math.max(0, d.offsetTop - el.clientHeight * 0.25)
      else scrollToBottom()
    } else {
      const node = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(req.id)}"]`)
      node?.scrollIntoView({ block: "center" })
      if (req.highlight) {
        const id = req.id
        setTimeout(() => textChatStore.clearHighlight(props.roomId, id), 2000)
      }
    }
    textChatStore.consumeScrollRequest(props.roomId)
    measure()
    updateReadPosition()
  },
  { immediate: true },
)

// Live messages: stick to the bottom when the user was there.
watch(
  () => [
    props.view.messages.length,
    props.pending.length,
    props.view.messages[props.view.messages.length - 1]?.id,
    systemLines.value.length,
  ],
  async () => {
    const stick = props.view.atBottom
    await nextTick()
    if (stick) scrollToBottom()
    measure()
    updateReadPosition()
  },
)

function onFocus() {
  updateReadPosition()
}

onMounted(() => {
  window.addEventListener("focus", onFocus)
  measure()
})
onBeforeUnmount(() => {
  window.removeEventListener("focus", onFocus)
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
})

function jumpToPresent() {
  void textChatStore.jumpToPresent(props.roomId)
}

// --- Reactions -------------------------------------------------------------

const PICKER_W = 320
const PICKER_H = 380
const reactionPicker = ref<{ messageId: string; top: number; left: number } | null>(null)

function openReactionPicker(messageId: string, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  const x = rect ? rect.right - PICKER_W : event.clientX - PICKER_W
  const y = rect ? rect.bottom + 4 : event.clientY
  reactionPicker.value = {
    messageId,
    left: Math.max(8, Math.min(x, window.innerWidth - PICKER_W - 8)),
    top: y + PICKER_H > window.innerHeight - 8 ? Math.max(8, (rect?.top ?? y) - PICKER_H - 4) : y,
  }
}

function closeReactionPicker() {
  reactionPicker.value = null
}

function pickReaction(emoji: string) {
  if (reactionPicker.value) textChatStore.toggleReaction(reactionPicker.value.messageId, emoji)
  closeReactionPicker()
}

// --- Delete ----------------------------------------------------------------

const deleting = ref<TextMessage | null>(null)

function requestDelete(message: TextMessage, skipConfirm: boolean) {
  if (skipConfirm) textChatStore.deleteMessage(message.id)
  else deleting.value = message
}

function confirmDelete() {
  if (deleting.value) textChatStore.deleteMessage(deleting.value.id)
  deleting.value = null
}

defineExpose({ scrollToBottom })
</script>
