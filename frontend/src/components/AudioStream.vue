<template>
  <div 
    class="audio-stream relative bg-gray-800 rounded-lg p-3 border border-gray-600"
    @contextmenu="showContextMenu"
  >
    <!-- User Info Header -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center">
        <div class="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold text-white mr-3">
          {{ userNickname.charAt(0).toUpperCase() }}
        </div>

        <div>
          <div class="text-white font-medium">{{ userNickname }}</div>

          <div class="text-xs text-gray-400">
            <span v-if="connectionState === 'connected'" class="text-green-400">Connected</span>

            <span v-else-if="connectionState === 'connecting'" class="text-yellow-400">Connecting...</span>

            <span v-else-if="connectionRetryCount > 0" class="text-yellow-400">Reconnecting ({{ connectionRetryCount }})...</span>

            <span v-else class="text-gray-400">{{ connectionState || 'Unknown' }}</span>
          </div>
        </div>
      </div>
      
      <!-- Audio Controls -->
      <div class="flex items-center space-x-2">
        <!-- Placeholder for future controls -->
      </div>
    </div>

    <!-- Audio Element (Hidden) -->
    <audio
      :id="`audio-${userId}`"
      ref="audioElement"
      :muted="isMuted"
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
          class="bg-green-400 h-full transition-all duration-150 ease-out"
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

    <!-- Screen Sharing Indicator -->
    <div
      v-if="isScreenSharing"
      class="absolute top-2 right-8 w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center"
      :title="'Sharing screen (' + (screenShareQuality || 'unknown') + ')'"
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

    <!-- Muted Indicator -->
    <div
      v-if="isMuted"
      class="absolute top-2 right-2 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center"
      title="Muted"
    >
      <PhMicrophoneSlash class="w-3 h-3 text-white" />
    </div>

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
  import { analyzeICEConnection } from '@/services/webrtc-stats'
  import { useRoomStore } from '@/stores'
  import type { ScreenShareQuality, ICEConnectionType } from '@/types'

   interface Props {
     userId: string
     userNickname: string
     stream: MediaStream | null
     connectionState?: string
     connectionRetryCount?: number
     initialVolume?: number
     isDeafened?: boolean
     isScreenSharing?: boolean
     screenShareQuality?: ScreenShareQuality
     peerConnection?: RTCPeerConnection
   }

   const props = withDefaults(defineProps<Props>(), {
     connectionState: 'disconnected',
     connectionRetryCount: 0,
     initialVolume: 80,
     isDeafened: false,
     isScreenSharing: false,
     screenShareQuality: '1080p30',
     peerConnection: undefined
   })

 const emit = defineEmits<{
  'mute-toggle': [userId: string, isMuted: boolean]
  'audio-level': [userId: string, level: number, isSpeaking: boolean]
 }>()

 // Initialize RoomStore for volume management
 const roomStore = useRoomStore()

 // Reactive state
 const audioElement = useTemplateRef<HTMLAudioElement>('audioElement')
 const volume = computed(() => roomStore.getUserVolume(props.userId))
 const isMuted = ref(false)
 const audioLevel = ref(0)
 const audioContext = ref<AudioContext | null>(null)
 const analyser = ref<AnalyserNode | null>(null)
 const animationId = ref<number | null>(null)
 const showMenu = ref(false)
 const menuPosition = { x: 0, y: 0 }
 const connectionInfo = ref<ICEConnectionType | null>(null)
 const connectionInfoInterval = ref<number | null>(null)

 // Computed properties
 const isSpeaking = computed(() => audioLevel.value > 0.1) // Threshold for speaking detection

 // Connection display info
 const connectionDisplay = computed(() => {
   // If we don't have connection info yet, show connecting state
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

 // Update connection info from peer connection
 const updateConnectionInfo = async () => {
   if (!props.peerConnection || props.connectionState !== 'connected') {
     connectionInfo.value = null
     return
   }
   
   try {
     connectionInfo.value = await analyzeICEConnection(props.peerConnection)
   } catch (error) {
     console.warn('Failed to analyze ICE connection:', error)
   }
 }

 // Start polling for connection info
 const startConnectionInfoPolling = async () => {
   // Update immediately (don't wait for interval)
   await updateConnectionInfo()
   
    // Then poll every 3 seconds
    connectionInfoInterval.value = window.setInterval(() => {
      void updateConnectionInfo()
    }, 3000)
 }

 // Stop polling
 const stopConnectionInfoPolling = () => {
   if (connectionInfoInterval.value) {
     clearInterval(connectionInfoInterval.value)
     connectionInfoInterval.value = null
   }
 }

 // Update volume of audio element
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

 // Context menu functions
 const showContextMenu = (event: MouseEvent) => {
   event.preventDefault()
   event.stopPropagation()
   
   // Store mouse position for fixed positioning
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
     transform: 'translate(0, -100%)' // Position above mouse
   }
 }

 // Toggle mute state
 const toggleMute = () => {
   isMuted.value = !isMuted.value
   if (audioElement.value) {
     audioElement.value.muted = isMuted.value
   }
   emit('mute-toggle', props.userId, isMuted.value)
 }

 // Analyze audio level
 const analyzeAudioLevel = () => {
   if (!analyser.value) return

   const dataArray = new Uint8Array(analyser.value.frequencyBinCount)
   analyser.value.getByteFrequencyData(dataArray)

   // Calculate average volume from frequency data
   let sum = 0
   for (let i = 0; i < dataArray.length; i++) {
     sum += dataArray[i]
   }
   const average = sum / dataArray.length
   const normalizedLevel = average / 255 // Normalize to 0-1

   audioLevel.value = normalizedLevel
 }

  // Animation loop for audio level visualization
  const animate = () => {
    analyzeAudioLevel()
    // Emit audio level data to parent for icon animation
    emit('audio-level', props.userId, audioLevel.value, isSpeaking.value)
    
    // Throttle to ~10fps (100ms intervals) instead of 60fps
    setTimeout(() => {
      animationId.value = requestAnimationFrame(animate)
    }, 100)
  }

 // Setup audio analysis
 const setupAudioAnalysis = () => {
   if (!props.stream || !audioElement.value) return

   try {
     // Create Web Audio API context
     audioContext.value = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
     
     const source = audioContext.value.createMediaStreamSource(props.stream)
     analyser.value = audioContext.value.createAnalyser()
     analyser.value.fftSize = 256
     
     source.connect(analyser.value)
     
     // Start animation loop
     animate()
   } catch (error) {
     console.error('Error setting up audio analysis:', error)
   }
 }

  // Watch for stream changes
  watch(() => props.stream, (newStream) => {
    if (newStream && audioElement.value) {
      console.log(`🎵 Setting stream for user ${props.userId}:`, newStream)
      audioElement.value.srcObject = newStream
      void audioElement.value.play().catch((error: Error) => {
        console.warn(`Audio play failed for user ${props.userId}:`, error)
      })
      setupAudioAnalysis()
    }
  }, { immediate: true })

   // Watch for volume changes from store
   watch(volume, (newVolume) => {
     if (audioElement.value) {
       audioElement.value.volume = newVolume / 100
     }
   })

   // Watch for deafen state changes
   watch(() => props.isDeafened, (newDeafened) => {
     if (audioElement.value) {
       audioElement.value.muted = newDeafened
     }
   })

    // Watch for connection state changes to start/stop polling
    watch(() => props.connectionState, (newState, oldState) => {
      if (newState === 'connected' && oldState !== 'connected') {
        startConnectionInfoPolling()
      } else if (newState !== 'connected') {
        stopConnectionInfoPolling()
        connectionInfo.value = null
      }
    })

    // Close menu on escape key or document click
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

    // Lifecycle hooks
    onMounted(() => {
      nextTick(() => {
        if (audioElement.value) {
          updateVolume()
          // Apply initial deafen state
          if (props.isDeafened) {
            audioElement.value.muted = true
          }
        }
      })

      // Check if already connected when component mounts
      // (handles race condition where connectionState is already 'connected')
      if (props.connectionState === 'connected') {
        startConnectionInfoPolling()
      }

      // Add document event listeners for context menu
      document.addEventListener('keydown', handleKeydown)
      document.addEventListener('click', handleDocumentClick)
    })

   onUnmounted(() => {
     if (animationId.value) {
       cancelAnimationFrame(animationId.value)
     }
     
     if (audioContext.value) {
       audioContext.value.close()
     }

     // Clean up connection info polling
     stopConnectionInfoPolling()

     // Clean up document event listeners
     document.removeEventListener('keydown', handleKeydown)
     document.removeEventListener('click', handleDocumentClick)
   })
</script>

<style scoped>
.audio-stream input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
}

.audio-stream input[type="range"]::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
  border: none;
}
</style>