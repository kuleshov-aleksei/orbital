<template>
  <div class="user-card flex items-center px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors duration-200 cursor-pointer group" :data-testid="`user-card-${user.id}`">
    <!-- User Avatar -->
    <div class="relative mr-3">
      <div class="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-medium">
        {{ user.nickname.charAt(0).toUpperCase() }}
      </div>
      <!-- Status Indicator -->
      <div 
        class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-800"
        :class="statusColors[user.status]"
      ></div>
    </div>

    <!-- User Info -->
    <div class="flex-1 min-w-0">
      <div class="font-medium text-sm truncate">{{ user.nickname }}</div>
      <div class="text-xs text-gray-400">
        <span v-if="user.isSpeaking" class="text-green-400">Speaking...</span>
        <span v-else-if="user.isMuted" class="text-red-400">Muted</span>
        <span v-else-if="user.status === 'away'">Away</span>
        <span v-else-if="user.status === 'dnd'">Do Not Disturb</span>
        <span v-else>Online</span>
      </div>
    </div>

    <!-- Action Icons -->
    <div class="ml-2 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      <!-- Muted Icon -->
      <div v-if="user.isMuted" class="w-4 h-4 text-red-400">
        <svg fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
        </svg>
      </div>
      
      <!-- Speaking Indicator -->
      <div v-if="user.isSpeaking" class="w-4 h-4 text-green-400 animate-pulse">
        <PhSpeakerHigh class="w-3 h-3" />
      </div>

      <!-- Deafened Icon -->
      <div v-if="user.isDeafened" class="w-4 h-4 text-gray-400">
        <PhMicrophoneSlash class="w-3 h-3" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PhMicrophoneSlash, PhSpeakerHigh, PhSpeakerSimpleSlash, PhSpeakerSlash } from '@phosphor-icons/vue'

interface User {
  id: string
  nickname: string
  isSpeaking: boolean
  isMuted: boolean
  isDeafened: boolean
  status: 'online' | 'away' | 'dnd'
}

interface Props {
  user: User
}

defineProps<Props>()

const statusColors = {
  online: 'bg-green-400',
  away: 'bg-yellow-400',
  dnd: 'bg-red-400'
}
</script>
