import { ref, onUnmounted, watch, type Ref } from "vue"
import type { RemoteAudioTrack } from "livekit-client"
import { EARSHOT_RADIUS } from "@/world/WorldConfig"

export interface Vector2 {
  x: number
  y: number
}

const REF_DISTANCE = 100
const ROLLOFF_FACTOR = 2

export function useSpatialAudio(options: {
  remoteAudioTracks: Ref<Map<string, RemoteAudioTrack>>
  localPosition: Ref<Vector2>
  remotePositions: Ref<Map<string, Vector2>>
}) {
  const audioContextRef = ref<AudioContext | null>(null)
  const pannerNodes = new Map<string, PannerNode>()
  const muteNodes = new Map<string, GainNode>()
  const gainNodes = new Map<string, GainNode>()
  const sourceNodes = new Map<string, MediaStreamAudioSourceNode>()
  const audioElements = new Map<string, HTMLAudioElement>()

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  const initializeAudio = (): AudioContext => {
    if (audioContextRef.value) return audioContextRef.value
    const ctx = new AudioContext()
    audioContextRef.value = ctx
    return ctx
  }

  const resumeAudio = async (): Promise<void> => {
    const ctx = audioContextRef.value
    if (ctx?.state === "suspended") {
      await ctx.resume()
    }
  }

  const connectTrack = (userId: string, track: RemoteAudioTrack) => {
    if (!audioContextRef.value) return
    const ctx = audioContextRef.value
    const mediaStreamTrack = track.mediaStreamTrack
    if (!mediaStreamTrack) return

    // Create hidden audio element (required for MediaStream to play)
    const audioEl = document.createElement("audio")
    audioEl.autoplay = true
    audioEl.muted = true
    audioEl.style.display = "none"
    document.body.appendChild(audioEl)

    const stream = new MediaStream([mediaStreamTrack])
    audioEl.srcObject = stream
    audioEl.play().catch(() => {})

    const source = ctx.createMediaStreamSource(stream)
    sourceNodes.set(userId, source)
    audioElements.set(userId, audioEl)

    if (isMobile) {
      const gain = ctx.createGain()
      gain.gain.value = 0
      source.connect(gain).connect(ctx.destination)
      gainNodes.set(userId, gain)
    } else {
      const panner = ctx.createPanner()
      panner.coneOuterAngle = 360
      panner.coneInnerAngle = 360
      panner.distanceModel = "exponential"
      panner.coneOuterGain = 1
      panner.refDistance = REF_DISTANCE
      panner.maxDistance = REF_DISTANCE * 5
      panner.rolloffFactor = ROLLOFF_FACTOR
      panner.positionX.value = 1000
      panner.positionY.value = 0
      panner.positionZ.value = 1000
      const mute = ctx.createGain()
      mute.gain.value = 0
      source.connect(panner).connect(mute).connect(ctx.destination)
      pannerNodes.set(userId, panner)
      muteNodes.set(userId, mute)
    }
  }

  const disconnectTrack = (userId: string) => {
    const panner = pannerNodes.get(userId)
    if (panner) {
      panner.disconnect()
      pannerNodes.delete(userId)
    }
    const mute = muteNodes.get(userId)
    if (mute) {
      mute.disconnect()
      muteNodes.delete(userId)
    }
    const gain = gainNodes.get(userId)
    if (gain) {
      gain.disconnect()
      gainNodes.delete(userId)
    }
    const source = sourceNodes.get(userId)
    if (source) {
      source.disconnect()
      sourceNodes.delete(userId)
    }
    const audioEl = audioElements.get(userId)
    if (audioEl) {
      audioEl.pause()
      audioEl.srcObject = null
      audioEl.remove()
      audioElements.delete(userId)
    }
  }

  const updateAudioPositions = (
    myPos: Vector2,
    remotePos: Map<string, Vector2>,
  ) => {
    remotePos.forEach((pos, userId) => {
      const relX = pos.x - myPos.x
      const relY = pos.y - myPos.y
      const distance = Math.sqrt(relX * relX + relY * relY)
      const outside = distance > EARSHOT_RADIUS

      if (isMobile) {
        const gain = gainNodes.get(userId)
        if (!gain) return
        if (outside) {
          gain.gain.setTargetAtTime(0, 0, 0.1)
        } else if (distance < 50) {
          gain.gain.setTargetAtTime(1, 0, 0.1)
        } else {
          const t = (distance - 50) / (EARSHOT_RADIUS - 50)
          gain.gain.setTargetAtTime(1 - t, 0, 0.1)
        }
      } else {
        const panner = pannerNodes.get(userId)
        const mute = muteNodes.get(userId)
        if (!panner || !mute) return
        panner.positionX.setTargetAtTime(relX, 0, 0.02)
        panner.positionZ.setTargetAtTime(relY, 0, 0.02)
        mute.gain.setTargetAtTime(outside ? 0 : 1, 0, 0.05)
      }
    })
  }

  // Watch remote audio tracks and connect/disconnect
  watch(
    () => options.remoteAudioTracks.value,
    (newTracks, oldTracks) => {
      // Disconnect removed tracks
      if (oldTracks) {
        oldTracks.forEach((_, userId) => {
          if (!newTracks.has(userId)) {
            disconnectTrack(userId)
          }
        })
      }

      // Connect new tracks
      newTracks.forEach((track, userId) => {
        if (!pannerNodes.has(userId) && !gainNodes.has(userId) && !muteNodes.has(userId)) {
          connectTrack(userId, track)
        }
      })
    },
    { deep: true, immediate: true },
  )

  const cleanup = () => {
    pannerNodes.forEach((_, userId) => disconnectTrack(userId))
    pannerNodes.clear()
    muteNodes.clear()
    gainNodes.clear()
    sourceNodes.clear()
    audioElements.clear()

    if (audioContextRef.value) {
      void audioContextRef.value.close()
      audioContextRef.value = null
    }
  }

  onUnmounted(() => {
    cleanup()
  })

  return {
    audioContext: audioContextRef,
    initializeAudio,
    resumeAudio,
    updateAudioPositions,
    cleanup,
  }
}
