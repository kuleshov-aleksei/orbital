<template>
  <button
    type="button"
    class="relative w-12 h-12 rounded-full bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary shadow-lg transition-all duration-200 flex items-center justify-center"
    :class="{ 'ring-2 ring-theme-accent': chatStore.isOpen }"
    :title="chatStore.isOpen ? 'Close Chat' : 'Open Chat'"
    @click="chatStore.toggleChat">
    <PhChatDots v-if="!chatStore.isOpen" class="w-6 h-6" />
    <PhMinus v-else class="w-6 h-6" />
    <span
      v-if="chatStore.totalUnreadCount > 0"
      class="absolute -top-1 -right-1 min-w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1">
      {{ chatStore.totalUnreadCount > 99 ? "99+" : chatStore.totalUnreadCount }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { PhChatDots, PhMinus } from "@phosphor-icons/vue"
import { useChatStore } from "@/stores"

const chatStore = useChatStore()
</script>