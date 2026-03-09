import { useAudioSettingsStore } from "@/stores/audioSettings"
import { useAudioTracksStore } from "@/stores/audioTracks"
import { getLiveKitAudioConstraints } from "@/services/livekit-audio-processors"
import { createLocalAudioTrack } from "livekit-client"
import type { LocalAudioTrack, LocalTrackPublication } from "livekit-client"
import { debugLog, debugWarn } from "@/utils/debug"
import type { LiveKitState } from "./useLiveKitState"

export function useLiveKitAudio(state: LiveKitState) {
  const audioSettingsStore = useAudioSettingsStore()
  const audioTracksStore = useAudioTracksStore()

  const ensureLocalStream = async (): Promise<MediaStream | null> => {
    if (!state.localAudioTrack.value) {
      await initializeAudioTrack()
    }

    if (state.localAudioTrack.value) {
      return new MediaStream([state.localAudioTrack.value.mediaStreamTrack])
    }
    return null
  }

  const initializeAudioTrack = async (): Promise<LocalAudioTrack | null> => {
    if (state.localAudioTrack.value) {
      const mediaStreamTrack = state.localAudioTrack.value.mediaStreamTrack
      if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
        return state.localAudioTrack.value
      }
      debugLog(`[LiveKit][INFO]: Existing audio track ended, creating new track`)
      state.localAudioTrack.value.stop()
      state.localAudioTrack.value = null
      state.localStreamPromise.value = null
    }

    if (!state.localStreamPromise.value) {
      state.localStreamPromise.value = (async () => {
        try {
          if (!audioSettingsStore.isLoaded) {
            audioSettingsStore.loadSettings()
          }

          const algorithm = audioSettingsStore.noiseSuppressionAlgorithm

          debugLog(`[LiveKit][INFO]: Initializing audio track with algorithm: ${algorithm}`)

          const audioConstraints = getLiveKitAudioConstraints(algorithm)

          const track = await createLocalAudioTrack({
            noiseSuppression: audioConstraints.noiseSuppression,
            autoGainControl: audioConstraints.autoGainControl,
            echoCancellation: audioConstraints.echoCancellation,
          })

          state.localAudioTrack.value = track
          debugLog(`[LiveKit][INFO]: Audio track initialized successfully'}`)
          return track
        } catch (error) {
          console.error("Failed to initialize audio track:", error)
          console.error(`[LiveKit][ERROR]: Failed to initialize audio: ${(error as Error).message}`)
          return null
        }
      })()
    }

    return await state.localStreamPromise.value
  }

  const publishAudioTrack = async (): Promise<void> => {
    if (!state.room.value || !state.localAudioTrack.value) {
      debugWarn(`[LiveKit][WARN]: 'Cannot publish audio: room or track not ready'}`)
      return
    }

    try {
      debugLog(`[LiveKit][INFO]: 'Publishing audio track...'`)
      const publication = await state.room.value.localParticipant.publishTrack(state.localAudioTrack.value)
      state.localAudioPublication.value = publication
      debugLog(`[LiveKit][INFO]: 'Audio track published successfully'}`)
    } catch (error) {
      console.error("Failed to publish audio track:", error)
      console.error(`[LiveKit][ERROR]: Failed to publish audio: ${(error as Error).message}`)
    }
  }

  const unpublishAudioTrack = async (): Promise<void> => {
    if (!state.room.value || !state.localAudioPublication.value) {
      return
    }

    try {
      await state.room.value.localParticipant.unpublishTrack(state.localAudioPublication.value.trackSid)
      state.localAudioPublication.value = null
      debugLog(`[LiveKit][INFO]: 'Audio track unpublished'}`)
    } catch (error) {
      console.error("Failed to unpublish audio track:", error)
    }
  }

  const applyMuteState = async (muted: boolean): Promise<void> => {
    if (!state.room.value || !state.isConnected.value) {
      debugLog(`[LiveKit][INFO]: Cannot apply mute state - room not ready`)
      return
    }

    if (!state.localAudioPublication.value) {
      debugLog(`[LiveKit][INFO]: Cannot apply mute state - no audio track published yet`)
      return
    }

    try {
      await state.room.value.localParticipant.setMicrophoneEnabled(!muted)
      debugLog(`[LiveKit][INFO]: Microphone ${muted ? "muted" : "unmuted"}`)
    } catch (error) {
      console.error("Failed to apply mute state:", error)
    }
  }

  const applyDeafenState = (deafened: boolean): void => {
    state.remoteAudioTracks.value.forEach((track) => {
      track.setMuted(deafened)
    })
    debugLog(`[LiveKit][INFO]: Deafen ${deafened ? "enabled" : "disabled"}`)
  }

  const handleMuteToggle = (userId: string, isMuted: boolean): void => {
    const track = state.remoteAudioTracks.value.get(userId)
    if (track) {
      track.setMuted(isMuted)
    }
  }

  const reinitializeAudioStream = async (): Promise<void> => {
    debugLog(`[LiveKit][INFO]: 'Reinitializing audio stream...'`)

    await unpublishAudioTrack()

    if (state.localAudioTrack.value) {
      state.localAudioTrack.value.stop()
      state.localAudioTrack.value = null
    }

    state.localStreamPromise.value = null

    await initializeAudioTrack()
    await publishAudioTrack()

    debugLog(`[LiveKit][INFO]: 'Audio stream reinitialized'`)
  }

  return {
    ensureLocalStream,
    initializeAudioTrack,
    publishAudioTrack,
    unpublishAudioTrack,
    applyMuteState,
    applyDeafenState,
    handleMuteToggle,
    reinitializeAudioStream,
  }
}
