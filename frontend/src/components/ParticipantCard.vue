<template>
  <div 
    class="participant-card overflow-visible relative rounded-lg cursor-pointer transition-all duration-200"
    :class="[
      isScreenSharing && screenShareStream ? 'aspect-video bg-gray-900' : 'p-3 border-2',
      isCurrentUser && !isScreenSharing ? 'bg-indigo-900/30 border-indigo-500' : !isScreenSharing ? 'bg-gray-800 border-gray-600' : ''
    ]"
    @contextmenu="handleContextMenu"
    @click="handleCardClick"
    @mouseenter="showStats = true"
    @mouseleave="showStats = false"
  >
    <!-- Stats Tooltip -->
    <Transition name="fade">
      <div
        v-if="showStats && hasStats"
        class="absolute z-50 bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg p-3 min-w-44 shadow-xl"
      >
        <div class="text-xs font-medium text-gray-300 mb-2 border-b border-gray-700 pb-1">
          Connection Stats
        </div>

        <div class="space-y-1">
          <div class="flex justify-between text-xs">
            <span class="text-gray-400">Ping:</span>

            <span class="text-green-400">{{ formatNumber(stats.ping) }}ms</span>
          </div>

          <div class="flex justify-between text-xs">
            <span class="text-gray-400">Jitter:</span>

            <span class="text-blue-400">{{ formatNumber(stats.jitter) }}ms</span>
          </div>

          <div class="flex justify-between text-xs">
            <span class="text-gray-400">Packet Loss:</span>

            <span :class="getPacketLossClass(stats.packetLoss)">{{ formatNumber(stats.packetLoss) }}%</span>
          </div>

          <div class="flex justify-between text-xs">
            <span class="text-gray-400">Bitrate:</span>

            <span class="text-purple-400">{{ formatBitrate(stats.bitrate) }}</span>
          </div>

          <div class="flex justify-between text-xs">
            <span class="text-gray-400">Kind:</span>

            <span class="text-purple-400">{{ stats.kind }}</span>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Screen Share Mode: Video Preview with floating info -->
    <template v-if="isScreenSharing && screenShareStream">
      <video
        ref="videoElement"
        class="w-full h-full object-contain bg-gray-900"
        autoplay
        playsinline
        muted
        @loadedmetadata="onVideoLoaded"
      />
      
      <!-- Floating nickname overlay -->
      <div class="absolute top-2 left-2 right-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div 
            class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
            :class="isCurrentUser ? 'bg-indigo-500' : 'bg-indigo-600'"
          >
            {{ userNickname.charAt(0).toUpperCase() }}
          </div>

          <span class="text-white text-sm font-medium bg-black/50 px-2 py-0.5 rounded">
            {{ userNickname }}
            <span v-if="isCurrentUser" class="text-indigo-300 text-xs ml-1">(You)</span>
          </span>
        </div>
      </div>
      
      <!-- Audio level indicator overlay -->
      <div class="absolute bottom-2 left-2 right-2">
        <div class="flex items-center gap-2">
          <div class="flex-1 bg-black/50 rounded-full h-1.5 overflow-hidden">
            <div
              class="bg-green-400 h-full"
              :style="{ width: (audioLevel * 100) + '%' }"
            />
          </div>
          <!-- Speaking indicator -->
          <div
            v-if="isSpeaking"
            class="w-2 h-2 bg-green-400 rounded-full animate-pulse"
            title="Speaking"
          />
        </div>
      </div>
      
      <!-- Screen sharing badge -->
      <div class="absolute bottom-2 right-2 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
        <PhMonitorPlay class="w-3 h-3 text-white" />
      </div>
    </template>
    
    <!-- Audio Mode: User info with audio visualization -->
    <template v-else>
      <!-- User Info Header -->
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center">
          <div 
            class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white mr-3"
            :class="isCurrentUser ? 'bg-indigo-500' : 'bg-indigo-600'"
          >
            {{ userNickname.charAt(0).toUpperCase() }}
          </div>
          
          <div>
            <div class="text-white font-medium flex items-center gap-2">
              {{ userNickname }}
            </div>
            
            <div class="text-xs text-gray-400">
              <span 
                v-if="isCurrentUser" 
                class="text-xs px-2 py-0.5 bg-indigo-500 text-white rounded-full"
              >
                You
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Audio Element (Hidden) -->
      <audio
        :id="`audio-${userId}`"
        ref="audioElement"
        :muted="isMuted || isDeafened"
        autoplay
        playsinline
        class="hidden"
      />
      
      <!-- Audio Level Visualization -->
      <div class="mt-3">
        <div class="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>Audio Level</span>

          <span>{{ Math.round(audioLevel * 100) }}%</span>
        </div>
        
        <div class="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            class="bg-green-400 h-full"
            :style="{ width: (audioLevel * 100) + '%' }"
          />
        </div>
      </div>
      
      <!-- Speaking Indicator -->
      <div
        v-if="isSpeaking"
        class="absolute top-2 right-2 w-3 h-3 bg-green-400 rounded-full animate-pulse"
        title="Speaking"
      />
      
      <!-- Screen Sharing Indicator (when not actively showing screen) -->
      <div
        v-if="isScreenSharing"
        class="absolute top-2 right-8 w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center"
        :title="'Sharing screen'"
      >
        <PhMonitorPlay class="w-3 h-3 text-white" />
      </div>
    </template>
    
    <!-- Context Menu -->
    <div
      v-if="showMenu"
      class="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-50 py-2 min-w-48"
      :style="getMenuPosition()"
      @click.stop
    >
      <div class="px-3 py-2 text-sm text-gray-300 border-b border-gray-600">
        {{ userNickname }}
      </div>
      
      <!-- Mute/Unmute User -->
      <button
        type="button"
        class="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center space-x-2"
        @click="toggleMute(); hideContextMenu()"
      >
        <PhMicrophoneSlash v-if="isMuted" class="w-4 h-4" />

        <PhMicrophone v-else class="w-4 h-4" />

        <span>{{ isMuted ? 'Unmute User' : 'Mute User' }}</span>
      </button>
      
      <div class="border-t border-gray-600 my-1"></div>
      
      <!-- Volume Control -->
      <div class="px-3 py-2">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm text-gray-300">Volume</span>

          <span class="text-xs text-gray-400">{{ Math.round(volume) }}%</span>
        </div>
        
        <div class="flex items-center space-x-2">
          <PhSpeakerHigh class="w-4 h-4 text-gray-400" />

          <input
            :value="volume"
            type="range"
            min="0"
            max="100"
            class="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            @input="handleVolumeInput"
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
import { ref, computed, onMounted, onUnmounted, watch, nextTick, useTemplateRef } from 'vue'
import {
  PhMicrophone,
  PhMicrophoneSlash,
  PhSpeakerHigh,
  PhMonitorPlay
} from '@phosphor-icons/vue'
import { useRoomStore } from '@/stores'
import type { ScreenShareQuality, ConnectionStats } from '@/types'

interface Props {
  userId: string
  userNickname: string
  audioStream: MediaStream | null
  screenShareStream: MediaStream | null
  initialVolume?: number
  isDeafened?: boolean
  isScreenSharing?: boolean
  screenShareQuality?: ScreenShareQuality
  isCurrentUser?: boolean
  externalAudioLevel?: number
  stats?: ConnectionStats
  // Mode control
  forceAudioMode?: boolean // If true, always show audio mode even when screen sharing
}

const props = withDefaults(defineProps<Props>(), {
  initialVolume: 80,
  isDeafened: false,
  isScreenSharing: false,
  screenShareQuality: '1080p30',
  isCurrentUser: false,
  externalAudioLevel: 0,
  stats: () => ({ ping: 0, jitter: 0, packetLoss: 0, bitrate: 0 }),
  forceAudioMode: false
})

const emit = defineEmits<{
  'mute-toggle': [userId: string, isMuted: boolean]
  'audio-level': [userId: string, level: number, isSpeaking: boolean]
  'card-click': [userId: string]
}>()

// Store
const roomStore = useRoomStore()

// Refs
const audioElement = useTemplateRef<HTMLAudioElement>('audioElement')
const videoElement = useTemplateRef<HTMLVideoElement>('videoElement')

// State
const volume = computed(() => roomStore.getUserVolume(props.userId))
const isMuted = ref(false)
const analyzedAudioLevel = ref(0)
const audioContext = ref<AudioContext | null>(null)
const analyser = ref<AnalyserNode | null>(null)
const analysisIntervalId = ref<number | null>(null)
const showMenu = ref(false)
const showStats = ref(false)
const menuPosition = { x: 0, y: 0 }

// Computed
const audioLevel = computed(() => {
  if (props.isCurrentUser) {
    return props.externalAudioLevel
  }
  return analyzedAudioLevel.value
})

const isSpeaking = computed(() => audioLevel.value > 0.1)

const hasStats = computed(() => {
  const s = props.stats
  return s && (s.ping > 0 || s.jitter > 0 || s.packetLoss > 0 || s.bitrate > 0)
})

// Methods
const formatNumber = (value: number): string => {
  if (value === 0) return '–'
  return value.toFixed(1)
}

const formatBitrate = (value: number): string => {
  if (value === 0) return '–'
  if (value < 1000) return `${value.toFixed(0)} bps`
  if (value < 1000000) return `${(value / 1000).toFixed(1)} kbps`
  return `${(value / 1000000).toFixed(2)} mbps`
}

const getPacketLossClass = (value: number): string => {
  if (value === 0) return 'text-green-400'
  if (value < 1) return 'text-yellow-400'
  return 'text-red-400'
}

const updateVolume = (newVolume: number) => {
  roomStore.setUserVolume(props.userId, newVolume)
  if (audioElement.value) {
    audioElement.value.volume = newVolume / 100
  }
}

const handleVolumeInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  const newVolume = parseInt(target.value)
  updateVolume(newVolume)
}

const handleContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  menuPosition.x = event.clientX
  menuPosition.y = event.clientY
  showMenu.value = true
}

const hideContextMenu = () => {
  showMenu.value = false
}

const getMenuPosition = () => {
  return {
    left: `${menuPosition.x}px`,
    top: `${menuPosition.y}px`,
    transform: 'translate(0, -100%)'
  }
}

const handleCardClick = () => {
  emit('card-click', props.userId)
}

const onVideoLoaded = () => {
  console.log(`✅ Video loaded for user ${props.userId}`)
}

const setupVideoStream = () => {
  if (props.screenShareStream && videoElement.value) {
    console.log(`🖥️ Setting up screen share stream for user ${props.userId}`)
    const video = videoElement.value
    const stream = props.screenShareStream
    
    // Check if stream has video tracks and they're active
    const videoTracks = stream.getVideoTracks()
    if (videoTracks.length === 0 || !videoTracks[0].enabled) {
      console.warn(`No active video tracks in stream for user ${props.userId}`)
      return
    }
    
    // Set the stream
    video.srcObject = stream
    
    // Wait for metadata to load before playing
    // This ensures the browser is ready to play the stream
    const attemptPlay = () => {
      video.play().catch((error) => {
        // Only log if it's not an abort error (which is normal during rapid changes)
        if (error.name !== 'AbortError') {
          console.warn(`Screen share video play failed for user ${props.userId}:`, error)
        }
      })
    }
    
    if (video.readyState >= 1) { // HAVE_METADATA or higher
      // Metadata already loaded, play immediately
      attemptPlay()
    } else {
      // Wait for metadata to load
      video.addEventListener('loadedmetadata', attemptPlay, { once: true })
    }
  }
}

const toggleMute = () => {
  isMuted.value = !isMuted.value
  if (audioElement.value) {
    audioElement.value.muted = isMuted.value
  }
  emit('mute-toggle', props.userId, isMuted.value)
}

const setupAudioAnalysis = () => {
  if (!props.audioStream || !audioElement.value) return
  
  // Clean up any existing analysis first
  cleanupAudioAnalysis()
  
  try {
    audioContext.value = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const source = audioContext.value.createMediaStreamSource(props.audioStream)
    analyser.value = audioContext.value.createAnalyser()
    analyser.value.fftSize = 256
    
    source.connect(analyser.value)
    
    // Use setInterval instead of RAF for 10fps updates (100ms)
    analysisIntervalId.value = window.setInterval(() => {
      if (!analyser.value) return
      
      const dataArray = new Uint8Array(analyser.value.frequencyBinCount)
      analyser.value.getByteFrequencyData(dataArray)
      
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]
      }
      const average = sum / dataArray.length
      analyzedAudioLevel.value = average / 255
      
      emit('audio-level', props.userId, audioLevel.value, isSpeaking.value)
    }, 100)
  } catch (error) {
    console.error('Error setting up audio analysis:', error)
  }
}

const cleanupAudioAnalysis = () => {
  if (analysisIntervalId.value) {
    clearInterval(analysisIntervalId.value)
    analysisIntervalId.value = null
  }
  
  if (analyser.value) {
    try {
      analyser.value.disconnect()
    } catch {
      // Ignore
    }
    analyser.value = null
  }
  
  if (audioContext.value) {
    void audioContext.value.close()
    audioContext.value = null
  }
  
  analyzedAudioLevel.value = 0
}

// Watchers
watch(() => props.audioStream, (newStream, oldStream) => {
  if (newStream && audioElement.value) {
    console.log(`🎵 Setting audio stream for user ${props.userId}`)
    audioElement.value.srcObject = newStream
    void audioElement.value.play().catch((error: Error) => {
      console.warn(`Audio play failed for user ${props.userId}:`, error)
    })
    setupAudioAnalysis()
  } else if (!newStream && oldStream) {
    // Stream was removed, cleanup analysis
    cleanupAudioAnalysis()
  }
}, { immediate: true })

watch(() => props.screenShareStream, (newStream, oldStream) => {
  if (newStream && newStream !== oldStream) {
    // Small delay to ensure DOM is updated and stream is ready
    setTimeout(() => {
      void nextTick(() => {
        setupVideoStream()
      })
    }, 100)
  }
}, { immediate: true })

watch(volume, (newVolume) => {
  if (audioElement.value) {
    audioElement.value.volume = newVolume / 100
  }
})

watch(() => props.isDeafened, (newDeafened) => {
  if (audioElement.value) {
    audioElement.value.muted = newDeafened || isMuted.value
  }
})

// Event handlers
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    hideContextMenu()
  }
}

const handleDocumentClick = () => {
  if (showMenu.value) {
    hideContextMenu()
  }
}

// Lifecycle
onMounted(() => {
  void nextTick(() => {
    if (audioElement.value) {
      updateVolume(volume.value)
      if (props.isDeafened) {
        audioElement.value.muted = true
      }
    }
    // Setup video stream after mount with a small delay to ensure stream is ready
    setTimeout(() => {
      setupVideoStream()
    }, 50)
  })

  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  cleanupAudioAnalysis()

  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<style scoped>
.participant-card {
  min-height: 100px;
}

.participant-card input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
}

.participant-card input[type="range"]::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
  border: none;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
