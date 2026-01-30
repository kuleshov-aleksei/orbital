<template>
  <div 
    class="user-card flex items-center px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors duration-200 cursor-pointer group relative" 
    :data-testid="`user-card-${user.id}`"
    @contextmenu="showContextMenu"
  >
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
        <span v-else-if="user.isDeafened" class="text-red-400">Deafened</span>
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

    <!-- Context Menu -->
    <div 
      v-if="showMenu"
      class="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-[9999] py-2 min-w-48"
      :style="getMenuPosition()"
      @click.stop
    >
      <div class="px-3 py-2 text-sm text-gray-300 border-b border-gray-600">
        {{ user.nickname }}
      </div>
      
      <!-- Volume Control -->
      <div class="px-3 py-2">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm text-gray-300">Volume</span>
          <span class="text-xs text-gray-400">{{ Math.round(volume) }}%</span>
        </div>
        <div class="flex items-center space-x-2">
          <PhSpeakerHigh class="w-4 h-4 text-gray-400" />
          <input
            v-model="volume"
            type="range"
            min="0"
            max="100"
            class="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            @input="handleVolumeChange"
          />
        </div>
      </div>
    </div>

    <!-- Click outside to close menu -->
    <div 
      v-if="showMenu"
      class="fixed inset-0 z-40"
      @click="hideContextMenu"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { PhMicrophoneSlash, PhSpeakerHigh } from '@phosphor-icons/vue'

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
  initialVolume?: number
}

const props = withDefaults(defineProps<Props>(), {
  initialVolume: 80
})

const emit = defineEmits<{
  'volume-change': [userId: string, volume: number]
}>()

const showMenu = ref(false)
const volume = ref(props.initialVolume)
let menuPosition = { x: 0, y: 0 }

const statusColors = {
  online: 'bg-green-400',
  away: 'bg-yellow-400',
  dnd: 'bg-red-400'
}

const showContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  
  // Store mouse position for fixed positioning
  menuPosition.x = event.clientX
  menuPosition.y = event.clientY
  
  showMenu.value = true
}

const getMenuPosition = () => {
  return {
    left: `${menuPosition.x}px`,
    top: `${menuPosition.y}px`,
    transform: 'translate(0, -100%)' // Position above mouse
  }
}

const hideContextMenu = () => {
  showMenu.value = false
}

const handleVolumeChange = () => {
  emit('volume-change', props.user.id, volume.value)
}

// Close menu on escape key or document click
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    hideContextMenu()
  }
}

const handleDocumentClick = (event: MouseEvent) => {
  if (showMenu.value) {
    hideContextMenu()
  }
}



onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<style scoped>
.user-card input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
}

.user-card input[type="range"]::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
  border: none;
}
</style>