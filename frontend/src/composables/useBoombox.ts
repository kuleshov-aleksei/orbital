import { ref, watch, type Ref } from "vue"
import type { Room, LocalParticipant, RemoteAudioTrack, RemoteParticipant } from "livekit-client"
import { Track, type LocalTrackPublication } from "livekit-client"
import { EARSHOT_RADIUS, MAX_BOOMBOX_VOLUME } from "@/world/WorldConfig"

export interface BoomboxState {
  isPlaying: Ref<boolean>
  currentTrackId: Ref<string>
  currentTrackName: Ref<string>
  ownerIdentity: Ref<string>
  ownerNickname: Ref<string>
  boomboxTrack: Ref<RemoteAudioTrack | null>
}

interface Vector2 {
  x: number
  y: number
}

const REF_DISTANCE = 100
const ROLLOFF_FACTOR = 2

export function useBoombox(options: {
  lkRoom: Ref<Room | null>
  localParticipant: Ref<LocalParticipant | null>
  remoteAudioTracks: Ref<Map<string, RemoteAudioTrack>>
  remoteParticipants: Ref<Map<string, RemoteParticipant>>
}) {
  const isPlaying = ref(false)
  const currentTrackId = ref("")
  const currentTrackName = ref("")
  const ownerIdentity = ref("")
  const ownerNickname = ref("")

  const boomboxTrack = ref<RemoteAudioTrack | null>(null)

  const syncBoomboxTrack = () => {
    for (const [key, track] of options.remoteAudioTracks.value) {
      if (key.endsWith("-boombox")) {
        boomboxTrack.value = track
        return
      }
    }
    boomboxTrack.value = null
  }

  watch(
    () => options.remoteAudioTracks.value,
    () => syncBoomboxTrack(),
    { immediate: true, deep: true },
  )

  let audioContext: AudioContext | null = null
  let audioElement: HTMLAudioElement | null = null
  let sourceNode: MediaElementAudioSourceNode | null = null
  let destinationNode: MediaStreamAudioDestinationNode | null = null
  let localTrackPublication: LocalTrackPublication | null = null
  let localPanner: PannerNode | null = null
  let localMuteGain: GainNode | null = null

  const scanRemoteParticipantsForBoombox = () => {
    for (const [identity, participant] of options.remoteParticipants.value) {
      const tid = participant.attributes?.["boombox_track_id"]
      if (tid) {
        ownerIdentity.value = identity
        ownerNickname.value = identity
        currentTrackId.value = tid
        currentTrackName.value = participant.attributes?.["boombox_track_name"] || ""
        isPlaying.value = true
        return
      }
    }
    isPlaying.value = false
    ownerIdentity.value = ""
    ownerNickname.value = ""
    currentTrackId.value = ""
    currentTrackName.value = ""
  }

  const handleAttributesChanged = (changedAttributes: Record<string, string>) => {
    if ("boombox_track_id" in changedAttributes || "boombox_track_name" in changedAttributes) {
      scanRemoteParticipantsForBoombox()
    }
  }

  const play = async (trackId: string, trackName: string, audioUrl: string) => {
    const room = options.lkRoom.value
    const participant = options.localParticipant.value
    if (!room || !participant) return

    const ctx = new AudioContext()
    const el = document.createElement("audio")
    el.autoplay = true
    el.loop = true
    el.crossOrigin = "anonymous"
    el.style.display = "none"
    document.body.appendChild(el)

    el.src = audioUrl

    const source = ctx.createMediaElementSource(el)
    const dest = ctx.createMediaStreamDestination()
    source.connect(dest)

    // Local spatialized monitoring — same PannerNode model as remote participants
    const panner = ctx.createPanner()
    panner.coneOuterAngle = 360
    panner.coneInnerAngle = 360
    panner.distanceModel = "exponential"
    panner.coneOuterGain = 1
    panner.refDistance = REF_DISTANCE
    panner.maxDistance = REF_DISTANCE * 5
    panner.rolloffFactor = ROLLOFF_FACTOR
    const muteGain = ctx.createGain()
    muteGain.gain.value = MAX_BOOMBOX_VOLUME
    source.connect(panner).connect(muteGain).connect(ctx.destination)

    const pub = await participant.publishTrack(dest.stream.getAudioTracks()[0], {
      name: "boombox",
      source: Track.Source.Unknown,
    })

    audioContext = ctx
    audioElement = el
    sourceNode = source
    destinationNode = dest
    localTrackPublication = pub
    localPanner = panner
    localMuteGain = muteGain

    await participant.setAttributes({
      boombox_track_id: trackId,
      boombox_track_name: trackName,
    })

    currentTrackId.value = trackId
    currentTrackName.value = trackName
    ownerIdentity.value = participant.identity
    ownerNickname.value = participant.identity
    isPlaying.value = true
  }

  const stop = async () => {
    const participant = options.localParticipant.value

    if (participant) {
      if (localTrackPublication) {
        try {
          await participant.unpublishTrack(localTrackPublication.track)
        } catch (e) {
          console.warn("[Boombox] Failed to unpublish track:", e)
        }
        localTrackPublication = null
      }

      await participant.setAttributes({
        boombox_track_id: "",
        boombox_track_name: "",
      })
    }

    if (audioElement) {
      audioElement.pause()
      audioElement.src = ""
      audioElement.remove()
      audioElement = null
    }

    if (localPanner) {
      localPanner.disconnect()
      localPanner = null
    }

    if (localMuteGain) {
      localMuteGain.disconnect()
      localMuteGain = null
    }

    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }

    if (destinationNode) {
      destinationNode.disconnect()
      destinationNode = null
    }

    if (audioContext) {
      await audioContext.close()
      audioContext = null
    }

    isPlaying.value = false
    currentTrackId.value = ""
    currentTrackName.value = ""
    ownerIdentity.value = ""
    ownerNickname.value = ""
  }

  const amIPlaying = (): boolean => {
    const participant = options.localParticipant.value
    return isPlaying.value && participant !== null && ownerIdentity.value === participant.identity
  }

  const updateLocalSpatial = (myPos: Vector2, boomboxPos: Vector2) => {
    if (!localPanner || !localMuteGain) return
    const relX = boomboxPos.x - myPos.x
    const relY = boomboxPos.y - myPos.y
    const distance = Math.sqrt(relX * relX + relY * relY)
    const outside = distance > EARSHOT_RADIUS
    localPanner.positionX.setTargetAtTime(relX, 0, 0.02)
    localPanner.positionZ.setTargetAtTime(relY, 0, 0.02)
    localMuteGain.gain.setTargetAtTime(outside ? 0 : MAX_BOOMBOX_VOLUME, 0, 0.05)
  }

  return {
    isPlaying,
    currentTrackId,
    currentTrackName,
    ownerIdentity,
    ownerNickname,
    boomboxTrack,
    play,
    stop,
    amIPlaying,
    updateLocalSpatial,
    scanRemoteParticipantsForBoombox,
    handleAttributesChanged,
  }
}
