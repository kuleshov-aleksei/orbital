<template>
  <div
    class="screen-stream relative bg-theme-bg-primary rounded-lg overflow-hidden border border-theme-border flex flex-col"
    :class="{ 'border-theme-accent ring-2 ring-theme-accent/50': isFocused }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false">
    <div
      ref="videoContainerRef"
      class="relative flex items-center justify-center bg-black w-full h-full max-h-[70vh]"
      @mousemove="onFullscreenMousemove">
      <video
        :id="`screen-${userId}`"
        ref="videoElement"
        class="object-contain w-full max-h-full"
        :style="{ aspectRatio: videoAspectRatio }"
        autoplay
        playsinline
        controlsList="nofullscreen nodownload nomedia"
        @dblclick="toggleFullscreen"
        @loadedmetadata="handleVideoMetadata" />

      <StreamUserOverlay
        :user-id="userId"
        :user-nickname="userNickname"
        :quality-label="qualityLabel"
        :connection-state="connectionState"
        :is-fullscreen="isFullscreen"
        :fullscreen-controls-visible="fullscreenControlsVisible" />

      <StreamControls
        v-show="!isFullscreen"
        :is-hovered="isHovered"
        :is-focused="isFocused"
        :show-focus-button="showFocusButton"
        :is-self-view="isSelfView"
        :local-volume="localVolume"
        :is-muted="isMuted"
        :is-call-muted="isCallMuted"
        :is-call-deafened="isCallDeafened"
        @make-focused="$emit('make-focused')"
        @volume-change="forwardVolumeChange"
        @toggle-mute="toggleMute"
        @toggle-fullscreen="toggleFullscreen"
        @toggle-pip="togglePiP"
        @toggle-call-mute="toggleCallMute"
        @toggle-call-deafen="toggleCallDeafen"
        @unsubscribe="emit('unsubscribe')"
        @stop-own-screen-share="emit('stop-own-screen-share')" />

      <StreamControls
        v-show="isFullscreen"
        fullscreen
        :is-hovered="fullscreenControlsVisible"
        :show-focus-button="false"
        :is-self-view="isSelfView"
        :local-volume="localVolume"
        :is-muted="isMuted"
        :is-call-muted="isCallMuted"
        :is-call-deafened="isCallDeafened"
        @volume-change="forwardVolumeChange"
        @toggle-mute="toggleMute"
        @toggle-fullscreen="toggleFullscreen"
        @toggle-call-mute="toggleCallMute"
        @toggle-call-deafen="toggleCallDeafen"
        @unsubscribe="emit('unsubscribe')"
        @stop-own-screen-share="emit('stop-own-screen-share')" />

      <div
        v-if="!videoTrack"
        class="absolute inset-0 flex items-center justify-center bg-theme-bg-primary">
        <div class="text-center">
          <PhSpinner class="w-8 h-8 text-theme-accent animate-spin mx-auto mb-2" />
          <span class="text-theme-text-muted text-sm">Connecting...</span>
        </div>
      </div>

      <div
        v-if="isPausedComputed"
        class="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
        <div class="text-center">
          <PhPause class="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <span class="text-theme-text-secondary text-lg font-medium">Paused</span>
          <p class="text-theme-text-muted text-sm mt-1">Hover to view</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from "vue"
import { PhSpinner, PhPause } from "@phosphor-icons/vue"
import type { ScreenShareQuality } from "@/types"
import type {
  RemoteVideoTrack,
  RemoteAudioTrack,
  LocalVideoTrack,
  LocalAudioTrack,
} from "livekit-client"
import StreamUserOverlay from "@/components/StreamUserOverlay.vue"
import StreamControls from "@/components/StreamControls.vue"
import { useCallStore, useUserStore, useRoomStore } from "@/stores"
import { useSounds } from "@/services/sounds"
import { wsService } from "@/services/websocket"
import { debugLog, debugWarn, debugError } from "@/utils/debug"

interface Props {
  userId: string
  userNickname: string
  videoTrack: RemoteVideoTrack | LocalVideoTrack | null
  audioTrack: RemoteAudioTrack | LocalAudioTrack | null
  quality: ScreenShareQuality
  connectionState?: string
  isFocused?: boolean
  showFocusButton?: boolean
  isSelfView?: boolean
  volume?: number
}

const props = withDefaults(defineProps<Props>(), {
  connectionState: "connecting",
  isFocused: false,
  showFocusButton: false,
  isSelfView: false,
  volume: 80,
})

const emit = defineEmits<{
  "make-focused": []
  "volume-change": [volume: number, isScreenShare: boolean]
  unsubscribe: []
  "stop-own-screen-share": []
}>()

const videoElement = useTemplateRef<HTMLVideoElement>("videoElement")
const videoContainerRef = useTemplateRef<HTMLDivElement>("videoContainerRef")
const isFullscreen = ref(false)
const isHovered = ref(false)
const videoWidth = ref(1920)
const videoHeight = ref(1080)
const localVolume = ref(80)
const previousVolume = ref(80)
const isMuted = ref(false)
const fullscreenControlsVisible = ref(true)
let fullscreenControlsTimer: ReturnType<typeof setTimeout> | null = null
const callStore = useCallStore()
const userStore = useUserStore()
const roomStore = useRoomStore()
const { playMute, playUnmute, playDeafen, playUndeafen } = useSounds()
const isCallMuted = computed(() => callStore.isMuted)
const isCallDeafened = computed(() => callStore.isDeafened)
const isLiveKitAttached = ref(false)
const selfViewStream = ref<MediaStream | null>(null)
const pendingTrack = ref<typeof props.videoTrack>(null)

const isPausedComputed = computed(() => {
  return props.isSelfView && !isHovered.value
})

const handleVideoMetadata = () => {
  if (videoElement.value) {
    videoWidth.value = videoElement.value.videoWidth || 1920
    videoHeight.value = videoElement.value.videoHeight || 1080
    debugLog(
      `Screen share dimensions for ${props.userId}: ${videoWidth.value}x${videoHeight.value}`,
    )
  }
}

const qualityLabels: Record<ScreenShareQuality, string> = {
  fullhd60: "Full HD 60fps",
  adaptive: "Adaptive",
  text: "Text Mode",
}

const qualityLabel = computed(() => qualityLabels[props.quality])

const videoAspectRatio = computed(() => {
  if (videoHeight.value === 0) return "auto"
  return `${videoWidth.value} / ${videoHeight.value}`
})

const attachTrackToElement = async (track: typeof props.videoTrack, element: HTMLVideoElement) => {
  if (!track || !element) return

  if (props.isSelfView) {
    selfViewStream.value = new MediaStream([track.mediaStreamTrack])
    element.srcObject = selfViewStream.value
    try {
      await element.play()
    } catch (error) {
      debugWarn(`Self-view play failed for ${props.userId}:`, error)
    }
  } else {
    try {
      track.attach(element)
      isLiveKitAttached.value = true
      if (element.paused) {
        try {
          await element.play()
        } catch (playError) {
          debugWarn(`Play after attach failed for ${props.userId}:`, playError)
        }
      }
    } catch (error) {
      debugError(`Error attaching track to ${props.userId}:`, error)
    }
  }
}

watch(
  () => props.videoTrack,
  async (newTrack, oldTrack) => {
    if (oldTrack && isLiveKitAttached.value && videoElement.value) {
      try {
        oldTrack.detach(videoElement.value)
        isLiveKitAttached.value = false
      } catch (error) {
        debugWarn(`Error detaching track from ${props.userId}:`, error)
      }
    }

    if (selfViewStream.value) {
      selfViewStream.value = null
    }

    if (newTrack && videoElement.value) {
      pendingTrack.value = null
      await attachTrackToElement(newTrack, videoElement.value)
    } else if (newTrack && !videoElement.value) {
      pendingTrack.value = newTrack
    } else if (!newTrack && videoElement.value) {
      videoElement.value.srcObject = null
      pendingTrack.value = null
    }
  },
)

watch(isPausedComputed, (isPaused) => {
  if (!videoElement.value || !props.isSelfView) return
  if (isPaused) {
    videoElement.value.pause()
  } else {
    videoElement.value.play().catch(() => {})
  }
})

watch(
  () => props.volume,
  (newVolume) => {
    if (newVolume !== undefined) {
      localVolume.value = newVolume
    }
  },
  { immediate: true },
)

const toggleFullscreen = async () => {
  const container = videoContainerRef.value
  if (!container) return
  try {
    if (!document.fullscreenElement) {
      await container.requestFullscreen()
      isFullscreen.value = true
      showFullscreenControls()
    } else {
      await document.exitFullscreen()
      isFullscreen.value = false
    }
  } catch (error) {
    debugError("Fullscreen error:", error)
  }
}

const showFullscreenControls = () => {
  fullscreenControlsVisible.value = true
  if (fullscreenControlsTimer) clearTimeout(fullscreenControlsTimer)
  fullscreenControlsTimer = setTimeout(() => {
    fullscreenControlsVisible.value = false
  }, 3000)
}

const onFullscreenMousemove = () => {
  if (isFullscreen.value) showFullscreenControls()
}

const toggleCallMute = () => {
  const newValue = !callStore.isMuted
  if (newValue) playMute()
  else playUnmute()
  callStore.setMuted(newValue)
  const roomId = roomStore.activeRoomId
  if (roomId) wsService.sendMuteState(roomId, newValue)
  roomStore.updateUserStatus(userStore.userId, { is_muted: newValue })
}

const toggleCallDeafen = () => {
  const newValue = !callStore.isDeafened
  if (newValue) playDeafen()
  else playUndeafen()
  callStore.setDeafened(newValue)
  const roomId = roomStore.activeRoomId
  if (roomId) wsService.sendDeafenState(roomId, newValue)
  roomStore.updateUserStatus(userStore.userId, {
    is_deafened: newValue,
    is_muted: callStore.isMuted,
  })
}

const togglePiP = async () => {
  if (!videoElement.value) return
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture()
    } else {
      if (!videoElement.value.srcObject && props.videoTrack) {
        const mediaStreamTrack = props.videoTrack.mediaStreamTrack
        if (mediaStreamTrack) {
          videoElement.value.srcObject = new MediaStream([mediaStreamTrack])
        }
      }
      if (videoElement.value.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Video not ready")), 5000)
          videoElement.value!.addEventListener(
            "loadeddata",
            () => {
              clearTimeout(timeout)
              resolve()
            },
            { once: true },
          )
        })
      }
      await videoElement.value.requestPictureInPicture()
    }
  } catch (error) {
    debugError("Picture-in-Picture error:", error)
  }
}

const forwardVolumeChange = (volume: number) => {
  if (volume > 0) isMuted.value = false
  emit("volume-change", volume, true)
}

const toggleMute = () => {
  if (isMuted.value) {
    isMuted.value = false
    localVolume.value = previousVolume.value || 80
    emit("volume-change", localVolume.value, true)
  } else {
    previousVolume.value = localVolume.value
    localVolume.value = 0
    isMuted.value = true
    emit("volume-change", 0, true)
  }
}

const handleFullscreenChange = () => {
  const wasFullscreen = isFullscreen.value
  isFullscreen.value = !!document.fullscreenElement
  if (isFullscreen.value && !wasFullscreen) {
    showFullscreenControls()
  }
}

onMounted(() => {
  const trackToAttach = pendingTrack.value || props.videoTrack
  if (trackToAttach && videoElement.value && !isLiveKitAttached.value && !selfViewStream.value) {
    pendingTrack.value = null
    void attachTrackToElement(trackToAttach, videoElement.value)
  }
  if (videoElement.value && videoElement.value.videoWidth > 0) {
    handleVideoMetadata()
  }
  document.addEventListener("fullscreenchange", handleFullscreenChange)
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange)
})

onUnmounted(() => {
  document.removeEventListener("fullscreenchange", handleFullscreenChange)
  document.removeEventListener("webkitfullscreenchange", handleFullscreenChange)
  if (videoElement.value) {
    videoElement.value.removeEventListener("enterpictureinpicture", () => {})
    videoElement.value.removeEventListener("leavepictureinpicture", () => {})
  }
  if (props.videoTrack && videoElement.value && isLiveKitAttached.value) {
    props.videoTrack.detach(videoElement.value)
  }
  if (document.pictureInPictureElement === videoElement.value) {
    document.exitPictureInPicture().catch(() => {})
  }
})
</script>
