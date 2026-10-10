import { Howl } from "howler"
import type { SoundEvent, SoundPack, SoundPackSprite } from "@/types/audio"
import { minecraftSprites } from "@/services/sprites/minecraft"
import { whooshSprites } from "@/services/sprites/whoosh"
import { defaultSprites } from "@/services/sprites/default"
import { crunchySprites } from "@/services/sprites/crunchy"
import { kawkawSprites } from "@/services/sprites/kawkaw"
import { dotaSprites } from "@/services/sprites/dota"
import { destinySprites } from "@/services/sprites/destiny"
import { resolveUrl } from "@/services/api"
import { isElectron } from "@/services/electron"
import { useCallStore } from "@/stores/call"

const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : ""

const DEFAULT_SOUND_PACK_ID = "default"

const soundPacks: Record<string, SoundPack> = {
  default: {
    id: "default",
    name: "Default",
    description: "Default sound pack",
    sprites: defaultSprites,
  },
  jd_sherbert: {
    id: "jd_sherbert",
    name: "Whoosh",
    description: "Whoosh",
    sprites: whooshSprites,
  },
  minecraft: {
    id: "minecraft",
    name: "Minecraft",
    description: "Blocky sounds",
    sprites: minecraftSprites,
  },
  crunchy: {
    id: "crunchy",
    name: "Crunchy",
    description: "Beer with me",
    sprites: crunchySprites,
  },
  kawkaw: {
    id: "kawkaw",
    name: "Kawkaw",
    description: "Deltarune bird",
    sprites: kawkawSprites,
  },
  dota: {
    id: "dota",
    name: "Dota",
    description: "Dota 2 sounds",
    sprites: dotaSprites,
  },
  destiny: {
    id: "destiny",
    name: "Destiny",
    description: "Wake up, guardian",
    sprites: destinySprites,
  },
}

const spriteUrls: Record<string, string[]> = {
  default: [
    "/assets/sounds/sprite/default/default.ogg",
    "/assets/sounds/sprite/default/default.m4a",
    "/assets/sounds/sprite/default/default.mp3",
  ],
  jd_sherbert: [
    "/assets/sounds/sprite/whoosh/whoosh.ogg",
    "/assets/sounds/sprite/whoosh/whoosh.m4a",
    "/assets/sounds/sprite/whoosh/whoosh.mp3",
  ],
  minecraft: [
    "/assets/sounds/sprite/minecraft/minecraft.ogg",
    "/assets/sounds/sprite/minecraft/minecraft.m4a",
    "/assets/sounds/sprite/minecraft/minecraft.mp3",
  ],
  crunchy: [
    "/assets/sounds/sprite/crunchy/crunchy.ogg",
    "/assets/sounds/sprite/crunchy/crunchy.m4a",
    "/assets/sounds/sprite/crunchy/crunchy.mp3",
  ],
  kawkaw: [
    "/assets/sounds/sprite/kawkaw/kawkaw.ogg",
    "/assets/sounds/sprite/kawkaw/kawkaw.m4a",
    "/assets/sounds/sprite/kawkaw/kawkaw.mp3",
  ],
  dota: [
    "/assets/sounds/sprite/dota/dota.ogg",
    "/assets/sounds/sprite/dota/dota.m4a",
    "/assets/sounds/sprite/dota/dota.mp3",
  ],
  destiny: [
    "/assets/sounds/sprite/destiny/destiny.ogg",
    "/assets/sounds/sprite/destiny/destiny.m4a",
    "/assets/sounds/sprite/destiny/destiny.mp3",
  ],
}

const loadedSounds: Map<string, ReturnType<typeof Howl>> = new Map()
const loadedSpriteUrls: Set<string> = new Set()

// Voice budget: Howl defaults to a pool of 5 concurrent voices per sprite,
// Sometimes it is just not enough (for seasonal mini-game)
const SPRITE_POOL_SIZE = 24
// Hard ceiling on simultaneously audible voices across one pack; anything
// past it is dropped rather than stacked into noise
const MAX_CONCURRENT_VOICES = 10

// Per-event throttle caps (ms). The actual window comes from the soundpack
// (see throttleWindowMs): a replay is allowed once half the chunk has
// played, so rapid hits stay audible instead of stacking into noise. These
// caps keep a long chunk from over-throttling a hot event.
const EVENT_THROTTLE_MS: Record<string, number> = {
  shooting: 45,
  slug_destroyed: 30,
  pumpkin_destroyed: 75,
  shield_break: 60,
  item_used: 40,
  slug_movement: 100,
}
// Live voice tracking per pack. NOTE: Howl.playing() with no id returns a
// BOOLEAN (true if anything is audible), not a voice count — so the cap is
// enforced with our own set, filled on play() and drained on end.
const activeVoices: Map<string, Set<number>> = new Map()
const lastPlayAt: Map<string, number> = new Map()
// Packs still loading: remember at most ONE queued play per sprite so a
// burst before load doesn't stack N once("load") listeners that all fire.
const pendingLoadPlays: Set<string> = new Set()

// Throttle window for an event in a pack: half the resolved chunk's own
// duration (a replay lands as the previous play fades), capped by the
// per-event cap above. Events without a cap (all UI sounds) return 0 —
// they always play.
function throttleWindowMs(packId: string, soundId: string, resolved: string): number {
  const cap = EVENT_THROTTLE_MS[soundId]
  if (cap == null) return 0
  const chunk = getSprites(packId)[resolved]
  if (chunk && chunk.duration > 0) return Math.min(chunk.duration / 2, cap)
  return cap
}

let currentUserSoundPack: string = DEFAULT_SOUND_PACK_ID
let globalVolume: number = 0.7

function getSpriteUrls(packId: string): string[] {
  const urls = spriteUrls[packId] || spriteUrls[DEFAULT_SOUND_PACK_ID]
  const appendVersion = (url: string) => {
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}v=${version}`
  }
  if (isElectron()) {
    if (typeof __VITE_DEV_SERVER_URL__ !== "undefined" && __VITE_DEV_SERVER_URL__) {
      return urls.map((url) => `${__VITE_DEV_SERVER_URL__}${appendVersion(url)}`)
    }
    return urls.map((url) => `.${appendVersion(url)}`)
  }
  return urls.map((url) => resolveUrl(appendVersion(url)))
}

function getSprites(packId: string): Record<string, SoundPackSprite> {
  return soundPacks[packId]?.sprites || soundPacks[DEFAULT_SOUND_PACK_ID].sprites
}

function convertToHowlSpriteFormat(
  sprites: Record<string, SoundPackSprite>,
): Record<string, [number, number]> {
  const result: Record<string, [number, number]> = {}
  for (const [key, sprite] of Object.entries(sprites)) {
    result[key] = [sprite.start, sprite.duration]
  }
  return result
}

function loadSound(packId: string): ReturnType<typeof Howl> {
  const existing = loadedSounds.get(packId)
  if (existing) {
    existing.volume(globalVolume)
    return existing
  }

  const urls = getSpriteUrls(packId)
  const sprites = getSprites(packId)

  const sound = new Howl({
    src: urls,
    sprite: convertToHowlSpriteFormat(sprites),
    // NOTE: html5 must stay false. With html5:true Howler plays through
    // <audio> elements, where sprite *end* is enforced by a racy timer —
    // under concurrent load the timer loses and the whole file plays
    // instead of the chunk. Web Audio enforces sprite bounds
    // sample-accurately, which is what short SFX sprites need.
    html5: false,
    pool: SPRITE_POOL_SIZE,
    volume: globalVolume,
    preload: true,
    onloaderror: (_id: string, error: string) => {
      console.error(`Failed to load sound pack ${packId}:`, error)
    },
  })

  loadedSounds.set(packId, sound)
  urls.forEach((url) => loadedSpriteUrls.add(url))

  return sound
}

function playSoundById(packId: string, soundId: string): void {
  // Events without a sprite entry in the pack stay silent by default
  // (e.g. "reconnecting"/"reconnected" and seasonal game SFX until a pack
  // author adds them). Check before loading so we don't even fetch audio for
  // unknown events.
  if (!(soundId in getSprites(packId))) {
    return
  }

  const resolved = soundId
  const sound = loadSound(packId)

  // Debounce: same event re-firing faster than its window is dropped.
  // Only game SFX are throttled
  // user-triggered UI sounds always play.
  const key = `${packId}:${soundId}`
  const now = typeof performance !== "undefined" ? performance.now() : Date.now()
  const window = throttleWindowMs(packId, soundId, resolved)
  const last = lastPlayAt.get(key) ?? -Infinity

  if (window > 0) {
    if (now - last < window) {
      return
    }
    lastPlayAt.set(key, now)
  }

  if (sound.state() === "loaded") {
    let voices = activeVoices.get(packId)
    if (!voices) {
      voices = new Set<number>()
      activeVoices.set(packId, voices)
    }
    if (voices.size >= MAX_CONCURRENT_VOICES) {
      console.debug(`[sounds] CAPPED id=${soundId} voices=${voices.size}`)
      return
    }
    const voiceId = sound.play(resolved) as number
    voices.add(voiceId)
    sound.once(
      "end",
      () => {
        voices.delete(voiceId)
      },
      voiceId,
    )
  } else if (!pendingLoadPlays.has(key)) {
    pendingLoadPlays.add(key)
    sound.once("load", () => {
      pendingLoadPlays.delete(key)
      sound.play(resolved)
    })
  }
}

export function setUserSoundPack(packId: string): void {
  currentUserSoundPack = packId
  loadSound(packId)
}

export function getUserSoundPack(): string {
  return currentUserSoundPack
}

export function setGlobalVolume(volume: number): void {
  globalVolume = volume
  loadedSounds.forEach((sound) => {
    sound.volume(volume)
  })
}

export function getGlobalVolume(): number {
  return globalVolume
}

export function playLocalSound(event: SoundEvent): void {
  playSoundById(currentUserSoundPack, event)
}

export function playRemoteSound(event: SoundEvent, remoteUserSoundPack: string): void {
  // When deafened, silence all remote presence sounds (mute/deafen, join/leave, camera, etc.)
  if (useCallStore().isDeafened) return
  playSoundById(remoteUserSoundPack, event)
}

export function preloadSoundPacks(): void {
  loadSound(DEFAULT_SOUND_PACK_ID)
}

export function useSounds() {
  const playJoinRoom = () => playLocalSound("join_room")
  const playLeaveRoom = () => playLocalSound("leave_room")
  const playMute = () => playLocalSound("mute")
  const playUnmute = () => playLocalSound("unmute")
  const playDeafen = () => playLocalSound("deafen")
  const playUndeafen = () => playLocalSound("undeafen")
  const playCameraStart = () => playLocalSound("camera_start")
  const playCameraStop = () => playLocalSound("camera_stop")
  const playScreenShareStart = () => playLocalSound("screenshare_start")
  const playScreenShareStop = () => playLocalSound("screenshare_stop")
  const playMessage = () => playLocalSound("message")
  const playViewerJoined = () => playLocalSound("viewer_joined")
  const playViewerLeft = () => playLocalSound("viewer_left")
  const playReconnecting = () => playLocalSound("reconnecting")
  const playReconnected = () => playLocalSound("reconnected")

  const playRemoteMute = (soundPack: string) => playRemoteSound("mute", soundPack)
  const playRemoteUnmute = (soundPack: string) => playRemoteSound("unmute", soundPack)
  const playRemoteDeafen = (soundPack: string) => playRemoteSound("deafen", soundPack)
  const playRemoteUndeafen = (soundPack: string) => playRemoteSound("undeafen", soundPack)
  const playRemoteJoinRoom = (soundPack: string) => playRemoteSound("join_room", soundPack)
  const playRemoteLeaveRoom = (soundPack: string) => playRemoteSound("leave_room", soundPack)
  const playRemoteCameraStart = (soundPack: string) => playRemoteSound("camera_start", soundPack)
  const playRemoteCameraStop = (soundPack: string) => playRemoteSound("camera_stop", soundPack)
  const playRemoteScreenShareStart = (soundPack: string) =>
    playRemoteSound("screenshare_start", soundPack)
  const playRemoteScreenShareStop = (soundPack: string) =>
    playRemoteSound("screenshare_stop", soundPack)
  const playRemoteMessage = (soundPack: string) => playRemoteSound("message", soundPack)
  const playRemoteViewerJoined = (soundPack: string) => playRemoteSound("viewer_joined", soundPack)
  const playRemoteViewerLeft = (soundPack: string) => playRemoteSound("viewer_left", soundPack)
  const playShooting = () => playLocalSound("shooting")
  const playSlugDestroyed = () => playLocalSound("slug_destroyed")
  const playPumpkinDestroyed = () => playLocalSound("pumpkin_destroyed")
  const playItemUsed = () => playLocalSound("item_used")
  const playSlugMovement = () => playLocalSound("slug_movement")
  const playShieldBreak = () => playLocalSound("shield_break")

  return {
    playJoinRoom,
    playLeaveRoom,
    playMute,
    playUnmute,
    playDeafen,
    playUndeafen,
    playCameraStart,
    playCameraStop,
    playScreenShareStart,
    playScreenShareStop,
    playMessage,
    playViewerJoined,
    playViewerLeft,
    playReconnecting,
    playReconnected,
    playRemoteMute,
    playRemoteUnmute,
    playRemoteDeafen,
    playRemoteUndeafen,
    playRemoteJoinRoom,
    playRemoteLeaveRoom,
    playRemoteCameraStart,
    playRemoteCameraStop,
    playRemoteScreenShareStart,
    playRemoteScreenShareStop,
    playRemoteMessage,
    playRemoteViewerJoined,
    playRemoteViewerLeft,
    playShooting,
    playSlugDestroyed,
    playPumpkinDestroyed,
    playItemUsed,
    playSlugMovement,
    playShieldBreak,
  }
}

export function playJoinRoom(): void {
  playLocalSound("join_room")
}

export function playLeaveRoom(): void {
  playLocalSound("leave_room")
}

export function playRemoteMute(soundPack: string): void {
  playRemoteSound("mute", soundPack)
}

export function playRemoteUnmute(soundPack: string): void {
  playRemoteSound("unmute", soundPack)
}

export function playRemoteDeafen(soundPack: string): void {
  playRemoteSound("deafen", soundPack)
}

export function playRemoteUndeafen(soundPack: string): void {
  playRemoteSound("undeafen", soundPack)
}

export function playRemoteJoinRoom(soundPack: string): void {
  playRemoteSound("join_room", soundPack)
}

export function playRemoteLeaveRoom(soundPack: string): void {
  playRemoteSound("leave_room", soundPack)
}

export function playRemoteCameraStart(soundPack: string): void {
  playRemoteSound("camera_start", soundPack)
}

export function playRemoteCameraStop(soundPack: string): void {
  playRemoteSound("camera_stop", soundPack)
}

export function playRemoteScreenShareStart(soundPack: string): void {
  playRemoteSound("screenshare_start", soundPack)
}

export function playRemoteScreenShareStop(soundPack: string): void {
  playRemoteSound("screenshare_stop", soundPack)
}

export function playRemoteMessage(soundPack: string): void {
  playRemoteSound("message", soundPack)
}

export function playRemoteViewerJoined(soundPack: string): void {
  playRemoteSound("viewer_joined", soundPack)
}

export function playRemoteViewerLeft(soundPack: string): void {
  playRemoteSound("viewer_left", soundPack)
}

export function playReconnecting(): void {
  playLocalSound("reconnecting")
}

export function playReconnected(): void {
  playLocalSound("reconnected")
}

let reconnectLoopTimer: ReturnType<typeof setTimeout> | null = null

function getSoundDuration(packId: string, soundId: string): number | null {
  const sprite = getSprites(packId)[soundId]
  return sprite && sprite.duration > 0 ? sprite.duration : null
}

function scheduleReconnectTick(): void {
  // Re-read the duration on every tick so switching sound packs mid-reconnect
  // picks up the new pack's timing (or stops if the new pack has no sprite).
  const duration = getSoundDuration(getUserSoundPack(), "reconnecting")
  if (!duration) return

  reconnectLoopTimer = setTimeout(() => {
    playLocalSound("reconnecting")
    scheduleReconnectTick()
  }, duration + 1000)
}

/**
 * Start looping the "reconnecting" chime for as long as reconnection is in
 * progress. The repeat interval comes from the "reconnecting" sprite duration
 * in the current sound pack - if the pack has no such sprite, nothing plays
 * at all. Call stopReconnectingLoop() when reconnecting ends.
 */
export function startReconnectingLoop(): void {
  stopReconnectingLoop()
  playLocalSound("reconnecting")
  scheduleReconnectTick()
}

/** Stop the reconnecting chime loop started by startReconnectingLoop(). */
export function stopReconnectingLoop(): void {
  if (reconnectLoopTimer) {
    clearTimeout(reconnectLoopTimer)
    reconnectLoopTimer = null
  }
}

export { soundPacks, DEFAULT_SOUND_PACK_ID }
