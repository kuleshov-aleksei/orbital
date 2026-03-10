<template>
  <div
    ref="cardElement"
    class="participant-card overflow-visible relative rounded-lg cursor-pointer transition-all duration-200 border-2"
    :class="[
      !isCurrentUser &&
      !isViewing &&
      ((isScreenSharing && screenShareStream) || (isCameraEnabled && cameraStream)) &&
      !forceAudioMode
        ? 'aspect-video bg-theme-bg-primary'
        : 'aspect-square',
      isCurrentUser && (!isScreenSharing || forceAudioMode)
        ? 'bg-theme-accent/30 border-theme-accent'
        : !isScreenSharing || forceAudioMode
          ? 'bg-theme-bg-secondary border-theme-border'
          : '',
      isSpeaking && isCurrentUser && (!isScreenSharing || forceAudioMode)
        ? 'border-theme-accent shadow-[0_0_10px_var(--color-accent)] animate-pulse'
        : isSpeaking && (!isScreenSharing || forceAudioMode)
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
          v-if="showStats && hasStats"
          ref="tooltipElement"
          class="fixed z-[9999] bg-theme-bg-primary/95 backdrop-blur-sm border border-theme-border rounded-lg p-3 w-52 shadow-xl pointer-events-none"
          :style="tooltipStyle">
          <div
            class="text-xs font-medium text-theme-text-secondary mb-2 border-b border-theme-border pb-1">
            Connection Stats
          </div>

          <div class="space-y-2">
            <!-- Ping (always shown) -->
            <div class="flex justify-between text-xs">
              <span class="text-theme-text-muted">Ping:</span>

              <span class="text-green-400">{{ formatNumber(stats.ping) }}ms</span>
            </div>

            <!-- Audio Stats -->
            <template v-if="stats.audio">
              <div
                class="text-xs font-medium text-theme-text-muted mt-2 pt-1 border-t border-theme-border/50">
                Audio
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-theme-text-muted">Jitter:</span>

                <span class="text-blue-400">{{ formatNumber(stats.audio.jitter) }}ms</span>
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-theme-text-muted">Packet Loss:</span>

                <span :class="getPacketLossClass(stats.audio.packetLoss)">
                  {{ formatNumber(stats.audio.packetLoss) }}%
                </span>
              </div>

              <div class="flex justify-between text-xs">
                <span class="text-theme-text-muted">Bitrate:</span>

                <span class="text-purple-400">{{ formatBitrate(stats.audio.bitrate) }}</span>
              </div>
            </template>

            <!-- Video Stats -->
            <template v-if="stats.video">
              <div
                class="text-xs font-medium text-theme-text-muted mt-2 pt-1 border-t border-theme-border/50">
                Camera
              </div>

              <!-- Resolution -->
              <div class="flex justify-between text-xs">
                <span class="text-theme-text-muted">Resolution:</span>

                <span class="text-purple-400">{{ stats.video.resolution || "–" }}</span>
              </div>

              <!-- Frame Rate -->
              <div class="flex justify-between text-xs">
                <span class="text-theme-text-muted">Frame Rate:</span>

                <span class="text-purple-400">{{ formatNumber(stats.video.fps || 0) }} fps</span>
              </div>

              <!-- Codec -->
              <div class="flex justify-between text-xs">
                <span class="text-theme-text-muted">Codec:</span>

                <span class="text-purple-400">{{ stats.video.codec || "–" }}</span>
              </div>

              <!-- Jitter -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Jitter:</span>

                <span class="text-blue-400">{{ formatNumber(stats.video.jitter) }}ms</span>
              </div>

              <!-- Packet Loss -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Packet Loss:</span>

                <span :class="getPacketLossClass(stats.video.packetLoss)">
                  {{ formatNumber(stats.video.packetLoss) }}%
                </span>
              </div>

              <!-- Bitrate -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Bitrate:</span>

                <span class="text-purple-400">{{ formatBitrate(stats.video.bitrate) }}</span>
              </div>

              <!-- Quality Limitation (only show if present and not "none") -->
              <div
                v-if="
                  stats.video.qualityLimitationReason &&
                  stats.video.qualityLimitationReason !== 'none'
                "
                class="flex justify-between text-xs">
                <span class="text-gray-500">Quality:</span>

                <span class="text-yellow-400">{{ stats.video.qualityLimitationReason }}</span>
              </div>
            </template>

            <!-- Local Video Stats (current user's own camera) -->
            <template v-if="stats.localVideo">
              <div
                class="text-xs font-medium text-amber-400 mt-2 pt-1 border-t border-amber-700/50">
                My Camera
              </div>

              <!-- Resolution -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Resolution:</span>

                <span class="text-amber-400">{{ stats.localVideo.resolution || "–" }}</span>
              </div>

              <!-- Frame Rate -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Frame Rate:</span>

                <span class="text-amber-400"
                  >{{ formatNumber(stats.localVideo.fps || 0) }} fps</span
                >
              </div>

              <!-- Codec -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Codec:</span>

                <span class="text-amber-400">{{ stats.localVideo.codec || "–" }}</span>
              </div>

              <!-- Bitrate -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Bitrate:</span>

                <span class="text-amber-400">{{ formatBitrate(stats.localVideo.bitrate) }}</span>
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

            <!-- Screen Share Audio Stats -->
            <template v-if="stats.screenShareAudio">
              <div class="text-xs font-medium text-cyan-300 mt-2 pt-1 border-t border-cyan-700/50">
                Screen Share Audio
              </div>

              <!-- Codec -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Codec:</span>

                <span class="text-cyan-400">{{ stats.screenShareAudio.codec || "–" }}</span>
              </div>

              <!-- Jitter -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Jitter:</span>

                <span class="text-blue-400"
                  >{{ formatNumber(stats.screenShareAudio.jitter) }}ms</span
                >
              </div>

              <!-- Packet Loss -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Packet Loss:</span>

                <span :class="getPacketLossClass(stats.screenShareAudio.packetLoss)">
                  {{ formatNumber(stats.screenShareAudio.packetLoss) }}%
                </span>
              </div>

              <!-- Bitrate -->
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Bitrate:</span>

                <span class="text-cyan-400">{{
                  formatBitrate(stats.screenShareAudio.bitrate)
                }}</span>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Video Mode: Show video when NOT current user AND NOT being viewed in main AND has any stream -->
    <!-- Current user's own card always shows avatar -->
    <template
      v-if="
        !isCurrentUser &&
        !isViewing &&
        ((isScreenSharing && screenShareStream) || (isCameraEnabled && cameraStream)) &&
        !forceAudioMode
      ">
      <!-- Show the stream that is NOT in the main view, or the only available stream -->
      <div class="relative w-full h-full">
        <!-- Show Screen Share when: both exist but camera in main, OR only screen share exists -->
        <!-- Only show if screen share exists -->
        <video
          v-show="screenShareStream && (!cameraStream || !showCameraAsMain)"
          ref="screenVideoElement"
          class="absolute inset-0 w-full h-full object-contain bg-theme-bg-primary rounded-lg pointer-events-none"
          autoplay
          playsinline
          muted
          @loadedmetadata="onScreenVideoLoaded" />

        <!-- Show Camera when: both exist but screen in main, OR only camera exists -->
        <!-- Only show if camera exists -->
        <video
          v-show="cameraStream && (!screenShareStream || showCameraAsMain)"
          ref="cameraVideoElement"
          class="absolute inset-0 w-full h-full object-cover bg-theme-bg-primary rounded-lg pointer-events-none"
          autoplay
          playsinline
          muted
          @loadedmetadata="onCameraVideoLoaded" />

        <!-- Toggle hint overlay - only show when both streams available -->
        <div
          v-show="
            isScreenSharing &&
            isCameraEnabled &&
            screenShareStream &&
            cameraStream &&
            showCameraAsMain
          "
          class="absolute bottom-2 right-2 bg-indigo-600/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-white flex items-center gap-1 z-10 pointer-events-none">
          <PhMonitorPlay class="w-3 h-3" />
        </div>

        <div
          v-show="
            isScreenSharing &&
            isCameraEnabled &&
            screenShareStream &&
            cameraStream &&
            !showCameraAsMain
          "
          class="absolute bottom-2 right-2 bg-purple-600/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-white flex items-center gap-1 z-10 pointer-events-none">
          <PhCamera class="w-3 h-3" />
        </div>

        <!-- Floating nickname overlay -->
        <div class="absolute top-2 left-2 right-2 flex items-center justify-between z-10">
          <div class="flex items-center gap-2">
            <UserAvatar
              :user-id="userId"
              :nickname="userNickname"
              :size="24"
              :show-status="false" />

            <span
              class="text-theme-text-primary text-sm font-medium bg-theme-bg-primary/70 px-3 py-1 rounded-lg max-w-[140px] truncate">
              {{ userNickname.length > 12 ? userNickname.slice(0, 12) + "..." : userNickname }}
            </span>
            <!-- Mute/Deafen indicators -->
            <div v-if="isMuted || isDeafened" class="flex gap-0.5">
              <PhMicrophoneSlash v-if="isMuted" class="w-3 h-3 text-red-400" />
              <PhHeadphones v-if="isDeafened" class="w-3 h-3 text-red-400" />
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
      <div class="absolute bottom-2 left-0 right-0 flex justify-center items-center gap-1">
        <span
          class="text-theme-text-primary font-medium text-sm bg-theme-bg-primary/70 px-3 py-1 rounded-lg max-w-[140px] truncate">
          {{ userNickname.length > 12 ? userNickname.slice(0, 12) + "..." : userNickname }}
        </span>
        <!-- Mute/Deafen indicators -->
        <div v-if="isMuted || isDeafened" class="flex gap-0.5">
          <PhMicrophoneSlash v-if="isMuted" class="w-3 h-3 text-red-400" />
          <PhHeadphones v-if="isDeafened" class="w-3 h-3 text-red-400" />
        </div>
      </div>

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
    <UserContextMenu ref="contextMenuRef" :user-id="userId" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, useTemplateRef } from "vue"
import { PhMicrophoneSlash, PhMonitorPlay, PhCamera, PhHeadphones } from "@phosphor-icons/vue"
import { useRoomStore, usePresenceStore, useCallStore } from "@/stores"
import UserAvatar from "@/components/UserAvatar.vue"
import UserContextMenu from "@/components/UserContextMenu.vue"
import { useUserContextMenu } from "@/composables/useUserContextMenu"
import type { ScreenShareQuality, ConnectionStats } from "@/types"

interface Props {
  userId: string
  userNickname: string
  screenShareStream: MediaStream | null
  cameraStream?: MediaStream | null // Camera video stream
  initialVolume?: number
  isDeafened?: boolean
  isScreenSharing?: boolean
  isCameraEnabled?: boolean
  screenShareQuality?: ScreenShareQuality
  isCurrentUser?: boolean
  stats?: ConnectionStats
  // Mode control
  forceAudioMode?: boolean // If true, always show audio mode even when screen sharing
  isViewing?: boolean // If true, show "Viewing" overlay instead of video (stream is shown in main area)
  isCompact?: boolean // If true, show compact layout for sidebar
  // Sync state with parent for stream toggle
  modelValueShowCameraAsMain?: boolean // true = camera in main view, false = screen share in main view
}

const props = withDefaults(defineProps<Props>(), {
  cameraStream: null,
  initialVolume: 80,
  isDeafened: false,
  isScreenSharing: false,
  isCameraEnabled: false,
  screenShareQuality: "adaptive",
  isCurrentUser: false,
  stats: () => ({
    ping: 0,
  }),
  forceAudioMode: false,
  isViewing: false,
  isCompact: false,
  modelValueShowCameraAsMain: false,
})

const emit = defineEmits<{
  "card-click": [userId: string]
  "update:modelValueShowCameraAsMain": [value: boolean]
}>()

// Store
const roomStore = useRoomStore()
const presenceStore = usePresenceStore()
const callStore = useCallStore()

// Refs
const screenVideoElement = useTemplateRef<HTMLVideoElement>("screenVideoElement")
const cameraVideoElement = useTemplateRef<HTMLVideoElement>("cameraVideoElement")
const tooltipElement = useTemplateRef<HTMLDivElement>("tooltipElement")
const contextMenuRef = useTemplateRef<InstanceType<typeof UserContextMenu>>("contextMenuRef")

// State
const isMuted = computed(() => {
  if (props.isCurrentUser) {
    return callStore.isMuted
  }
  return roomStore.getUserMuted(props.userId)
})
const isDeafened = computed(() => {
  if (props.isCurrentUser) {
    return callStore.isDeafened
  }
  return roomStore.getUserDeafened(props.userId)
})
const { isUserContextMenuOpen } = useUserContextMenu()
const showStatsInternal = ref(false)
const showStats = computed(() => (isUserContextMenuOpen.value ? false : showStatsInternal.value))
const mousePosition = ref({ x: 0, y: 0 })
const tooltipOffset = { x: 16, y: 16 }

// Camera/Screen share toggle state - synced with parent via v-model
// showCameraAsMain = true means camera is main, screen share is in ParticipantCard
// showCameraAsMain = false means screen share is main, camera is in ParticipantCard
const showCameraAsMain = computed({
  get: () => props.modelValueShowCameraAsMain,
  set: (value) => emit("update:modelValueShowCameraAsMain", value),
})

// Suggest initial state to parent when streams become available
const hasInitialized = ref(false)
watch(
  [() => props.isScreenSharing, () => props.isCameraEnabled],
  ([hasScreen, hasCamera], [prevHasScreen, prevHasCamera]) => {
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
  },
  { immediate: true },
)

// Computed for whether video mode is active
const isVideoMode = computed(
  () =>
    !props.isCurrentUser &&
    !props.isViewing &&
    ((props.isScreenSharing && props.screenShareStream) ||
      (props.isCameraEnabled && props.cameraStream)) &&
    !props.forceAudioMode,
)

// Watch for video mode becoming active, then setup streams
watch(isVideoMode, (isActive) => {
  if (isActive) {
    void nextTick(() => {
      setTimeout(() => {
        setupAllVideoStreams()
      }, 50)
    })
  }
})

// Computed
const isSpeaking = computed(() => {
  if (props.isCurrentUser) {
    return roomStore.localAudioLevel > 0.05
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
  const hasScreenShareAudio =
    s.screenShareAudio &&
    (s.screenShareAudio.jitter > 0 ||
      s.screenShareAudio.packetLoss > 0 ||
      s.screenShareAudio.bitrate > 0)
  const hasLocalVideo =
    s.localVideo &&
    (s.localVideo.jitter > 0 ||
      s.localVideo.packetLoss > 0 ||
      s.localVideo.bitrate > 0 ||
      s.localVideo.resolution)
  return (
    s.ping > 0 || hasAudio || hasVideo || hasScreenShare || hasScreenShareAudio || hasLocalVideo
  )
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
  mousePosition.value = { x: event.clientX, y: event.clientY }
  showStatsInternal.value = true
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

const handleContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  contextMenuRef.value?.show(event)
}

const handleCardClick = () => {
  // If both screen share and camera are active, toggle the view
  if (
    props.isScreenSharing &&
    props.screenShareStream &&
    props.isCameraEnabled &&
    props.cameraStream
  ) {
    showCameraAsMain.value = !showCameraAsMain.value
  }
  emit("card-click", props.userId)
}

const handleMouseMove = (event: MouseEvent) => {
  mousePosition.value = { x: event.clientX, y: event.clientY }
}

const handleMouseLeave = () => {
  showStatsInternal.value = false
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

// Watchers

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

// Lifecycle
onMounted(() => {
  void nextTick(() => {
    // Setup video streams after mount with a small delay to ensure streams are ready
    setTimeout(() => {
      setupAllVideoStreams()
    }, 50)
  })
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
