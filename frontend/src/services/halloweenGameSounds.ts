import { Howl } from "howler"
import type { SoundPackSprite } from "@/types/audio"
import { HALLOWEEN_GAME_VOLUME_KEY } from "@/types/audio"
import { halloweenGameSprites } from "@/services/sprites/halloween_game"
import { resolveUrl } from "@/services/api"
import { isElectron } from "@/services/electron"

export type HalloweenGameSoundEvent = keyof typeof halloweenGameSprites

const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : ""

const GAME_SPRITE_URLS = [
  "/assets/hw26/sfx/halloween_game.ogg",
  "/assets/hw26/sfx/halloween_game.m4a",
  "/assets/hw26/sfx/halloween_game.mp3",
]

// Same Howl audiosprite engine as UI sounds (see services/sounds.ts), but a
// separate Howl instance so game SFX play WITH the user's UI sound pack
// instead of replacing it or depending on the pack to include game sprites.
const SPRITE_POOL_SIZE = 24
const MAX_CONCURRENT_VOICES = 10

// Throttle only automatic hot events (fire/death). User-initiated casts and
// UI (freeze, holy_grenade, purchase, sell, card_pick, levelup, item_used)
// bypass throttling and always play — long durations are by design.
const GAME_EVENT_THROTTLE_MS: Record<string, number> = {
  shooting: 45,
  slug_destroyed: 30,
  pumpkin_destroyed: 75,
  shield_break: 60,
}

let gameHowl: ReturnType<typeof Howl> | null = null
const gameVoices = new Set<number>()
const lastPlayAt = new Map<string, number>()
const pendingLoadPlays = new Set<string>()

const DEFAULT_GAME_VOLUME = 0.7

function loadStoredGameVolume(): number {
  try {
    const stored = localStorage.getItem(HALLOWEEN_GAME_VOLUME_KEY)
    if (stored != null) {
      const parsed = parseFloat(stored)
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed
    }
  } catch {
    // Private mode etc. — fall through to the default.
  }
  return DEFAULT_GAME_VOLUME
}

let gameVolume = loadStoredGameVolume()

function getGameSpriteUrls(): string[] {
  const appendVersion = (url: string) => {
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}v=${version}`
  }
  if (isElectron()) {
    if (typeof __VITE_DEV_SERVER_URL__ !== "undefined" && __VITE_DEV_SERVER_URL__) {
      return GAME_SPRITE_URLS.map((url) => `${__VITE_DEV_SERVER_URL__}${appendVersion(url)}`)
    }
    return GAME_SPRITE_URLS.map((url) => `.${appendVersion(url)}`)
  }
  return GAME_SPRITE_URLS.map((url) => resolveUrl(appendVersion(url)))
}

function toHowlSpriteFormat(
  sprites: Record<string, SoundPackSprite>,
): Record<string, [number, number]> {
  const result: Record<string, [number, number]> = {}
  for (const [key, sprite] of Object.entries(sprites)) {
    result[key] = [sprite.start, sprite.duration]
  }
  return result
}

function loadGameSound(): ReturnType<typeof Howl> {
  if (gameHowl) {
    gameHowl.volume(gameVolume)
    return gameHowl
  }
  const sound = new Howl({
    src: getGameSpriteUrls(),
    sprite: toHowlSpriteFormat(halloweenGameSprites),
    // Must stay false: with html5:true sprite end is enforced by a racy
    // timer and concurrent load makes the whole file play (see sounds.ts).
    html5: false,
    pool: SPRITE_POOL_SIZE,
    volume: gameVolume,
    preload: true,
    onloaderror: (_id: string, error: string) => {
      console.error("Failed to load halloween game sounds:", error)
    },
  })
  gameHowl = sound
  return sound
}

function throttleWindowMs(soundId: string): number {
  const cap = GAME_EVENT_THROTTLE_MS[soundId]
  if (cap == null) return 0
  const chunk = halloweenGameSprites[soundId]
  if (chunk && chunk.duration > 0) return Math.min(chunk.duration / 2, cap)
  return cap
}

export function playHalloweenGameSound(event: HalloweenGameSoundEvent): void {
  if (!(event in halloweenGameSprites)) return
  const sound = loadGameSound()
  const key = `halloween:${event}`
  const now = typeof performance !== "undefined" ? performance.now() : Date.now()
  const window = throttleWindowMs(event)
  const last = lastPlayAt.get(key) ?? -Infinity
  if (window > 0) {
    if (now - last < window) return
    lastPlayAt.set(key, now)
  }
  if (sound.state() === "loaded") {
    if (gameVoices.size >= MAX_CONCURRENT_VOICES) return
    const voiceId = sound.play(event) as number
    gameVoices.add(voiceId)
    sound.once(
      "end",
      () => {
        gameVoices.delete(voiceId)
      },
      voiceId,
    )
  } else if (!pendingLoadPlays.has(key)) {
    pendingLoadPlays.add(key)
    sound.once("load", () => {
      pendingLoadPlays.delete(key)
      sound.play(event)
    })
  }
}

export function setHalloweenGameVolume(volume: number): void {
  gameVolume = volume
  gameHowl?.volume(volume)
  try {
    localStorage.setItem(HALLOWEEN_GAME_VOLUME_KEY, volume.toString())
  } catch {
    // Private mode etc. — volume still applies to the live Howl.
  }
}

export function getHalloweenGameVolume(): number {
  return gameVolume
}

export function preloadHalloweenGameSounds(): void {
  loadGameSound()
}

export function useHalloweenGameSounds() {
  return {
    playShooting: () => playHalloweenGameSound("shooting"),
    playSlugDestroyed: () => playHalloweenGameSound("slug_destroyed"),
    playPumpkinDestroyed: () => playHalloweenGameSound("pumpkin_destroyed"),
    playShieldBreak: () => playHalloweenGameSound("shield_break"),
    playItemUsed: () => playHalloweenGameSound("item_used"),
    playFreeze: () => playHalloweenGameSound("freeze"),
    playSeedRain: () => playHalloweenGameSound("seed_rain"),
    playHolyGrenade: () => playHalloweenGameSound("holy_grenade"),
    playPurchase: () => playHalloweenGameSound("purchase"),
    playSell: () => playHalloweenGameSound("sell"),
    playCardPick: () => playHalloweenGameSound("card_pick"),
    playPumpkinLeveled: () => playHalloweenGameSound("pumpkin_leveled"),
    playPumpkinPlaced: () => playHalloweenGameSound("pumkin_place"),
  }
}
