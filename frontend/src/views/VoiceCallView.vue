<template>
  <div class="voice-call-view flex-1 flex flex-col">
    <!-- Room Header -->
    <header class="bg-gray-800 px-6 py-4 border-b border-gray-700">
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <button
            @click="$emit('leave-room')"
            class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 class="text-xl font-semibold text-white">{{ currentRoom?.name || 'Voice Room' }}</h1>
            <p class="text-sm text-gray-400">{{ users.length }} users in room</p>
          </div>
        </div>
        
        <div class="flex items-center space-x-3">
          <!-- Connection Status -->
          <div class="flex items-center text-sm">
            <div class="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
            <span class="text-gray-300">Connected</span>
          </div>
          
          <!-- Room Settings -->
          <button class="p-2 text-gray-400 hover:text-white transition-colors duration-200">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Call Area -->
    <main class="flex-1 flex flex-col min-h-0 overflow-hidden">
      <!-- User Grid -->
      <div class="flex-1 p-4 lg:p-6 overflow-y-auto">
        <div v-if="users.length > 0" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
          <div
            v-for="user in users"
            :key="user.id"
            class="user-tile bg-gray-800 rounded-lg p-4 flex flex-col items-center justify-center h-48 relative border border-gray-700"
          >
            <!-- User Avatar -->
            <div class="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-2xl font-bold text-white mb-3">
              {{ user.nickname.charAt(0).toUpperCase() }}
            </div>
            
            <!-- User Name -->
            <div class="text-center">
              <div class="text-white font-medium">{{ user.nickname }}</div>
              <div class="text-xs text-gray-400 mt-1">
                <span v-if="user.isSpeaking" class="text-green-400">Speaking...</span>
                <span v-else-if="user.isMuted" class="text-red-400">Muted</span>
                <span v-else>Listening</span>
              </div>
            </div>

            <!-- Speaking Indicator -->
            <div v-if="user.isSpeaking" class="absolute top-2 right-2 w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
            
            <!-- Muted Indicator -->
            <div v-if="user.isMuted" class="absolute top-2 right-2 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center">
              <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="flex items-center justify-center h-full">
          <div class="text-center">
            <div class="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-white mb-2">Waiting for others...</h3>
            <p class="text-gray-400">You're the first one here. Invite some friends to join!</p>
          </div>
        </div>
      </div>

      <!-- Audio Controls -->
      <div class="bg-gray-800 border-t border-gray-700 px-6 py-4">
        <AudioControls />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AudioControls from '@/components/AudioControls.vue'

interface User {
  id: string
  nickname: string
  isSpeaking: boolean
  isMuted: boolean
  isDeafened: boolean
  status: 'online' | 'away' | 'dnd'
}

interface Props {
  roomId: string
  users: User[]
}

defineProps<Props>()
defineEmits<{
  'leave-room': []
}>()

// Mock current room data - will be replaced with API call
const currentRoom = computed(() => ({
  name: 'General',
  id: '1'
}))
</script>