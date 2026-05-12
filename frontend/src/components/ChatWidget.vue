<template>
  <!-- Chat Panel (no toggle button - button is in VoiceCallView) -->
  <div class="fixed bottom-20 right-4 z-50">
    <Transition name="chat-slide">
      <div
        v-if="chatStore.isOpen"
        class="w-80 h-[28rem] bg-theme-bg-secondary rounded-lg shadow-2xl flex flex-col overflow-hidden border border-theme-border">
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-theme-border shrink-0">
          <h3 class="font-semibold text-theme-text-primary">Chat</h3>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover rounded transition-colors"
              title="Minimize"
              @click="chatStore.closeChat">
              <PhMinus class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Messages Area -->
        <div
          ref="messagesContainerRef"
          class="flex-1 overflow-y-auto p-3 space-y-3">
          <div
            v-for="item in currentMessages"
            :key="item.id"
            class="flex gap-3">
            <UserAvatar :user-id="item.sender_id" :size="36" :show-status="false" />
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="text-sm font-medium text-theme-text-primary">
                  {{ getSenderName(item.sender_id) }}
                </span>
                <span
                  class="text-xs text-theme-text-muted"
                  :title="formatFullTime(item.sent_at)">
                  {{ formatRelativeTime(item.sent_at) }}
                </span>
              </div>
              <p class="text-sm text-theme-text-secondary break-words">
                {{ item.content }}
              </p>
            </div>
          </div>
          <div v-if="currentMessages.length === 0" class="h-full flex items-center justify-center -mt-3">
            <p class="text-sm text-theme-text-muted">No messages yet</p>
          </div>
        </div>

        <!-- Input Area -->
        <div class="px-3 py-2 border-t border-theme-border shrink-0">
          <div class="flex gap-2">
            <input
              ref="inputRef"
              v-model="messageInput"
              type="text"
              class="flex-1 bg-theme-bg-tertiary text-theme-text-primary text-sm px-3 py-2 rounded-md border border-theme-border focus:border-theme-accent focus:outline-none resize-none placeholder-theme-text-muted"
              :placeholder="inputPlaceholder"
              :maxlength="2000"
              @keydown.enter.exact.prevent="sendMessage" />
            <button
              type="button"
              class="px-3 py-2 bg-theme-accent hover:bg-theme-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="!canSend"
              title="Send message"
              @click="sendMessage">
              <PhPaperPlaneRight class="w-4 h-4" />
            </button>
          </div>
          <div class="mt-1 text-xs text-theme-text-muted text-right">
            {{ messageInput.length }}/2000
          </div>
        </div>
      </div>
    </Transition>

    <!-- Unread Badge (shown when chat is closed) -->
    <button
      v-if="!chatStore.isOpen && chatStore.totalUnreadCount > 0"
      type="button"
      class="absolute -top-1 -right-1 min-w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1 animate-pulse">
      {{ chatStore.totalUnreadCount > 99 ? "99+" : chatStore.totalUnreadCount }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue"
import { PhPaperPlaneRight, PhMinus } from "@phosphor-icons/vue"
import { useChatStore, useUserStore, useRoomStore, useUsersStore } from "@/stores"
import { wsService } from "@/services/websocket"
import UserAvatar from "@/components/UserAvatar.vue"

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

  if (diffSecs < 60) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (diffDays < 7) return `${diffDays}d ago`
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
.chat-slide-enter-active,
.chat-slide-leave-active {
  transition: all 0.2s ease-out;
}

.chat-slide-enter-from,
.chat-slide-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
</style>
