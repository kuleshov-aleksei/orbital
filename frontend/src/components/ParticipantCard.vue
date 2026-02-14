<template>
  <div 
    class="participant-card relative rounded-lg overflow-hidden cursor-pointer transition-all duration-200"
    :class="[
      isScreenSharing && screenShareStream ? 'aspect-video bg-gray-900' : 'p-3 border-2',
      isCurrentUser && !isScreenSharing ? 'bg-indigo-900/30 border-indigo-500' : !isScreenSharing ? 'bg-gray-800 border-gray-600' : ''
    ]"
    @contextmenu="handleContextMenu"
    @click="handleCardClick"
  >
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
      
      <!-- Connection state badge -->
      <div 
        v-if="connectionState && connectionState !== 'connected'"
        class="absolute top-2 right-2 px-2 py-0.5 text-xs rounded-full bg-yellow-500/80 text-white"
      >
        <span v-if="connectionState === 'connecting'">Connecting...</span>

        <span v-else-if="connectionRetryCount > 0">Retry {{ connectionRetryCount }}</span>

        <span v-else>{{ connectionState }}</span>
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

              <span v-else-if="connectionState === 'connected'" class="text-green-400">Connected</span>

              <span v-else-if="connectionState === 'connecting'" class="text-yellow-400">Connecting...</span>

              <span v-else-if="connectionRetryCount > 0" class="text-yellow-400">Reconnecting ({{ connectionRetryCount }})...</span>

              <span v-else class="text-gray-400">{{ connectionState || 'Unknown' }}</span>
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
      
      <!-- Connection Info Indicator -->
      <div
        v-if="connectionDisplay && (connectionState === 'connected' || connectionState === 'answer-received' || connectionState === 'handshake-complete')"
        class="absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center cursor-help"
        :class="{
          'bg-blue-500': connectionDisplay.icon === 'relay',
          'bg-yellow-500': connectionDisplay.icon === 'stun',
          'bg-green-500': connectionDisplay.icon === 'direct',
          'bg-gray-500': connectionDisplay.icon === 'unknown'
        }"
        :title="connectionDisplay.tooltip"
      >
        <PhInfo class="w-3 h-3 text-white" />
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
  PhMonitorPlay,
  PhInfo
} from '@phosphor-icons/vue'
import { useRoomStore } from '@/stores'
import type { ICEConnectionType, ScreenShareQuality } from '@/types'

interface Props {
  userId: string
  userNickname: string
  audioStream: MediaStream | null
  screenShareStream: MediaStream | null
  connectionState?: string
  connectionRetryCount?: number
  initialVolume?: number
  isDeafened?: boolean
  isScreenSharing?: boolean
  screenShareQuality?: ScreenShareQuality
  peerConnection?: RTCPeerConnection
  isCurrentUser?: boolean
  externalAudioLevel?: number
  // Mode control
  forceAudioMode?: boolean // If true, always show audio mode even when screen sharing
}

const props = withDefaults(defineProps<Props>(), {
  connectionState: 'disconnected',
  connectionRetryCount: 0,
  initialVolume: 80,
  isDeafened: false,
  isScreenSharing: false,
  screenShareQuality: '1080p30',
  peerConnection: undefined,
  isCurrentUser: false,
  externalAudioLevel: 0,
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
const menuPosition = { x: 0, y: 0 }
const connectionInfo = ref<ICEConnectionType | null>(null)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const connectionInfoInterval = ref<number | null>(null) // Preserved for future use

// Computed
const audioLevel = computed(() => {
  if (props.isCurrentUser) {
    return props.externalAudioLevel
  }
  return analyzedAudioLevel.value
})

const isSpeaking = computed(() => audioLevel.value > 0.1)

const connectionDisplay = computed(() => {
  if (!connectionInfo.value) {
    return {
      icon: 'unknown',
      label: 'Detecting...',
      tooltip: 'Detecting connection type...'
    }
  }
  
  const info = connectionInfo.value
  let icon = 'direct'
  let label = 'Direct P2P'
  let tooltip = 'Direct peer-to-peer connection'
  
  switch (info.type) {
    case 'relay':
      icon = 'relay'
      label = 'TURN Relay'
      tooltip = `Connected via TURN relay server (${info.relayProtocol?.toUpperCase()})`
      break
    case 'srflx':
      icon = 'stun'
      label = 'STUN (NAT)'
      tooltip = 'Connected via STUN server (traversing NAT)'
      break
    case 'host':
      icon = 'direct'
      label = 'Direct P2P'
      tooltip = 'Direct peer-to-peer connection'
      break
    case 'unknown':
    default:
      icon = 'unknown'
      label = 'Connecting...'
      tooltip = 'Connection type not yet determined'
  }
  
  return { icon, label, tooltip }
})

// Methods
// ICE connection analysis removed - LiveKit handles connections internally
// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
const updateConnectionInfo = async () => {
  // With LiveKit, ICE connections are managed by the SFU
  connectionInfo.value = null
}

// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
const startConnectionInfoPolling = async () => {
  // No-op - LiveKit manages connections internally
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const stopConnectionInfoPolling = () => {
  // No-op - LiveKit manages connections internally
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

// Connection state polling removed - LiveKit manages connections internally
watch(() => props.connectionState, (newState) => {
  if (newState !== 'connected') {
    connectionInfo.value = null
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

  // Connection polling removed - LiveKit manages connections internally

  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  cleanupAudioAnalysis()

  // Connection polling removed - LiveKit manages connections internally

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
</style>
