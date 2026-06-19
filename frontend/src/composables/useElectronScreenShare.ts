import { Track } from "livekit-client"
import type { LocalVideoTrack, LocalAudioTrack } from "livekit-client"
import { debugLog, debugWarn, debugError } from "@/utils/debug"
import {
  getPlatform,
  startElectronScreenShare as startElectronScreenShareIPC,
} from "@/services/electron"
import { startAudioCapture, stopAudioCapture, getVirtualMicDeviceId } from "@/services/venmic"
import type { ScreenShareQuality, VenmicNode } from "@/types"
import type { LiveKitState } from "./useLiveKitState"

export function useElectronScreenShare(
  state: LiveKitState,
  stopScreenShare: () => Promise<void>,
  withTimeout: <T>(promise: Promise<T>, ms: number, context: string) => Promise<T>,
) {
  const startElectronScreenShare = async (
    quality: ScreenShareQuality,
    audio: boolean,
    sourceId: string,
    audioSources?: VenmicNode[],
  ): Promise<void> => {
    if (!state.room.value) {
      throw new Error("Not connected to room")
    }

    if (state.isStartingScreenShare.value) {
      debugLog(`[LiveKit][INFO]: Screen share already starting, ignoring duplicate request`)
      return
    }

    state.isStartingScreenShare.value = true

    try {
      debugLog(`[LiveKit][INFO]: Starting Electron screen share: ${quality}, source: ${sourceId}`)

      let maxFrameRate = 60
      if (quality === "text") {
        maxFrameRate = 5
      } else if (quality === "fullhd60") {
        maxFrameRate = 60
      }

      const platform = await getPlatform()
      const isWindows = platform === "win32"
      const isLinux = platform === "linux"

      let displayStream: MediaStream

      if (isWindows) {
        await startElectronScreenShareIPC(sourceId, audio)

        const getWindowsDisplayMedia = async (withAudio: boolean, diagLabel: string) => {
          return await withTimeout(
            navigator.mediaDevices.getDisplayMedia({
              audio: withAudio,
              video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: maxFrameRate },
              },
            }),
            10000,
            diagLabel,
          )
        }

        try {
          displayStream = await getWindowsDisplayMedia(audio, "getDisplayMedia (Windows)")
        } catch (cause) {
          const msg = cause instanceof Error ? cause.message : String(cause)
          const isAudioSourceError = msg.includes("Could not start audio source")

          if (isAudioSourceError && audio) {
            debugLog("[ScreenShare] Audio source unavailable, falling back to video-only share")
            await startElectronScreenShareIPC(sourceId, false)
            try {
              displayStream = await getWindowsDisplayMedia(
                false,
                "getDisplayMedia (Windows, no audio)",
              )
              state.screenShareAudioWarning.value =
                "Could not capture system audio. Screen sharing without audio."
              debugLog("[ScreenShare] Video-only fallback succeeded")
            } catch (retryCause) {
              const retryMsg = retryCause instanceof Error ? retryCause.message : String(retryCause)
              console.error("[ScreenShare] Video-only fallback also failed:", retryMsg)
              debugError("[ScreenShare] Video-only fallback also failed:", retryMsg)
              await stopScreenShare()
              throw new Error(`Screen share failed: ${retryMsg}`, { cause: retryCause })
            }
          } else {
            console.error("[ScreenShare] getDisplayMedia failed:", msg)
            debugError("[ScreenShare] getDisplayMedia failed:", msg)
            await stopScreenShare()
            throw new Error(`Screen share failed: ${msg}`, { cause })
          }
        }
      } else {
        const constraints: MediaStreamConstraints = {
          audio: audio
            ? ({
                mandatory: {
                  chromeMediaSource: "desktop",
                  chromeMediaSourceId: sourceId,
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                },
              } as MediaStreamConstraints)
            : false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: maxFrameRate,
              minFrameRate: 30,
            },
          } as MediaTrackConstraints,
        }

        displayStream = await navigator.mediaDevices.getUserMedia(constraints)
      }

      const videoTrackFromStream = displayStream.getVideoTracks()[0]

      if (!videoTrackFromStream) {
        throw new Error("No video track obtained from display media")
      }

      try {
        await videoTrackFromStream.applyConstraints({
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: maxFrameRate },
        })
      } catch (e) {
        debugWarn(
          `[LiveKit][WARN]: Could not apply ${maxFrameRate}fps constraint: ${(e as Error).message}`,
        )
      }

      const trackSettings = videoTrackFromStream.getSettings()
      debugLog(
        `[LiveKit][INFO]: Electron screen share track settings: ${JSON.stringify(trackSettings)}, frameRate: ${trackSettings.frameRate}`,
      )

      const publication = await state.room.value.localParticipant.publishTrack(
        videoTrackFromStream,
        {
          name: "screen-share",
          source: Track.Source.ScreenShare,
          videoCodec: "av1",
          simulcast: false,
          screenShareEncoding: {
            maxBitrate: quality === "text" ? 3 * 1000 * 1000 : 20 * 1000 * 1000,
            maxFramerate: maxFrameRate,
          },
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

      if (audio && displayStream.getAudioTracks().length > 0) {
        const venmicReady = isLinux && audioSources && audioSources.length > 0

        if (venmicReady) {
          try {
            const success = await startAudioCapture(audioSources)
            if (!success) {
              throw new Error("Failed to start audio capture via venmic")
            }

            await new Promise((resolve) => setTimeout(resolve, 500))

            const deviceId = await getVirtualMicDeviceId()
            if (!deviceId) {
              throw new Error("Virtual audio device not found")
            }

            const audioStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: { exact: deviceId },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
              },
            })

            const audioTrackFromStream = audioStream.getAudioTracks()[0]
            if (!audioTrackFromStream) {
              throw new Error("No audio track from virtual device")
            }

            const audioPublication = await state.room.value.localParticipant.publishTrack(
              audioTrackFromStream,
              {
                name: "screen-share-audio",
                source: Track.Source.ScreenShareAudio,
              },
            )
            state.localScreenAudioPublication.value = audioPublication

            const lkAudioTrack = audioPublication.track as LocalAudioTrack
            state.localScreenAudioTrack.value = lkAudioTrack

            audioTrackFromStream.onended = () => {
              if (!state.isStoppingScreenShare.value) {
                void stopAudioCapture()
                void stopScreenShare()
              }
            }

            debugLog(`[LiveKit][INFO] Screen share audio captured via venmic`)
          } catch (audioError) {
            console.error("[ScreenShare] Venmic error:", audioError)
            debugWarn(
              `[LiveKit][WARN] Failed to capture audio via venmic: ${(audioError as Error).message}`,
            )
            await stopAudioCapture()
          }
        } else {
          const audioTrackFromStream = displayStream.getAudioTracks()[0]

          const audioPublication = await state.room.value.localParticipant.publishTrack(
            audioTrackFromStream,
            {
              name: "screen-share-audio",
              source: Track.Source.ScreenShareAudio,
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
      }

      state.userScreenShareStates.value.set(state.getCurrentUserId(), {
        isSharing: true,
        quality,
      })

      state.screenShareQuality.value = quality

      debugLog(`[LiveKit][INFO]: Electron screen sharing started successfully`)
    } catch (error) {
      console.error("Failed to start Electron screen share:", error)
      throw error
    } finally {
      state.isStartingScreenShare.value = false
    }
  }

  return { startElectronScreenShare }
}
