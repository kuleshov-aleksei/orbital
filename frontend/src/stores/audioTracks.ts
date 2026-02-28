import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { RemoteAudioTrack } from "livekit-client"

export const useAudioTracksStore = defineStore("audioTracks", () => {
  // Remote audio tracks - Map<userId, track>
  // Using a plain object with reactive inner Map to ensure reactivity
  const tracksMap = ref<Map<string, RemoteAudioTrack>>(new Map())

  // Helper to trigger reactivity by creating a new Map reference
  const updateMap = (updater: (map: Map<string, RemoteAudioTrack>) => void) => {
    updater(tracksMap.value)
    // Create a new Map to trigger Vue reactivity
    tracksMap.value = new Map(tracksMap.value)
  }

  // Add or update a track for a user
  const setTrack = (userId: string, track: RemoteAudioTrack | null) => {
    console.log(`[AudioStore] setTrack: ${userId}, track: ${track ? "present" : "null"}`)
    if (track) {
      updateMap((map) => map.set(userId, track))
    } else {
      removeTrack(userId)
    }
  }

  // Remove track for a user
  const removeTrack = (userId: string) => {
    console.log(`[AudioStore] removeTrack: ${userId}`)
    updateMap((map) => map.delete(userId))
  }

  // Get track for a user
  const getTrack = (userId: string): RemoteAudioTrack | undefined => {
    return tracksMap.value.get(userId)
  }

  // Check if track exists for a user
  const hasTrack = (userId: string): boolean => {
    return tracksMap.value.has(userId)
  }

  // Get all tracks
  const getAllTracks = (): Map<string, RemoteAudioTrack> => {
    return tracksMap.value
  }

  // Clear all tracks
  const clearAll = () => {
    console.log(`[AudioStore] clearAll`)
    tracksMap.value = new Map()
  }

  // Get track count
  const trackCount = (): number => {
    return tracksMap.value.size
  }

  // Expose the reactive tracks for watching
  const remoteAudioTracks = computed(() => tracksMap.value)

  return {
    remoteAudioTracks,
    setTrack,
    removeTrack,
    getTrack,
    hasTrack,
    getAllTracks,
    clearAll,
    trackCount,
  }
})
