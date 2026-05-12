<template>
  <div
    class="screen-stream relative bg-theme-bg-primary rounded-lg overflow-hidden border border-theme-border flex flex-col"
    :class="{ 'border-theme-accent ring-2 ring-theme-accent/50': isFocused }"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave">
    <!-- Video Container - maintains actual stream aspect ratio within available space -->
    <div class="relative flex items-center justify-center bg-black w-full h-full max-h-[70vh]">
      <video
        :id="`screen-${userId}`"
        ref="videoElement"
        class="object-contain max-h-[70vh]"
        :style="{ aspectRatio: videoAspectRatio }"
        autoplay
        playsinline
        controlsList="nofullscreen nodownload nomedia"
        @dblclick="toggleFullscreen"
        @loadedmetadata="handleVideoMetadata" />

      <!-- User Info Overlay -->
      <div
        class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <UserAvatar class="mr-2" :user-id="userId" :size="24" :show-status="false" />

            <div>
              <div class="text-theme-text-primary font-medium text-sm">
                {{ userNickname }}
              </div>

              <div class="text-xs text-theme-text-secondary flex items-center">
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
                'bg-theme-text-muted': !connectionState || connectionState === 'new',
              }" />

            <span class="text-theme-text-secondary capitalize">{{
              connectionState || "connecting"
            }}</span>
          </div>
        </div>
      </div>

      <!-- Controls Overlay -->
      <div
        class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3 transition-opacity duration-200"
        :class="{ 'opacity-100': isHovered, 'opacity-0': !isHovered }">
        <div class="flex items-center justify-between">
          <!-- Left: Make Focus Button (only when not focused in multi-stream mode) -->
          <div v-if="!isFocused && showFocusButton">
            <button
              type="button"
              class="px-3 py-1.5 bg-theme-bg-tertiary/80 hover:bg-theme-bg-hover rounded-lg text-theme-text-primary text-sm flex items-center transition-colors"
              @click="$emit('make-focused')">
              <PhArrowsOut class="w-4 h-4 mr-1" />
              Focus
            </button>
          </div>

          <div v-else />

          <!-- Right: Control Buttons -->
          <div class="flex items-center space-x-2">
            <!-- Volume Slider -->
            <div class="flex items-center space-x-2">
              <button
                type="button"
                class="p-1 hover:bg-theme-bg-hover/50 rounded transition-colors"
                :title="isMuted ? 'Unmute' : 'Mute'"
                @click="toggleMute">
                <PhSpeakerHigh
                  v-if="localVolume > 50 && !isMuted"
                  class="w-4 h-4 text-theme-text-primary" />
                <PhSpeakerLow
                  v-else-if="localVolume > 0 && !isMuted"
                  class="w-4 h-4 text-theme-text-primary" />
                <PhSpeakerNone v-else class="w-4 h-4 text-red-400" />
              </button>
              <input
                v-model.number="localVolume"
                type="range"
                min="0"
                max="100"
                class="w-20 h-1 bg-theme-bg-hover rounded-lg appearance-none cursor-pointer accent-theme-accent"
                @input="handleVolumeChange" />
            </div>

            <!-- Stop Watching Button -->
            <button
              type="button"
              class="px-2 py-1 bg-red-600/80 hover:bg-red-600 rounded-lg text-theme-text-primary text-xs flex items-center transition-colors"
              :title="isSelfView ? 'Stop sharing' : 'Stop watching'"
              @click="isSelfView ? $emit('stop-own-screen-share') : $emit('unsubscribe')">
              <PhImageBroken class="w-3 h-3 mr-1" />
              Stop
            </button>

            <button
              type="button"
              class="p-2 bg-theme-bg-tertiary/80 hover:bg-theme-bg-hover rounded-lg text-theme-text-primary transition-colors"
              :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
              @click="toggleFullscreen">
              <PhArrowsOut v-if="!isFullscreen" class="w-4 h-4" />

              <PhArrowsIn v-else class="w-4 h-4" />
            </button>

            <button
              type="button"
              class="p-2 bg-theme-bg-tertiary/80 hover:bg-theme-bg-hover rounded-lg text-theme-text-primary transition-colors"
              title="Picture in Picture"
              @click="togglePiP">
              <PhPictureInPicture class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div
        v-if="!videoTrack"
        class="absolute inset-0 flex items-center justify-center bg-theme-bg-primary">
        <div class="text-center">
          <PhSpinner class="w-8 h-8 text-theme-accent animate-spin mx-auto mb-2" />

          <span class="text-theme-text-muted text-sm">Connecting...</span>
        </div>
      </div>

      <!-- Paused State (for self-view when not hovered) -->
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
import {
  PhMonitorPlay,
  PhArrowsOut,
  PhArrowsIn,
  PhPictureInPicture,
  PhSpinner,
  PhPause,
  PhSpeakerHigh,
  PhSpeakerLow,
  PhSpeakerNone,
  PhImageBroken,
} from "@phosphor-icons/vue"
import type { ScreenShareQuality } from "@/types"
import type {
  RemoteVideoTrack,
  RemoteAudioTrack,
  LocalVideoTrack,
  LocalAudioTrack,
} from "livekit-client"
import UserAvatar from "@/components/UserAvatar.vue"

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
const isFullscreen = ref(false)
const isPiPActive = ref(false)
const isHovered = ref(false)
const videoWidth = ref(1920)
const videoHeight = ref(1080)
const localVolume = ref(80)
const previousVolume = ref(80)
const isMuted = ref(false)

// Track if LiveKit track is attached (for cleanup)
const isLiveKitAttached = ref(false)
// Self-view stream for non-LiveKit tracks
const selfViewStream = ref<MediaStream | null>(null)
// Pending track to attach when element becomes available
const pendingTrack = ref<typeof props.videoTrack>(null)

// Self-view pauses when not hovered
const isPausedComputed = computed(() => {
  return props.isSelfView && !isHovered.value
})

// Handle video metadata loaded to get actual dimensions
const handleVideoMetadata = () => {
  if (videoElement.value) {
    videoWidth.value = videoElement.value.videoWidth || 1920
    videoHeight.value = videoElement.value.videoHeight || 1080
    console.log(
      `Screen share dimensions for ${props.userId}: ${videoWidth.value}x${videoHeight.value} (ratio: ${(videoWidth.value / videoHeight.value).toFixed(2)})`,
    )
  }
}

const handleMouseEnter = () => {
  isHovered.value = true
}

const handleMouseLeave = () => {
  isHovered.value = false
}

const qualityLabels: Record<ScreenShareQuality, string> = {
  fullhd60: "Full HD 60fps",
  adaptive: "Adaptive",
  text: "Text Mode",
}

const qualityLabel = computed(() => qualityLabels[props.quality])

// Compute aspect ratio from actual video dimensions
const videoAspectRatio = computed(() => {
  if (videoHeight.value === 0) return "auto"
  return `${videoWidth.value} / ${videoHeight.value}`
})

// Function to attach track to video element
const attachTrackToElement = async (track: typeof props.videoTrack, element: HTMLVideoElement) => {
  if (!track || !element) return

  console.log(
    `[AdaptiveStream] Attaching track for ${props.userId}, isSelfView: ${props.isSelfView}`,
  )

  if (props.isSelfView) {
    // For self-view, use MediaStream approach (custom pause/resume support)
    selfViewStream.value = new MediaStream([track.mediaStreamTrack])
    element.srcObject = selfViewStream.value
    try {
      await element.play()
      console.log(`[AdaptiveStream] Self-view playing for ${props.userId}`)
    } catch (error) {
      console.warn(`[AdaptiveStream] Self-view play failed for ${props.userId}:`, error)
    }
  } else {
    // For remote views, use LiveKit attach for adaptive streaming
    try {
      track.attach(element)
      isLiveKitAttached.value = true
      console.log(`[AdaptiveStream] Attached track to ${props.userId}`)

      // Ensure video plays (sometimes attach doesn't auto-play)
      if (element.paused) {
        try {
          await element.play()
          console.log(`[AdaptiveStream] Video playing after attach for ${props.userId}`)
        } catch (playError) {
          console.warn(`[AdaptiveStream] Play after attach failed for ${props.userId}:`, playError)
        }
      }
    } catch (error) {
      console.error(`[AdaptiveStream] Error attaching track to ${props.userId}:`, error)
    }
  }
}

// Watch for track changes
watch(
  () => props.videoTrack,
  async (newTrack, oldTrack) => {
    // Detach old track if it was attached
    if (oldTrack && isLiveKitAttached.value && videoElement.value) {
      try {
        oldTrack.detach(videoElement.value)
        isLiveKitAttached.value = false
        console.log(`[AdaptiveStream] Detached track from ${props.userId}`)
      } catch (error) {
        console.warn(`[AdaptiveStream] Error detaching track from ${props.userId}:`, error)
      }
    }

    // Clear previous self-view stream
    if (selfViewStream.value) {
      selfViewStream.value = null
    }

    if (newTrack && videoElement.value) {
      pendingTrack.value = null
      await attachTrackToElement(newTrack, videoElement.value)
    } else if (newTrack && !videoElement.value) {
      // Track arrived but element not ready - store for later
      pendingTrack.value = newTrack
      console.log(
        `[AdaptiveStream] Track arrived but element not ready for ${props.userId}, storing for later`,
      )
    } else if (!newTrack && videoElement.value) {
      // Clear video element when track is null
      videoElement.value.srcObject = null
      pendingTrack.value = null
      console.log(`[AdaptiveStream] Cleared video element for ${props.userId}`)
    }
  },
)

// Actually pause/resume video for self-view
watch(isPausedComputed, (isPaused) => {
  if (!videoElement.value || !props.isSelfView) return

  if (isPaused) {
    videoElement.value.pause()
    console.log(`⏸️ Self-view paused for ${props.userId}`)
  } else {
    videoElement.value.play().catch((error) => {
      console.warn(`Failed to resume self-view for ${props.userId}:`, error)
    })
    console.log(`▶️ Self-view resumed for ${props.userId}`)
  }
})

// Watch for volume prop changes to update local state
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
    console.error("Fullscreen error:", error)
  }
}

const togglePiP = async () => {
  if (!videoElement.value) return

  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture()
      isPiPActive.value = false
    } else {
      // Ensure video element has a valid srcObject before attempting PiP
      // For LiveKit attached tracks, the element should have the stream attached
      if (!videoElement.value.srcObject && props.videoTrack) {
        // Try to get the MediaStream from the LiveKit track
        const mediaStreamTrack = props.videoTrack.mediaStreamTrack
        if (mediaStreamTrack) {
          videoElement.value.srcObject = new MediaStream([mediaStreamTrack])
        }
      }

      // Check if video is ready for PiP
      if (videoElement.value.readyState < 2) {
        // Have to wait for the video to have enough data
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
      isPiPActive.value = true
    }
  } catch (error) {
    console.error("Picture-in-Picture error:", error)
  }
}

const handleVolumeChange = () => {
  if (localVolume.value > 0) {
    isMuted.value = false
  }
  emit("volume-change", localVolume.value, true)
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

// Handle fullscreen change events
const handleFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement
}

const handlePiPChange = () => {
  isPiPActive.value = !!document.pictureInPictureElement
}

onMounted(() => {
  console.log(
    `[AdaptiveStream] Component mounted for ${props.userId}, has track: ${!!props.videoTrack}, has element: ${!!videoElement.value}, pending: ${!!pendingTrack.value}`,
  )

  // If we have a pending track or current track but haven't attached it yet, attach it now
  const trackToAttach = pendingTrack.value || props.videoTrack
  if (trackToAttach && videoElement.value && !isLiveKitAttached.value && !selfViewStream.value) {
    console.log(`[AdaptiveStream] Attaching track in onMounted for ${props.userId}`)
    pendingTrack.value = null
    void attachTrackToElement(trackToAttach, videoElement.value)
  }

  // Check if video already has metadata
  if (videoElement.value && videoElement.value.videoWidth > 0) {
    handleVideoMetadata()
  }

  document.addEventListener("fullscreenchange", handleFullscreenChange)
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange)
  videoElement.value?.addEventListener("enterpictureinpicture", handlePiPChange)
  videoElement.value?.addEventListener("leavepictureinpicture", handlePiPChange)
})

onUnmounted(() => {
  document.removeEventListener("fullscreenchange", handleFullscreenChange)
  document.removeEventListener("webkitfullscreenchange", handleFullscreenChange)
  videoElement.value?.removeEventListener("enterpictureinpicture", handlePiPChange)
  videoElement.value?.removeEventListener("leavepictureinpicture", handlePiPChange)

  // Detach LiveKit track if attached
  if (props.videoTrack && videoElement.value && isLiveKitAttached.value) {
    props.videoTrack.detach(videoElement.value)
    console.log(`[AdaptiveStream] Detached track from ${props.userId} (unmount)`)
  }

  // Clean up PiP if active
  if (document.pictureInPictureElement === videoElement.value) {
    document.exitPictureInPicture().catch(() => {})
  }
})
</script>
