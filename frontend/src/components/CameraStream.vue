<template>
  <div
    class="camera-stream relative bg-theme-bg-primary rounded-lg overflow-hidden border border-theme-border flex flex-col"
    :class="{ 'border-theme-accent ring-2 ring-theme-accent/50': isFocused }">
    <!-- Video Container -->
    <div class="relative flex items-center justify-center bg-black w-full h-full max-h-[70vh]">
      <video
        :id="`camera-${userId}`"
        ref="videoElement"
        class="object-contain max-h-full w-auto"
        :class="{ 'scale-x-[-1]': shouldMirror }"
        :style="{ aspectRatio: videoAspectRatio }"
        autoplay
        playsinline
        muted
        @dblclick="toggleFullscreen"
        @loadedmetadata="handleVideoMetadata" />

      <!-- User Info Overlay -->
      <div
        class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent px-3 py-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <UserAvatar class="mr-2" :user-id="userId" :size="24" :show-status="false" />

            <div class="text-theme-text-primary font-medium text-sm truncate max-w-[150px]">
              {{ userNickname }}
            </div>
          </div>

          <!-- Self-view indicator -->
          <div
            v-if="isSelfView"
            class="text-xs text-theme-accent bg-theme-accent/20 px-2 py-0.5 rounded">
            You
          </div>
        </div>
      </div>

      <!-- Controls Overlay -->
      <div
        class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 opacity-0 hover:opacity-100 transition-opacity duration-200">
        <div class="flex items-center justify-end space-x-2">
          <button
            type="button"
            class="p-1.5 bg-theme-bg-tertiary/80 hover:bg-theme-bg-hover rounded-lg text-theme-text-primary transition-colors"
            :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
            @click="toggleFullscreen">
            <PhArrowsOut v-if="!isFullscreen" class="w-3.5 h-3.5" />

            <PhArrowsIn v-else class="w-3.5 h-3.5" />
          </button>

          <button
            v-if="showPiPButton"
            type="button"
            class="p-1.5 bg-theme-bg-tertiary/80 hover:bg-theme-bg-hover rounded-lg text-theme-text-primary transition-colors"
            title="Picture in Picture"
            @click="togglePiP">
            <PhPictureInPicture class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div
        v-if="!videoTrack"
        class="absolute inset-0 flex items-center justify-center bg-theme-bg-primary">
        <div class="text-center">
          <PhSpinner class="w-6 h-6 text-theme-accent animate-spin mx-auto mb-2" />

          <span class="text-theme-text-muted text-xs">Connecting...</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from "vue"
import { PhArrowsOut, PhArrowsIn, PhPictureInPicture, PhSpinner } from "@phosphor-icons/vue"
import type { RemoteVideoTrack, LocalVideoTrack } from "livekit-client"
import UserAvatar from "@/components/UserAvatar.vue"
import { useVideoSettingsStore } from "@/stores"

interface Props {
  userId: string
  userNickname: string
  videoTrack: RemoteVideoTrack | LocalVideoTrack | null
  connectionState?: string
  isFocused?: boolean
  isSelfView?: boolean
  isCompact?: boolean
  showPiPButton?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  connectionState: "connecting",
  isFocused: false,
  isSelfView: false,
  isCompact: false,
  showPiPButton: true,
})

const videoElement = useTemplateRef<HTMLVideoElement>("videoElement")
const isFullscreen = ref(false)
const isPiPActive = ref(false)
const videoWidth = ref(1280)
const videoHeight = ref(720)

const videoSettingsStore = useVideoSettingsStore()

const shouldMirror = computed(() => {
  return props.isSelfView && videoSettingsStore.isMirrored
})

// Compute aspect ratio from actual video dimensions
const videoAspectRatio = computed(() => {
  if (videoHeight.value === 0) return "auto"
  return `${videoWidth.value} / ${videoHeight.value}`
})

// Track if LiveKit track is attached (for cleanup)
const isLiveKitAttached = ref(false)
// Self-view stream for non-LiveKit tracks
const selfViewStream = ref<MediaStream | null>(null)
// Pending track to attach when element becomes available
const pendingTrack = ref<typeof props.videoTrack>(null)

// Handle video metadata loaded to get actual dimensions
const handleVideoMetadata = () => {
  if (videoElement.value) {
    videoWidth.value = videoElement.value.videoWidth || 1280
    videoHeight.value = videoElement.value.videoHeight || 720
  }
}

// Function to attach track to video element
const attachTrackToElement = async (track: typeof props.videoTrack, element: HTMLVideoElement) => {
  if (!track || !element) return

  if (props.isSelfView) {
    // For self-view, use MediaStream approach (custom pause/resume support)
    selfViewStream.value = new MediaStream([track.mediaStreamTrack])
    element.srcObject = selfViewStream.value
    try {
      await element.play()
    } catch {
      // Silently ignore play errors
    }
  } else {
    // For remote views, use LiveKit attach for adaptive streaming
    try {
      track.attach(element)
      isLiveKitAttached.value = true

      // Ensure video plays (sometimes attach doesn't auto-play)
      if (element.paused) {
        try {
          await element.play()
        } catch {
          // Silently ignore play errors
        }
      }
    } catch (error) {
      console.error(`[CameraStream] Error attaching track to ${props.userId}:`, error)
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
      } catch {
        // Silently ignore detach errors
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
    } else if (!newTrack && videoElement.value) {
      // Clear video element when track is null
      videoElement.value.srcObject = null
      pendingTrack.value = null
    }
  },
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
      await videoElement.value.requestPictureInPicture()
      isPiPActive.value = true
    }
  } catch (error) {
    console.error("Picture-in-Picture error:", error)
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
  // If we have a pending track or current track but haven't attached it yet, attach it now
  const trackToAttach = pendingTrack.value || props.videoTrack
  if (trackToAttach && videoElement.value && !isLiveKitAttached.value && !selfViewStream.value) {
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
  }

  // Clean up PiP if active
  if (document.pictureInPictureElement === videoElement.value) {
    document.exitPictureInPicture().catch(() => {})
  }
})
</script>
