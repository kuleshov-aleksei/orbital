<template>
  <Transition name="sidebar-slide" @after-enter="scrollToBottom" @after-leave="scrollToBottom">
    <div
      v-if="chatStore.isOpen"
      class="chat-sidebar flex flex-col w-80 shrink-0 bg-theme-bg-secondary border-l border-theme-border"
      data-testid="chat-sidebar">
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
          class="flex items-center justify-center w-7 h-7 rounded-md bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-muted hover:text-theme-text-primary transition-all duration-200"
          title="Close Chat"
          @click="chatStore.closeChat">
          <PhCaretDoubleRight class="w-3.5 h-3.5" />
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
            <p class="text-xs text-theme-text-secondary break-words leading-relaxed">
              {{ item.content }}
            </p>
          </div>
        </div>
        <div v-if="currentMessages.length === 0" class="h-full flex flex-col items-center justify-center -mt-3 gap-2">
          <PhChatCircle class="w-10 h-10 text-theme-text-muted opacity-50" />
          <p class="text-xs text-theme-text-muted">No messages yet</p>
          <p class="text-[10px] text-theme-text-muted opacity-70">Start the conversation</p>
        </div>
      </div>

      <!-- Input Area -->
      <div class="px-3 py-2 border-t border-theme-border shrink-0">
        <div class="relative">
          <input
            ref="inputRef"
            v-model="messageInput"
            type="text"
            class="w-full bg-theme-bg-tertiary text-theme-text-primary text-xs px-3 py-2.5 pr-10 rounded-md border border-theme-border focus:border-theme-accent focus:outline-none placeholder-theme-text-muted placeholder:text-[10px]"
            :placeholder="inputPlaceholder"
            :maxlength="2000"
            @keydown.enter.exact.prevent="sendMessage" />
          <button
            type="button"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-theme-text-muted hover:text-theme-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :disabled="!canSend"
            title="Send message"
            @click="sendMessage">
            <PhPaperPlaneRight class="w-3.5 h-3.5" />
          </button>
        </div>
        <div class="mt-1 text-[10px] text-theme-text-muted text-right">
          {{ messageInput.length }}/2000
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue"
import { PhChatDots, PhChatCircle, PhPaperPlaneRight, PhCaretDoubleRight } from "@phosphor-icons/vue"
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
.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  width: 0;
}

.chat-sidebar {
  height: 100%;
}
</style>
