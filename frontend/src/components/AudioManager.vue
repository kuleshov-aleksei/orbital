<template>
  <!-- AudioManager: Hidden container that manages all audio playback -->
  <!-- Audio elements are created/destroyed programmatically using LiveKit's attach() -->
  <div ref="audioContainer" class="audio-manager hidden" aria-hidden="true" />
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, useTemplateRef } from "vue"
import type { RemoteAudioTrack } from "livekit-client"

interface Props {
  audioTracks: Map<string, RemoteAudioTrack>
  volumes: Map<string, number>
  isDeafened: boolean
  mutedUsers: Set<string>
}

const props = defineProps<Props>()

const audioContainer = useTemplateRef<HTMLElement>("audioContainer")

// Track created audio elements by userId
const audioElements = ref<Map<string, HTMLAudioElement>>(new Map())

// Create audio element for a user
const createAudioElement = (userId: string, track: RemoteAudioTrack): HTMLAudioElement => {
  // Use LiveKit's attach() to create audio element from track
  const element = track.attach() as HTMLAudioElement

  // Apply initial settings
  const volume = props.volumes.get(userId) ?? 80
  element.volume = volume / 100

  const isMuted = props.mutedUsers.has(userId)
  element.muted = props.isDeafened || isMuted

  element.autoplay = true

  // Append to container
  if (audioContainer.value) {
    audioContainer.value.appendChild(element)
  }

  // Play the audio
  element.play().catch(() => {
    // Silently ignore play errors
  })

  audioElements.value.set(userId, element)
  return element
}

// Remove audio element for a user
const removeAudioElement = (userId: string) => {
  const element = audioElements.value.get(userId)
  if (element) {
    // Use LiveKit's detach() to properly clean up
    const track = props.audioTracks.get(userId)
    if (track) {
      track.detach(element)
    } else {
      // Fallback: just remove from DOM
      element.remove()
    }
    audioElements.value.delete(userId)
  }
}

// Watch for track changes
watch(
  () => props.audioTracks,
  (newTracks, oldTracks) => {
    // Handle new tracks - create audio elements
    newTracks.forEach((track, userId) => {
      if (!audioElements.value.has(userId)) {
        createAudioElement(userId, track)
      }
    })

    // Handle removed tracks - remove audio elements
    oldTracks?.forEach((track, userId) => {
      if (!newTracks.has(userId)) {
        removeAudioElement(userId)
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
  // Detach all tracks using LiveKit's detach
  audioElements.value.forEach((element, userId) => {
    const track = props.audioTracks.get(userId)
    if (track) {
      track.detach(element)
    } else {
      element.remove()
    }
  })
  audioElements.value.clear()
})

// Expose methods
const muteUser = (userId: string, muted: boolean) => {
  const element = audioElements.value.get(userId)
  if (element) {
    element.muted = props.isDeafened || muted
  }
}

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
