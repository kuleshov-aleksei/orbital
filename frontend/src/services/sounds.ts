import { Howl } from "howler"
import type { SoundEvent, SoundPack, SoundPackSprite } from "@/types/audio"
import { minecraftSprites } from "@/services/sprites/minecraft"
import { jdSherbertSprites } from "@/services/sprites/jdSherbert"
import { defaultSprites } from "@/services/sprites/default"

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
}

const spriteUrls: Record<string, string[]> = {
  default: [
    "/assets/sounds/sprite/snd-lib-sine/audioSprite.ogg",
    "/assets/sounds/sprite/snd-lib-sine/audioSprite.m4a",
    "/assets/sounds/sprite/snd-lib-sine/audioSprite.mp3",
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
}

const loadedSounds: Map<string, Howl> = new Map()
const loadedSpriteUrls: Set<string> = new Set()

let currentUserSoundPack: string = DEFAULT_SOUND_PACK_ID
let globalVolume: number = 0.7

function getSpriteUrls(packId: string): string[] {
  return spriteUrls[packId] || spriteUrls[DEFAULT_SOUND_PACK_ID]
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

function loadSound(packId: string): Howl {
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
    onloaderror: (_id, error) => {
      console.error(`Failed to load sound pack ${packId}:`, error)
    },
  })

  loadedSounds.set(packId, sound)
  urls.forEach((url) => loadedSpriteUrls.add(url))

  return sound
}

function playSoundById(packId: string, soundId: string): void {
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
  console.log(`Playing ${event} from pack ${remoteUserSoundPack}`)
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

export { soundPacks, DEFAULT_SOUND_PACK_ID }
