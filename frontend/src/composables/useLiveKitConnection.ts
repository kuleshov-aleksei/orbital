import { Room, Track, AudioPresets } from "livekit-client"
import { apiService } from "@/services/api"
import { usePresenceStore } from "@/stores/presence"
import { useCallStore } from "@/stores/call"
import { debugLog } from "@/utils/debug"
import { playJoinRoom, playLeaveRoom } from "@/services/sounds"
import type { LiveKitState } from "./useLiveKitState"

export interface UseLiveKitConnectionDependencies {
  setupRoomEventListeners: (lkRoom: Room) => void
  publishAudioTrack: () => Promise<void>
}

export function useLiveKitConnection(state: LiveKitState, deps: UseLiveKitConnectionDependencies) {
  const connectToRoom = async (
    token: string,
    url: string,
    startTime?: number,
  ): Promise<boolean> => {
    const connectStart = startTime || performance.now()
    try {
      state.isConnecting.value = true
      state.connectionError.value = null

      debugLog(
        `[LiveKit][INFO]: Connecting to LiveKit room at ${url} (t=${(performance.now() - connectStart).toFixed(0)}ms)`,
      )

      const lkRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
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

      await lkRoom.connect(url, token, {
        autoSubscribe: false
      })

      debugLog(
        `[LiveKit][INFO]: Room connected (t=${(performance.now() - startTime).toFixed(0)}ms)`,
      )

      state.room.value = lkRoom
      state.localParticipant.value = lkRoom.localParticipant
      state.isConnected.value = true
      state.isConnecting.value = false

      debugLog(`[LiveKit][INFO]: 'Connected to LiveKit room successfully'}`)

      playJoinRoom()

      lkRoom.remoteParticipants.forEach((participant) => {
        state.remoteParticipants.value.set(participant.identity, participant)

        participant.trackPublications.forEach((publication) => {
          const source = publication.source

          if (source === Track.Source.Microphone || source === Track.Source.Camera) {
            debugLog(
              `[LiveKit][INFO]: Subscribing to existing ${source} track from ${participant.identity}`,
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

      await deps.publishAudioTrack()

      const callStore = useCallStore()
      if (callStore.isMuted) {
        await lkRoom.localParticipant.setMicrophoneEnabled(false)
      }

      return true
    } catch (error) {
      console.error("Failed to connect to LiveKit room:", error)
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

      const response = await apiService.getLiveKitToken(roomId)
      const tokenTime = performance.now() - startTime
      debugLog(
        `[LiveKit][INFO]: Token received (t=${tokenTime.toFixed(0)}ms), connecting to ${response.room_url}`,
      )

      const connected = await connectToRoom(response.token, response.room_url, startTime)

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
  }
}
