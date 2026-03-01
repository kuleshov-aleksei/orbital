<template>
  <!-- AudioManager: Hidden container that manages all audio playback -->
  <!-- Audio elements are created/destroyed programmatically -->
  <div ref="audioContainer" class="audio-manager hidden" aria-hidden="true" />
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, onMounted, useTemplateRef } from "vue"
import type { RemoteAudioTrack } from "livekit-client"
import { useAudioTracksStore } from "@/stores/audioTracks"
import { debugLog, debugWarn } from "@/utils/debug"

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
// Track the sid of the attached track to detect reconnection
const attachedTrackSids = ref<Map<string, string>>(new Map())

// Create audio element for a user
const createAudioElement = (userId: string, track: RemoteAudioTrack): HTMLAudioElement => {
  debugLog(`[AudioManager] Creating audio element for user: ${userId}, track sid: ${track.sid}`)

  // Always create a new audio element (don't reuse)
  const element = document.createElement("audio")
  element.autoplay = true

  // Create MediaStream from track
  if (track.mediaStreamTrack) {
    const stream = new MediaStream([track.mediaStreamTrack])
    element.srcObject = stream
    debugLog(
      `[AudioManager] Created MediaStream for ${userId}, track readyState: ${track.mediaStreamTrack.readyState}`,
    )
  } else {
    debugWarn(`[AudioManager] No mediaStreamTrack for ${userId}!`)
  }

  // Apply initial settings
  const volume = props.volumes.get(userId) ?? 80
  element.volume = volume / 100

  const isMuted = props.mutedUsers.has(userId)
  element.muted = props.isDeafened || isMuted

  // Append to container
  if (audioContainer.value) {
    audioContainer.value.appendChild(element)
    debugLog(`[AudioManager] Appended element to container for ${userId}`)
  } else {
    debugWarn(`[AudioManager] Audio container not ready for ${userId}!`)
  }

  // Play the audio
  element
    .play()
    .then(() => {
      debugLog(`[AudioManager] Playing audio for ${userId}`)
    })
    .catch((err) => {
      debugWarn(`[AudioManager] Failed to play audio for ${userId}:`, err)
    })

  audioElements.value.set(userId, element)
  attachedTrackSids.value.set(userId, track.sid)

  debugLog(
    `[AudioManager] Created audio element for ${userId}, total elements: ${audioElements.value.size}`,
  )
  return element
}

// Remove audio element for a user
const removeAudioElement = (userId: string) => {
  debugLog(`[AudioManager] Removing audio element for user: ${userId}`)
  const element = audioElements.value.get(userId)
  if (element) {
    // Stop playback and clean up
    element.pause()
    element.srcObject = null
    element.remove()

    audioElements.value.delete(userId)
    attachedTrackSids.value.delete(userId)

    debugLog(
      `[AudioManager] Removed audio element for ${userId}, remaining: ${audioElements.value.size}`,
    )
  } else {
    debugWarn(`[AudioManager] No audio element found for ${userId}`)
  }
}

// Watch for track changes from the store
watch(
  () => audioTracksStore.remoteAudioTracks,
  (newTracks, oldTracks) => {
    debugLog(
      `[AudioManager] Track change detected. Old: ${oldTracks?.size || 0}, New: ${newTracks.size}`,
    )

    // First, clean up any elements whose tracks are no longer in the store
    // This handles the case where store goes 1→0 but audioElements still has stale entries
    const tracksToRemove: string[] = []
    audioElements.value.forEach((_, userId) => {
      if (!newTracks.has(userId)) {
        tracksToRemove.push(userId)
      }
    })
    tracksToRemove.forEach((userId) => {
      debugLog(`[AudioManager] Cleaning up stale element for ${userId} (track not in store)`)
      removeAudioElement(userId)
    })

    // Handle new tracks - ALWAYS create new element for each track
    newTracks.forEach((track, userId) => {
      const existingSid = attachedTrackSids.value.get(userId)
      const isNewTrack = existingSid !== track.sid

      debugLog(
        `[AudioManager] Checking track for ${userId}, sid: ${track.sid}, existingSid: ${existingSid}, isNewTrack: ${isNewTrack}`,
      )

      // Always remove existing and recreate on any track change (including reconnection)
      if (audioElements.value.has(userId)) {
        debugLog(
          `[AudioManager] Removing existing element for ${userId} (sid changed or reconnect)`,
        )
        removeAudioElement(userId)
      }

      debugLog(`[AudioManager] Creating NEW audio element for ${userId}`)
      createAudioElement(userId, track)
    })

    debugLog(`[AudioManager] After track change, total elements: ${audioElements.value.size}`)
  },
  { deep: true },
)

// Periodic check to ensure audio is still playing
let playCheckInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // Start periodic check every 3 seconds
  playCheckInterval = setInterval(() => {
    audioElements.value.forEach((element, userId) => {
      if (element.paused) {
        debugLog(`[AudioManager] Periodic check: element paused for ${userId}, attempting to play`)
        element.play().catch(() => {})
      }
    })
  }, 3000)
})

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
  debugLog(`[AudioManager] Unmounting, cleaning up ${audioElements.value.size} elements`)

  if (playCheckInterval) {
    clearInterval(playCheckInterval)
    playCheckInterval = null
  }

  audioElements.value.forEach((element) => {
    element.pause()
    element.srcObject = null
    element.remove()
  })
  audioElements.value.clear()
  attachedTrackSids.value.clear()
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
