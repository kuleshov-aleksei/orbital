<template>
  <div
    ref="cardElement"
    class="participant-card overflow-visible relative rounded-lg cursor-pointer transition-all duration-200 border-2"
    :class="cardClasses"
    @contextmenu="handleContextMenu"
    @click="handleCardClick"
    @mouseenter="handleMouseEnter"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave">
    <ParticipantStatsTooltip
      :stats="stats"
      :show="showStats && hasStats"
      :mouse-x="mousePosition.x"
      :mouse-y="mousePosition.y" />

    <template
      v-if="
        !isCurrentUser &&
        ((isScreenSharing && screenShareStream) || (isCameraEnabled && cameraStream)) &&
        !forceAudioMode
      ">
      <div class="relative w-full h-full">
        <video
          v-if="screenShareStream && (!cameraStream || showCameraAsMain)"
          ref="screenVideoElement"
          class="absolute inset-0 w-full h-full object-contain bg-theme-bg-primary rounded-lg pointer-events-none"
          autoplay
          playsinline
          muted
          @loadedmetadata="onScreenVideoLoaded" />

        <video
          v-if="cameraStream && (!screenShareStream || !showCameraAsMain)"
          ref="cameraVideoElement"
          class="absolute inset-0 w-full h-full object-cover bg-theme-bg-primary rounded-lg pointer-events-none"
          autoplay
          playsinline
          muted
          @loadedmetadata="onCameraVideoLoaded" />

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

            <div v-if="isMuted || isDeafened" class="flex gap-0.5">
              <PhMicrophoneSlash v-if="isMuted" class="w-3 h-3 text-red-400" />
              <PhHeadphones v-if="isDeafened" class="w-3 h-3 text-red-400" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="absolute inset-0 flex items-center justify-center overflow-hidden">
        <div
          class="absolute w-16 h-16 flex items-center justify-center transition-opacity duration-300"
          :class="isSpeaking ? 'opacity-100' : 'opacity-0'">
          <div
            class="absolute rounded-full border-2 border-green-500 animate-breathe bg-green-500/20 opacity-25 w-20 h-20"
            style="animation-delay: 0ms" />
          <div
            class="absolute rounded-full border-2 border-green-500 animate-breathe bg-green-500/20 w-16 h-16"
            style="animation-delay: 150ms" />
        </div>

        <UserAvatar :user-id="userId" :nickname="userNickname" :size="48" :show-status="false" />
      </div>

      <div class="absolute bottom-2 left-0 right-0 flex justify-center items-center gap-1">
        <span
          class="text-theme-text-primary font-medium text-sm bg-theme-bg-primary/70 px-3 py-1 rounded-lg max-w-[140px] truncate">
          {{ userNickname.length > 12 ? userNickname.slice(0, 12) + "..." : userNickname }}
        </span>

        <div v-if="isMuted || isDeafened" class="flex gap-0.5">
          <PhMicrophoneSlash v-if="isMuted" class="w-3 h-3 text-red-400" />
          <PhHeadphones v-if="isDeafened" class="w-3 h-3 text-red-400" />
        </div>
      </div>

      <div class="absolute top-2 left-2 flex gap-1">
        <div
          v-if="isScreenSharing && !hasAvailableScreenShare"
          class="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center"
          title="Sharing screen">
          <PhMonitorPlay class="w-3 h-3 text-white" />
        </div>

        <div
          v-if="isCameraEnabled"
          class="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center"
          title="Camera enabled">
          <PhCamera class="w-3 h-3 text-white" />
        </div>

        <div
          v-if="hasAvailableScreenShare && !isCurrentUser"
          class="w-6 h-6 bg-yellow-600 rounded-full flex items-center justify-center"
          title="Screen share available">
          <PhMonitor class="w-3 h-3 text-white" />
        </div>
      </div>

      <div
        v-if="hasAvailableScreenShare && !isCurrentUser"
        class="absolute inset-0 flex items-center justify-center z-20">
        <button
          type="button"
          class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-medium flex items-center transition-colors shadow-lg"
          @click.stop="$emit('subscribe-screen-share', userId)">
          <PhPlay class="w-4 h-4 mr-2" />
          View
        </button>
      </div>
    </template>

    <UserContextMenu ref="contextMenuRef" :user-id="userId" :room-id="roomId" />
  </div>
</template>

<script setup lang="ts">
import { debugWarn } from "@/utils/debug"
import { ref, computed, onMounted, watch, nextTick, useTemplateRef } from "vue"
import {
  PhMicrophoneSlash,
  PhMonitorPlay,
  PhCamera,
  PhHeadphones,
  PhMonitor,
  PhPlay,
} from "@phosphor-icons/vue"
import { useRoomStore, usePresenceStore, useCallStore } from "@/stores"
import UserAvatar from "@/components/UserAvatar.vue"
import UserContextMenu from "@/components/UserContextMenu.vue"
import ParticipantStatsTooltip from "@/components/ParticipantStatsTooltip.vue"
import { useUserContextMenu } from "@/composables/useUserContextMenu"
import type { ScreenShareQuality, ConnectionStats } from "@/types"
import type { RemoteVideoTrack, LocalVideoTrack } from "livekit-client"

interface Props {
  userId: string
  userNickname: string
  roomId: string
  screenShareStream: MediaStream | null
  cameraStream?: MediaStream | null
  screenShareTrack?: RemoteVideoTrack | LocalVideoTrack | null
  cameraTrack?: RemoteVideoTrack | LocalVideoTrack | null
  initialVolume?: number
  isDeafened?: boolean
  isScreenSharing?: boolean
  isCameraEnabled?: boolean
  screenShareQuality?: ScreenShareQuality
  isCurrentUser?: boolean
  stats?: ConnectionStats
  forceAudioMode?: boolean
  isViewing?: boolean
  isCompact?: boolean
  showCameraAsMain?: boolean
  hasAvailableScreenShare?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  cameraStream: null,
  screenShareTrack: null,
  cameraTrack: null,
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
  showCameraAsMain: false,
  hasAvailableScreenShare: false,
})

const emit = defineEmits<{
  "card-click": [userId: string]
  "toggle-view": [userId: string]
  "subscribe-screen-share": [userId: string]
}>()

const roomStore = useRoomStore()
const presenceStore = usePresenceStore()
const callStore = useCallStore()

const screenVideoElement = useTemplateRef<HTMLVideoElement>("screenVideoElement")
const cameraVideoElement = useTemplateRef<HTMLVideoElement>("cameraVideoElement")
const contextMenuRef = useTemplateRef<InstanceType<typeof UserContextMenu>>("contextMenuRef")

const isMuted = computed(() => {
  if (props.isCurrentUser) return callStore.isMuted
  return roomStore.getUserMuted(props.userId)
})
const isDeafened = computed(() => {
  if (props.isCurrentUser) return callStore.isDeafened
  return roomStore.getUserDeafened(props.userId)
})
const { isUserContextMenuOpen } = useUserContextMenu()
const showStatsInternal = ref(false)
const showStats = computed(() => (isUserContextMenuOpen.value ? false : showStatsInternal.value))
const mousePosition = ref({ x: 0, y: 0 })

const isVideoMode = computed(
  () =>
    !props.isCurrentUser &&
    !props.isViewing &&
    ((props.isScreenSharing && props.screenShareStream) ||
      (props.isCameraEnabled && props.cameraStream)) &&
    !props.forceAudioMode,
)

watch(isVideoMode, (isActive) => {
  if (isActive) {
    void nextTick(() => {
      setTimeout(() => setupAllVideoStreams(), 50)
    })
  }
})

watch(
  screenVideoElement,
  (el) => {
    if (el && isVideoMode.value && props.screenShareStream) {
      setupVideoStream(el, props.screenShareStream, props.screenShareTrack || undefined)
    }
  },
  { immediate: true },
)

watch(
  cameraVideoElement,
  (el) => {
    if (el && isVideoMode.value && props.cameraStream) {
      setupVideoStream(el, props.cameraStream, props.cameraTrack || undefined)
    }
  },
  { immediate: true },
)

const isSpeaking = computed(() => {
  if (props.isCurrentUser) return roomStore.localAudioLevel > 0.01
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

const cardClasses = computed(() => {
  const classes: string[] = []

  if (isVideoMode.value) {
    classes.push("aspect-video bg-theme-bg-primary")
  } else {
    classes.push("aspect-square")
  }

  if (props.isCurrentUser && (!props.isScreenSharing || props.forceAudioMode)) {
    classes.push("bg-theme-accent/30 border-theme-accent")
  } else if (!props.isScreenSharing || props.forceAudioMode) {
    classes.push("bg-theme-bg-secondary border-theme-border")
  }

  const showSpeakingBorder = !props.isScreenSharing || props.forceAudioMode
  if (isSpeaking.value && props.isCurrentUser && showSpeakingBorder) {
    classes.push("border-theme-accent")
  } else if (isSpeaking.value && showSpeakingBorder) {
    classes.push("border-green-500")
  }

  return classes
})

const handleContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  contextMenuRef.value?.show(event)
}

const handleCardClick = () => {
  if (
    props.isScreenSharing &&
    props.screenShareStream &&
    props.isCameraEnabled &&
    props.cameraStream
  ) {
    emit("toggle-view", props.userId)
  }
  emit("card-click", props.userId)
}

const handleMouseEnter = (event: MouseEvent) => {
  mousePosition.value = { x: event.clientX, y: event.clientY }
  showStatsInternal.value = true
}

const handleMouseMove = (event: MouseEvent) => {
  mousePosition.value = { x: event.clientX, y: event.clientY }
}

const handleMouseLeave = () => {
  showStatsInternal.value = false
}

const onScreenVideoLoaded = () => {}
const onCameraVideoLoaded = () => {}

const setupVideoStream = (
  element: HTMLVideoElement | null,
  stream: MediaStream | null,
  lkTrack?: RemoteVideoTrack | LocalVideoTrack | null,
) => {
  if (!element) return

  if (lkTrack) {
    try {
      lkTrack.attach(element)
    } catch (e) {
      debugWarn(`[ParticipantCard] LiveKit attach failed:`, e)
    }
    return
  }

  if (!stream) return

  const videoTracks = stream.getVideoTracks()
  if (videoTracks.length === 0 || !videoTracks[0].enabled) return

  if (element.srcObject !== stream) {
    element.srcObject = stream
  }

  if (element.paused) {
    element.play().catch(() => {})
  }
}

const setupAllVideoStreams = () => {
  if (props.screenShareStream && screenVideoElement.value) {
    setupVideoStream(
      screenVideoElement.value,
      props.screenShareStream,
      props.screenShareTrack || undefined,
    )
  }

  if (props.cameraStream && cameraVideoElement.value) {
    setupVideoStream(cameraVideoElement.value, props.cameraStream, props.cameraTrack || undefined)
  }
}

watch(
  () => props.screenShareStream,
  (newStream, oldStream) => {
    if (newStream && newStream !== oldStream && isVideoMode.value) {
      setTimeout(() => {
        void nextTick(() => setupAllVideoStreams())
      }, 100)
    }
  },
  { immediate: true },
)

watch(
  () => props.cameraStream,
  (newStream, oldStream) => {
    if (newStream && newStream !== oldStream && isVideoMode.value) {
      setTimeout(() => {
        void nextTick(() => setupAllVideoStreams())
      }, 100)
    }
  },
  { immediate: true },
)

onMounted(() => {
  void nextTick(() => {
    setTimeout(() => setupAllVideoStreams(), 50)
  })
})
</script>

<style scoped>
.participant-card {
  min-height: 100px;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
}

.animate-breathe {
  animation: breathe 2s ease-in-out infinite;
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
