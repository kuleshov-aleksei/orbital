import { computed } from "vue"
import { Track } from "livekit-client"
import type {
  LocalVideoTrack,
  LocalAudioTrack,
  RemoteVideoTrack,
  RemoteAudioTrack,
} from "livekit-client"
import { useAudioTracksStore } from "@/stores/audioTracks"
import { useUsersStore } from "@/stores/users"
import { debugLog, debugWarn, debugError } from "@/utils/debug"
import { stopAudioCapture } from "@/services/venmic"
import { isElectron } from "@/services/electron"
import type { ScreenShareQuality } from "@/types"
import type { LiveKitState } from "./useLiveKitState"

export function useScreenShareCore(state: LiveKitState) {
  const audioTracksStore = useAudioTracksStore()
  const usersStore = useUsersStore()

  const getNickname = (userId: string): string => {
    const user = usersStore.allUsers.find((u) => u.id === userId)
    return user?.nickname || userId
  }

  const isRunningInElectron = (): boolean => {
    return isElectron()
  }

  function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`[ScreenShare] ${context} timed out after ${ms}ms`)), ms),
      ),
    ])
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
      debugLog(`[LiveKit][INFO]: Stopping screen share...`)

      await state.room.value.localParticipant.setScreenShareEnabled(false)

      if (videoTrackToStop) {
        const mediaStreamTrack = videoTrackToStop.mediaStreamTrack
        if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
          mediaStreamTrack.stop()
        }
      }

      if (audioTrackToStop) {
        const mediaStreamTrack = audioTrackToStop.mediaStreamTrack
        if (mediaStreamTrack && mediaStreamTrack.readyState === "live") {
          mediaStreamTrack.stop()
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

      debugLog(`[LiveKit][INFO]: Screen sharing stopped`)
    } catch (error) {
      debugError("Error stopping screen share:", error)
    } finally {
      state.isStoppingScreenShare.value = false
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

  return {
    stopScreenShare,
    subscribeToScreenShare,
    unsubscribeFromScreenShare,
    subscribedScreenShares: state.subscribedScreenShares,
    screenShareData,
    availableScreenShares,
    isRunningInElectron,
    withTimeout,
    getNickname,
  }
}
