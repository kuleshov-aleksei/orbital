<template>
  <div class="audio-controls">
    <div class="flex items-center justify-center space-x-4">
      <!-- Mute/Unmute -->
      <button
        @click="toggleMute"
        class="control-button"
        :class="{ 'bg-red-600 hover:bg-red-700': isMuted, 'bg-gray-700 hover:bg-gray-600': !isMuted }"
      >
        <svg v-if="isMuted" class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clip-rule="evenodd" />
        </svg>
        <svg v-else class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
        </svg>
      </button>

      <!-- Deafen/Undeafen -->
      <button
        @click="toggleDeafen"
        class="control-button"
        :class="{ 'bg-red-600 hover:bg-red-700': isDeafened, 'bg-gray-700 hover:bg-gray-600': !isDeafened }"
      >
        <!-- Headphones with slash (deafened) -->
        <!-- Headphones with slash (deafened) -->
        <svg v-if="isDeafened" class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 9v3a2 2 0 002 2h1a1 1 0 100-2H6a1 1 0 110 2h1a2 2 0 002-2V9a1 1 0 00-1-1H5a1 1 0 00-1 1zm12 0v3a2 2 0 01-2 2h-1a1 1 0 110-2h1a1 1 0 100-2h-1a1 1 0 00-1 1v3a2 2 0 002 2h1a1 1 0 100-2h-1a1 1 0 110-2h1a1 1 0 001-1z" />
          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 110 12 6 6 0 010-12z" />
          <path d="M13.414 10l1.293-1.293a1 1 0 10-1.414-1.414L12 8.586l-1.293-1.293a1 1 0 10-1.414 1.414L10.586 10l-1.293 1.293a1 1 0 101.414 1.414L12 11.414l1.293 1.293a1 1 0 001.414-1.414L13.414 10z" />
        </svg>
        <!-- Headphones (undeafened) -->
        <svg v-else class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 9v3a2 2 0 002 2h1a1 1 0 100-2H6a1 1 0 110 2h1a2 2 0 002-2V9a1 1 0 00-1-1H5a1 1 0 00-1 1zm12 0v3a2 2 0 01-2 2h-1a1 1 0 110-2h1a1 1 0 100-2h-1a1 1 0 00-1 1v3a2 2 0 002 2h1a1 1 0 100-2h-1a1 1 0 110-2h1a1 1 0 001-1z" />
          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 110 12 6 6 0 010-12z" />
        </svg>
      </button>

      <!-- Screen Share -->
      <button
        @click="toggleScreenShare"
        class="control-button"
        :class="{ 'bg-indigo-600 hover:bg-indigo-700': isScreenSharing, 'bg-gray-700 hover:bg-gray-600': !isScreenSharing }"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </button>

      <!-- Leave Room -->
      <button
        @click="$emit('leave-room')"
        class="control-button bg-red-600 hover:bg-red-700"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>

      <!-- Settings -->
      <button
        @click="toggleSettings"
        class="control-button bg-gray-700 hover:bg-gray-600"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </div>

    <!-- Connection Info -->
    <div class="flex items-center justify-center mt-4 space-x-6 text-xs text-gray-400">
      <div class="flex items-center">
        <div class="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
        <span>Ping: {{ ping }}ms</span>
      </div>
      <div>
        <span>Quality: {{ connectionQuality }}</span>
      </div>
      <div v-if="isScreenSharing" class="flex items-center text-indigo-400">
        <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
          <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
        </svg>
        <span>Screen Sharing</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { wsService } from '@/services/websocket'

interface Props {
  isMuted?: boolean
  isDeafened?: boolean
  isScreenSharing?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'toggle-mute': []
  'toggle-deafen': []
  'toggle-screen-share': []
  'leave-room': []
}>()

// Local state
const ping = ref(42)
const connectionQuality = ref('Excellent')
const showSettings = ref(false)

// Methods
const toggleMute = () => {
  emit('toggle-mute')
  
  // Notify WebSocket of speaking status change
  const userId = getCurrentUserId()
  wsService.sendMessage('speaking_status', {
    user_id: userId,
    is_speaking: false,
    is_muted: !props.isMuted
  })
}

const toggleDeafen = () => {
  emit('toggle-deafen')
  console.log('Deafen status:', !props.isDeafened)
}

const toggleScreenShare = () => {
  emit('toggle-screen-share')
  console.log('Screen sharing:', !props.isScreenSharing)
}

const toggleSettings = () => {
  showSettings.value = !showSettings.value
  console.log('Settings toggled')
}

const getCurrentUserId = (): string => {
  return localStorage.getItem('orbital_user_id') || 'unknown-user'
}

// Simulate connection quality updates
const updateConnectionInfo = () => {
  // Simulate ping changes
  ping.value = Math.floor(Math.random() * 50) + 20
  
  // Update connection quality based on ping
  if (ping.value < 30) {
    connectionQuality.value = 'Excellent'
  } else if (ping.value < 60) {
    connectionQuality.value = 'Good'
  } else {
    connectionQuality.value = 'Fair'
  }
}

// Lifecycle hooks
onMounted(() => {
  // Update connection info periodically
  const interval = setInterval(updateConnectionInfo, 3000)
  
  onUnmounted(() => {
    clearInterval(interval)
  })
})
</script>

<style scoped>
.control-button {
  @apply w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-200;
}
</style>