import { Howl } from "howler"
import type { SoundEvent, SoundPack, SoundPackSprite } from "@/types/audio"
import { minecraftSprites } from "@/services/sprites/minecraft"
import { jdSherbertSprites } from "@/services/sprites/jd_sherbert"
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
    sprites: jdSherbertSprites,
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
    "/assets/sounds/sprite/jd_sherbert/jd_sherbert.ogg",
    "/assets/sounds/sprite/jd_sherbert/jd_sherbert.m4a",
    "/assets/sounds/sprite/jd_sherbert/jd_sherbert.mp3",
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
    html5: true,
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
  // (e.g. "reconnecting"/"reconnected" until a pack author adds them).
  // Check before loading so we don't even fetch audio for unknown events.
  if (!(soundId in getSprites(packId))) {
    return
  }

  const sound = loadSound(packId)
  if (sound.state() === "loaded") {
    sound.play(soundId)
  } else {
    sound.once("load", () => {
      sound.play(soundId)
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
