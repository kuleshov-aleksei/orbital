<template>
  <!-- Mobile: Backdrop overlay -->
  <Teleport to="body">
    <Transition name="backdrop-fade">
      <div
        v-if="isMobile && chatStore.isOpen"
        class="fixed inset-0 bg-black/50 z-30"
        @click="chatStore.closeChat" />
    </Transition>
  </Teleport>

  <!-- Sidebar / Modal -->
  <Transition :name="isMobile ? 'modal-slide' : 'sidebar-slide'" @after-enter="scrollToBottom" @after-leave="scrollToBottom">
    <div
      v-if="chatStore.isOpen"
      class="flex flex-col bg-theme-bg-secondary border-theme-border"
      :class="isMobile ? ['fixed', 'inset-0', 'z-40', 'w-full', 'h-full'] : ['w-80', 'shrink-0', 'h-full']"
      :data-testid="isMobile ? 'chat-modal' : 'chat-sidebar'">

      <!-- Header -->
      <div class="flex items-center justify-between h-16 px-4 border-b border-theme-border shrink-0">
        <div class="flex items-center gap-2">
          <PhChatDots class="w-4 h-4 text-theme-text-muted" weight="fill" />
          <h2 class="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
            Chat
          </h2>
        </div>

        <button
          type="button"
          class="flex items-center justify-center rounded-lg bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-muted hover:text-theme-text-primary transition-all duration-200 active:scale-95"
          :title="isMobile ? 'Close' : 'Close Chat'"
          :class="isMobile ? 'w-10 h-10' : 'w-7 h-7'"
          @click="chatStore.closeChat">
          <PhX class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Messages Area -->
      <div
        ref="messagesContainerRef"
        class="flex-1 overflow-y-auto p-3 space-y-3">
        <div
          v-for="item in currentMessages"
          :key="item.id"
          class="flex gap-2 group">
          <UserAvatar :user-id="item.sender_id" :size="28" :show-status="false" />
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
              <span class="text-xs font-medium text-theme-text-primary">
                {{ getSenderName(item.sender_id) }}
              </span>
              <span
                class="text-[10px] text-theme-text-muted"
                :title="formatFullTime(item.sent_at)">
                {{ formatRelativeTime(item.sent_at) }}
              </span>
            </div>
            <div
              class="text-sm text-theme-text-secondary wrap-break-word leading-relaxed chat-message-body"
              v-html="renderMarkdown(item.content)" />
          </div>
        </div>
        <div v-if="currentMessages.length === 0" class="h-full flex flex-col items-center justify-center -mt-3 gap-2">
          <PhChatCircle class="w-12 h-12 text-theme-text-muted opacity-50" />
          <p class="text-sm text-theme-text-muted">No messages yet</p>
          <p class="text-xs text-theme-text-muted opacity-70">Start the conversation</p>
        </div>
      </div>

      <!-- Selection Toolbar -->
      <Transition name="toolbar-fade">
        <div
          v-if="showToolbar"
          ref="toolbarRef"
          class="absolute flex items-center gap-0.5 px-1.5 py-1.5 bg-theme-bg-hover border border-theme-border rounded-lg shadow-lg z-50"
          :style="{ ...toolbarStyle, position: 'fixed' }">
          <button
            type="button"
            class="toolbar-btn"
            title="Bold (Ctrl+B)"
            @click="applyFormat('**', '**')">
            <span class="font-bold text-sm">B</span>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            title="Italic (Ctrl+I)"
            @click="applyFormat('*', '*')">
            <span class="italic text-sm">I</span>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            title="Strikethrough"
            @click="applyFormat('~~', '~~')">
            <span class="line-through text-sm">S</span>
          </button>
        </div>
      </Transition>

      <!-- Input Area -->
      <div class="px-3 py-3 border-t border-theme-border shrink-0 bg-theme-bg-tertiary/50 relative">
        <div class="relative">
          <textarea
            ref="inputRef"
            v-model="messageInput"
            class="chat-input w-full bg-theme-bg-secondary text-theme-text-primary text-sm px-4 py-3 pr-12 rounded-xl border border-theme-border focus:border-theme-accent focus:outline-none placeholder-theme-text-muted resize-none"
            :placeholder="inputPlaceholder"
            :maxlength="2000"
            @keydown.enter="handleEnter"
            @keydown="handleKeydown"
            @input="autoResize"
            @mouseup="updateToolbar($event)"
            @keyup="updateToolbar($event)" />
          <button
            type="button"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-theme-text-muted hover:text-theme-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-theme-bg-hover active:scale-95"
            :disabled="!canSend"
            title="Send message"
            @click="sendMessage">
            <PhPaperPlaneRight class="w-5 h-5" />
          </button>
        </div>
        <div class="mt-1.5 text-xs text-theme-text-muted text-right">
          {{ messageInput.length }}/2000
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue"
import { PhChatDots, PhChatCircle, PhPaperPlaneRight, PhX } from "@phosphor-icons/vue"
import { useChatStore, useUserStore, useRoomStore, useUsersStore } from "@/stores"
import { wsService } from "@/services/websocket"
import { renderMarkdown } from "@/utils/markdown"
import UserAvatar from "@/components/UserAvatar.vue"

defineProps<{
  isMobile?: boolean
}>()

const chatStore = useChatStore()
const userStore = useUserStore()
const roomStore = useRoomStore()
const usersStore = useUsersStore()

const messageInput = ref("")
const inputRef = ref<HTMLTextAreaElement | null>(null)
const messagesContainerRef = ref<HTMLElement | null>(null)
const toolbarRef = ref<HTMLElement | null>(null)

const showToolbar = ref(false)
const toolbarStyle = ref({})

const updateToolbar = (e?: MouseEvent | KeyboardEvent) => {
  const el = inputRef.value
  if (!el) return

  const { selectionStart, selectionEnd } = el
  const hasSelection = selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd

  if (!hasSelection) {
    showToolbar.value = false
    return
  }

  if (e && e instanceof MouseEvent) {
    toolbarStyle.value = {
      top: `${e.clientY - 60}px`,
      left: `${e.clientX - 40}px`,
    }
  } else {
    const rect = el.getBoundingClientRect()
    toolbarStyle.value = {
      top: `${rect.top - 60}px`,
      left: `${rect.left + 10}px`,
    }
  }
  showToolbar.value = true
}

const applyFormat = (prefix: string, suffix: string) => {
  showToolbar.value = false
  wrapSelection(prefix, suffix)
}

const currentMessages = computed(() => {
  const roomId = roomStore.activeRoomId
  if (!roomId) return []
  return chatStore.getMessages(roomId)
})

const canSend = computed(() => {
  return messageInput.value.trim().length > 0 && roomStore.activeRoomId !== null
})

const inputPlaceholder = computed(() => {
  if (!roomStore.activeRoomId) return "Join a room to chat"
  return "Message..."
})

const getSenderName = (senderId: string) => {
  if (senderId === userStore.userId) return userStore.nickname

  const user = usersStore.allUsers.find((u) => u.id === senderId)
  return user?.nickname || "Unknown User"
}

const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return "now"
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString()
}

const formatFullTime = (dateString: string) => {
  return new Date(dateString).toLocaleString()
}

const sendMessage = () => {
  const content = messageInput.value.trim()
  if (!content || !roomStore.activeRoomId) return

  wsService.sendChatMessage(content)
  messageInput.value = ""
  if (inputRef.value) {
    inputRef.value.style.height = "auto"
    inputRef.value.rows = 1
  }
}

const handleEnter = (e: KeyboardEvent) => {
  if (e.shiftKey) return
  e.preventDefault()
  sendMessage()
}

const wrapSelection = (prefix: string, suffix: string) => {
  const el = inputRef.value
  if (!el) return

  const { selectionStart: start, selectionEnd: end, value } = el
  if (start === null || end === null) return

  const selectedText = value.slice(start, end)
  const textBefore = value.slice(0, start)
  const textAfter = value.slice(end)
  let newValue = value
  let newStart = start
  let newEnd = end

  if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix)) {
    newValue = value.slice(0, start) + selectedText.slice(prefix.length, -suffix.length || selectedText.length) + value.slice(end)
    newStart = start
    newEnd = start + selectedText.length - prefix.length - suffix.length
  } else if (textBefore.endsWith(prefix) && textAfter.startsWith(suffix)) {
    newValue = value.slice(0, start - prefix.length) + selectedText + value.slice(end + suffix.length)
    newStart = start - prefix.length
    newEnd = start - prefix.length + selectedText.length
  } else {
    newValue = value.slice(0, start) + prefix + selectedText + suffix + value.slice(end)
    newStart = start + prefix.length
    newEnd = start + prefix.length + selectedText.length
  }

  messageInput.value = newValue
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.setSelectionRange(newStart, newEnd)
      autoResize()
      inputRef.value.focus()
    }
  })
}

const handleKeydown = (e: KeyboardEvent) => {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return

  if (e.key === "b") {
    e.preventDefault()
    wrapSelection("**", "**")
  } else if (e.key === "i") {
    e.preventDefault()
    wrapSelection("*", "*")
  }
}

const autoResize = () => {
  if (!inputRef.value) return
  inputRef.value.style.height = "auto"
  inputRef.value.style.height = `${inputRef.value.scrollHeight}px`
}

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainerRef.value) {
      messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
    }
  })
}

watch(
  () => currentMessages.value.length,
  () => {
    scrollToBottom()
  },
)

watch(
  () => chatStore.isOpen,
  (isOpen) => {
    if (isOpen) {
      nextTick(() => {
        inputRef.value?.focus()
      })
    }
  },
)
</script>

<style scoped>
/* Sidebar slide (desktop - shrinks main content) */
.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
  overflow: hidden;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  width: 0;
  opacity: 0;
}

/* Modal slide (mobile - slides up from bottom) */
.modal-slide-enter-active,
.modal-slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
}

.modal-slide-enter-from,
.modal-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

/* Backdrop fade */
.backdrop-fade-enter-active,
.backdrop-fade-leave-active {
  transition: opacity 0.3s ease;
}

.backdrop-fade-enter-from,
.backdrop-fade-leave-to {
  opacity: 0;
}

/* Toolbar fade */
.toolbar-fade-enter-active,
.toolbar-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.toolbar-fade-enter-from,
.toolbar-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* Toolbar buttons */
.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  color: #a1a1aa;
  transition: background 0.15s ease, color 0.15s ease;
}

.toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-slide-enter-active,
  .sidebar-slide-leave-active,
  .modal-slide-enter-active,
  .modal-slide-leave-active,
  .backdrop-fade-enter-active,
  .backdrop-fade-leave-active {
    transition: none;
  }
}

/* Chat input textarea */
.chat-input {
  min-height: 44px;
  max-height: 160px;
  overflow-y: auto;
  field-size: none;
  box-sizing: border-box;
  line-height: 1.5;
}

/* Markdown rendered content */
.chat-message-body :deep(a) {
  color: #3b82f6;
  text-decoration: none;
  word-break: break-all;
  overflow-wrap: break-word;
}

.chat-message-body :deep(a:hover) {
  text-decoration: underline;
}

.chat-message-body :deep(code) {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  font-size: 0.875em;
  padding: 0.1em 0.3em;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}

.chat-message-body :deep(pre) {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 0.6em 0.8em;
  overflow-x: auto;
  font-size: 0.8em;
}

.chat-message-body :deep(pre code) {
  background: none;
  padding: 0;
}

.chat-message-body :deep(blockquote) {
  border-left: 3px solid rgba(255, 255, 255, 0.2);
  padding-left: 0.8em;
  margin: 0.3em 0;
  color: rgba(255, 255, 255, 0.6);
}

.chat-message-body :deep(ul),
.chat-message-body :deep(ol) {
  list-style: revert;
  padding-left: 1.5em;
  margin: 0.25em 0;
}

.chat-message-body :deep(ul) {
  list-style-type: disc;
}

.chat-message-body :deep(ol) {
  list-style-type: decimal;
}

.chat-message-body :deep(li) {
  list-style: revert;
  margin: 0.15em 0;
  display: list-item;
}

.chat-message-body :deep(li > ul),
.chat-message-body :deep(li > ol) {
  margin: 0.1em 0;
}

.chat-message-body :deep(li p) {
  margin: 0;
}

.chat-message-body :deep(h1),
.chat-message-body :deep(h2),
.chat-message-body :deep(h3),
.chat-message-body :deep(h4),
.chat-message-body :deep(h5),
.chat-message-body :deep(h6) {
  margin: 0.4em 0 0.2em;
  font-weight: 600;
  line-height: 1.3;
}

.chat-message-body :deep(h1) { font-size: 1.3em; }
.chat-message-body :deep(h2) { font-size: 1.15em; }
.chat-message-body :deep(h3) { font-size: 1.05em; }
.chat-message-body :deep(h4),
.chat-message-body :deep(h5),
.chat-message-body :deep(h6) { font-size: 1em; }

.chat-message-body :deep(p) {
  margin: 0;
}

.chat-message-body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 0.5em 0;
}

.chat-message-body :deep(img) {
  max-width: 180px;
  max-height: 120px;
  border-radius: 4px;
}

.chat-message-body :deep(del),
.chat-message-body :deep(s),
.chat-message-body :deep(strike) {
  text-decoration: line-through;
  opacity: 0.7;
}

.chat-message-body :deep(u) {
  text-decoration: underline;
}

.chat-message-body :deep(table) {
  font-size: 0.85em;
  border-collapse: collapse;
}

.chat-message-body :deep(th),
.chat-message-body :deep(td) {
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.3em 0.6em;
}
</style>
