import { ref, onUnmounted, type Ref } from "vue"
import { DataPacket_Kind, RoomEvent } from "livekit-client"
import type { Participant, Room, LocalParticipant } from "livekit-client"

export interface Vector2 {
  x: number
  y: number
}

const SEND_INTERVAL_MS = 60
const TICK_RATE = 30
const INTERPOLATION_FACTOR = 10 / TICK_RATE

export function useSpatialPosition(options: {
  room: Ref<Room | null>
  localParticipant: Ref<LocalParticipant | null>
  characterKey: Ref<string>
  onCharacterChange?: (participantId: string, characterKey: string) => void
  onRemoteMove?: (participantId: string, dx: number, dy: number) => void
}) {
  const localPosition = ref<Vector2>({ x: 0, y: 0 })
  const remotePositions = ref<Map<string, Vector2>>(new Map())
  const remoteCharacterKeys = ref<Map<string, string>>(new Map())

  // Internal non-reactive state for the send loop
  let _myPosition = { x: 0, y: 0 }
  const _remotePositions = new Map<string, Vector2>()
  const _remoteCharacterKeys = new Map<string, string>()
  const _interpolatedPositions = new Map<string, Vector2>()
  const _textEncoder = new TextEncoder()
  const _textDecoder = new TextDecoder()

  let sendInterval: ReturnType<typeof setInterval> | null = null
  let tickInterval: ReturnType<typeof setInterval> | null = null

  const handleDataReceived = (payload: Uint8Array, participant: Participant) => {
    if (!participant) return
    try {
      const data = JSON.parse(_textDecoder.decode(payload))
      if (data.channelId === "position") {
        const { x, y, characterKey } = data.payload
        const prev = _remotePositions.get(participant.identity)
        _remotePositions.set(participant.identity, { x, y })
        if (prev) {
          options.onRemoteMove?.(participant.identity, x - prev.x, y - prev.y)
        }
        if (characterKey && _remoteCharacterKeys.get(participant.identity) !== characterKey) {
          _remoteCharacterKeys.set(participant.identity, characterKey)
          remoteCharacterKeys.value = new Map(_remoteCharacterKeys)
          options.onCharacterChange?.(participant.identity, characterKey)
        }
      } else if (data.channelId === "character") {
        options.onCharacterChange?.(participant.identity, data.payload.key)
      }
    } catch {
      // Ignore malformed payloads
    }
  }

  const sendMyPosition = async () => {
    const key = options.characterKey.value
    try {
      const payload = _textEncoder.encode(
        JSON.stringify({
          payload: { x: _myPosition.x, y: _myPosition.y, characterKey: key },
          channelId: "position",
        }),
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

  const sendCharacterChange = async (key: string) => {
    try {
      const payload = _textEncoder.encode(
        JSON.stringify({ payload: { key }, channelId: "character" }),
      )
      await options.localParticipant.value?.publishData(payload, DataPacket_Kind.LOSSY)
    } catch {
      // Ignore send errors
    }
  }

  const startPositionSync = () => {
    const room = options.room.value
    if (!room) return

    room.on(RoomEvent.DataReceived, handleDataReceived)

    // Send position immediately so new joiners get our current position right away
    void sendMyPosition()

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
      room.off(RoomEvent.DataReceived, handleDataReceived)
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
    remoteCharacterKeys,
    startPositionSync,
    stopPositionSync,
    updateLocalPosition,
    sendCharacterChange,
  }
}
