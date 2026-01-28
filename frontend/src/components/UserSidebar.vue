<template>
  <div class="user-sidebar w-60 lg:w-60 bg-gray-800 flex flex-col fixed lg:relative inset-y-0 right-0 z-40 lg:z-auto transform translate-x-full lg:translate-x-0 transition-transform duration-300"
       :class="{ 'translate-x-0': !isHidden }">
    <!-- Mobile Close Button -->
    <div class="lg:hidden flex items-center justify-between p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        In Room — {{ userCount }}
      </h2>
      <button
        @click="$emit('close-mobile-sidebar')"
        class="p-1 text-gray-400 hover:text-white"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Desktop Header -->
    <div class="hidden lg:flex items-center justify-between p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        In Room — {{ userCount }}
      </h2>
      <button class="text-gray-400 hover:text-gray-200 transition-colors duration-200">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
    </div>
    <!-- User List Header -->
    <div class="p-4 border-b border-gray-700">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          In Room — {{ userCount }}
        </h2>
        <button class="text-gray-400 hover:text-gray-200 transition-colors duration-200">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- User List -->
    <div class="flex-1 overflow-y-auto p-2">
      <UserCard
        v-for="user in users"
        :key="user.id"
        :user="user"
      />
    </div>

    <!-- User Controls -->
    <div class="p-3 border-t border-gray-700">
      <div class="space-y-2">
        <button class="w-full flex items-center justify-center px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors duration-200">
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span class="text-sm font-medium">Start Video</span>
        </button>
        
        <button class="w-full flex items-center justify-center px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors duration-200">
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span class="text-sm font-medium">Share Screen</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import UserCard from '@/components/UserCard.vue'

interface User {
  id: string
  nickname: string
  isSpeaking: boolean
  isMuted: boolean
  isDeafened: boolean
  status: 'online' | 'away' | 'dnd'
}

interface Props {
  users: User[]
  userCount: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'close-mobile-sidebar': []
}>()

const isHidden = computed(() => {
  return props.userCount === 0
})
</script>