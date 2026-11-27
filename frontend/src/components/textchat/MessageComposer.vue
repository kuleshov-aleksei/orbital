<template>
  <div
    ref="composerRoot"
    class="px-4 pt-1 flex-shrink-0"
    :class="composerPanel ? 'pb-0' : 'pb-4'"
    @dragover="onDragOver"
    @dragleave="dragging = false"
    @drop="onDrop">
    <!-- Auto-removal after an upload (docs/specs/CHAT_SYSTEM.md §7.12.3) -->
    <div
      v-if="attachmentsStore.evictionNotice"
      class="flex items-center gap-2 mb-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200"
      role="status"
      data-testid="eviction-notice">
      <PhInfo class="w-4 h-4 flex-shrink-0" />
      <span class="flex-1" :title="attachmentsStore.evictionNotice.files.join(', ')">
        Removed {{ attachmentsStore.evictionNotice.count }} oldest
        {{ attachmentsStore.evictionNotice.count === 1 ? "file" : "files" }}
        ({{ formatBytes(attachmentsStore.evictionNotice.bytes) }}) to make room.
        <button type="button" class="underline font-medium" @click="openStoragePage()">
          Manage storage
        </button>
      </span>
      <button
        type="button"
        class="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10"
        aria-label="Dismiss"
        @click="attachmentsStore.dismissEviction()">
        <PhX class="w-3.5 h-3.5" />
      </button>
    </div>
    <div
      v-if="attachmentsStore.composerError"
      class="flex items-center gap-2 mb-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300"
      role="alert">
      <span class="flex-1">{{ attachmentsStore.composerError }}</span>
      <button
        type="button"
        class="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10"
        aria-label="Dismiss"
        @click="attachmentsStore.composerError = null">
        <PhX class="w-3.5 h-3.5" />
      </button>
    </div>

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
      class="bg-theme-bg-tertiary border transition-colors focus-within:border-theme-accent"
      :class="[
        replyTarget ? 'rounded-b-lg' : 'rounded-lg',
        dragging ? 'border-theme-accent border-dashed' : 'border-theme-border',
      ]">
      <ComposerUploads v-if="roomUploads.length" :uploads="roomUploads" />
      <!-- A GIF picked from the provider, sent with the next message -->
      <div v-if="pendingGif" class="flex items-center gap-2 px-3 pt-2" data-testid="composer-gif">
        <div
          class="relative w-24 rounded-md border border-theme-border bg-theme-bg-secondary overflow-hidden">
          <img :src="pendingGif.preview_url" alt="" class="block w-full h-16 object-cover" />
          <button
            type="button"
            class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
            aria-label="Remove GIF"
            data-testid="composer-gif-remove"
            @click="pendingGif = null">
            <PhX class="w-3 h-3" />
          </button>
        </div>
        <span class="text-[11px] text-theme-text-muted"> GIF · send with your message </span>
      </div>
      <div ref="box" class="relative flex items-end gap-2 px-3 py-2">
        <ComposerPlusMenu
          v-if="canAttach || canSend"
          :can-attach="canAttach"
          :can-poll="canSend"
          :online="serverOnline"
          @attach="fileInput?.click()"
          @poll="pollModalOpen = true" />
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          :accept="ACCEPT"
          data-testid="attach-input"
          @change="onPick" />
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
          :enterkeyhint="appStore.isMobile ? 'enter' : 'send'"
          class="composer-input flex-1 min-w-0 resize-none bg-transparent text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none py-1 max-h-[50vh] disabled:cursor-not-allowed"
          data-testid="text-composer"
          aria-label="Message"
          @input="onInput"
          @click="updateSuggestions"
          @keydown="onKeydown"
          @mouseup="updateFormatBar"
          @keyup="updateFormatBar"
          @paste="onPaste"
          @focus="onInputFocus"
          @blur="onBlur" />
        <span
          v-if="quotaWarning"
          class="self-center flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 cursor-pointer"
          :title="`Storage ${Math.round(attachmentsStore.usageRatio * 100)}% full: your oldest unprotected files are removed automatically.`"
          data-testid="quota-warning"
          @click="openStoragePage()"
          >{{ Math.round(attachmentsStore.usageRatio * 100) }}% storage</span
        >
        <span
          v-if="charCount > MAX_CHARS - 200"
          class="text-[11px] self-center"
          :class="charCount > MAX_CHARS ? 'text-red-400' : 'text-theme-text-muted'"
          >{{ MAX_CHARS - charCount }}</span
        >
        <button
          v-if="gifSearchEnabled"
          type="button"
          class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
          :class="{ 'text-theme-text-primary bg-theme-bg-hover': gifPickerVisible }"
          title="GIF"
          aria-label="Insert GIF"
          :aria-expanded="gifPickerVisible"
          :disabled="!canSend"
          data-testid="gif-button"
          @mousedown.prevent
          @click="toggleGifPicker">
          <PhGif class="w-5 h-5" />
        </button>
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
          :class="{ 'text-theme-text-primary bg-theme-bg-hover': emojiPickerVisible }"
          title="Emoji"
          aria-label="Insert emoji"
          :aria-expanded="emojiPickerVisible"
          :disabled="!canSend"
          data-testid="emoji-button"
          @mousedown.prevent
          @click="toggleEmojiPicker">
          <PhSmiley class="w-5 h-5" />
        </button>
        <button
          v-if="showSend"
          type="button"
          class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded text-theme-accent hover:bg-theme-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          :title="appStore.isMobile ? 'Send' : 'Send (Enter)'"
          aria-label="Send message"
          :disabled="charCount > MAX_CHARS"
          data-testid="send-button"
          @mousedown.prevent
          @click="send">
          <PhPaperPlaneRight class="w-5 h-5" weight="fill" />
        </button>
        <ComposerSuggestions
          v-if="suggestions.length"
          :items="suggestions"
          :active="activeSuggestion"
          :title="suggestionTitle"
          @hover="(i) => (activeSuggestion = i)"
          @pick="applySuggestion" />
        <div
          v-if="isPickerOpen"
          class="absolute bottom-full right-0 mb-2 z-20 w-[352px] max-w-[calc(100vw-2rem)]">
          <EmojiPicker @select="insertEmoji" @close="closePicker" />
        </div>
        <div
          v-if="isGifPickerOpen && gifProvider"
          class="absolute bottom-full right-0 mb-2 z-20 w-[320px] max-w-[calc(100vw-2rem)]"
          data-testid="gif-picker-popover">
          <GifPicker :provider="gifProvider" @select="pickGif" @close="closeGifPicker" />
        </div>
        <!-- Formatting for the selected text -->
        <div
          v-if="formatBarLeft !== null"
          class="absolute bottom-full mb-2 z-20 flex items-center gap-0.5 p-1 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-lg"
          :style="{ left: `${formatBarLeft}px` }"
          role="toolbar"
          aria-label="Format selection"
          data-testid="format-toolbar">
          <button
            v-for="f in FORMATS"
            :key="f.marker"
            type="button"
            class="w-7 h-7 flex items-center justify-center rounded text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
            :title="f.title"
            :aria-label="f.label"
            :data-testid="`format-${f.label.toLowerCase()}`"
            @mousedown.prevent
            @click="applyFormat(f.marker)">
            <component :is="f.icon" class="w-4 h-4" weight="bold" />
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile layout (Android app, narrow window): the emoji/GIF pickers dock
         under the composer instead of floating over the chat. Collapsing to 0
         height gives the chat its space back; the panel keeps the height it had
         when opened while the soft keyboard is up, so the keyboard covers the
         chat instead of squeezing the panel. The handle drags it taller, over
         the chat, or smaller (drag far enough down to close it). -->
    <div
      v-if="appStore.isMobile"
      ref="dockSlot"
      class="composer-dock -mx-4"
      :class="{
        'composer-dock--open': composerPanel,
        'composer-dock--dragging': isDraggingDock,
      }"
      :style="{ '--composer-dock-h': `${isDraggingDock ? dragHeight : dockHeight}px` }"
      :inert="composerPanel ? undefined : true"
      :aria-hidden="!composerPanel"
      data-testid="composer-dock">
      <div
        v-if="dockMounted"
        class="composer-dock-inner flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-theme-border bg-theme-bg-primary">
        <div
          class="dock-handle"
          title="Drag to resize"
          data-testid="composer-dock-handle"
          @pointerdown="onDockHandleDown"
          @pointermove="onDockHandleMove"
          @pointerup="onDockHandleUp"
          @pointercancel="onDockHandleUp">
          <span class="dock-grabber" aria-hidden="true" />
        </div>
        <ComposerPickerDock
          :tab="composerPanel ?? 'emoji'"
          :gif-provider="gifProvider"
          @update:tab="textChatStore.openComposerPanel($event)"
          @select-emoji="insertEmoji"
          @select-gif="pickGif"
          @close="closeComposerPanel" />
      </div>
    </div>
    <CreatePollModal v-if="pollModalOpen" @close="pollModalOpen = false" @create="createPoll" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue"
import {
  PhEyeSlash,
  PhGif,
  PhInfo,
  PhPaperPlaneRight,
  PhSmiley,
  PhTextB,
  PhTextItalic,
  PhTextStrikethrough,
  PhX,
} from "@phosphor-icons/vue"
import EmojiPicker from "@/components/EmojiPicker.vue"
import GifPicker from "./GifPicker.vue"
import ComposerPickerDock from "./ComposerPickerDock.vue"
import ComposerSuggestions, { type Suggestion } from "./ComposerSuggestions.vue"
import ComposerUploads from "./ComposerUploads.vue"
import ComposerPlusMenu from "./ComposerPlusMenu.vue"
import CreatePollModal from "./polls/CreatePollModal.vue"
import { useGifSearch } from "@/composables/useGifSearch"
import { pushBackHandler } from "@/services/backButton"
import type { TextGIF, TextPollInput } from "@/types/textChat"
import { openStoragePage } from "@/services/attachments/urls"
import { formatBytes } from "@/utils/formatBytes"
import { Permission } from "@/types/permissions"
import {
  activeEmojiQuery,
  activeMentionQuery,
  encodeMentions,
  roleMentionToken,
  userMentionToken,
  type MentionMap,
} from "@/utils/mentionText"
import { wrapSelection } from "@/utils/wrapSelection"
import { activeCommandQuery, matchCommands } from "@/utils/chatCommands"
import {
  isCapacitor,
  onKeyboardImage,
  releaseKeyboardImage,
  setKeyboardContentEnabled,
  type KeyboardImageEvent,
} from "@/services/platform"
import { readKeyboardImage } from "@/services/attachments/keyboardContent"
import {
  CUSTOM_EMOJI_PREFIX,
  emojiShortcode,
  emojiTextLength,
  emojiTextToPlain,
  encodeShortcodes,
  extractShortcodes,
  resolveEmoji,
  searchEmojis,
  type Emoji,
  type EmojiRef,
} from "@/services/emoji"
import {
  useAppStore,
  useAttachmentsStore,
  useCustomEmojisStore,
  usePermissionsStore,
  useTextChatStore,
  useUsersStore,
  useConnectionStore,
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
const appStore = useAppStore()
const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()
const attachmentsStore = useAttachmentsStore()
const connectionStore = useConnectionStore()

const input = useTemplateRef<HTMLTextAreaElement>("input")
const box = useTemplateRef<HTMLDivElement>("box")
const isPickerOpen = ref(false)
// Third-party GIF search (docs/specs/CHAT_SYSTEM.md §7.17): settings load
// once per app session; the button stays hidden while unknown/disabled.
const {
  provider: gifProvider,
  enabled: gifSearchEnabled,
  ensureLoaded: ensureGifSearch,
} = useGifSearch()
const isGifPickerOpen = ref(false)
const pendingGif = computed({
  get: () => textChatStore.pendingGif,
  set: (gif: TextGIF | null) => (textChatStore.pendingGif = gif),
})
void ensureGifSearch()

// --- Mobile emoji/GIF dock ------------------------------------------------
// On the mobile layout the pickers are a panel under the composer instead of a
// popover over the chat (see the template and ComposerPickerDock).
const composerPanel = computed(() => textChatStore.composerPanel)
const emojiPickerVisible = computed(() =>
  appStore.isMobile ? composerPanel.value === "emoji" : isPickerOpen.value,
)
const gifPickerVisible = computed(() =>
  appStore.isMobile ? composerPanel.value === "gif" : isGifPickerOpen.value,
)
/** Created on the first open, then kept mounted (clipped to 0 height) so each
 * tab keeps its search, scroll position and loaded pages. */
const dockMounted = ref(false)
/** Panel height in px: 44 % of the viewport when it opens. It is deliberately
 * not re-measured while the soft keyboard shrinks the viewport: the panel keeps
 * its size and moves up with the composer, covering the chat, instead of being
 * squeezed. */
const DOCK_HEIGHT_RATIO = 0.44
const DOCK_HEIGHT_MAX_PX = 416
/** Below this the panel can't show anything useful: releasing there closes it. */
const DOCK_MIN_HEIGHT_PX = 150
/** Channel header height (h-16): the composer never slides above it. */
const CHANNEL_HEADER_PX = 64
const dockHeight = ref(0)
/** True once the user resized the panel by hand (keep that height on re-measure). */
let dockResized = false
let dockBaseline = { width: 0, height: 0 }
let stopDockBackHandler: (() => void) | null = null
/** Caret in the text composer while the dock holds focus (the textarea is
 * blurred so the keyboard doesn't cover the panel). */
const savedCaret = ref<{ start: number; end: number } | null>(null)

// Drag handle: pull the panel taller over the chat, or smaller.
const dockSlot = useTemplateRef<HTMLDivElement>("dockSlot")
const composerRoot = useTemplateRef<HTMLDivElement>("composerRoot")
const isDraggingDock = ref(false)
const dragHeight = ref(0)
let dragPointerId: number | null = null
let dragStartY = 0
let dragStartHeight = 0
let dragMaxHeight = 0
let dragMoved = false

function measureDockHeight() {
  dockResized = false
  dockHeight.value = Math.round(
    Math.min(window.innerHeight * DOCK_HEIGHT_RATIO, DOCK_HEIGHT_MAX_PX),
  )
}

/** The height the panel is actually rendered at (the CSS caps it on tiny screens). */
function renderedDockHeight(): number {
  return dockSlot.value?.getBoundingClientRect().height ?? dockHeight.value
}

/** Tallest the panel may get while keeping the composer on screen: the composer
 * block's bottom stays put, so growing the panel moves its top up until it
 * reaches the channel header. */
function maxDockHeight(): number {
  const rendered = renderedDockHeight()
  const root = composerRoot.value?.getBoundingClientRect()
  if (!root) return Math.round(window.innerHeight * 0.8)
  return Math.max(DOCK_MIN_HEIGHT_PX, rendered, Math.round(rendered + root.top - CHANNEL_HEADER_PX))
}

function onDockHandleDown(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return
  // No text selection / focus changes while dragging the panel.
  event.preventDefault()
  dragPointerId = event.pointerId
  dragStartY = event.clientY
  dragStartHeight = renderedDockHeight()
  dragMaxHeight = Math.max(dragStartHeight, maxDockHeight())
  dragHeight.value = dragStartHeight
  dragMoved = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onDockHandleMove(event: PointerEvent) {
  if (dragPointerId !== event.pointerId) return
  const dy = event.clientY - dragStartY
  if (!dragMoved) {
    // A tap on the handle must not resize the panel by a pixel.
    if (Math.abs(dy) < 4) return
    dragMoved = true
    isDraggingDock.value = true
  }
  dragHeight.value = Math.min(dragMaxHeight, Math.max(0, dragStartHeight - dy))
}

function onDockHandleUp(event: PointerEvent) {
  if (dragPointerId !== event.pointerId) return
  dragPointerId = null
  if (!dragMoved) return
  dragMoved = false
  isDraggingDock.value = false
  const released = dragHeight.value
  // Pulled down most of the way (or to nothing): dismiss like a sheet.
  if (released < DOCK_MIN_HEIGHT_PX || released < dragStartHeight * 0.5) {
    textChatStore.closeComposerPanel()
    return
  }
  dockHeight.value = Math.round(released)
  dockResized = true
}

function onDockResize() {
  if (!composerPanel.value) return
  const { innerWidth: width, innerHeight: height } = window
  // The keyboard is the only thing that shrinks the viewport without changing
  // the width; keep the panel as it was then. A growing viewport (keyboard
  // closed again) or a rotation/window resize re-measures.
  if (width === dockBaseline.width && height <= dockBaseline.height) return
  dockBaseline = { width, height }
  if (dockResized) {
    // Keep the size the user dragged to, just inside the new limits.
    dockHeight.value = Math.round(Math.min(dockHeight.value, maxDockHeight()))
  } else {
    measureDockHeight()
  }
}

function closeComposerPanel() {
  textChatStore.closeComposerPanel()
}

watch(composerPanel, (panel) => {
  if (!panel) {
    stopDockBackHandler?.()
    stopDockBackHandler = null
    isDraggingDock.value = false
    dragPointerId = null
    dragMoved = false
    // Focus follows the input into the collapsing panel; drop the keyboard too.
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest("[data-testid='composer-dock']")) {
      active.blur()
    }
    return
  }
  dockMounted.value = true
  const el = input.value
  // Remember where the caret was, then hide the keyboard so it can't cover the
  // panel (emoji insertion continues from the saved caret).
  savedCaret.value =
    el && document.activeElement === el ? { start: el.selectionStart, end: el.selectionEnd } : null
  el?.blur()
  dockBaseline = { width: window.innerWidth, height: window.innerHeight }
  measureDockHeight()
  // Android back closes the panel before it leaves the channel.
  stopDockBackHandler = pushBackHandler(() => textChatStore.closeComposerPanel())
})

// Drafts survive switching channels (kept for this app session).
const drafts = draftStore()
const draft = ref(drafts.get(props.roomId) ?? "")
watch(
  () => props.roomId,
  async (roomId, previous) => {
    if (previous) drafts.set(previous, draft.value)
    draft.value = drafts.get(roomId) ?? ""
    // A picked GIF belongs to the channel it was picked in.
    textChatStore.pendingGif = null
    isGifPickerOpen.value = false
    closeComposerPanel()
    closeSuggestions()
    await nextTick()
    autosize()
    // No autofocus on Android: it would pop up the on-screen keyboard.
    if (!isCapacitor()) focus()
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
// Custom emojis load on demand: resolve typed :shortcode:s in the background
// so the character count is right and send rarely has to wait.
watch(draft, (value) => void customEmojisStore.requestShortcodes(extractShortcodes(value)), {
  immediate: true,
})

function nameOf(userId: string): string {
  return usersStore.displayName(userId)
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

let sending = false
async function send() {
  if (sending) return
  const text = draft.value.trim()
  sending = true
  try {
    await customEmojisStore.resolveShortcodes(extractShortcodes(text))
  } finally {
    sending = false
  }
  const content = encode(text)
  if (charCount.value > MAX_CHARS || !props.canSend) return
  if (attachmentsStore.busy(props.roomId)) {
    attachmentsStore.composerError = "Wait for the uploads to finish."
    return
  }
  const hasFiles = roomUploads.value.some((u) => u.status === "done")
  const gif = pendingGif.value
  if (!content && !hasFiles && !gif) return
  const files = attachmentsStore.takeReady(props.roomId)
  attachmentsStore.composerError = null
  textChatStore.sendMessage(props.roomId, content, files, gif)
  pendingGif.value = null
  isGifPickerOpen.value = false
  closeComposerPanel()
  draft.value = ""
  mentionMap().clear()
  closeSuggestions()
  formatBarLeft.value = null
  void nextTick(autosize)
}

// --- Attachments ---------------------------------------------------------

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/wav,audio/ogg,video/mp4,.mp3,.wav,.ogg,.mp4"
const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
const dragging = ref(false)
const roomUploads = computed(() => attachmentsStore.forRoom(props.roomId))
// UX hint only; the backend checks AttachFiles on upload and send.
const canAttach = computed(
  () =>
    props.canSend &&
    attachmentsStore.enabled &&
    permissionsStore.can(Permission.AttachFiles, { roomId: props.roomId }),
)
/** Send button: shown once there is text, an attachment or a GIF to send. */
const showSend = computed(
  () =>
    props.canSend &&
    (draft.value.trim() !== "" || roomUploads.value.length > 0 || !!pendingGif.value),
)
const quotaWarning = computed(() => canAttach.value && attachmentsStore.usageRatio >= 0.9)
watch(canAttach, (can) => can && void attachmentsStore.loadUsage(), { immediate: true })

// Messages queue offline (outbox); uploads can't.
const serverOnline = computed(() => connectionStore.isOnline)

// --- Polls ----------------------------------------------------------------
const pollModalOpen = ref(false)
function createPoll(poll: TextPollInput) {
  pollModalOpen.value = false
  textChatStore.sendPoll(props.roomId, poll)
}

function addFiles(files: File[]) {
  if (!files.length) return
  if (canAttach.value && !serverOnline.value) {
    attachmentsStore.composerError = "Attachments need a connection."
    return
  }
  if (!canAttach.value) {
    attachmentsStore.composerError = attachmentsStore.enabled
      ? "You don't have permission to attach files in this channel."
      : "Attachments are disabled on this server."
    return
  }
  attachmentsStore.addFiles(props.roomId, files)
  focus()
}

let keyboardInputFocused = false
let composerDisposed = false
let stopKeyboardImages: (() => void) | null = null

function syncKeyboardContent() {
  const enabled = !composerDisposed && keyboardInputFocused && canAttach.value && serverOnline.value
  void setKeyboardContentEnabled(enabled, Math.max(1, attachmentsStore.maxBytes("image")))
}

function onInputFocus() {
  keyboardInputFocused = true
  syncKeyboardContent()
}

async function receiveKeyboardImage(event: KeyboardImageEvent) {
  if ("error" in event) {
    if (composerDisposed || !keyboardInputFocused) return
    attachmentsStore.composerError =
      event.error === "too_large"
        ? `This image is larger than the ${formatBytes(attachmentsStore.maxBytes("image"))} image limit.`
        : "The keyboard image or sticker could not be read."
    return
  }
  if (composerDisposed || !keyboardInputFocused) {
    await releaseKeyboardImage(event.uri)
    return
  }

  const roomId = props.roomId
  try {
    const file = await readKeyboardImage(event)
    // Do not add a delayed keyboard event to a different composer.
    if (composerDisposed || !keyboardInputFocused || roomId !== props.roomId) return
    addFiles([file])
  } catch {
    if (!composerDisposed && roomId === props.roomId) {
      attachmentsStore.composerError = "The keyboard image or sticker could not be read."
    }
  }
}

watch([canAttach, serverOnline, () => props.roomId], syncKeyboardContent)

onMounted(() => {
  window.addEventListener("resize", onDockResize)
  window.addEventListener("orientationchange", onDockResize)
  void onKeyboardImage((event) => void receiveKeyboardImage(event)).then((stop) => {
    if (composerDisposed) stop()
    else stopKeyboardImages = stop
  })
})

onBeforeUnmount(() => {
  window.removeEventListener("resize", onDockResize)
  window.removeEventListener("orientationchange", onDockResize)
  stopDockBackHandler?.()
  stopDockBackHandler = null
  composerDisposed = true
  keyboardInputFocused = false
  syncKeyboardContent()
  stopKeyboardImages?.()
})

function onPick(e: Event) {
  const el = e.target as HTMLInputElement
  addFiles(Array.from(el.files ?? []))
  el.value = ""
}

function onPaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.files ?? [])
  if (!files.length) return
  e.preventDefault()
  addFiles(files)
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files")
}

function onDragOver(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragging.value = true
}

function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragging.value = false
  addFiles(Array.from(e.dataTransfer?.files ?? []))
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
  emojiSearchQuery = ""
}

function mentionSuggestions(query: string): Suggestion[] {
  const q = query.toLowerCase()
  const rank = (name: string) => {
    const n = name.toLowerCase()
    return n.startsWith(q) ? 0 : n.includes(q) ? 1 : -1
  }
  // Only users who can see this channel, like the user sidebar (everyone
  // until the viewer list for this channel has loaded).
  const viewerIds =
    textChatStore.activeChannelId === props.roomId ? textChatStore.activeViewerIds : null
  const users = usersStore.allUsers
    .filter((u) => !viewerIds || viewerIds.has(u.id))
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

// Custom emojis outside the loaded pages come from a debounced server search;
// local (unicode + loaded) matches show immediately.
const EMOJI_SEARCH_DEBOUNCE_MS = 150
let emojiSearchTimer: ReturnType<typeof setTimeout> | undefined
let emojiSearchQuery = ""
// Server results for emojiSearchQuery, reused while the query is unchanged.
let emojiSearchExtra: Emoji[] = []

function showEmojiSuggestions(query: string) {
  if (query === emojiSearchQuery) {
    suggestions.value = emojiSuggestions(query, emojiSearchExtra)
    return
  }
  suggestions.value = emojiSuggestions(query)
  emojiSearchQuery = query
  emojiSearchExtra = []
  clearTimeout(emojiSearchTimer)
  emojiSearchTimer = setTimeout(async () => {
    const extra = await customEmojisStore.search(query).catch(() => [])
    if (emojiSearchQuery !== query) return
    emojiSearchExtra = extra
    suggestions.value = emojiSuggestions(query, extra)
    activeSuggestion.value = Math.max(
      0,
      Math.min(activeSuggestion.value, suggestions.value.length - 1),
    )
  }, EMOJI_SEARCH_DEBOUNCE_MS)
}

function emojiSuggestions(query: string, extra: Emoji[] = []): Suggestion[] {
  return searchEmojis(query, MAX_SUGGESTIONS, extra).map((e) => ({
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
  const command = activeCommandQuery(draft.value, caret)
  const mention = command ? null : activeMentionQuery(draft.value, caret)
  if (command) {
    emojiSearchQuery = ""
    suggestions.value = matchCommands(command.query).map((c) => ({
      key: `c:${c.name}`,
      kind: "command",
      id: c.name,
      label: `/${c.name}`,
      insert: `/${c.name}`,
      hint: c.description,
    }))
    suggestionTitle.value = "Commands"
    suggestionStart = 0
  } else if (mention) {
    emojiSearchQuery = ""
    suggestions.value = mentionSuggestions(mention.query)
    suggestionTitle.value = "Members and roles"
    suggestionStart = mention.start
  } else {
    const emoji = activeEmojiQuery(draft.value, caret)
    if (emoji) {
      showEmojiSuggestions(emoji.query)
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
  if (onFormatKey(event)) return
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    void nextTick(updateSuggestions)
  }
  // On mobile Enter inserts a newline (textarea default); the send button sends.
  if (event.key === "Enter" && !event.shiftKey && !appStore.isMobile) {
    event.preventDefault()
    send()
  } else if (event.key === "ArrowUp" && draft.value === "") {
    event.preventDefault()
    emit("edit-last")
  } else if (event.key === "Escape") {
    // Handled here; the channel view ignores prevented Escapes.
    event.preventDefault()
    if (composerPanel.value) {
      closeComposerPanel()
    } else if (isGifPickerOpen.value) {
      isGifPickerOpen.value = false
    } else if (isPickerOpen.value) {
      isPickerOpen.value = false
    } else if (formatBarLeft.value !== null) {
      formatBarLeft.value = null
    } else if (replyTarget.value) {
      textChatStore.cancelReply()
    } else {
      emit("escape")
    }
  }
}

// --- Formatting toolbar (selected text) --------------------------------

const FORMATS = [
  { marker: "**", label: "Bold", title: "Bold (Ctrl+B)", icon: PhTextB },
  { marker: "*", label: "Italic", title: "Italic (Ctrl+I)", icon: PhTextItalic },
  {
    marker: "~~",
    label: "Strikethrough",
    title: "Strikethrough (Ctrl+Shift+X)",
    icon: PhTextStrikethrough,
  },
  { marker: "||", label: "Spoiler", title: "Spoiler (Ctrl+Shift+S)", icon: PhEyeSlash },
]
/** Toolbar x offset inside the composer box; null while hidden. */
const formatBarLeft = ref<number | null>(null)
const FORMAT_BAR_WIDTH = 132

function updateFormatBar(event?: MouseEvent | KeyboardEvent) {
  const el = input.value
  const rect = box.value?.getBoundingClientRect()
  if (!el || !rect || el.selectionStart === el.selectionEnd) {
    formatBarLeft.value = null
    return
  }
  // Follow the pointer for mouse selections; keyboard selections anchor left.
  const x = event instanceof MouseEvent ? event.clientX - rect.left - FORMAT_BAR_WIDTH / 2 : 8
  formatBarLeft.value = Math.max(0, Math.min(x, rect.width - FORMAT_BAR_WIDTH))
}

async function applyFormat(marker: string) {
  const el = input.value
  if (!el) return
  const res = wrapSelection(draft.value, el.selectionStart, el.selectionEnd, marker)
  draft.value = res.value
  await nextTick()
  el.focus()
  el.setSelectionRange(res.start, res.end)
  autosize()
  updateFormatBar()
}

function onFormatKey(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  const key = event.key.toLowerCase()
  const marker = event.shiftKey ? { x: "~~", s: "||" }[key] : { b: "**", i: "*" }[key]
  if (!marker) return false
  event.preventDefault()
  void applyFormat(marker)
  return true
}

function onBlur() {
  keyboardInputFocused = false
  syncKeyboardContent()
  closeSuggestions()
  formatBarLeft.value = null
}

function textFor(ref: EmojiRef): string {
  if (!ref.startsWith(CUSTOM_EMOJI_PREFIX)) return ref
  const emoji = resolveEmoji(ref)
  return emoji ? `:${emojiShortcode(emoji.name)}:` : ""
}

async function insertEmoji(ref: EmojiRef) {
  const text = textFor(ref)
  if (!text) return
  const el = input.value
  const value = draft.value
  // In the mobile dock the textarea is blurred (keyboard away), so the caret
  // comes from the snapshot taken when the dock opened or from the last insert.
  const docked = appStore.isMobile && !!composerPanel.value
  if (!docked) isPickerOpen.value = false
  // Without a saved caret the emoji goes to the end of the draft, not to the
  // textarea's default selection (0 when it was never focused, e.g. Android).
  const start = docked
    ? Math.min(savedCaret.value?.start ?? value.length, value.length)
    : Math.min(el?.selectionStart ?? value.length, value.length)
  const end = docked
    ? Math.min(savedCaret.value?.end ?? value.length, value.length)
    : Math.min(el?.selectionEnd ?? value.length, value.length)
  draft.value = value.slice(0, start) + text + value.slice(end)
  await nextTick()
  const next = start + text.length
  if (docked) {
    // Keep the dock (and the chat) open for more emojis; no focus, or the
    // keyboard would cover the panel.
    savedCaret.value = { start: next, end: next }
  } else {
    el?.focus()
    el?.setSelectionRange(next, next)
  }
  autosize()
}

function closePicker() {
  isPickerOpen.value = false
  focus()
}

/** Emoji and GIF pickers share the same spot above the composer (desktop) or
 * the same dock (mobile). */
function toggleEmojiPicker() {
  if (appStore.isMobile) {
    textChatStore.toggleComposerPanel("emoji")
    return
  }
  isGifPickerOpen.value = false
  isPickerOpen.value = !isPickerOpen.value
}

function toggleGifPicker() {
  if (appStore.isMobile) {
    textChatStore.toggleComposerPanel("gif")
    return
  }
  isPickerOpen.value = false
  isGifPickerOpen.value = !isGifPickerOpen.value
}

/** The picked GIF waits in the composer until the message is sent. */
function pickGif(gif: TextGIF) {
  textChatStore.pendingGif = gif
  if (appStore.isMobile) {
    // A GIF is one per message: close the dock, but keep the keyboard away.
    closeComposerPanel()
    return
  }
  isGifPickerOpen.value = false
  focus()
}

function closeGifPicker() {
  isGifPickerOpen.value = false
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

<style scoped>
/* The global *:focus-visible outline (style.css) is unlayered, so it beats
   Tailwind's layered outline utilities; the surrounding box shows focus. */
.composer-input:focus-visible {
  outline: none;
}

/* Mobile emoji/GIF dock. The slot collapses to 0 and clips the full-height
   panel, so opening slides the panel up (the message list gives its height
   back) and closing slides it down. The panel keeps the height it had when it
   opened while the keyboard is up: only the chat is covered. */
.composer-dock {
  height: 0;
  overflow: hidden;
  transition:
    height 220ms var(--ease-out-smooth, cubic-bezier(0.22, 1, 0.36, 1)),
    margin-top 220ms var(--ease-out-smooth, cubic-bezier(0.22, 1, 0.36, 1));
}

.composer-dock--open {
  /* A gap under the composer, and the panel reads as its own sheet. */
  margin-top: 0.75rem;
  height: min(var(--composer-dock-h, 0px), calc(100dvh - 8rem));
}

.composer-dock-inner {
  /* Fixed, so the content slides in and out with the slot instead of
     squashing. Never taller than the space under the header: on short
     viewports (landscape, keyboard up) the composer must stay reachable. */
  height: min(var(--composer-dock-h, 0px), calc(100dvh - 8rem));
}

.composer-dock--dragging,
.composer-dock--dragging .composer-dock-inner {
  transition: none;
}

/* Grab handle: a full-width strip so the target is easy to hit. */
.dock-handle {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  height: 1.25rem;
  cursor: grab;
  touch-action: none;
}

.dock-handle:active {
  cursor: grabbing;
}

.dock-grabber {
  width: 2.5rem;
  height: 0.25rem;
  border-radius: 9999px;
  background-color: var(--color-theme-text-muted);
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .composer-dock {
    transition: none;
  }
}
</style>
