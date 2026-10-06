import { ref } from "vue"
import { useAudioSettingsStore } from "@/stores/audioSettings"
import { useCallStore } from "@/stores/call"
import { getLiveKitAudioConstraints } from "@/services/livekit-audio-processors"
import { getTrackProcessor, isWasmAlgorithm } from "@/services/audio"
import { createLocalAudioTrack } from "livekit-client"
import type { LocalAudioTrack, LocalTrackPublication } from "livekit-client"
import { debugLog, debugWarn, debugError } from "@/utils/debug"
import type { LiveKitState } from "./useLiveKitState"

const RNNOISE_REQUIRED_SAMPLE_RATE = 48000

function getFallbackAlgorithm(): "livekit-native" | "browser-native" {
  return "livekit-native"
}

function getPublicationSid(publication: LocalTrackPublication | null): string {
  // Takes the publication as a parameter (rather than reading
  // state.localAudioPublication.value inline) so TypeScript control-flow
  // narrowing from earlier assignments in the caller can't reduce it to null.
  return publication?.trackSid ?? "none"
}

export function useLiveKitAudio(state: LiveKitState) {
  const audioSettingsStore = useAudioSettingsStore()
  const activeWasmAlgorithm = ref<"rnnoise" | "speex" | null>(null)

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
      activeWasmAlgorithm.value = null
    }

    if (!state.localStreamPromise.value) {
      state.localStreamPromise.value = (async () => {
        try {
          if (!audioSettingsStore.isLoaded) {
            audioSettingsStore.loadSettings()
          }

          let selectedAlgorithm = audioSettingsStore.noiseSuppressionAlgorithm
          const noiseSuppressionEnabled = audioSettingsStore.noiseSuppressionEnabled
          activeWasmAlgorithm.value = null

          if (!noiseSuppressionEnabled) {
            selectedAlgorithm = "off"
          }

          const inputDeviceId = audioSettingsStore.inputDeviceId

          debugLog(`[LiveKit][INFO]: Initializing audio track with algorithm: ${selectedAlgorithm}`)

          if (selectedAlgorithm === "rnnoise" || selectedAlgorithm === "speex") {
            try {
              const audioConstraints = getLiveKitAudioConstraints(selectedAlgorithm)

              const track = await createLocalAudioTrack({
                noiseSuppression: false,
                autoGainControl: audioConstraints.autoGainControl,
                echoCancellation: audioConstraints.echoCancellation,
                sampleRate:
                  selectedAlgorithm === "rnnoise" ? RNNOISE_REQUIRED_SAMPLE_RATE : undefined,
                deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
              })

              const trackSettings = track.mediaStreamTrack.getSettings()
              const actualSampleRate = trackSettings.sampleRate
              debugLog(`[LiveKit][INFO]: Audio track created with sample rate: ${actualSampleRate}`)

              if (
                selectedAlgorithm === "rnnoise" &&
                actualSampleRate !== RNNOISE_REQUIRED_SAMPLE_RATE &&
                actualSampleRate !== undefined
              ) {
                debugWarn(
                  `[LiveKit][WARN]: RNNoise requires ${RNNOISE_REQUIRED_SAMPLE_RATE}Hz but got ${actualSampleRate}Hz. Falling back to speex`,
                )
                track.stop()
                selectedAlgorithm = "speex"
              }

              if (selectedAlgorithm === "rnnoise" || selectedAlgorithm === "speex") {
                activeWasmAlgorithm.value = selectedAlgorithm
                state.localAudioTrack.value = track
                debugLog(
                  `[LiveKit][INFO]: Audio track initialized successfully with ${selectedAlgorithm}`,
                )
                return track
              }
            } catch (error) {
              debugError(
                `[LiveKit][ERROR]: Failed to create audio track with ${selectedAlgorithm}:`,
                error,
              )
              const fallback = "speex"
              if (selectedAlgorithm === "rnnoise") {
                selectedAlgorithm = fallback
              } else {
                selectedAlgorithm = getFallbackAlgorithm()
              }
            }
          }

          const audioConstraints = getLiveKitAudioConstraints(selectedAlgorithm)

          const track = await createLocalAudioTrack({
            noiseSuppression: audioConstraints.noiseSuppression,
            autoGainControl: audioConstraints.autoGainControl,
            echoCancellation: audioConstraints.echoCancellation,
            deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
          })

          state.localAudioTrack.value = track
          debugLog(
            `[LiveKit][INFO]: Audio track initialized successfully with algorithm: ${selectedAlgorithm}`,
          )
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
      const publication = await state.room.value.localParticipant.publishTrack(
        state.localAudioTrack.value,
      )
      state.localAudioPublication.value = publication
      debugLog(`[LiveKit][INFO]: 'Audio track published successfully'`)

      const algorithm = activeWasmAlgorithm.value

      if (algorithm && isWasmAlgorithm(algorithm)) {
        const processor = getTrackProcessor(algorithm)
        if (processor) {
          try {
            debugLog(`[LiveKit][INFO]: Applying ${algorithm} noise suppression processor`)
            await state.localAudioTrack.value.setProcessor(processor)
            debugLog(
              `[LiveKit][INFO]: ${algorithm} noise suppression processor applied successfully`,
            )
          } catch (processorError) {
            // Non-fatal, but must be loud: the mic keeps working with raw audio while
            // noise suppression is silently off. A later retry (settings change,
            // reinitialize, reconnect recovery) can restore it.
            debugError(
              `[LiveKit][ERROR]: Failed to apply ${algorithm} processor, continuing with raw audio:`,
              processorError,
            )
          }
        }
      }
    } catch (error) {
      console.error("Failed to publish audio track:", error)
      console.error(`[LiveKit][ERROR]: Failed to publish audio: ${(error as Error).message}`)
    }
  }

  const unpublishAudioTrack = async (): Promise<void> => {
    if (!state.room.value) {
      return
    }

    try {
      const localParticipant = state.room.value.localParticipant
      const audioPublications = Array.from(localParticipant.trackPublications.values())

      for (const publication of audioPublications) {
        if (publication.kind === "audio" && publication.trackSid) {
          try {
            // @ts-expect-error - trackSid can be passed as string in LiveKit
            await localParticipant.unpublishTrack(publication.trackSid)
            debugLog(`[LiveKit][INFO]: Unpublished audio track: ${publication.trackSid}`)
          } catch (e) {
            debugWarn(`[LiveKit][WARN]: Failed to unpublish track ${publication.trackSid}:`, e)
          }
        }
      }

      state.localAudioPublication.value = null
      debugLog(`[LiveKit][INFO]: 'Audio track unpublished'}`)
    } catch (error) {
      debugError("Failed to unpublish audio track:", error)
    }
  }

  const applyMuteState = async (muted: boolean): Promise<void> => {
    if (!state.room.value || !state.isConnected.value) {
      debugLog(`[LiveKit][INFO]: Cannot apply mute state - room not ready`)
      return
    }

    // The signal connection is down while reconnecting - any mute op would throw
    // (e.g. SignalRequestError from the metadata update) as an unhandled rejection.
    // Skip it: the intent is preserved in the call store and re-synced after
    // reconnect by recoverLocalAudioAfterReconnect().
    if (state.isReconnecting.value) {
      debugLog(
        `[LiveKit][INFO]: Skipping mute apply while reconnecting - will re-sync after reconnect`,
      )
      return
    }

    try {
      if (state.localAudioTrack.value) {
        debugLog(`[LiveKit][INFO]: Applying mute: ${muted}, using stored track`)
        if (muted) {
          await state.localAudioTrack.value.mute()
        } else {
          await state.localAudioTrack.value.unmute()
        }
        debugLog(`[LiveKit][INFO]: Microphone ${muted ? "muted" : "unmuted"}`)
      } else {
        debugWarn(`[LiveKit][WARN]: No local audio track, using setMicrophoneEnabled`)
        await state.room.value.localParticipant.setMicrophoneEnabled(!muted)
      }
    } catch (error) {
      debugError("Failed to apply mute state:", error)
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

    if (!state.isConnected.value || !state.room.value) {
      debugWarn(`[LiveKit][WARN]: Room not connected, skipping reinitialize`)
      return
    }

    try {
      await unpublishAudioTrack()
    } catch (e) {
      debugWarn(`[LiveKit][WARN]: Error unpublishing track:`, e)
    }

    if (state.localAudioTrack.value) {
      try {
        state.localAudioTrack.value.stop()
      } catch (e) {
        debugWarn(`[LiveKit][WARN]: Error stopping track:`, e)
      }
      state.localAudioTrack.value = null
    }

    state.localStreamPromise.value = null
    state.localAudioPublication.value = null

    await new Promise((resolve) => setTimeout(resolve, 300))

    if (!state.isConnected.value || !state.room.value) {
      debugWarn(`[LiveKit][WARN]: Room disconnected during reinitialize`)
      return
    }

    await initializeAudioTrack()

    if (!state.localAudioTrack.value) {
      debugWarn(`[LiveKit][WARN]: No audio track created`)
      return
    }

    await publishAudioTrack()

    debugLog(
      `[LiveKit][INFO]: 'Audio stream reinitialized, publication:', ${getPublicationSid(state.localAudioPublication.value)}`,
    )
  }

  /**
   * Verify and repair the local microphone pipeline after a LiveKit room reconnect.
   *
   * During a reconnect the LiveKit SDK restarts the local audio track, which also
   * restarts the noise suppression processor. If that processor restart throws
   * (e.g. the RNNoise worklet failed to load while the AudioContext was being
   * torn down), the SDK's track restart aborts before the track is re-attached
   * to the sender - leaving the mic dead while the user still appears in the room.
   * Nothing in the SDK retries this, so we do it here.
   *
   * @returns true if the local audio pipeline is (or was made) healthy
   */
  const recoverLocalAudioAfterReconnect = async (): Promise<boolean> => {
    if (!state.room.value || !state.isConnected.value) {
      debugWarn(`[LiveKit][WARN]: Cannot recover local audio after reconnect - room not ready`)
      return false
    }

    try {
      const localParticipant = state.room.value.localParticipant
      const publishedAudio = Array.from(localParticipant.audioTrackPublications.values())
      const track = state.localAudioTrack.value

      if (!track || !track.mediaStreamTrack || track.mediaStreamTrack.readyState !== "live") {
        debugWarn(
          `[LiveKit][WARN]: Local audio track missing or ended after reconnect, reinitializing audio stream`,
        )
        await reinitializeAudioStream()
        return !!state.localAudioTrack.value
      }

      if (publishedAudio.length === 0) {
        debugWarn(
          `[LiveKit][WARN]: Local audio track alive but unpublished after reconnect, republishing`,
        )
        await publishAudioTrack()
        return state.localAudioPublication.value !== null
      }

      // Track is alive and published - rebuild the noise suppression pipeline,
      // since the SDK's in-reconnect processor restart may have failed.
      const algorithm = activeWasmAlgorithm.value
      if (algorithm && isWasmAlgorithm(algorithm)) {
        try {
          const processor = getTrackProcessor(algorithm)
          if (processor) {
            debugLog(`[LiveKit][INFO]: Re-applying ${algorithm} processor after reconnect`)
            await track.setProcessor(processor)
            debugLog(
              `[LiveKit][INFO]: ${algorithm} processor re-applied successfully after reconnect`,
            )
          }
        } catch (processorError) {
          debugError(
            `[LiveKit][ERROR]: Failed to re-apply ${algorithm} processor after reconnect, continuing with raw audio:`,
            processorError,
          )
        }
      }

      // Sync the SDK mute state with the call store in case it drifted during reconnect
      const callStore = useCallStore()
      if (track.isMuted !== callStore.isMuted) {
        debugWarn(
          `[LiveKit][WARN]: Local mute state drifted during reconnect, re-applying: ${callStore.isMuted}`,
        )
        await applyMuteState(callStore.isMuted)
      }

      return true
    } catch (error) {
      debugError("[LiveKit][ERROR]: Failed to recover local audio after reconnect:", error)
      return false
    }
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
    recoverLocalAudioAfterReconnect,
  }
}
