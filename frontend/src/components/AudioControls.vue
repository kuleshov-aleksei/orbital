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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
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

defineProps<Props>()
const emit = defineEmits<{
  'toggle-mute': []
  'toggle-deafen': []
  'toggle-screen-share': []
  'leave-room': []
}>()

// Local state
const showSettings = ref(false)

// Methods
const toggleMute = () => {
  emit('toggle-mute')
}

const toggleDeafen = () => {
  emit('toggle-deafen')
}

const toggleScreenShare = () => {
  emit('toggle-screen-share')
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