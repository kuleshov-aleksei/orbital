import { Track, ScreenSharePresets, AudioPresets } from "livekit-client"
import type { LocalVideoTrack, LocalAudioTrack } from "livekit-client"
import { debugLog, debugWarn, debugError } from "@/utils/debug"
import type { ScreenShareQuality } from "@/types"
import type { LiveKitState } from "./useLiveKitState"

export function useBrowserScreenShare(state: LiveKitState, stopScreenShare: () => Promise<void>) {
  const startScreenShare = async (quality: ScreenShareQuality): Promise<void> => {
    if (!state.room.value) {
      throw new Error("Not connected to room")
    }

    if (state.isStartingScreenShare.value) {
      debugLog(`[LiveKit][INFO]: Screen share already starting, ignoring duplicate request`)
      return
    }

    state.isStartingScreenShare.value = true

    try {
      debugLog(`[LiveKit][INFO]: Starting screen share: ${quality}`)

      if (quality === "fullhd60") {
        const displayMediaOptions: DisplayMediaStreamOptions = {
          audio: {
            sampleRate: { ideal: 48000 },
            echoCancellation: false,
            noiseSuppression: false,
          },
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
          },
        }

        const displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)
        const videoTrackFromStream = displayStream.getVideoTracks()[0]

        if (!videoTrackFromStream) {
          throw new Error("No video track obtained from display media")
        }

        try {
          await videoTrackFromStream.applyConstraints({
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
          })
        } catch (e) {
          debugWarn(`[LiveKit][WARN]: Could not apply 60fps constraint: ${(e as Error).message}`)
        }

        const trackSettings = videoTrackFromStream.getSettings()
        debugLog(
          `[LiveKit][INFO]: Screen share track settings: ${JSON.stringify(trackSettings)}, frameRate: ${trackSettings.frameRate}`,
        )

        const publication = await state.room.value.localParticipant.publishTrack(
          videoTrackFromStream,
          {
            name: "screen-share",
            source: Track.Source.ScreenShare,
            videoCodec: "av1",
            simulcast: false,
            screenShareEncoding: {
              maxBitrate: 20 * 1000 * 1000,
              maxFramerate: 60,
            },
            degradationPreference: "balanced",
          },
        )

        state.localScreenVideoPublication.value = publication

        const lkVideoTrack = publication.track as LocalVideoTrack
        state.localScreenVideoTrack.value = lkVideoTrack
        state.isScreenSharing.value = true
        state.screenShareVersion.value++

        if (lkVideoTrack) {
          lkVideoTrack.on("ended", () => {
            if (!state.isStoppingScreenShare.value) {
              debugLog(`[LiveKit][INFO]: Screen share track ended (browser UI)`)
              void stopScreenShare()
            }
          })
        }

        videoTrackFromStream.onended = () => {
          if (!state.isStoppingScreenShare.value) {
            debugLog(`[LiveKit][INFO]: Display media track ended`)
            void stopScreenShare()
          }
        }

        const audioTracks = displayStream.getAudioTracks()
        debugLog(`[LiveKit][INFO]: Audio tracks in stream: ${audioTracks.length}`)

        if (audioTracks.length > 0) {
          const audioTrackFromStream = audioTracks[0]
          debugLog(
            `[LiveKit][INFO]: Publishing screen share audio track: ${audioTrackFromStream.label}`,
          )

          const audioPublication = await state.room.value.localParticipant.publishTrack(
            audioTrackFromStream,
            {
              name: "screen-share-audio",
              source: Track.Source.ScreenShareAudio,
              audioPreset: AudioPresets.musicHighQuality,
            },
          )
          state.localScreenAudioPublication.value = audioPublication

          const lkAudioTrack = audioPublication.track as LocalAudioTrack
          state.localScreenAudioTrack.value = lkAudioTrack

          audioTrackFromStream.onended = () => {
            if (!state.isStoppingScreenShare.value) {
              void stopScreenShare()
            }
          }
        }

        state.userScreenShareStates.value.set(state.getCurrentUserId(), {
          isSharing: true,
          quality,
        })

        state.screenShareQuality.value = quality

        debugLog(`[LiveKit][INFO]: Screen sharing started (fullhd60 raw mode)`)
      } else if (quality === "adaptive") {
        await state.room.value.localParticipant.setScreenShareEnabled(
          true,
          {
            audio: {
              sampleRate: { ideal: 48000 },
              echoCancellation: false,
              noiseSuppression: false,
            },
            resolution: ScreenSharePresets.h1080fps30.resolution,
            contentHint: "motion",
            selfBrowserSurface: "exclude",
            systemAudio: "include",
          },
          {
            screenShareEncoding: {
              maxBitrate: 20 * 1000 * 1000,
              maxFramerate: 30,
            },
            degradationPreference: "maintain-framerate",
            audioPreset: AudioPresets.musicHighQualityStereo,
          },
        )

        state.userScreenShareStates.value.set(state.getCurrentUserId(), {
          isSharing: true,
          quality,
        })

        state.screenShareQuality.value = quality

        debugLog(`[LiveKit][INFO]: Screen sharing started (adaptive mode)`)
      } else if (quality === "text") {
        await state.room.value.localParticipant.setScreenShareEnabled(true, {
          audio: {
            sampleRate: { ideal: 48000 },
            echoCancellation: false,
            noiseSuppression: false,
          },
          resolution: {
            width: 1920,
            height: 1080,
            frameRate: 5,
          },
          contentHint: "text",
          selfBrowserSurface: "exclude",
          systemAudio: "include",
        })

        state.userScreenShareStates.value.set(state.getCurrentUserId(), {
          isSharing: true,
          quality,
        })

        state.screenShareQuality.value = quality

        debugLog(`[LiveKit][INFO]: Screen sharing started (text mode)`)
      }

      debugLog(`[LiveKit][INFO]: Screen sharing started successfully`)
    } catch (error) {
      debugError("Failed to start screen share:", error)
      throw error
    } finally {
      state.isStartingScreenShare.value = false
    }
  }

  return { startScreenShare }
}
