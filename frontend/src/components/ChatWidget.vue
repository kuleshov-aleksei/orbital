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
            <p class="text-sm text-theme-text-secondary wrap-break-word leading-relaxed">
              {{ item.content }}
            </p>
          </div>
        </div>
        <div v-if="currentMessages.length === 0" class="h-full flex flex-col items-center justify-center -mt-3 gap-2">
          <PhChatCircle class="w-12 h-12 text-theme-text-muted opacity-50" />
          <p class="text-sm text-theme-text-muted">No messages yet</p>
          <p class="text-xs text-theme-text-muted opacity-70">Start the conversation</p>
        </div>
      </div>

      <!-- Input Area -->
      <div class="px-3 py-3 border-t border-theme-border shrink-0 bg-theme-bg-tertiary/50">
        <div class="relative">
          <input
            ref="inputRef"
            v-model="messageInput"
            type="text"
            class="w-full bg-theme-bg-secondary text-theme-text-primary text-sm px-4 py-3 pr-12 rounded-xl border border-theme-border focus:border-theme-accent focus:outline-none placeholder-theme-text-muted"
            :placeholder="inputPlaceholder"
            :maxlength="2000"
            @keydown.enter.exact.prevent="sendMessage" />
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
import UserAvatar from "@/components/UserAvatar.vue"

defineProps<{
  isMobile?: boolean
}>()

const chatStore = useChatStore()
const userStore = useUserStore()
const roomStore = useRoomStore()
const usersStore = useUsersStore()

const messageInput = ref("")
const inputRef = ref<HTMLInputElement | null>(null)
const messagesContainerRef = ref<HTMLElement | null>(null)

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
</style>
