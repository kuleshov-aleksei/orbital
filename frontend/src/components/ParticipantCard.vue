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
              <div
                class="text-xs font-medium text-indigo-300 mt-2 pt-1 border-t border-indigo-700/50">
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

    <!-- Screen Share Mode: Video Preview with floating info -->
    <template v-if="isScreenSharing && screenShareStream && !forceAudioMode">
      <!-- Video element - only rendered when NOT viewing in main area -->
      <video
        v-if="!isViewing"
        ref="videoElement"
        class="w-full h-full object-contain bg-gray-900 rounded-lg"
        autoplay
        playsinline
        muted
        @loadedmetadata="onVideoLoaded" />

      <!-- Viewing overlay - shown when this stream is being viewed in main area -->
      <div
        v-if="isViewing"
        class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-indigo-600/90 backdrop-blur-sm text-white px-3 py-1.5 rounded-full z-20 shadow-lg">
        <PhMonitorPlay class="w-4 h-4" />

        <span class="text-sm font-medium">Viewing</span>
      </div>

      <!-- Floating nickname overlay -->
      <div class="absolute top-2 left-2 right-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UserAvatar :user-id="userId" :nickname="userNickname" :size="24" :show-status="false" />

          <span
            class="text-white text-sm font-medium bg-gray-900/70 px-3 py-1 rounded-lg max-w-[140px] truncate">
            {{ userNickname.length > 12 ? userNickname.slice(0, 12) + "..." : userNickname }}
          </span>
        </div>
      </div>

      <!-- Speaking indicator overlay -->
      <div
        v-if="isSpeaking"
        class="absolute bottom-2 left-2 w-3 h-3 bg-green-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]"
        title="Speaking" />
    </template>

    <!-- Audio Mode: Avatar centered with nickname at bottom -->
    <template v-else>
      <!-- Avatar centered in card -->
      <div class="absolute inset-0 flex items-center justify-center">
        <UserAvatar :user-id="userId" :nickname="userNickname" :size="48" :show-status="false" />
      </div>

      <!-- Nickname at bottom center -->
      <div class="absolute bottom-2 left-0 right-0 flex justify-center items-center">
        <span
          class="text-white font-medium text-sm bg-gray-900/70 px-3 py-1 rounded-lg max-w-[160px] truncate">
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

      <!-- Screen Sharing Indicator -->
      <div
        v-if="isScreenSharing"
        class="absolute top-2 left-2 w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center"
        :title="'Sharing screen'">
        <PhMonitorPlay class="w-3 h-3 text-white" />
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
import { PhMicrophone, PhMicrophoneSlash, PhSpeakerHigh, PhMonitorPlay } from "@phosphor-icons/vue"
import { useRoomStore, usePresenceStore } from "@/stores"
import UserAvatar from "@/components/UserAvatar.vue"
import type { ScreenShareQuality, ConnectionStats } from "@/types"

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
  isViewing?: boolean // If true, show "Viewing" overlay instead of video (stream is shown in main area)
}

const props = withDefaults(defineProps<Props>(), {
  initialVolume: 80,
  isDeafened: false,
  isScreenSharing: false,
  screenShareQuality: "1080p30",
  isCurrentUser: false,
  externalAudioLevel: 0,
  stats: () => ({
    ping: 0,
  }),
  forceAudioMode: false,
  isViewing: false,
})

const emit = defineEmits<{
  "mute-toggle": [userId: string, isMuted: boolean]
  "card-click": [userId: string]
}>()

// Store
const roomStore = useRoomStore()
const presenceStore = usePresenceStore()

// Refs
const audioElement = useTemplateRef<HTMLAudioElement>("audioElement")
const videoElement = useTemplateRef<HTMLVideoElement>("videoElement")
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
  emit("card-click", props.userId)
}

const handleMouseMove = (event: MouseEvent) => {
  mousePosition.value = { x: event.clientX, y: event.clientY }
}

const handleMouseLeave = () => {
  showStats.value = false
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
        if (error.name !== "AbortError") {
          console.warn(`Screen share video play failed for user ${props.userId}:`, error)
        }
      })
    }

    if (video.readyState >= 1) {
      // HAVE_METADATA or higher
      // Metadata already loaded, play immediately
      attemptPlay()
    } else {
      // Wait for metadata to load
      video.addEventListener("loadedmetadata", attemptPlay, { once: true })
    }
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
      console.log(`🎵 Setting audio stream for user ${props.userId}`)
      audioElement.value.srcObject = newStream
      void audioElement.value.play().catch((error: Error) => {
        console.warn(`Audio play failed for user ${props.userId}:`, error)
      })
    }
  },
  { immediate: true },
)

watch(
  () => props.screenShareStream,
  (newStream, oldStream) => {
    if (newStream && newStream !== oldStream) {
      // Small delay to ensure DOM is updated and stream is ready
      setTimeout(() => {
        void nextTick(() => {
          setupVideoStream()
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
    // Setup video stream after mount with a small delay to ensure stream is ready
    setTimeout(() => {
      setupVideoStream()
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
