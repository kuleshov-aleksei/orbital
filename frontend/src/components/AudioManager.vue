<template>
  <!-- AudioManager: Hidden component that manages all audio playback -->
  <!-- This component creates audio elements in a hidden container -->
  <div class="audio-manager hidden" aria-hidden="true">
    <audio
      v-for="[userId] in audioTracks"
      :key="userId"
      :ref="(el) => setAudioElement(userId, el as HTMLAudioElement)"
      autoplay
      playsinline />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue"
import type { RemoteAudioTrack } from "livekit-client"

interface Props {
  audioTracks: Map<string, RemoteAudioTrack>
  volumes: Map<string, number>
  isDeafened: boolean
  mutedUsers: Set<string>
}

const props = defineProps<Props>()

// Store references to audio elements
const audioElements = ref<Map<string, HTMLAudioElement>>(new Map())

// Store track attachment state to prevent duplicate attachments
const attachedTracks = ref<Map<string, boolean>>(new Map())

// Track pending attachments that need retry
const pendingAttachments = ref<Set<string>>(new Set())

// Set audio element reference
const setAudioElement = (userId: string, element: HTMLAudioElement | null) => {
  if (element) {
    audioElements.value.set(userId, element)
    // Try to attach track immediately
    void attachTrackToElement(userId, element)
  } else {
    // Element was removed - cleanup
    audioElements.value.delete(userId)
    attachedTracks.value.delete(userId)
    pendingAttachments.value.delete(userId)
  }
}

// Attach track to audio element
const attachTrackToElement = async (userId: string, element: HTMLAudioElement) => {
  // Prevent duplicate attachments
  if (attachedTracks.value.get(userId)) {
    return
  }

  const track = props.audioTracks.get(userId)
  if (!track || !track.mediaStreamTrack) {
    // Track not available yet, mark as pending for retry
    pendingAttachments.value.add(userId)
    return
  }

  try {
    // Create MediaStream from track
    const stream = new MediaStream([track.mediaStreamTrack])
    element.srcObject = stream

    // Apply initial volume
    const volume = props.volumes.get(userId) ?? 80
    element.volume = volume / 100

    // Apply mute/deafen state
    const isMuted = props.mutedUsers.has(userId)
    element.muted = props.isDeafened || isMuted

    // Mark as attached
    attachedTracks.value.set(userId, true)
    pendingAttachments.value.delete(userId)

    // Play the audio
    await element.play().catch(() => {
      // Silently ignore play errors (common during rapid changes)
    })
  } catch (error) {
    console.warn(`[AudioManager] Failed to attach track for ${userId}:`, error)
  }
}

// Retry pending attachments when tracks become available
const retryPendingAttachments = () => {
  pendingAttachments.value.forEach((userId) => {
    const element = audioElements.value.get(userId)
    if (element) {
      void attachTrackToElement(userId, element)
    }
  })
}

// Watch for new tracks and attach them
watch(
  () => props.audioTracks,
  (newTracks, oldTracks) => {
    // First, retry any pending attachments
    retryPendingAttachments()

    // Handle new tracks
    newTracks.forEach((track, userId) => {
      const element = audioElements.value.get(userId)
      if (element && !attachedTracks.value.get(userId)) {
        void attachTrackToElement(userId, element)
      }
    })

    // Handle removed tracks - detach them
    oldTracks?.forEach((_, userId) => {
      if (!newTracks.has(userId)) {
        const element = audioElements.value.get(userId)
        if (element) {
          element.srcObject = null
          attachedTracks.value.delete(userId)
          pendingAttachments.value.delete(userId)
        }
      }
    })
  },
  { deep: true },
)

// Watch for volume changes
watch(
  () => props.volumes,
  (newVolumes) => {
    newVolumes.forEach((volume, userId) => {
      const element = audioElements.value.get(userId)
      if (element) {
        element.volume = volume / 100
      }
    })
  },
  { deep: true },
)

// Watch for deafen state changes
watch(
  () => props.isDeafened,
  (isDeafened) => {
    audioElements.value.forEach((element, userId) => {
      const isMuted = props.mutedUsers.has(userId)
      element.muted = isDeafened || isMuted
    })
  },
)

// Watch for muted users changes
watch(
  () => props.mutedUsers,
  (newMutedUsers, oldMutedUsers) => {
    // Handle newly muted users
    newMutedUsers.forEach((userId) => {
      if (!oldMutedUsers?.has(userId)) {
        const element = audioElements.value.get(userId)
        if (element) {
          element.muted = true
        }
      }
    })

    // Handle unmuted users
    oldMutedUsers?.forEach((userId) => {
      if (!newMutedUsers.has(userId)) {
        const element = audioElements.value.get(userId)
        if (element) {
          element.muted = props.isDeafened
        }
      }
    })
  },
  { deep: true },
)

// Cleanup on unmount
onUnmounted(() => {
  // Detach all tracks
  audioElements.value.forEach((element) => {
    element.srcObject = null
    element.pause()
  })
  audioElements.value.clear()
  attachedTracks.value.clear()
  pendingAttachments.value.clear()
})

// Expose method to mute/unmute a specific user
const muteUser = (userId: string, muted: boolean) => {
  const element = audioElements.value.get(userId)
  if (element) {
    element.muted = props.isDeafened || muted
  }
}

// Expose method to set volume for a specific user
const setUserVolume = (userId: string, volume: number) => {
  const element = audioElements.value.get(userId)
  if (element) {
    element.volume = volume / 100
  }
}

defineExpose({
  muteUser,
  setUserVolume,
})
</script>

<style scoped>
.audio-manager {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
}
</style>
