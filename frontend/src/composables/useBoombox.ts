import { ref, watch, type Ref } from "vue"
import type {
  Room,
  LocalParticipant,
  RemoteAudioTrack,
  RemoteParticipant,
  Participant,
} from "livekit-client"
import { Track, RoomEvent, type LocalTrackPublication } from "livekit-client"
import { EARSHOT_RADIUS } from "@/world/WorldConfig"
import { apiService } from "@/services/api"

export interface PlaylistEntry {
  trackId: string
  trackName: string
}

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

  const VOLUME_STORAGE_KEY = "orbital:boombox_volume"

  const boomboxVolume = ref(parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) ?? "") || 0.5)
  const boomboxTrack = ref<RemoteAudioTrack | null>(null)
  const playlist = ref<PlaylistEntry[]>([])

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

  watch(boomboxVolume, (vol) => {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(vol))
    if (localMuteGain) {
      localMuteGain.gain.value = vol
    }
  })

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
        ownerNickname.value = participant.name || identity
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

  const syncPlaylistFromAttributes = () => {
    if (amIPlaying()) return
    for (const [, participant] of options.remoteParticipants.value) {
      const tid = participant.attributes?.["boombox_track_id"]
      if (tid) {
        const raw = participant.attributes?.["boombox_playlist"] || "[]"
        try {
          playlist.value = JSON.parse(raw)
        } catch {
          playlist.value = []
        }
        return
      }
    }
    playlist.value = []
  }

  const handleAttributesChanged = (changedAttributes: Record<string, string>) => {
    if ("boombox_track_id" in changedAttributes || "boombox_track_name" in changedAttributes) {
      scanRemoteParticipantsForBoombox()
      syncPlaylistFromAttributes()
    }
    if ("boombox_playlist" in changedAttributes) {
      syncPlaylistFromAttributes()
    }
  }

  const cleanupPlayback = async () => {
    const participant = options.localParticipant.value
    if (participant && localTrackPublication) {
      try {
        await participant.unpublishTrack(localTrackPublication.track)
      } catch (e) {
        console.warn("[Boombox] Failed to unpublish track:", e)
      }
      localTrackPublication = null
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
  }

  const handleTrackEnded = async () => {
    if (playlist.value.length > 0 && options.localParticipant.value) {
      const next = playlist.value.shift()!
      const url = apiService.getAudioUrl(next.trackId)
      await options.localParticipant.value.setAttributes({
        boombox_playlist: JSON.stringify(playlist.value),
      })
      await play(next.trackId, next.trackName, url, { clearPlaylist: false })
    } else {
      await stop()
    }
  }

  const stop = async () => {
    await cleanupPlayback()

    const participant = options.localParticipant.value
    if (participant) {
      await participant.setAttributes({
        boombox_track_id: "",
        boombox_track_name: "",
        boombox_playlist: "",
      })
    }

    isPlaying.value = false
    currentTrackId.value = ""
    currentTrackName.value = ""
    ownerIdentity.value = ""
    ownerNickname.value = ""
    playlist.value = []
  }

  const play = async (
    trackId: string,
    trackName: string,
    audioUrl: string,
    playOpts?: { clearPlaylist?: boolean },
  ) => {
    const room = options.lkRoom.value
    const participant = options.localParticipant.value
    if (!room || !participant) return

    await cleanupPlayback()

    const ctx = new AudioContext()
    const el = document.createElement("audio")
    el.autoplay = true
    el.crossOrigin = "anonymous"
    el.style.display = "none"
    document.body.appendChild(el)

    el.src = audioUrl
    el.addEventListener("ended", handleTrackEnded)

    const source = ctx.createMediaElementSource(el)
    const dest = ctx.createMediaStreamDestination()
    source.connect(dest)

    const panner = ctx.createPanner()
    panner.coneOuterAngle = 360
    panner.coneInnerAngle = 360
    panner.distanceModel = "exponential"
    panner.coneOuterGain = 1
    panner.refDistance = REF_DISTANCE
    panner.maxDistance = REF_DISTANCE * 5
    panner.rolloffFactor = ROLLOFF_FACTOR
    const muteGain = ctx.createGain()
    muteGain.gain.value = boomboxVolume.value
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

    const clearPlaylist = playOpts?.clearPlaylist ?? true
    const attrs: Record<string, string> = {
      boombox_track_id: trackId,
      boombox_track_name: trackName,
    }
    if (clearPlaylist) {
      attrs.boombox_playlist = ""
      playlist.value = []
    } else {
      attrs.boombox_playlist = JSON.stringify(playlist.value)
    }
    await participant.setAttributes(attrs)

    currentTrackId.value = trackId
    currentTrackName.value = trackName
    ownerIdentity.value = participant.identity
    ownerNickname.value = participant.name || participant.identity
    isPlaying.value = true
  }

  const amIPlaying = (): boolean => {
    const participant = options.localParticipant.value
    return isPlaying.value && participant !== null && ownerIdentity.value === participant.identity
  }

  const queueTrack = (trackId: string, trackName: string) => {
    if (amIPlaying()) {
      playlist.value.push({ trackId, trackName })
      options.localParticipant.value?.setAttributes({
        boombox_playlist: JSON.stringify(playlist.value),
      })
    } else if (isPlaying.value) {
      const msg = JSON.stringify({ type: "boombox_queue_add", trackId, trackName })
      const payload = new TextEncoder().encode(msg)
      options.lkRoom.value?.localParticipant?.publishData(payload, { reliable: true })
    }
  }

  const skipTrack = () => {
    if (!amIPlaying()) return
    handleTrackEnded()
  }

  const onDataReceived = (payload: Uint8Array, participant?: Participant) => {
    if (!participant || participant.identity === options.localParticipant.value?.identity) return
    if (!amIPlaying()) return
    try {
      const msg = JSON.parse(new TextDecoder().decode(payload))
      if (msg.type === "boombox_queue_add") {
        playlist.value.push({ trackId: msg.trackId, trackName: msg.trackName })
        options.localParticipant.value?.setAttributes({
          boombox_playlist: JSON.stringify(playlist.value),
        })
      }
    } catch {
      /* ignore malformed messages */
    }
  }

  watch(
    () => options.lkRoom.value,
    (room, oldRoom) => {
      if (oldRoom) {
        oldRoom.off(RoomEvent.DataReceived, onDataReceived)
      }
      if (room) {
        room.on(RoomEvent.DataReceived, onDataReceived)
      }
    },
    { immediate: true },
  )

  const updateLocalSpatial = (myPos: Vector2, boomboxPos: Vector2) => {
    if (!localPanner || !localMuteGain) return
    const relX = boomboxPos.x - myPos.x
    const relY = boomboxPos.y - myPos.y
    const distance = Math.sqrt(relX * relX + relY * relY)
    const outside = distance > EARSHOT_RADIUS
    localPanner.positionX.setTargetAtTime(relX, 0, 0.02)
    localPanner.positionZ.setTargetAtTime(relY, 0, 0.02)
    localMuteGain.gain.setTargetAtTime(outside ? 0 : boomboxVolume.value, 0, 0.05)
  }

  return {
    isPlaying,
    currentTrackId,
    currentTrackName,
    ownerIdentity,
    ownerNickname,
    boomboxTrack,
    boomboxVolume,
    playlist,
    play,
    stop,
    amIPlaying,
    queueTrack,
    skipTrack,
    updateLocalSpatial,
    scanRemoteParticipantsForBoombox,
    handleAttributesChanged,
  }
}
