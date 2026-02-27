import { defineStore } from "pinia"
import { ref } from "vue"
import type { RemoteAudioTrack } from "livekit-client"

export const useAudioTracksStore = defineStore("audioTracks", () => {
  // Remote audio tracks - Map<userId, track>
  const remoteAudioTracks = ref<Map<string, RemoteAudioTrack>>(new Map())

  // Add or update a track for a user
  const setTrack = (userId: string, track: RemoteAudioTrack | null) => {
    console.log(`[AudioStore] setTrack: ${userId}, track: ${track ? "present" : "null"}`)
    if (track) {
      remoteAudioTracks.value.set(userId, track)
    } else {
      remoteAudioTracks.value.delete(userId)
    }
  }

  // Remove track for a user
  const removeTrack = (userId: string) => {
    console.log(`[AudioStore] removeTrack: ${userId}`)
    remoteAudioTracks.value.delete(userId)
  }

  // Get track for a user
  const getTrack = (userId: string): RemoteAudioTrack | undefined => {
    return remoteAudioTracks.value.get(userId)
  }

  // Check if track exists for a user
  const hasTrack = (userId: string): boolean => {
    return remoteAudioTracks.value.has(userId)
  }

  // Get all tracks
  const getAllTracks = (): Map<string, RemoteAudioTrack> => {
    return remoteAudioTracks.value
  }

  // Clear all tracks
  const clearAll = () => {
    console.log(`[AudioStore] clearAll`)
    remoteAudioTracks.value.clear()
  }

  // Get track count
  const trackCount = (): number => {
    return remoteAudioTracks.value.size
  }

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
