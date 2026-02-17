<template>
  <div
    ref="cardElement"
    class="participant-card overflow-visible relative rounded-lg cursor-pointer transition-all duration-200 border-2"
    :class="[
      isScreenSharing && screenShareStream && !forceAudioMode
        ? 'aspect-video bg-gray-900'
        : 'aspect-square',
      isCurrentUser && (!isScreenSharing || forceAudioMode)
        ? 'bg-indigo-900/30 border-indigo-500'
        : !isScreenSharing || forceAudioMode
          ? 'bg-gray-800 border-gray-600'
          : '',
      isSpeaking && (!isScreenSharing || forceAudioMode)
        ? 'border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]'
        : '',
    ]"
    @contextmenu="handleContextMenu"
    @click="handleCardClick"
    @mouseenter="handleMouseEnter"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave">
    <!-- Stats Tooltip -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showStats && hasStats && !showMenu"
          ref="tooltipElement"
          class="fixed z-[9999] bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg p-3 w-52 shadow-xl pointer-events-none"
          :style="tooltipStyle">
          <div class="text-xs font-medium text-gray-300 mb-2 border-b border-gray-700 pb-1">
            Connection Stats
          </div>

          <div class="space-y-2">
            <!-- Ping (always shown) -->
            <div class="flex justify-between text-xs">
              <span class="text-gray-400">Ping:</span>

              <span class="text-green-400">{{ formatNumber(stats.ping) }}ms</span>
            </div>

            <!-- Audio Stats -->
            <template v-if="stats.audio">
              <div class="text-xs font-medium text-gray-400 mt-2 pt-1 border-t border-gray-700/50">
                Audio
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Jitter:</span>

                <span class="text-blue-400">{{ formatNumber(stats.audio.jitter) }}ms</span>
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Packet Loss:</span>

                <span :class="getPacketLossClass(stats.audio.packetLoss)">
                  {{ formatNumber(stats.audio.packetLoss) }}%
                </span>
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Bitrate:</span>

                <span class="text-purple-400">{{ formatBitrate(stats.audio.bitrate) }}</span>
              </div>
            </template>

            <!-- Video Stats -->
            <template v-if="stats.video">
              <div class="text-xs font-medium text-gray-400 mt-2 pt-1 border-t border-gray-700/50">
                Video
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Jitter:</span>

                <span class="text-blue-400">{{ formatNumber(stats.video.jitter) }}ms</span>
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Packet Loss:</span>

                <span :class="getPacketLossClass(stats.video.packetLoss)">
                  {{ formatNumber(stats.video.packetLoss) }}%
                </span>
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Bitrate:</span>

                <span class="text-purple-400">{{ formatBitrate(stats.video.bitrate) }}</span>
              </div>
            </template>

            <!-- Screen Share Stats -->
            <template v-if="stats.screenShare">
              <div class="text-xs font-medium text-indigo-300 mt-2 pt-1 border-t border-indigo-700/50">
                Screen Share
              </div>

              <!-- Resolution -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Resolution:</span>

                <span class="text-indigo-400">{{ stats.screenShare.resolution || "–" }}</span>
              </div>

              <!-- Frame Rate -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Frame Rate:</span>

                <span class="text-indigo-400"
                  >{{ formatNumber(stats.screenShare.fps || 0) }} fps</span
                >
              </div>

              <!-- Codec -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Codec:</span>

                <span class="text-indigo-400">{{ stats.screenShare.codec || "–" }}</span>
              </div>

              <!-- Jitter -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Jitter:</span>

                <span class="text-blue-400">{{ formatNumber(stats.screenShare.jitter) }}ms</span>
              </div>

              <!-- Packet Loss -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Packet Loss:</span>

                <span :class="getPacketLossClass(stats.screenShare.packetLoss)">
                  {{ formatNumber(stats.screenShare.packetLoss) }}%
                </span>
              </div>

              <!-- Bitrate -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Bitrate:</span>

                <span class="text-purple-400">{{ formatBitrate(stats.screenShare.bitrate) }}</span>
              </div>

              <!-- Frames -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Frames:</span>

                <span class="text-green-400">
                  {{ stats.screenShare.framesDecoded || 0 }}
                  <span class="text-gray-500">/</span>

                  <span
                    :class="
                      stats.screenShare.framesDropped && stats.screenShare.framesDropped > 0
                        ? 'text-red-400'
                        : 'text-green-400'
                    ">
                    {{ stats.screenShare.framesDropped || 0 }}
                  </span>
                </span>
              </div>

              <!-- Quality Limitation (only show if present and not "none") -->
              <div
                v-if="
                  stats.screenShare.qualityLimitationReason &&
                  stats.screenShare.qualityLimitationReason !== 'none'
                "
                class="flex justify-between text-xs">
                <span class="text-gray-500">Quality:</span>

                <span class="text-yellow-400">{{ stats.screenShare.qualityLimitationReason }}</span>
              </div>

              <!-- NACK/PLI/FIR Counts (only show if any are present) -->
              <div
                v-if="
                  stats.screenShare.nackCount ||
                  stats.screenShare.pliCount ||
                  stats.screenShare.firCount
                "
                class="flex justify-between text-xs">
                <span class="text-gray-500">Recovery:</span>

                <span class="text-orange-400">
                  N:{{ stats.screenShare.nackCount || 0 }} P:{{
                    stats.screenShare.pliCount || 0
                  }}
                  F:{{ stats.screenShare.firCount || 0 }}
                </span>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Video Mode: Only when BOTH Screen Share AND Camera are active -->
    <!-- Shows the OPPOSITE stream of what's in the main view. Click to toggle. -->
    <template v-if="isScreenSharing && screenShareStream && isCameraEnabled && cameraStream && !forceAudioMode">
      <!-- Show the stream that's NOT in the main view -->
      <div class="relative w-full h-full">
        <!-- Both videos are always mounted (v-show) to keep streams running -->
        <!-- Show Screen Share in ParticipantCard when Camera is in main view -->
        <video
          v-show="showCameraAsMain"
          ref="screenVideoElement"
          class="absolute inset-0 w-full h-full object-contain bg-gray-900 rounded-lg pointer-events-none"
          autoplay
          playsinline
          muted
          @loadedmetadata="onScreenVideoLoaded" />

        <!-- Show Camera in ParticipantCard when Screen Share is in main view -->
        <video
          v-show="!showCameraAsMain"
          ref="cameraVideoElement"
          class="absolute inset-0 w-full h-full object-cover bg-gray-900 rounded-lg pointer-events-none"
          autoplay
          playsinline
          muted
          @loadedmetadata="onCameraVideoLoaded" />

        <!-- Toggle hint overlay (Screen) -->
        <div v-show="showCameraAsMain" class="absolute bottom-2 right-2 bg-indigo-600/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-white flex items-center gap-1 z-10 pointer-events-none">
          <PhMonitorPlay class="w-3 h-3" />

          <span>Screen</span>

          <span class="text-indigo-200 ml-1">(click to swap)</span>
        </div>

        <!-- Toggle hint overlay (Camera) -->
        <div v-show="!showCameraAsMain" class="absolute bottom-2 right-2 bg-purple-600/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-white flex items-center gap-1 z-10 pointer-events-none">
          <PhCamera class="w-3 h-3" />

          <span>Camera</span>

          <span class="text-purple-200 ml-1">(click to swap)</span>
        </div>

        <!-- Floating nickname overlay -->
        <div class="absolute top-2 left-2 right-2 flex items-center justify-between z-10">
          <div class="flex items-center gap-2">
            <UserAvatar :user-id="userId" :nickname="userNickname" :size="24" :show-status="false" />

            <span class="text-white text-sm font-medium bg-gray-900/70 px-3 py-1 rounded-lg max-w-[140px] truncate">
              {{ userNickname.length > 12 ? userNickname.slice(0, 12) + "..." : userNickname }}
            </span>
          </div>

          <!-- Stream Type Indicator (showing what's in main view) -->
          <div class="flex items-center gap-2">
            <div
              v-if="!showCameraAsMain"
              class="bg-indigo-600/80 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
              <PhMonitorPlay class="w-3 h-3" />

              <span>Screen</span>
            </div>

            <div
              v-else
              class="bg-purple-600/80 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
              <PhCamera class="w-3 h-3" />

              <span>Camera</span>
            </div>
          </div>
        </div>

        <!-- Speaking indicator overlay -->
        <div
          v-if="isSpeaking"
          class="absolute bottom-2 left-2 w-3 h-3 bg-green-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]"
          title="Speaking" />
      </div>
    </template>

    <!-- Audio Mode: Avatar centered with nickname at bottom -->
    <template v-else>
      <!-- Avatar centered in card -->
      <div class="absolute inset-0 flex items-center justify-center">
        <UserAvatar :user-id="userId" :nickname="userNickname" :size="48" :show-status="false" />
      </div>

      <!-- Nickname at bottom center -->
      <div class="absolute bottom-2 left-0 right-0 flex justify-center items-center">
        <span class="text-white font-medium text-sm bg-gray-900/70 px-3 py-1 rounded-lg max-w-[160px] truncate">
          {{ userNickname.length > 12 ? userNickname.slice(0, 12) + "..." : userNickname }}
        </span>
      </div>

      <!-- Audio Element (Hidden) -->
      <audio
        :id="`audio-${userId}`"
        ref="audioElement"
        :muted="isMuted || isDeafened"
        autoplay
        playsinline
        class="hidden" />

      <!-- Speaking Indicator -->
      <div
        v-if="isSpeaking"
        class="absolute top-2 right-2 w-3 h-3 bg-green-400 rounded-full animate-pulse"
        title="Speaking" />

      <!-- Stream Indicators -->
      <div class="absolute top-2 left-2 flex gap-1">
        <div
          v-if="isScreenSharing"
          class="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center"
          :title="'Sharing screen'">
          <PhMonitorPlay class="w-3 h-3 text-white" />
        </div>

        <div
          v-if="isCameraEnabled"
          class="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center"
          :title="'Camera enabled'">
          <PhCamera class="w-3 h-3 text-white" />
        </div>
      </div>
    </template>

    <!-- Context Menu -->
    <div
      v-if="showMenu"
      class="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-50 py-2 min-w-48"
      :style="getMenuPosition()"
      @click.stop>
      <div class="px-3 py-2 text-sm text-gray-300 border-b border-gray-600">
        {{ userNickname }}
      </div>

      <!-- Mute/Unmute User -->
      <button
        type="button"
        class="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center space-x-2"
        @click="handleMuteToggle">
        <PhMicrophoneSlash v-if="isMuted" class="w-4 h-4" />

        <PhMicrophone v-else class="w-4 h-4" />

        <span>{{ isMuted ? "Unmute User" : "Mute User" }}</span>
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
            @input="handleVolumeInput" />
        </div>
      </div>
    </div>

    <!-- Click outside to close menu -->
    <div v-if="showMenu" class="fixed inset-0 z-40" @click="hideContextMenu"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, useTemplateRef } from "vue"
import { PhMicrophone, PhMicrophoneSlash, PhSpeakerHigh, PhMonitorPlay, PhCamera } from "@phosphor-icons/vue"
import { useRoomStore, usePresenceStore } from "@/stores"
import UserAvatar from "@/components/UserAvatar.vue"
import type { ScreenShareQuality, ConnectionStats } from "@/types"

interface Props {
  userId: string
  userNickname: string
  audioStream: MediaStream | null
  screenShareStream: MediaStream | null
  cameraStream?: MediaStream | null // Camera video stream
  initialVolume?: number
  isDeafened?: boolean
  isScreenSharing?: boolean
  isCameraEnabled?: boolean
  screenShareQuality?: ScreenShareQuality
  isCurrentUser?: boolean
  externalAudioLevel?: number
  stats?: ConnectionStats
  // Mode control
  forceAudioMode?: boolean // If true, always show audio mode even when screen sharing
  isViewing?: boolean // If true, show "Viewing" overlay instead of video (stream is shown in main area)
  isCompact?: boolean // If true, show compact layout for sidebar
}

const props = withDefaults(defineProps<Props>(), {
  cameraStream: null,
  initialVolume: 80,
  isDeafened: false,
  isScreenSharing: false,
  isCameraEnabled: false,
  screenShareQuality: "1080p30",
  isCurrentUser: false,
  externalAudioLevel: 0,
  stats: () => ({
    ping: 0,
  }),
  forceAudioMode: false,
  isViewing: false,
  isCompact: false,
  // Sync state with parent for stream toggle
  modelValueShowCameraAsMain: false,
})

const emit = defineEmits<{
  "mute-toggle": [userId: string, isMuted: boolean]
  "card-click": [userId: string]
  "update:modelValueShowCameraAsMain": [value: boolean]
}>()

// Store
const roomStore = useRoomStore()
const presenceStore = usePresenceStore()

// Refs
const audioElement = useTemplateRef<HTMLAudioElement>("audioElement")
const screenVideoElement = useTemplateRef<HTMLVideoElement>("screenVideoElement")
const cameraVideoElement = useTemplateRef<HTMLVideoElement>("cameraVideoElement")
const cardElement = useTemplateRef<HTMLDivElement>("cardElement")
const tooltipElement = useTemplateRef<HTMLDivElement>("tooltipElement")

// State
const volume = computed(() => roomStore.getUserVolume(props.userId))
const isMuted = ref(false)
const showMenu = ref(false)
const showStats = ref(false)
const menuPosition = { x: 0, y: 0 }
const mousePosition = ref({ x: 0, y: 0 })
const tooltipOffset = { x: 16, y: 16 }

// Camera/Screen share toggle state - synced with parent via v-model
// showCameraAsMain = true means camera is main, screen share is in ParticipantCard
// showCameraAsMain = false means screen share is main, camera is in ParticipantCard
const showCameraAsMain = computed({
  get: () => {
    console.log(`[ParticipantCard] Getting showCameraAsMain for ${props.userId}: ${props.modelValueShowCameraAsMain}`)
    return props.modelValueShowCameraAsMain
  },
  set: (value) => {
    console.log(`[ParticipantCard] Setting showCameraAsMain for ${props.userId} to ${value}`)
    emit("update:modelValueShowCameraAsMain", value)
  },
})

// Suggest initial state to parent when streams become available
const hasInitialized = ref(false)
watch([() => props.isScreenSharing, () => props.isCameraEnabled], ([hasScreen, hasCamera], [prevHasScreen, prevHasCamera]) => {
  if (!hasInitialized.value) {
    // First initialization: if only camera is available, suggest showing it as main
    if (hasCamera && !hasScreen && !props.modelValueShowCameraAsMain) {
      emit("update:modelValueShowCameraAsMain", true)
    }
    hasInitialized.value = true
    return
  }
  
  // When camera becomes available while screen share is already active, suggest screen share as main
  if (hasCamera && !prevHasCamera && hasScreen && props.modelValueShowCameraAsMain) {
    emit("update:modelValueShowCameraAsMain", false)
  }
  // When screen share becomes available while camera is already active, suggest camera as main
  if (hasScreen && !prevHasScreen && hasCamera && !props.modelValueShowCameraAsMain) {
    emit("update:modelValueShowCameraAsMain", true)
  }
}, { immediate: true })

// Computed
const isSpeaking = computed(() => {
  if (props.isCurrentUser) {
    return props.externalAudioLevel > 0.1
  }
  // Use LiveKit's built-in isSpeaking flag from presence store (more reliable than checking audioLevel)
  return presenceStore.getParticipant(props.userId)?.isSpeaking ?? false
})

const hasStats = computed(() => {
  const s = props.stats
  if (!s) return false
  const hasAudio = s.audio && (s.audio.jitter > 0 || s.audio.packetLoss > 0 || s.audio.bitrate > 0)
  const hasVideo = s.video && (s.video.jitter > 0 || s.video.packetLoss > 0 || s.video.bitrate > 0)
  const hasScreenShare =
    s.screenShare &&
    (s.screenShare.jitter > 0 || s.screenShare.packetLoss > 0 || s.screenShare.bitrate > 0)
  return s.ping > 0 || hasAudio || hasVideo || hasScreenShare
})

// Calculate tooltip position with viewport boundary detection
const tooltipStyle = computed(() => {
  if (typeof window === "undefined") {
    return { left: "0px", top: "0px" }
  }

  const tooltipWidth = 208 // w-52 = 13rem = 208px
  const tooltipHeight = tooltipElement.value?.offsetHeight || 200
  const padding = 8

  let left = mousePosition.value.x + tooltipOffset.x
  let top = mousePosition.value.y + tooltipOffset.y

  // Check right boundary
  if (left + tooltipWidth > window.innerWidth - padding) {
    left = mousePosition.value.x - tooltipWidth - tooltipOffset.x
  }

  // Check bottom boundary
  if (top + tooltipHeight > window.innerHeight - padding) {
    top = mousePosition.value.y - tooltipHeight - tooltipOffset.y
  }

  // Ensure minimum padding from edges
  left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding))
  top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding))

  return {
    left: `${left}px`,
    top: `${top}px`,
  }
})

const handleMouseEnter = (event: MouseEvent) => {
  // Don't show stats tooltip when context menu is open
  if (showMenu.value) return
  mousePosition.value = { x: event.clientX, y: event.clientY }
  showStats.value = true
}

// Methods
const formatNumber = (value: number): string => {
  if (value === 0) return "–"
  return value.toFixed(1)
}

const formatBitrate = (value: number): string => {
  if (value === 0) return "–"
  if (value < 1000) return `${value.toFixed(0)} bps`
  if (value < 1000000) return `${(value / 1000).toFixed(1)} kbps`
  return `${(value / 1000000).toFixed(2)} mbps`
}

const getPacketLossClass = (value: number): string => {
  if (value === 0) return "text-green-400"
  if (value < 1) return "text-yellow-400"
  return "text-red-400"
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
    transform: "translate(0, -100%)",
  }
}

const handleCardClick = () => {
  console.log(`[ParticipantCard] Card clicked for ${props.userId}`)
  // If both screen share and camera are active, toggle the view
  if (props.isScreenSharing && props.screenShareStream && props.isCameraEnabled && props.cameraStream) {
    console.log(`[ParticipantCard] Both streams active, toggling from ${showCameraAsMain.value} to ${!showCameraAsMain.value}`)
    showCameraAsMain.value = !showCameraAsMain.value
  }
  console.log(`[ParticipantCard] Emitting card-click for ${props.userId}`)
  emit("card-click", props.userId)
}

const handleMouseMove = (event: MouseEvent) => {
  mousePosition.value = { x: event.clientX, y: event.clientY }
}

const handleMouseLeave = () => {
  showStats.value = false
}

const onScreenVideoLoaded = () => {
  // Video loaded successfully
}

const onCameraVideoLoaded = () => {
  // Video loaded successfully
}

const setupVideoStream = (element: HTMLVideoElement | null, stream: MediaStream | null) => {
  if (!element || !stream) return

  // Check if stream has video tracks and they're active
  const videoTracks = stream.getVideoTracks()
  if (videoTracks.length === 0 || !videoTracks[0].enabled) {
    return
  }

  // Set the stream
  element.srcObject = stream

  // Wait for metadata to load before playing
  const attemptPlay = () => {
    element.play().catch(() => {
      // Silently ignore play errors (AbortError is normal during rapid changes)
    })
  }

  if (element.readyState >= 1) {
    // HAVE_METADATA or higher - play immediately
    attemptPlay()
  } else {
    // Wait for metadata to load
    element.addEventListener("loadedmetadata", attemptPlay, { once: true })
  }
}

const setupAllVideoStreams = () => {
  // Setup screen share video (shown in ParticipantCard when camera is in main view)
  if (props.screenShareStream && screenVideoElement.value) {
    setupVideoStream(screenVideoElement.value, props.screenShareStream)
  }

  // Setup camera video (shown in ParticipantCard when screen share is in main view)
  if (props.cameraStream && cameraVideoElement.value) {
    setupVideoStream(cameraVideoElement.value, props.cameraStream)
  }
}

const toggleMute = () => {
  isMuted.value = !isMuted.value
  if (audioElement.value) {
    audioElement.value.muted = isMuted.value
  }
  emit("mute-toggle", props.userId, isMuted.value)
}

const handleMuteToggle = () => {
  toggleMute()
  hideContextMenu()
}

// Watchers
watch(
  () => props.audioStream,
  (newStream) => {
    if (newStream && audioElement.value) {
      audioElement.value.srcObject = newStream
      void audioElement.value.play().catch(() => {
        // Silently ignore play errors
      })
    }
  },
  { immediate: true },
)

watch(
  () => props.screenShareStream,
  (newStream, oldStream) => {
    if (newStream && newStream !== oldStream) {
      setTimeout(() => {
        void nextTick(() => {
          setupAllVideoStreams()
        })
      }, 100)
    }
  },
  { immediate: true },
)

watch(
  () => props.cameraStream,
  (newStream, oldStream) => {
    if (newStream && newStream !== oldStream) {
      setTimeout(() => {
        void nextTick(() => {
          setupAllVideoStreams()
        })
      }, 100)
    }
  },
  { immediate: true },
)

watch(volume, (newVolume) => {
  if (audioElement.value) {
    audioElement.value.volume = newVolume / 100
  }
})

watch(
  () => props.isDeafened,
  (newDeafened) => {
    if (audioElement.value) {
      audioElement.value.muted = newDeafened || isMuted.value
    }
  },
)

// Event handlers
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
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
    // Setup video streams after mount with a small delay to ensure streams are ready
    setTimeout(() => {
      setupAllVideoStreams()
    }, 50)
  })

  document.addEventListener("keydown", handleKeydown)
  document.addEventListener("click", handleDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown)
  document.removeEventListener("click", handleDocumentClick)
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
