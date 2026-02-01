<template>
  <div 
    class="screen-stream relative bg-gray-900 rounded-lg overflow-hidden border border-gray-600"
    :class="{ 'border-indigo-500 ring-2 ring-indigo-500/50': isFocused }"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- Video Element -->
    <video
      :id="`screen-${userId}`"
      ref="videoElement"
      class="w-full h-full object-contain bg-black"
      autoplay
      playsinline
      @dblclick="toggleFullscreen"
    />
    
    <!-- User Info Overlay -->
    <div class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <div class="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold text-white mr-2">
            {{ userNickname.charAt(0).toUpperCase() }}
          </div>

          <div>
            <div class="text-white font-medium text-sm">{{ userNickname }}</div>

            <div class="text-xs text-gray-300 flex items-center">
              <PhMonitorPlay class="w-3 h-3 mr-1" />
              {{ qualityLabel }}
            </div>
          </div>
        </div>
        
        <!-- Connection State -->
        <div class="flex items-center text-xs">
          <div 
            class="w-2 h-2 rounded-full mr-1"
            :class="{
              'bg-green-400': connectionState === 'connected',
              'bg-yellow-400': connectionState === 'connecting',
              'bg-red-400': connectionState === 'failed' || connectionState === 'closed',
              'bg-gray-400': !connectionState || connectionState === 'new'
            }"
          />

          <span class="text-gray-300 capitalize">{{ connectionState || 'connecting' }}</span>
        </div>
      </div>
    </div>
    
    <!-- Controls Overlay -->
    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3 opacity-0 hover:opacity-100 transition-opacity duration-200">
      <div class="flex items-center justify-between">
        <!-- Left: Make Focus Button (only when not focused in multi-stream mode) -->
        <div v-if="!isFocused && showFocusButton">
          <button
            type="button"
            class="px-3 py-1.5 bg-gray-700/80 hover:bg-gray-600 rounded-lg text-white text-sm flex items-center transition-colors"
            @click="$emit('make-focused')"
          >
            <PhArrowsOut class="w-4 h-4 mr-1" />
            Focus
          </button>
        </div>

        <div v-else />
        
        <!-- Right: Control Buttons -->
        <div class="flex items-center space-x-2">
          <button
            type="button"
            class="p-2 bg-gray-700/80 hover:bg-gray-600 rounded-lg text-white transition-colors"
            :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
            @click="toggleFullscreen"
          >
            <PhArrowsOut v-if="!isFullscreen" class="w-4 h-4" />

            <PhArrowsIn v-else class="w-4 h-4" />
          </button>
          
          <button
            type="button"
            class="p-2 bg-gray-700/80 hover:bg-gray-600 rounded-lg text-white transition-colors"
            title="Picture in Picture"
            @click="togglePiP"
          >
            <PhPictureInPicture class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
    
    <!-- Loading State -->
    <div v-if="!stream" class="absolute inset-0 flex items-center justify-center bg-gray-900">
      <div class="text-center">
        <PhSpinner class="w-8 h-8 text-indigo-400 animate-spin mx-auto mb-2" />

        <span class="text-gray-400 text-sm">Connecting...</span>
      </div>
    </div>
    
    <!-- Paused State (for self-view when not hovered) -->
    <div v-if="isPausedComputed" class="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-10">
      <div class="text-center">
        <PhPause class="w-12 h-12 text-gray-400 mx-auto mb-3" />

        <span class="text-gray-300 text-lg font-medium">Paused</span>

        <p class="text-gray-500 text-sm mt-1">Hover to view</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from 'vue'
import {
  PhMonitorPlay,
  PhArrowsOut,
  PhArrowsIn,
  PhPictureInPicture,
  PhSpinner,
  PhPause
} from '@phosphor-icons/vue'
import type { ScreenShareQuality } from '@/types'

interface Props {
  userId: string
  userNickname: string
  stream: MediaStream | null
  quality: ScreenShareQuality
  connectionState?: string
  isFocused?: boolean
  showFocusButton?: boolean
  isSelfView?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  connectionState: 'connecting',
  isFocused: false,
  showFocusButton: false,
  isSelfView: false
})

defineEmits<{
  'make-focused': []
}>()

const videoElement = useTemplateRef<HTMLVideoElement>('videoElement')
const isFullscreen = ref(false)
const isPiPActive = ref(false)
const isHovered = ref(false)

// Self-view pauses when not hovered
const isPausedComputed = computed(() => {
  return props.isSelfView && !isHovered.value
})

const handleMouseEnter = () => {
  isHovered.value = true
}

const handleMouseLeave = () => {
  isHovered.value = false
}

const qualityLabels: Record<ScreenShareQuality, string> = {
  'source': 'Source',
  '1080p60': '1080p60',
  '1080p30': '1080p30',
  '720p30': '720p',
  '360p30': '360p',
  'text': 'Text Mode'
}

const qualityLabel = computed(() => qualityLabels[props.quality])

// Watch for stream changes
watch(() => props.stream, (newStream) => {
  if (newStream && videoElement.value) {
    videoElement.value.srcObject = newStream
    videoElement.value.play().catch(error => {
      console.warn(`Screen video play failed for user ${props.userId}:`, error)
    })
  }
}, { immediate: true })

// Actually pause/resume video for self-view
watch(isPausedComputed, (isPaused) => {
  if (!videoElement.value || !props.isSelfView) return
  
  if (isPaused) {
    videoElement.value.pause()
    console.log(`⏸️ Self-view paused for ${props.userId}`)
  } else {
    videoElement.value.play().catch(error => {
      console.warn(`Failed to resume self-view for ${props.userId}:`, error)
    })
    console.log(`▶️ Self-view resumed for ${props.userId}`)
  }
})

const toggleFullscreen = async () => {
  if (!videoElement.value) return
  
  try {
    if (!document.fullscreenElement) {
      await videoElement.value.requestFullscreen()
      isFullscreen.value = true
    } else {
      await document.exitFullscreen()
      isFullscreen.value = false
    }
  } catch (error) {
    console.error('Fullscreen error:', error)
  }
}

const togglePiP = async () => {
  if (!videoElement.value) return
  
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture()
      isPiPActive.value = false
    } else {
      await videoElement.value.requestPictureInPicture()
      isPiPActive.value = true
    }
  } catch (error) {
    console.error('Picture-in-Picture error:', error)
  }
}

// Handle fullscreen change events
const handleFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement
}

const handlePiPChange = () => {
  isPiPActive.value = !!document.pictureInPictureElement
}

onMounted(() => {
  // Re-attach stream when component mounts (handles view switching)
  if (props.stream && videoElement.value) {
    videoElement.value.srcObject = props.stream
    videoElement.value.play().catch(error => {
      console.warn(`Screen video play failed for user ${props.userId}:`, error)
    })
  }
  
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
  videoElement.value?.addEventListener('enterpictureinpicture', handlePiPChange)
  videoElement.value?.addEventListener('leavepictureinpicture', handlePiPChange)
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
  videoElement.value?.removeEventListener('enterpictureinpicture', handlePiPChange)
  videoElement.value?.removeEventListener('leavepictureinpicture', handlePiPChange)
  
  // Clean up PiP if active
  if (document.pictureInPictureElement === videoElement.value) {
    document.exitPictureInPicture().catch(() => {})
  }
})
</script>

<style scoped>
.screen-stream {
  aspect-ratio: 16/9;
}
</style>
