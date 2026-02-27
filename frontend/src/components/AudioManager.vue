<template>
  <!-- AudioManager: Hidden container that manages all audio playback -->
  <!-- Audio elements are created/destroyed programmatically using LiveKit's attach() -->
  <div ref="audioContainer" class="audio-manager hidden" aria-hidden="true" />
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, useTemplateRef } from "vue"
import type { RemoteAudioTrack } from "livekit-client"
import { useAudioTracksStore } from "@/stores/audioTracks"

interface Props {
  volumes: Map<string, number>
  isDeafened: boolean
  mutedUsers: Set<string>
}

const props = defineProps<Props>()

// Use shared store for audio tracks
const audioTracksStore = useAudioTracksStore()

const audioContainer = useTemplateRef<HTMLElement>("audioContainer")

// Track created audio elements by userId
const audioElements = ref<Map<string, HTMLAudioElement>>(new Map())

// Create audio element for a user
const createAudioElement = (userId: string, track: RemoteAudioTrack): HTMLAudioElement => {
  console.log(`[AudioManager] Creating audio element for user: ${userId}, track sid: ${track.sid}`)

  // Use LiveKit's attach() to create audio element from track
  const element = track.attach() as HTMLAudioElement
  console.log(`[AudioManager] Attached track to element for ${userId}, element:`, element)

  // Apply initial settings
  const volume = props.volumes.get(userId) ?? 80
  element.volume = volume / 100
  console.log(`[AudioManager] Set initial volume for ${userId}: ${volume}`)

  const isMuted = props.mutedUsers.has(userId)
  element.muted = props.isDeafened || isMuted
  console.log(`[AudioManager] Set initial mute for ${userId}: ${element.muted}`)

  element.autoplay = true

  // Append to container
  if (audioContainer.value) {
    audioContainer.value.appendChild(element)
    console.log(`[AudioManager] Appended element to container for ${userId}`)
  } else {
    console.warn(`[AudioManager] Audio container not ready for ${userId}!`)
  }

  // Play the audio
  element
    .play()
    .then(() => {
      console.log(`[AudioManager] Playing audio for ${userId}`)
    })
    .catch((err) => {
      console.warn(`[AudioManager] Failed to play audio for ${userId}:`, err)
    })

  audioElements.value.set(userId, element)
  console.log(
    `[AudioManager] Created audio element for ${userId}, total elements: ${audioElements.value.size}`,
  )
  return element
}

// Remove audio element for a user
const removeAudioElement = (userId: string) => {
  console.log(`[AudioManager] Removing audio element for user: ${userId}`)
  const element = audioElements.value.get(userId)
  if (element) {
    // Use LiveKit's detach() to properly clean up
    const track = audioTracksStore.getTrack(userId)
    if (track) {
      track.detach(element)
      console.log(`[AudioManager] Detached track for ${userId}`)
    } else {
      // Fallback: just remove from DOM
      element.remove()
      console.log(`[AudioManager] Removed element from DOM for ${userId}`)
    }
    audioElements.value.delete(userId)
    console.log(
      `[AudioManager] Removed audio element for ${userId}, remaining: ${audioElements.value.size}`,
    )
  } else {
    console.warn(`[AudioManager] No audio element found for ${userId}`)
  }
}

// Watch for track changes from the store
watch(
  () => audioTracksStore.remoteAudioTracks,
  (newTracks, oldTracks) => {
    console.log(
      `[AudioManager] Track change detected. Old: ${oldTracks?.size || 0}, New: ${newTracks.size}`,
    )

    // Handle new tracks - create audio elements
    newTracks.forEach((track, userId) => {
      console.log(
        `[AudioManager] Checking track for ${userId}, has element: ${audioElements.value.has(userId)}`,
      )
      if (!audioElements.value.has(userId)) {
        console.log(`[AudioManager] Creating NEW audio element for ${userId}`)
        createAudioElement(userId, track)
      }
    })

    // Handle removed tracks - remove audio elements
    oldTracks?.forEach((track, userId) => {
      if (!newTracks.has(userId)) {
        console.log(`[AudioManager] Removing audio element for disconnected user ${userId}`)
        removeAudioElement(userId)
      }
    })

    console.log(`[AudioManager] After track change, total elements: ${audioElements.value.size}`)
  },
  { deep: true },
)

// Watch for volume changes
watch(
  () => props.volumes,
  (newVolumes) => {
    console.log(`[AudioManager] Volume change detected`)
    newVolumes.forEach((volume, userId) => {
      const element = audioElements.value.get(userId)
      if (element) {
        element.volume = volume / 100
        console.log(`[AudioManager] Updated volume for ${userId}: ${volume}`)
      }
    })
  },
  { deep: true },
)

// Watch for deafen state changes
watch(
  () => props.isDeafened,
  (isDeafened) => {
    console.log(`[AudioManager] Deafen state changed: ${isDeafened}`)
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
    console.log(`[AudioManager] Muted users changed`)
    // Handle newly muted users
    newMutedUsers.forEach((userId) => {
      if (!oldMutedUsers?.has(userId)) {
        const element = audioElements.value.get(userId)
        if (element) {
          element.muted = true
          console.log(`[AudioManager] Muted user ${userId}`)
        }
      }
    })

    // Handle unmuted users
    oldMutedUsers?.forEach((userId) => {
      if (!newMutedUsers.has(userId)) {
        const element = audioElements.value.get(userId)
        if (element) {
          element.muted = props.isDeafened
          console.log(`[AudioManager] Unmuted user ${userId}`)
        }
      }
    })
  },
  { deep: true },
)

// Cleanup on unmount
onUnmounted(() => {
  console.log(`[AudioManager] Unmounting, cleaning up ${audioElements.value.size} elements`)
  // Detach all tracks using LiveKit's detach
  audioElements.value.forEach((element, userId) => {
    const track = audioTracksStore.getTrack(userId)
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
