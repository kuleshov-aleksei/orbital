import { computed } from "vue"
import { Track, ScreenSharePresets, AudioPresets } from "livekit-client"
import type {
  LocalVideoTrack,
  LocalAudioTrack,
  RemoteVideoTrack,
  RemoteAudioTrack,
} from "livekit-client"
import { useAudioSettingsStore } from "@/stores/audioSettings"
import { useAudioTracksStore } from "@/stores/audioTracks"
import { useUsersStore } from "@/stores/users"
import { debugLog, debugWarn, debugError } from "@/utils/debug"
import {
  isElectron,
  getPlatform,
  startElectronScreenShare as startElectronScreenShareIPC,
} from "@/services/electron"
import { startAudioCapture, stopAudioCapture, getVirtualMicDeviceId } from "@/services/venmic"
import type { ScreenShareQuality, VenmicNode } from "@/types"
import type { LiveKitState } from "./useLiveKitState"

export function useLiveKitScreenShare(state: LiveKitState) {
  const audioSettingsStore = useAudioSettingsStore()
  const audioTracksStore = useAudioTracksStore()
  const usersStore = useUsersStore()

  const getNickname = (userId: string): string => {
    const user = usersStore.allUsers.find((u) => u.id === userId)
    return user?.nickname || userId
  }

  const stopScreenShare = async (): Promise<void> => {
    if (!state.room.value || state.isStoppingScreenShare.value) {
      return
    }

    const videoTrackToStop = state.localScreenVideoTrack.value
    const audioTrackToStop = state.localScreenAudioTrack.value
    const videoPublicationToUnpublish = state.localScreenVideoPublication.value

    if (!videoTrackToStop && !videoPublicationToUnpublish) {
      return
    }

    state.isStoppingScreenShare.value = true

    try {
      debugLog(`[LiveKit][INFO]: 'Stopping screen share...'`)

      await state.room.value.localParticipant.setScreenShareEnabled(false)

      if (videoTrackToStop) {
        const mediaStreamTrack = videoTrackToStop.mediaStreamTrack
        if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
          mediaStreamTrack.stop()
          debugLog(`[LiveKit][INFO]: Stopped screen share video MediaStreamTrack`)
        }
      }

      if (audioTrackToStop) {
        const mediaStreamTrack = audioTrackToStop.mediaStreamTrack
        if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
          mediaStreamTrack.stop()
          debugLog(`[LiveKit][INFO]: Stopped screen share audio MediaStreamTrack`)
        }
      }

      try {
        await stopAudioCapture()
      } catch (e) {
        debugWarn(`[LiveKit][WARN]: Failed to stop venmic: ${(e as Error).message}`)
      }

      state.localScreenVideoPublication.value = null
      state.localScreenAudioPublication.value = null
      state.localScreenVideoTrack.value = null
      state.localScreenAudioTrack.value = null
      state.isScreenSharing.value = false
      state.screenShareVersion.value++

      state.userScreenShareStates.value.set(state.getCurrentUserId(), {
        isSharing: false,
        quality: "adaptive",
      })

      debugLog(`[LiveKit][INFO]: 'Screen sharing stopped'`)
    } catch (error) {
      console.error("Error stopping screen share:", error)
      console.error(`[LiveKit][ERROR]: Error stopping screen share: ${(error as Error).message}`)
    } finally {
      state.isStoppingScreenShare.value = false
    }
  }

  function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`[ScreenShare] ${context} timed out after ${ms}ms`)), ms),
      ),
    ])
  }

  const startElectronScreenShare = async (
    quality: ScreenShareQuality,
    audio: boolean,
    sourceId: string,
    audioSources?: VenmicNode[],
  ): Promise<void> => {
    console.log("[ScreenShare] startElectronScreenShare called:", {
      quality,
      audio,
      sourceId,
      audioSources,
    })

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

        // -- DIAG: enumerate audio devices before getDisplayMedia --
        const devicesBefore = await navigator.mediaDevices.enumerateDevices()
        const audioInputsBefore = devicesBefore
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            groupId: d.groupId,
          }))
        debugLog(
          "[ScreenShare-DIAG] Audio input devices BEFORE getDisplayMedia:",
          audioInputsBefore,
        )

        // -- DIAG: current mic track settings --
        if (state.localAudioTrack.value?.mediaStreamTrack) {
          const micSettings = state.localAudioTrack.value.mediaStreamTrack.getSettings()
          debugLog("[ScreenShare-DIAG] Mic track settings BEFORE:", micSettings)
        }

        // -- DIAG: selected input device --
        debugLog("[ScreenShare-DIAG] Selected input deviceId:", audioSettingsStore.inputDeviceId)
        debugLog(
          "[ScreenShare-DIAG] Available input devices:",
          audioSettingsStore.availableInputDevices,
        )

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
              throw new Error(`Screen share failed: ${retryMsg}`)
            }
          } else {
            console.error("[ScreenShare] getDisplayMedia failed:", msg)
            debugError("[ScreenShare] getDisplayMedia failed:", msg)
            await stopScreenShare()
            throw new Error(`Screen share failed: ${msg}`)
          }
        }

        // -- DIAG: enumerate audio devices after getDisplayMedia --
        const devicesAfter = await navigator.mediaDevices.enumerateDevices()
        const audioInputsAfter = devicesAfter
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            groupId: d.groupId,
          }))
        debugLog("[ScreenShare-DIAG] Audio input devices AFTER getDisplayMedia:", audioInputsAfter)

        // -- DIAG: compare device lists --
        const newDevices = audioInputsAfter.filter(
          (a) => !audioInputsBefore.some((b) => b.deviceId === a.deviceId),
        )
        if (newDevices.length > 0) {
          debugLog(
            "[ScreenShare-DIAG] NEW audio input device(s) appeared after getDisplayMedia:",
            newDevices,
          )
        } else {
          debugLog("[ScreenShare-DIAG] No new audio input devices appeared")
        }

        const missingDevices = audioInputsBefore.filter(
          (b) => !audioInputsAfter.some((a) => a.deviceId === b.deviceId),
        )
        if (missingDevices.length > 0) {
          debugLog(
            "[ScreenShare-DIAG] Audio input devices DISAPPEARED after getDisplayMedia:",
            missingDevices,
          )
        }

        // -- DIAG: loopback track settings --
        const loopbackTrack = displayStream.getAudioTracks()[0]
        if (loopbackTrack) {
          const loopbackSettings = loopbackTrack.getSettings()
          debugLog("[ScreenShare-DIAG] Loopback audio track settings:", loopbackSettings)

          if (state.localAudioTrack.value?.mediaStreamTrack) {
            const micSettings = state.localAudioTrack.value.mediaStreamTrack.getSettings()
            debugLog(
              "[ScreenShare-DIAG] Mic vs Loopback — mic deviceId:",
              micSettings.deviceId,
              "loopback deviceId:",
              loopbackSettings.deviceId,
              "same groupId?",
              micSettings.groupId === loopbackSettings.groupId,
              "same deviceId?",
              micSettings.deviceId === loopbackSettings.deviceId,
            )
          }
        } else {
          debugLog("[ScreenShare-DIAG] No loopback audio track in display stream")
        }
      } else {
        const constraints: MediaStreamConstraints = {
          audio: audio
            ? {
                mandatory: {
                  chromeMediaSource: "desktop",
                  chromeMediaSourceId: sourceId,
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                },
              }
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
          },
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

      console.log("[ScreenShare] audio check:", {
        audio,
        displayAudioTracks: displayStream.getAudioTracks().length,
      })

      if (audio && displayStream.getAudioTracks().length > 0) {
        const venmicReady = isLinux && audioSources && audioSources.length > 0

        console.log("[ScreenShare] venmicReady check:", {
          platform,
          isLinux,
          audioSources,
          venmicReady,
        })

        if (venmicReady) {
          try {
            console.log("[ScreenShare] Starting venmic audio capture with sources:", audioSources)
            const success = await startAudioCapture(audioSources)
            console.log("[ScreenShare] venmic startAudioCapture result:", success)
            if (!success) {
              throw new Error("Failed to start audio capture via venmic")
            }

            await new Promise((resolve) => setTimeout(resolve, 500))

            const deviceId = await getVirtualMicDeviceId()
            console.log("[ScreenShare] Virtual mic deviceId:", deviceId)
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
          console.log("[ScreenShare] Using system audio from display stream")
          const audioTrackFromStream = displayStream.getAudioTracks()[0]

          // -- DIAG: screen share audio track settings --
          if (audioTrackFromStream) {
            const displayAudioSettings = audioTrackFromStream.getSettings()
            debugLog("[ScreenShare-DIAG] Screen share audio track settings:", displayAudioSettings)

            if (state.localAudioTrack.value?.mediaStreamTrack) {
              const micSettings = state.localAudioTrack.value.mediaStreamTrack.getSettings()
              debugLog(
                "[ScreenShare-DIAG] During publish — mic deviceId:",
                micSettings.deviceId,
                "share deviceId:",
                displayAudioSettings.deviceId,
                "same groupId?",
                micSettings.groupId === displayAudioSettings.groupId,
                "same deviceId?",
                micSettings.deviceId === displayAudioSettings.deviceId,
              )
            }

            // -- DIAG: enumerate devices during audio publish --
            const devicesDuring = await navigator.mediaDevices.enumerateDevices()
            const audioInputsDuring = devicesDuring
              .filter((d) => d.kind === "audioinput")
              .map((d) => ({
                deviceId: d.deviceId,
                label: d.label,
                groupId: d.groupId,
              }))
            debugLog(
              "[ScreenShare-DIAG] Audio input devices DURING audio publish:",
              audioInputsDuring,
            )
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
              void stopScreenShare()
            }
          }
        }
      } else {
        console.log("[ScreenShare] No audio to publish")
      }

      state.userScreenShareStates.value.set(state.getCurrentUserId(), {
        isSharing: true,
        quality: quality,
      })

      state.screenShareQuality.value = quality

      debugLog(`[LiveKit][INFO]: Electron screen sharing started successfully`)
    } catch (error) {
      console.error("Failed to start Electron screen share:", error)
      console.error(`[LiveKit][ERROR]: Electron screen share failed: ${(error as Error).message}`)
      throw error
    } finally {
      state.isStartingScreenShare.value = false
    }
  }

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

          debugLog(`[LiveKit][INFO]: Screen share audio track published successfully`)

          audioTrackFromStream.onended = () => {
            if (!state.isStoppingScreenShare.value) {
              void stopScreenShare()
            }
          }
        }

        state.userScreenShareStates.value.set(state.getCurrentUserId(), {
          isSharing: true,
          quality: quality,
        })

        state.screenShareQuality.value = quality

        debugLog(`[LiveKit][INFO]: 'Screen sharing started (fullhd60 raw mode)'`)
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
            degradationPreference: "balanced",
            audioPreset: AudioPresets.musicHighQualityStereo,
          },
        )

        state.userScreenShareStates.value.set(state.getCurrentUserId(), {
          isSharing: true,
          quality: quality,
        })

        state.screenShareQuality.value = quality

        debugLog(`[LiveKit][INFO]: 'Screen sharing started (adaptive mode)'`)
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
          quality: quality,
        })

        state.screenShareQuality.value = quality

        debugLog(`[LiveKit][INFO]: 'Screen sharing started (text mode)'`)
      }

      debugLog(`[LiveKit][INFO]: 'Screen sharing started successfully'`)
    } catch (error) {
      console.error("Failed to start screen share:", error)
      console.error(`[LiveKit][ERROR]: Screen share failed: ${(error as Error).message}`)
      throw error
    } finally {
      state.isStartingScreenShare.value = false
    }
  }

  const subscribeToScreenShare = async (userId: string): Promise<void> => {
    if (!state.room.value) {
      debugWarn(`[LiveKit][WARN]: Cannot subscribe to screen share: room not connected`)
      return
    }

    if (state.subscribedScreenShares.value.has(userId)) {
      debugLog(`[LiveKit][INFO]: Already subscribed to screen share from ${userId}`)
      return
    }

    const shareState = state.userScreenShareStates.value.get(userId)
    if (!shareState || !shareState.isSharing) {
      debugLog(`[LiveKit][INFO]: User ${userId} is not sharing screen anymore`)
      return
    }

    const participant = state.remoteParticipants.value.get(userId)
    if (!participant) {
      debugWarn(`[LiveKit][WARN]: Participant ${userId} not found in remoteParticipants`)
      return
    }

    debugLog(`[LiveKit][INFO]: Subscribing to screen share from ${userId}`)

    let subscribed = false
    participant.trackPublications.forEach((publication) => {
      const source = publication.source
      if (source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio) {
        debugLog(`[LiveKit][INFO]: Subscribing to ${source} track from ${userId}`)
        publication.setSubscribed(true)
        subscribed = true

        if (source === Track.Source.ScreenShareAudio && publication.track) {
          const trackKey = `${userId}-screenshare`
          debugLog(
            `[LiveKit][INFO]: Manually adding existing screen share audio to store for ${userId}`,
          )
          state.remoteAudioTracks.value.set(trackKey, publication.track as RemoteAudioTrack)
          audioTracksStore.setTrack(trackKey, publication.track as RemoteAudioTrack)
          const volume = state.remoteStreamVolumes.get(userId) ?? 80
          ;(publication.track as RemoteAudioTrack).setVolume(volume / 100)

          const currentTracks = state.remoteScreenTracks.value.get(userId) || {}
          state.remoteScreenTracks.value.set(userId, {
            ...currentTracks,
            audio: publication.track as RemoteAudioTrack,
          })
        }
      }
    })

    if (subscribed) {
      state.subscribedScreenShares.value.add(userId)
      state.screenShareVersion.value++
    } else {
      debugWarn(`[LiveKit][WARN]: No screen share tracks found for ${userId}`)
    }
  }

  const unsubscribeFromScreenShare = async (userId: string): Promise<void> => {
    if (!state.room.value) {
      debugWarn(`[LiveKit][WARN]: Cannot unsubscribe from screen share: room not connected`)
      return
    }

    if (!state.subscribedScreenShares.value.has(userId)) {
      debugLog(`[LiveKit][INFO]: Not subscribed to screen share from ${userId}`)
      return
    }

    const participant = state.remoteParticipants.value.get(userId)
    if (!participant) {
      debugWarn(`[LiveKit][WARN]: Participant ${userId} not found - cleaning up state anyway`)
      state.subscribedScreenShares.value.delete(userId)
      state.screenShareVersion.value++
      return
    }

    debugLog(`[LiveKit][INFO]: Unsubscribing from screen share from ${userId}`)

    participant.trackPublications.forEach((publication) => {
      const source = publication.source
      if (source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio) {
        debugLog(`[LiveKit][INFO]: Unsubscribing from ${source} track from ${userId}`)
        publication.setSubscribed(false)
      }
    })

    state.subscribedScreenShares.value.delete(userId)
    state.screenShareVersion.value++
  }

  const screenShareData = computed(() => {
    void state.screenShareVersion.value
    const currentUserId = state.getCurrentUserId()

    const shares: Array<{
      userId: string
      userNickname: string
      videoTrack: RemoteVideoTrack | LocalVideoTrack | null
      audioTrack: RemoteAudioTrack | LocalAudioTrack | null
      quality: ScreenShareQuality
      connectionState: string
      isSelfView?: boolean
    }> = []

    if (state.isScreenSharing.value && state.localScreenVideoTrack.value) {
      shares.push({
        userId: currentUserId,
        userNickname: "Your Screen",
        videoTrack: state.localScreenVideoTrack.value,
        audioTrack: state.localScreenAudioTrack.value,
        quality: state.screenShareQuality.value,
        connectionState: "self-view",
        isSelfView: true,
      })
    }

    state.userScreenShareStates.value.forEach((shareState, userId) => {
      if (shareState?.isSharing && userId !== currentUserId) {
        const isSubscribed = state.subscribedScreenShares.value.has(userId)
        if (!isSubscribed) return

        const tracks = state.remoteScreenTracks.value.get(userId)

        shares.push({
          userId,
          userNickname: getNickname(userId),
          videoTrack: tracks?.video || null,
          audioTrack: tracks?.audio || null,
          quality: shareState.quality,
          connectionState: "connected",
        })
      }
    })

    return shares
  })

  const availableScreenShares = computed(() => {
    void state.screenShareVersion.value
    const currentUserId = state.getCurrentUserId()

    const shares: Array<{
      userId: string
      userNickname: string
      quality: ScreenShareQuality
    }> = []

    state.userScreenShareStates.value.forEach((shareState, userId) => {
      if (shareState?.isSharing && userId !== currentUserId) {
        const isSubscribed = state.subscribedScreenShares.value.has(userId)
        if (isSubscribed) return

        shares.push({
          userId,
          userNickname: getNickname(userId),
          quality: shareState.quality,
        })
      }
    })

    return shares
  })

  const isRunningInElectron = (): boolean => {
    return isElectron()
  }

  return {
    startScreenShare,
    startElectronScreenShare,
    stopScreenShare,
    subscribeToScreenShare,
    unsubscribeFromScreenShare,
    subscribedScreenShares: state.subscribedScreenShares,
    screenShareData,
    availableScreenShares,
    isRunningInElectron,
  }
}
