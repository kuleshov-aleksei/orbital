import { RoomEvent, Track } from "livekit-client"
import type { Room, RemoteParticipant, RemoteAudioTrack, RemoteVideoTrack } from "livekit-client"
import { useAudioTracksStore } from "@/stores/audioTracks"
import { debugLog, debugWarn } from "@/utils/debug"
import type { LiveKitState } from "./useLiveKitState"

export function useLiveKitEvents(state: LiveKitState) {
  const audioTracksStore = useAudioTracksStore()

  const handleRemoteTrack = (
    track: RemoteAudioTrack | RemoteVideoTrack,
    participant: RemoteParticipant,
  ) => {
    const participantId = participant.identity

    debugLog(
      `[LiveKit] handleRemoteTrack: ${participantId}, track kind: ${track.kind}, track sid: ${track.sid}`,
    )

    if (track.kind === Track.Kind.Audio) {
      const audioTrack = track as RemoteAudioTrack

      const audioSource = audioTrack.source || Track.Source.Microphone
      const trackKey =
        audioSource === Track.Source.ScreenShareAudio
          ? `${participantId}-screenshare`
          : participantId

      debugLog(`[LiveKit] Audio track source: ${audioSource}, using key: ${trackKey}`)

      if (audioSource === Track.Source.ScreenShareAudio) {
        if (!state.subscribedScreenShares.value.has(participantId)) {
          debugLog(
            `[LiveKit] Not adding unsubscribed screen share audio for ${participantId} to audio store`,
          )
          return
        }
        debugLog(
          `[LiveKit] User subscribed to screen share audio for ${participantId}, adding to store`,
        )

        const currentTracks = state.remoteScreenTracks.value.get(participantId) || {}
        state.remoteScreenTracks.value.set(participantId, {
          ...currentTracks,
          audio: audioTrack,
        })
        debugLog(`[LiveKit] Screen share audio added to remoteScreenTracks for ${participantId}`)
      }

      state.remoteAudioTracks.value.set(trackKey, audioTrack)
      audioTracksStore.setTrack(trackKey, audioTrack)

      debugLog(
        `[LiveKit] Audio track stored for ${trackKey}, store count: ${audioTracksStore.trackCount()}`,
      )

      const volume = state.remoteStreamVolumes.get(participantId) ?? 80
      audioTrack.setVolume(volume / 100)

      debugLog(`[LiveKit][INFO]: Audio track received from ${participantId} (${audioSource})`)
    } else if (track.kind === Track.Kind.Video) {
      const videoTrack = track
      if (videoTrack.source === Track.Source.ScreenShare) {
        const currentTracks = state.remoteScreenTracks.value.get(participantId) || {}
        state.remoteScreenTracks.value.set(participantId, {
          ...currentTracks,
          video: videoTrack,
        })

        state.userScreenShareStates.value.set(participantId, {
          isSharing: true,
          quality: "adaptive",
        })
        state.screenShareVersion.value++

        debugLog(`[LiveKit][INFO]: Screen share track received from ${participantId}`)
      } else if (videoTrack.source === Track.Source.Camera) {
        state.remoteCameraTracks.value.set(participantId, videoTrack)
        state.userCameraStates.value.set(participantId, true)
        state.cameraVersion.value++

        debugLog(`[LiveKit][INFO]: Camera track received from ${participantId}`)
      }
    }
  }

  const handleTrackUnsubscribed = (
    track: RemoteAudioTrack | RemoteVideoTrack,
    participant: RemoteParticipant,
  ) => {
    const participantId = participant.identity
    debugLog(
      `[LiveKit] handleTrackUnsubscribed: ${participantId}, track kind: ${track.kind}, track sid: ${track.sid}`,
    )

    if (track.kind === Track.Kind.Audio) {
      const audioTrack = track as RemoteAudioTrack
      const audioSource = audioTrack.source || Track.Source.Microphone
      const trackKey =
        audioSource === Track.Source.ScreenShareAudio
          ? `${participantId}-screenshare`
          : participantId

      debugLog(`[LiveKit] Audio unsubscribed source: ${audioSource}, using key: ${trackKey}`)

      state.remoteAudioTracks.value.delete(trackKey)
      audioTracksStore.removeTrack(trackKey)

      if (audioSource === Track.Source.ScreenShareAudio) {
        state.subscribedScreenShares.value.delete(participantId)
        state.screenShareVersion.value++

        const currentTracks = state.remoteScreenTracks.value.get(participantId)
        if (currentTracks) {
          const { audio: _, ...rest } = currentTracks
          if (Object.keys(rest).length > 0) {
            state.remoteScreenTracks.value.set(participantId, rest)
          } else {
            state.remoteScreenTracks.value.delete(participantId)
          }
        }
      }

      debugLog(
        `[LiveKit] Audio track removed for ${trackKey}, store count: ${audioTracksStore.trackCount()}`,
      )
    } else if (track.kind === Track.Kind.Video) {
      const videoTrack = track
      if (videoTrack.source === Track.Source.ScreenShare) {
        const currentTracks = state.remoteScreenTracks.value.get(participantId)
        if (currentTracks) {
          delete currentTracks.video
          if (!currentTracks.audio) {
            state.remoteScreenTracks.value.delete(participantId)
          }
        }

        state.subscribedScreenShares.value.delete(participantId)
        state.screenShareVersion.value++
      } else if (videoTrack.source === Track.Source.Camera) {
        state.remoteCameraTracks.value.delete(participantId)
        state.userCameraStates.value.set(participantId, false)
        state.cameraVersion.value++
      }
    }
  }

  const setupRoomEventListeners = (lkRoom: Room) => {
    lkRoom.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      debugLog(`[LiveKit][INFO]: Participant connected: ${participant.identity}`)
      state.remoteParticipants.value.set(participant.identity, participant)

      participant.trackPublications.forEach((publication) => {
        const source = publication.source

        if (source === Track.Source.Microphone || source === Track.Source.Camera) {
          debugLog(
            `[LiveKit][INFO]: Auto-subscribing to ${source} track from ${participant.identity}`,
          )
          publication.setSubscribed(true)
        } else if (
          source === Track.Source.ScreenShare ||
          source === Track.Source.ScreenShareAudio
        ) {
          if (source === Track.Source.ScreenShare) {
            debugLog(
              `[LiveKit][INFO]: Screen share available from ${participant.identity}, not auto-subscribing`,
            )
            state.userScreenShareStates.value.set(participant.identity, {
              isSharing: true,
              quality: "adaptive",
            })
            state.screenShareVersion.value++
          }
        }
      })
    })

    lkRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
      debugLog(
        `[LiveKit][INFO]: Track published: ${publication.source} from ${participant.identity}`,
      )
      const source = publication.source

      if (source === Track.Source.Microphone || source === Track.Source.Camera) {
        debugLog(
          `[LiveKit][INFO]: Auto-subscribing to ${source} track from ${participant.identity}`,
        )
        publication.setSubscribed(true)
      } else if (source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio) {
        if (source === Track.Source.ScreenShare) {
          debugLog(
            `[LiveKit][INFO]: Screen share available from ${participant.identity}, not auto-subscribing`,
          )
          state.userScreenShareStates.value.set(participant.identity, {
            isSharing: true,
            quality: "adaptive",
          })
          state.screenShareVersion.value++
        }
      }
    })

    lkRoom.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      debugLog(`[LiveKit][INFO]: Participant disconnected: ${participant.identity}`)
      state.remoteParticipants.value.delete(participant.identity)
      state.remoteAudioTracks.value.delete(participant.identity)
      state.remoteAudioTracks.value.delete(`${participant.identity}-screenshare`)
      state.remoteScreenTracks.value.delete(participant.identity)
      state.userScreenShareStates.value.delete(participant.identity)
      state.subscribedScreenShares.value.delete(participant.identity)
      audioTracksStore.removeTrack(participant.identity)
      audioTracksStore.removeTrack(`${participant.identity}-screenshare`)
      state.screenShareVersion.value++
    })

    lkRoom.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      debugLog(`[LiveKit][INFO]: Track subscribed: ${track.kind} from ${participant.identity}`)
      // @ts-expect-error - RemoteTrack is compatible with RemoteAudioTrack | RemoteVideoTrack
      handleRemoteTrack(track, participant)
    })

    lkRoom.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      debugLog(`[LiveKit][INFO]: Track unsubscribed: ${track.kind} from ${participant.identity}`)
      // @ts-expect-error - RemoteTrack is compatible with RemoteAudioTrack | RemoteVideoTrack
      handleTrackUnsubscribed(track, participant)
    })

    lkRoom.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      debugLog(
        `[LiveKit][INFO]: Track unpublished: ${publication.source} from ${participant.identity}`,
      )

      if (publication.source === Track.Source.ScreenShare) {
        debugLog(
          `[LiveKit][INFO]: Screen share unpublished from ${participant.identity}, removing from states`,
        )
        state.userScreenShareStates.value.delete(participant.identity)
        state.remoteScreenTracks.value.delete(participant.identity)
        state.subscribedScreenShares.value.delete(participant.identity)
        state.screenShareVersion.value++
      } else if (publication.source === Track.Source.ScreenShareAudio) {
        state.remoteAudioTracks.value.delete(`${participant.identity}-screenshare`)
        audioTracksStore.removeTrack(`${participant.identity}-screenshare`)
        state.subscribedScreenShares.value.delete(participant.identity)
        state.screenShareVersion.value++
      }
    })

    lkRoom.on(RoomEvent.TrackMuted, (publication, participant) => {
      debugLog(`[LiveKit][INFO]: Track muted: ${publication.trackSid} from ${participant.identity}`)
    })

    lkRoom.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      debugLog(
        `[LiveKit][INFO]: Track unmuted: ${publication.trackSid} from ${participant.identity}`,
      )
    })

    lkRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
      const track = publication.track
      if (!track) return

      if (track.source === Track.Source.ScreenShare) {
        debugLog(`[LiveKit][INFO]: Local screen share track published: ${publication.trackSid}`)
        state.localScreenVideoPublication.value = publication as any
        state.localScreenVideoTrack.value = track as any
        state.isScreenSharing.value = true
        state.screenShareVersion.value++

        state.userScreenShareStates.value.set(state.getCurrentUserId(), {
          isSharing: true,
          quality: state.screenShareQuality.value,
        })

        track.on("ended", () => {
          if (!state.isStoppingScreenShare.value) {
            debugLog(`[LiveKit][INFO]: 'Screen share track ended (browser UI)'`)
          }
        })
      } else if (track.source === Track.Source.ScreenShareAudio) {
        debugLog(
          `[LiveKit][INFO]: Local screen share audio track published: ${publication.trackSid}`,
        )
        state.localScreenAudioPublication.value = publication as any
        state.localScreenAudioTrack.value = track as any
      } else if (track.source === Track.Source.Camera) {
        debugLog(`[LiveKit][INFO]: Local camera track published: ${publication.trackSid}`)
        state.localCameraPublication.value = publication as any
        state.localCameraTrack.value = track as any
        state.isCameraEnabled.value = true
        state.cameraVersion.value++

        state.userCameraStates.value.set(state.getCurrentUserId(), true)

        track.on("ended", () => {
          if (!state.isStoppingCamera.value) {
            debugLog(`[LiveKit][INFO]: 'Camera track ended (external)'`)
          }
        })
      }
    })

    lkRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        debugLog(`[LiveKit][INFO]: Local screen share track unpublished: ${publication.trackSid}`)
        state.localScreenVideoPublication.value = null
        state.localScreenVideoTrack.value = null
        state.isScreenSharing.value = false
        state.screenShareQuality.value = "fullhd60"
        state.screenShareVersion.value++

        state.userScreenShareStates.value.set(state.getCurrentUserId(), {
          isSharing: false,
          quality: "fullhd60",
        })

        state.isStoppingScreenShare.value = false
      } else if (publication.source === Track.Source.ScreenShareAudio) {
        debugLog(
          `[LiveKit][INFO]: Local screen share audio track unpublished: ${publication.trackSid}`,
        )
        state.localScreenAudioPublication.value = null
        state.localScreenAudioTrack.value = null
      } else if (publication.source === Track.Source.Camera) {
        debugLog(`[LiveKit][INFO]: Local camera track unpublished: ${publication.trackSid}`)
        state.localCameraPublication.value = null
        state.localCameraTrack.value = null
        state.isCameraEnabled.value = false
        state.cameraVersion.value++

        state.userCameraStates.value.set(state.getCurrentUserId(), false)

        state.isStoppingCamera.value = false
      }
    })

    lkRoom.on(RoomEvent.Disconnected, async (reason) => {
      debugWarn(`[LiveKit][WARN]: Disconnected from room: ${reason || "unknown reason"}`)
      state.isConnected.value = false
    })

    lkRoom.on(RoomEvent.Reconnecting, () => {
      debugWarn(`[LiveKit][WARN]: 'Reconnecting to room...'`)
    })

    lkRoom.on(RoomEvent.Reconnected, () => {
      debugLog(`[LiveKit][INFO]: 'Reconnected to room'`)
    })
  }

  return {
    setupRoomEventListeners,
    handleRemoteTrack,
    handleTrackUnsubscribed,
  }
}
