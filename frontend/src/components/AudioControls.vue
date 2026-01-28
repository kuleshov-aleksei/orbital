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
          <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
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
        <svg v-if="isDeafened" class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clip-rule="evenodd" />
        </svg>
        <svg v-else class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
          <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
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
import { ref } from 'vue'

// Audio control state
const isMuted = ref(false)
const isDeafened = ref(false)
const isScreenSharing = ref(false)
const showSettings = ref(false)

// Connection info
const ping = ref(42)
const connectionQuality = ref('Excellent')

// Methods
const toggleMute = () => {
  isMuted.value = !isMuted.value
  if (isMuted.value) {
    console.log('Microphone muted')
  } else {
    console.log('Microphone unmuted')
    isDeafened.value = false
  }
}

const toggleDeafen = () => {
  isDeafened.value = !isDeafened.value
  if (isDeafened.value) {
    console.log('Deafened')
    isMuted.value = true
  } else {
    console.log('Undeafened')
  }
}

const toggleScreenShare = () => {
  isScreenSharing.value = !isScreenSharing.value
  if (isScreenSharing.value) {
    console.log('Screen sharing started')
  } else {
    console.log('Screen sharing stopped')
  }
}

const toggleSettings = () => {
  showSettings.value = !showSettings.value
  console.log('Settings toggled')
}
</script>

<style scoped>
.control-button {
  @apply w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-200;
}
</style>