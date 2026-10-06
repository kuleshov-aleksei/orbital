import { RoomEvent, Track } from "livekit-client"
import { DisconnectReason } from "livekit-client"
import type {
  Room,
  RemoteParticipant,
  RemoteAudioTrack,
  RemoteVideoTrack,
  RemoteTrackPublication,
} from "livekit-client"
import { useAudioTracksStore } from "@/stores/audioTracks"
import { useCallStore } from "@/stores/call"
import { playReconnected, startReconnectingLoop, stopReconnectingLoop } from "@/services/sounds"
import { debugLog, debugWarn, debugError } from "@/utils/debug"
import type { LiveKitState } from "./useLiveKitState"

export interface UseLiveKitEventsDependencies {
  /** Called after the room reconnects, to verify/repair the local audio pipeline */
  onRoomReconnected?: () => Promise<boolean> | boolean | Promise<void> | void
  /** True when the user asked to leave - an expected disconnect, not a drop */
  isManualLeave?: () => boolean
  /** Called when (signal) reconnecting starts - supervisor begins watching */
  onReconnectStarted?: () => void
  /** Called when reconnecting ends (recovered, terminal, or user left) */
  onReconnectSettled?: () => void
}

export function useLiveKitEvents(state: LiveKitState, deps?: UseLiveKitEventsDependencies) {
  const audioTracksStore = useAudioTracksStore()
  const callStore = useCallStore()

  const handleRemoteTrack = (
    track: RemoteAudioTrack | RemoteVideoTrack,
    participant: RemoteParticipant,
    publication?: RemoteTrackPublication,
  ) => {
    const participantId = participant.identity

    debugLog(
      `[LiveKit] handleRemoteTrack: ${participantId}, track kind: ${track.kind}, track sid: ${track.sid}`,
    )

    if (track.kind === Track.Kind.Audio) {
      const audioTrack = track as RemoteAudioTrack

      const audioSource = audioTrack.source || Track.Source.Microphone
      const trackName = publication?.trackName || ""
      const isBoombox = trackName === "boombox"
      const trackKey = isBoombox
        ? `${participantId}-boombox`
        : audioSource === Track.Source.ScreenShareAudio
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
    publication?: RemoteTrackPublication,
  ) => {
    const participantId = participant.identity
    debugLog(
      `[LiveKit] handleTrackUnsubscribed: ${participantId}, track kind: ${track.kind}, track sid: ${track.sid}`,
    )

    if (track.kind === Track.Kind.Audio) {
      const audioTrack = track as RemoteAudioTrack
      const audioSource = audioTrack.source || Track.Source.Microphone
      const trackName = publication?.trackName || ""
      const isBoombox = trackName === "boombox"
      const trackKey = isBoombox
        ? `${participantId}-boombox`
        : audioSource === Track.Source.ScreenShareAudio
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
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { audio, ...rest } = currentTracks
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

  // Reconnect diagnostics: SDK retry attempt count + periodic state log so a
  // stalled retry chain is visible in the console instead of silent.
  let reconnectDiagTimer: ReturnType<typeof setInterval> | null = null
  let reconnectCount = 0

  const stopReconnectDiagnostics = () => {
    if (reconnectDiagTimer) {
      clearInterval(reconnectDiagTimer)
      reconnectDiagTimer = null
    }
    reconnectCount = 0
  }

  // The SDK emits RoomEvent.Reconnecting only once per cycle while its engine
  // keeps retrying internally - read the engine's real attempt count so the
  // logs don't look stuck. Falls back to our own counter if unreachable.
  const sdkAttemptCount = (lkRoom: Room): number => {
    const engineAttempts = (lkRoom as unknown as { engine?: { reconnectAttempts?: number } }).engine
      ?.reconnectAttempts
    if (typeof engineAttempts === "number" && engineAttempts >= 0) return engineAttempts + 1
    return reconnectCount
  }

  const setupRoomEventListeners = (lkRoom: Room) => {
    lkRoom.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      debugLog(`[LiveKit][INFO]: Participant connected: ${participant.identity}`)
      state.remoteParticipants.value.set(participant.identity, participant)

      participant.trackPublications.forEach((publication) => {
        const source = publication.source
        const trackName = publication.trackName

        if (
          source === Track.Source.Microphone ||
          source === Track.Source.Camera ||
          trackName === "boombox"
        ) {
          debugLog(
            `[LiveKit][INFO]: Auto-subscribing to ${source}${trackName ? ` (${trackName})` : ""} track from ${participant.identity}`,
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
      const trackName = publication.trackName

      if (
        source === Track.Source.Microphone ||
        source === Track.Source.Camera ||
        trackName === "boombox"
      ) {
        debugLog(
          `[LiveKit][INFO]: Auto-subscribing to ${source}${trackName ? ` (${trackName})` : ""} track from ${participant.identity}`,
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
      state.remoteAudioTracks.value.delete(`${participant.identity}-boombox`)
      state.remoteScreenTracks.value.delete(participant.identity)
      state.userScreenShareStates.value.delete(participant.identity)
      state.subscribedScreenShares.value.delete(participant.identity)
      audioTracksStore.removeTrack(participant.identity)
      audioTracksStore.removeTrack(`${participant.identity}-screenshare`)
      audioTracksStore.removeTrack(`${participant.identity}-boombox`)
      state.screenShareVersion.value++
    })

    lkRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      debugLog(`[LiveKit][INFO]: Track subscribed: ${track.kind} from ${participant.identity}`)
      // @ts-expect-error - RemoteTrack is compatible with RemoteAudioTrack | RemoteVideoTrack
      handleRemoteTrack(track, participant, publication)
    })

    lkRoom.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      debugLog(`[LiveKit][INFO]: Track unsubscribed: ${track.kind} from ${participant.identity}`)
      // @ts-expect-error - RemoteTrack is compatible with RemoteAudioTrack | RemoteVideoTrack
      handleTrackUnsubscribed(track, participant, publication)
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.localScreenVideoPublication.value = publication as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.localScreenAudioPublication.value = publication as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.localScreenAudioTrack.value = track as any
      } else if (track.source === Track.Source.Camera) {
        debugLog(`[LiveKit][INFO]: Local camera track published: ${publication.trackSid}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.localCameraPublication.value = publication as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        state.screenShareQuality.value = "adaptive"
        state.screenShareVersion.value++

        state.userScreenShareStates.value.set(state.getCurrentUserId(), {
          isSharing: false,
          quality: "adaptive",
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
      stopReconnectDiagnostics()
      state.isConnected.value = false

      // User-initiated leave (room switch / unmount / leave button) - full stop.
      if (reason === DisconnectReason.CLIENT_INITIATED && deps?.isManualLeave?.()) {
        stopReconnectingLoop()
        state.isReconnecting.value = false
        state.connectionFailed.value = false
        callStore.setReconnecting(false)
        deps?.onReconnectSettled?.()
        return
      }

      // Our own supervisor-forced teardown (CLIENT_INITIATED but not manual):
      // stay in reconnecting mode, the forced rejoin is already in flight.
      if (reason === DisconnectReason.CLIENT_INITIATED) {
        return
      }

      // Unexpected drop after the SDK exhausted its retries: nothing more will
      // retry automatically - surface "connection lost" with a manual Retry.
      debugWarn(`[LiveKit][WARN]: Unexpected disconnect - showing connection lost state`)
      stopReconnectingLoop()
      state.isReconnecting.value = false
      state.connectionFailed.value = true
      callStore.setReconnecting(false)
      deps?.onReconnectSettled?.()
    })

    lkRoom.on(RoomEvent.Reconnecting, () => {
      reconnectCount++
      debugWarn(
        `[LiveKit][WARN]: 'Reconnecting to room...' (attempt ${sdkAttemptCount(lkRoom)}, room state: ${lkRoom.state})`,
      )
      state.isReconnecting.value = true
      callStore.setReconnecting(true)
      startReconnectingLoop()
      deps?.onReconnectStarted?.()
      if (!reconnectDiagTimer) {
        reconnectDiagTimer = setInterval(() => {
          debugWarn(
            `[LiveKit][WARN]: Still reconnecting (attempt ${sdkAttemptCount(lkRoom)}, room state: ${lkRoom.state})`,
          )
        }, 10_000)
      }
    })

    // Signal-only blip: the SDK emits this before escalating to Reconnecting
    // (only if media fails too). Same treatment so pure-signal drops show state.
    lkRoom.on(RoomEvent.SignalReconnecting, () => {
      debugWarn(
        `[LiveKit][WARN]: 'Signal reconnecting...' (attempt ${sdkAttemptCount(lkRoom)}, room state: ${lkRoom.state})`,
      )
      state.isReconnecting.value = true
      callStore.setReconnecting(true)
      startReconnectingLoop()
      deps?.onReconnectStarted?.()
      if (!reconnectDiagTimer) {
        reconnectDiagTimer = setInterval(() => {
          debugWarn(
            `[LiveKit][WARN]: Still reconnecting (attempt ${sdkAttemptCount(lkRoom)}, room state: ${lkRoom.state})`,
          )
        }, 10_000)
      }
    })

    lkRoom.on(RoomEvent.Reconnected, async () => {
      debugLog(`[LiveKit][INFO]: 'Reconnected to room'`)
      stopReconnectDiagnostics()
      stopReconnectingLoop()
      playReconnected()
      deps?.onReconnectSettled?.()

      // The SDK restarts the local audio track (and its noise suppression
      // processor) during reconnect; if that failed, the mic stays dead while
      // the user still appears in the room. Verify and repair it here.
      try {
        const recovered = await deps?.onRoomReconnected?.()
        if (recovered === false) {
          debugError(`[LiveKit][ERROR]: Local audio recovery after reconnect reported failure`)
        }
      } catch (error) {
        debugError(`[LiveKit][ERROR]: Local audio recovery after reconnect threw:`, error)
      }

      state.isReconnecting.value = false
      callStore.setReconnecting(false)
    })
  }

  return {
    setupRoomEventListeners,
    handleRemoteTrack,
    handleTrackUnsubscribed,
  }
}
