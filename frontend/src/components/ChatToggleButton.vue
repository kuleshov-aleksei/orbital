<template>
  <button
    type="button"
    class="relative flex items-center gap-2 px-3 py-2 rounded-md bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary transition-all duration-200"
    :class="{ 'ring-1 ring-theme-accent': chatStore.isOpen }"
    :title="chatStore.isOpen ? 'Close Chat' : 'Open Chat'"
    @click="chatStore.toggleChat">
    <PhChatDots v-if="!chatStore.isOpen" class="w-4 h-4" weight="fill" />
    <PhX v-else class="w-4 h-4" />
    <span class="text-xs font-medium">Chat</span>
    <span
      v-if="chatStore.totalUnreadCount > 0"
      class="min-w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
      {{ chatStore.totalUnreadCount > 99 ? "99+" : chatStore.totalUnreadCount }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { PhChatDots, PhX } from "@phosphor-icons/vue"
import { useChatStore } from "@/stores"

const chatStore = useChatStore()
</script>
