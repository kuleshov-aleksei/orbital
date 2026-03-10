import { computed } from "vue"
import { Track, ScreenSharePresets, AudioPresets } from "livekit-client"
import type {
  LocalVideoTrack,
  LocalAudioTrack,
  RemoteVideoTrack,
  RemoteAudioTrack,
} from "livekit-client"
import { useAudioTracksStore } from "@/stores/audioTracks"
import { useUsersStore } from "@/stores/users"
import { debugLog, debugWarn } from "@/utils/debug"
import { isElectron } from "@/services/electron"
import type { ScreenShareQuality } from "@/types"
import type { LiveKitState } from "./useLiveKitState"

export function useLiveKitScreenShare(state: LiveKitState) {
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

  const startElectronScreenShare = async (
    quality: ScreenShareQuality,
    audio: boolean,
    sourceId: string,
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

      const displayStream = await navigator.mediaDevices.getUserMedia(constraints)
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
          audio: true,
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
              audioPreset: AudioPresets.musicHighQualityStereo,
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
            audio: true,
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
          audio: true,
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
        }
      }
    })

    if (subscribed) {
      state.subscribedScreenShares.value.add(userId)
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
    screenShareData,
    availableScreenShares,
    isRunningInElectron,
  }
}
