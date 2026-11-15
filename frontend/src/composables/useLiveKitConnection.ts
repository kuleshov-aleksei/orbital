import { Room, Track, AudioPresets } from "livekit-client"
import type { ReconnectPolicy, ReconnectContext } from "livekit-client"
import { apiService } from "@/services/api"
import { usePresenceStore } from "@/stores/presence"
import { useCallStore } from "@/stores/call"
import { debugLog } from "@/utils/debug"
import { playJoinRoom, playLeaveRoom, stopReconnectingLoop } from "@/services/sounds"
import type { LiveKitState } from "./useLiveKitState"

export interface UseLiveKitConnectionDependencies {
  setupRoomEventListeners: (lkRoom: Room) => void
  publishAudioTrack: () => Promise<void>
}

// Retry roughly every 1-2s (1000ms + up to 1s jitter) for up to
// MAX_RECONNECT_ATTEMPTS. Combined with the short signal/PC timeouts passed to
// connect(), attempts tick over about every 5 seconds - enough to ride through
// multi-minute network blackouts at the SDK level.
const MAX_RECONNECT_ATTEMPTS = 100

// A whole join (token + signal + PC + presence + mic publish) that hasn't
// finished by then is abandoned: the user gets the Retry banner instead of a
// spinner that never ends.
const JOIN_DEADLINE_MS = 25_000

class OrbitalReconnectPolicy implements ReconnectPolicy {
  nextRetryDelayInMs(context: ReconnectContext): number | null {
    if (context.retryCount >= MAX_RECONNECT_ATTEMPTS) return null
    return 1000 + Math.random() * 1000
  }
}

export function useLiveKitConnection(state: LiveKitState, deps: UseLiveKitConnectionDependencies) {
  // True once the user (or unmount) asked to leave - distinguishes an expected
  // CLIENT_INITIATED disconnect from an unexpected drop.
  let manualLeave = false
  // Each join attempt gets a number; a newer attempt, a deadline or cleanup
  // makes an older one stale, and a stale attempt bails out after every await
  // (no mic publish, join sound or state writes from a join nobody wants).
  let attempt = 0
  // The Room of the attempt in progress, before it lands in state.room.
  let pendingRoom: Room | null = null

  const isManualLeave = (): boolean => manualLeave

  const disconnectQuietly = (lkRoom: Room | null) => {
    if (!lkRoom) return
    try {
      void lkRoom.disconnect()
    } catch {
      // already gone
    }
  }
  const connectToRoom = async (
    token: string,
    url: string,
    startTime?: number,
    attemptId = attempt,
  ): Promise<boolean> => {
    const connectStart = startTime || performance.now()
    const stale = () => manualLeave || attemptId !== attempt
    let lkRoom: Room | null = null
    try {
      state.isConnecting.value = true
      state.connectionError.value = null

      debugLog(
        `[LiveKit][INFO]: Connecting to LiveKit room at ${url} (t=${(performance.now() - connectStart).toFixed(0)}ms)`,
      )

      lkRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: false,
        reconnectPolicy: new OrbitalReconnectPolicy(),
        publishDefaults: {
          simulcast: true,
          screenShareEncoding: {
            maxBitrate: 20 * 1000 * 1000,
            maxFramerate: 60,
          },
          audioPreset: AudioPresets.music,
        },
      })

      deps.setupRoomEventListeners(lkRoom)
      pendingRoom = lkRoom

      await lkRoom.connect(url, token, {
        autoSubscribe: false,
        // Fail hung signal/PC attempts fast so the retry policy ticks over ~every 5s.
        websocketTimeout: 4000,
        peerConnectionTimeout: 8000,
      })
      if (stale()) {
        debugLog(`[LiveKit][INFO]: Join abandoned after connect, disconnecting`)
        disconnectQuietly(lkRoom)
        return false
      }
      if (pendingRoom === lkRoom) pendingRoom = null

      debugLog(
        `[LiveKit][INFO]: Room connected (t=${(performance.now() - connectStart).toFixed(0)}ms)`,
      )

      state.room.value = lkRoom
      state.localParticipant.value = lkRoom.localParticipant
      state.isConnected.value = true
      state.isConnecting.value = false

      debugLog(`[LiveKit][INFO]: 'Connected to LiveKit room successfully'`)

      playJoinRoom()

      lkRoom.remoteParticipants.forEach((participant) => {
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
              `[LiveKit][INFO]: Subscribing to existing ${source}${trackName ? ` (${trackName})` : ""} track from ${participant.identity}`,
            )
            publication.setSubscribed(true)
          } else if (
            source === Track.Source.ScreenShare ||
            source === Track.Source.ScreenShareAudio
          ) {
            if (source === Track.Source.ScreenShare) {
              debugLog(
                `[LiveKit][INFO]: Screen share available from existing participant ${participant.identity}`,
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

      const presenceStore = usePresenceStore()
      await presenceStore.initializePresence(lkRoom)
      if (stale()) return false

      await deps.publishAudioTrack()
      if (stale()) return false

      const callStore = useCallStore()
      if (callStore.isMuted) {
        await lkRoom.localParticipant.setMicrophoneEnabled(false)
      }

      return true
    } catch (error) {
      console.error("Failed to connect to LiveKit room:", error)
      // A Room that never connected is still holding sockets and listeners.
      if (lkRoom && state.room.value !== lkRoom) disconnectQuietly(lkRoom)
      if (pendingRoom === lkRoom) pendingRoom = null
      if (stale()) return false
      state.connectionError.value = (error as Error).message
      console.error(`[LiveKit][ERROR]: Connection failed: ${(error as Error).message}`)
      state.isConnecting.value = false
      return false
    }
  }

  const initializeLiveKit = async (roomId: string): Promise<boolean> => {
    const startTime = performance.now()
    try {
      debugLog(`[LiveKit][INFO]: 'Initializing LiveKit...' (t=0ms)`)

      // Fresh (re)join - clear any failure banner and the manual-leave marker.
      manualLeave = false
      state.connectionFailed.value = false

      const attemptId = ++attempt
      const join = (async () => {
        const response = await apiService.getLiveKitToken(roomId)
        if (attemptId !== attempt || manualLeave) return false
        const tokenTime = performance.now() - startTime
        debugLog(
          `[LiveKit][INFO]: Token received (t=${tokenTime.toFixed(0)}ms), connecting to ${response.room_url}`,
        )
        return connectToRoom(response.token, response.room_url, startTime, attemptId)
      })()

      let deadline: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<"timeout">((resolve) => {
        deadline = setTimeout(() => resolve("timeout"), JOIN_DEADLINE_MS)
      })
      const outcome = await Promise.race([join, timedOut]).finally(() => clearTimeout(deadline))

      if (outcome === "timeout") {
        console.error(`[LiveKit][ERROR]: Join timed out after ${JOIN_DEADLINE_MS}ms`)
        // Make the attempt stale and drop whatever it had opened.
        attempt++
        disconnectQuietly(pendingRoom)
        pendingRoom = null
        const joinedRoom = state.room.value
        if (joinedRoom) {
          state.room.value = null
          state.isConnected.value = false
          state.localParticipant.value = null
          disconnectQuietly(joinedRoom)
        }
        state.isConnecting.value = false
        state.connectionError.value = "Connection timed out"
        // The losing join may still reject later; nobody is listening.
        join.catch(() => {})
        return false
      }
      const connected = outcome

      if (connected) {
        const totalTime = performance.now() - startTime
        debugLog(`[LiveKit][INFO]: LiveKit fully connected (t=${totalTime.toFixed(0)}ms)`)
      }

      return connected
    } catch (error) {
      console.error("Failed to initialize LiveKit:", error)
      console.error(`[LiveKit][ERROR]: Initialization failed: ${(error as Error).message}`)
      return false
    }
  }

  const cleanup = () => {
    debugLog(`[LiveKit][INFO]: 'Cleaning up LiveKit...'`)

    manualLeave = true
    attempt++ // any join still in flight is abandoned
    state.connectionFailed.value = false
    state.isConnecting.value = false
    stopReconnectingLoop()

    disconnectQuietly(pendingRoom)
    pendingRoom = null

    const currentRoom = state.room.value

    state.room.value = null
    state.isConnected.value = false
    state.localParticipant.value = null

    const presenceStore = usePresenceStore()
    presenceStore.cleanup()

    if (currentRoom) {
      try {
        void currentRoom.disconnect()
      } catch {
        // Ignore errors during cleanup
      }
    }

    playLeaveRoom()
  }

  return {
    connectToRoom,
    initializeLiveKit,
    cleanup,
    isManualLeave,
  }
}
