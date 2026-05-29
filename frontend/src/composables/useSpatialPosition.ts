import { ref, onUnmounted, type Ref } from "vue"
import { DataPacket_Kind, RoomEvent } from "livekit-client"
import type { Room, LocalParticipant } from "livekit-client"
import { debugLog } from "@/utils/debug"

export interface Vector2 {
  x: number
  y: number
}

const SEND_INTERVAL_MS = 100
const TICK_RATE = 30
const INTERPOLATION_FACTOR = 10 / TICK_RATE

export function useSpatialPosition(options: {
  room: Ref<Room | null>
  localParticipant: Ref<LocalParticipant | null>
}) {
  const localPosition = ref<Vector2>({ x: 0, y: 0 })
  const remotePositions = ref<Map<string, Vector2>>(new Map())

  // Internal non-reactive state for the send loop
  let _myPosition = { x: 0, y: 0 }
  const _remotePositions = new Map<string, Vector2>()
  const _interpolatedPositions = new Map<string, Vector2>()
  const _sendLock = false
  const _textEncoder = new TextEncoder()
  const _textDecoder = new TextDecoder()

  let sendInterval: ReturnType<typeof setInterval> | null = null
  let tickInterval: ReturnType<typeof setInterval> | null = null

  const handleDataReceived = (payload: Uint8Array, participantIdentity?: string) => {
    if (!participantIdentity) return
    try {
      const data = JSON.parse(_textDecoder.decode(payload))
      if (data.channelId === "position") {
        const { x, y } = data.payload
        _remotePositions.set(participantIdentity, { x, y })
      }
    } catch {
      // Ignore malformed payloads
    }
  }

  const sendMyPosition = async () => {
    try {
      const payload = _textEncoder.encode(
        JSON.stringify({ payload: _myPosition, channelId: "position" }),
      )
      await options.localParticipant.value?.publishData(payload, DataPacket_Kind.LOSSY)
    } catch {
      // Ignore send errors
    }
  }

  const interpolatePositions = () => {
    _remotePositions.forEach((target, id) => {
      const current = _interpolatedPositions.get(id)
      if (!current) {
        _interpolatedPositions.set(id, { ...target })
      } else {
        current.x += (target.x - current.x) * INTERPOLATION_FACTOR
        current.y += (target.y - current.y) * INTERPOLATION_FACTOR
      }
    })

    // Remove stale entries
    _interpolatedPositions.forEach((_, id) => {
      if (!_remotePositions.has(id)) {
        _interpolatedPositions.delete(id)
      }
    })

    remotePositions.value = new Map(_interpolatedPositions)
  }

  const updateLocalPosition = (pos: Vector2) => {
    localPosition.value = pos
    _myPosition = pos
  }

  const startPositionSync = () => {
    const room = options.room.value
    if (!room) return

    room.on(RoomEvent.DataReceived, handleDataReceived as any)

    sendInterval = setInterval(() => {
      void sendMyPosition()
    }, SEND_INTERVAL_MS)

    tickInterval = setInterval(() => {
      interpolatePositions()
    }, 1000 / TICK_RATE)
  }

  const stopPositionSync = () => {
    const room = options.room.value
    if (room) {
      room.off(RoomEvent.DataReceived, handleDataReceived as any)
    }

    if (sendInterval) {
      clearInterval(sendInterval)
      sendInterval = null
    }

    if (tickInterval) {
      clearInterval(tickInterval)
      tickInterval = null
    }
  }

  onUnmounted(() => {
    stopPositionSync()
  })

  return {
    localPosition,
    remotePositions,
    startPositionSync,
    stopPositionSync,
    updateLocalPosition,
  }
}
