<template>
  <div class="audio-controls">
    <div class="flex items-center justify-center space-x-4">
      <!-- Mute/Unmute -->
      <button
        class="control-button"
        :class="{ 'bg-red-600 hover:bg-red-700': isMuted, 'bg-gray-700 hover:bg-gray-600': !isMuted }"
        @click="toggleMute"
      >
        <PhMicrophoneSlash v-if="isMuted" class="w-5 h-5" />
        <PhMicrophone v-else class="w-5 h-5" />
      </button>

      <!-- Deafen/Undeafen -->
      <button
        class="control-button"
        :class="{ 'bg-red-600 hover:bg-red-700': isDeafened, 'bg-gray-700 hover:bg-gray-600': !isDeafened }"
        @click="toggleDeafen"
      >
        <!-- Headphones with slash (deafened) -->
        <!-- Headphones with slash (deafened) - TODO: Find proper crossed headphones icon -->
        <div v-if="isDeafened" class="w-5 h-5 relative">
          <PhHeadphones class="absolute inset-0" />
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="w-6 h-0.5 bg-red-500 rotate-45"></div>
          </div>
        </div>
        <PhHeadphones v-else class="w-5 h-5" />
      </button>

      <!-- Screen Share -->
      <button
        class="control-button"
        :class="{ 'bg-indigo-600 hover:bg-indigo-700': isScreenSharing, 'bg-gray-700 hover:bg-gray-600': !isScreenSharing }"
        @click="toggleScreenShare"
      >
        <PhMonitorPlay class="w-5 h-5" />
      </button>

      <!-- Leave Room -->
      <button
        class="control-button bg-red-600 hover:bg-red-700"
        @click="$emit('leave-room')"
      >
        <PhSignOut class="w-5 h-5" />
      </button>

      <!-- Settings -->
      <button
        class="control-button bg-gray-700 hover:bg-gray-600"
        @click="toggleSettings"
      >
        <PhGearSix class="w-5 h-5" />
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
        <PhMonitorPlay class="w-3 h-3 mr-1" />
        <span>Screen Sharing</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
 import { ref, onMounted, onUnmounted } from 'vue'
 import { wsService } from '@/services/websocket'
 import { 
   PhMicrophone, 
   PhMicrophoneSlash, 
   PhHeadphones, 
   PhMonitorPlay, 
   PhSignOut, 
   PhGearSix 
 } from '@phosphor-icons/vue'

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