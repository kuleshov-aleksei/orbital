import { Assets, Spritesheet, Texture, SCALE_MODES } from "pixi.js"
import { assetPath } from "@/utils/assetPath"

export interface CharacterConfig {
  key: string
  spritesheet: string
  frameWidth: number
  frameHeight: number
  totalFrames: number
  scale?: number
  animations: {
    walk: { frames: number[]; loop: boolean }
    idle: { frames: number[]; loop: boolean }
    walkUp?: { frames: number[]; loop: boolean }
    walkDown?: { frames: number[]; loop: boolean }
  }
}

export interface AnimationTextures {
  walk: Texture[]
  idle: Texture[]
  walkUp?: Texture[]
  walkDown?: Texture[]
  scale: number
}

const registry = new Map<string, CharacterConfig>()
const cache = new Map<string, Promise<AnimationTextures>>()

export function registerCharacter(config: CharacterConfig) {
  registry.set(config.key, config)
}

export function getRegisteredKeys(): string[] {
  return Array.from(registry.keys())
}

export function getAnimations(key: string): Promise<AnimationTextures> {
  const cached = cache.get(key)
  if (cached) return cached

  const config = registry.get(key)
  if (!config) {
    throw new Error(`Character "${key}" not registered`)
  }

  const promise = loadAnimations(config)
  cache.set(key, promise)
  return promise
}

async function loadAnimations(config: CharacterConfig): Promise<AnimationTextures> {
  const texture = await Assets.load<Texture>(assetPath(config.spritesheet))
  texture.baseTexture.scaleMode = SCALE_MODES.NEAREST
  const { frameWidth, frameHeight, totalFrames } = config

  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {}
  for (let i = 0; i < totalFrames; i++) {
    frames[`frame_${i}`] = {
      frame: { x: i * frameWidth, y: 0, w: frameWidth, h: frameHeight },
    }
  }

  const spritesheet = new Spritesheet(texture, {
    frames,
    meta: { scale: "1" },
  })

  await spritesheet.parse()

  const walkTextures = config.animations.walk.frames.map((f) => spritesheet.textures[`frame_${f}`])
  const idleTextures = config.animations.idle.frames.map((f) => spritesheet.textures[`frame_${f}`])
  const walkUpTextures = config.animations.walkUp?.frames.map(
    (f) => spritesheet.textures[`frame_${f}`],
  )
  const walkDownTextures = config.animations.walkDown?.frames.map(
    (f) => spritesheet.textures[`frame_${f}`],
  )

  return {
    walk: walkTextures,
    idle: idleTextures,
    walkUp: walkUpTextures,
    walkDown: walkDownTextures,
    scale: config.scale ?? 3,
  }
}

// Default character registrations
export function registerDefaultCharacters() {
  registerCharacter({
    key: "targ",
    spritesheet: "/assets/characters/targ.png",
    frameWidth: 24,
    frameHeight: 24,
    totalFrames: 24,
    animations: {
      walk: { frames: [4, 5, 6, 7, 8, 9], loop: true },
      idle: { frames: [0, 1, 2, 3], loop: true },
    },
  })

  registerCharacter({
    key: "jeremy",
    spritesheet: "/assets/characters/jeremy.png",
    frameWidth: 64,
    frameHeight: 64,
    totalFrames: 29,
    scale: 3,
    animations: {
      walk: { frames: [6, 7, 8, 9, 10, 11, 12, 13], loop: true },
      idle: { frames: [0, 1, 2, 3, 4, 5], loop: true },
      walkUp: { frames: [15, 16, 17, 18, 19, 20, 21], loop: true },
      walkDown: { frames: [22, 23, 24, 25, 26, 27, 28], loop: true },
    },
  })

  registerCharacter({
    key: "elisabeth",
    spritesheet: "/assets/characters/elisabeth.png",
    frameWidth: 80,
    frameHeight: 64,
    totalFrames: 15,
    scale: 2,
    animations: {
      walk: { frames: [7, 8, 9, 10, 11, 12, 13, 14], loop: true },
      idle: { frames: [0, 1, 2, 3, 4, 5, 6], loop: true },
    },
  })

  registerCharacter({
    key: "robert",
    spritesheet: "/assets/characters/robert.png",
    frameWidth: 64,
    frameHeight: 64,
    totalFrames: 4,
    scale: 2,
    animations: {
      walk: { frames: [2, 3], loop: true },
      idle: { frames: [0, 1], loop: true },
    },
  })

  registerCharacter({
    key: "kusya",
    spritesheet: "/assets/characters/kusya.png",
    frameWidth: 32,
    frameHeight: 48,
    totalFrames: 14,
    scale: 3,
    animations: {
      walk: { frames: [8, 9, 10, 11, 12, 13], loop: true },
      idle: { frames: [0, 1, 2, 3, 4, 5, 6, 7], loop: true },
    },
  })

  registerCharacter({
    key: "ricardo",
    spritesheet: "/assets/characters/ricardo.png",
    frameWidth: 32,
    frameHeight: 32,
    totalFrames: 8,
    scale: 3,
    animations: {
      walk: { frames: [2, 3, 4, 5, 6, 7], loop: true },
      idle: { frames: [0, 1], loop: true },
    },
  })

  registerCharacter({
    key: "boltuhai",
    spritesheet: "/assets/characters/boltuhai.png",
    frameWidth: 64,
    frameHeight: 64,
    totalFrames: 11,
    scale: 1.5,
    animations: {
      walk: { frames: [5, 6, 7, 8, 9, 10], loop: true },
      idle: { frames: [0, 1, 2, 3, 4], loop: true },
    },
  })

  registerCharacter({
    key: "bonk",
    spritesheet: "/assets/characters/bonk.png",
    frameWidth: 64,
    frameHeight: 64,
    totalFrames: 13,
    scale: 2,
    animations: {
      walk: { frames: [9, 10, 11, 12], loop: true },
      idle: { frames: [0, 1, 2, 3, 4, 5, 6, 7, 8], loop: true },
    },
  })

  registerCharacter({
    key: "sid",
    spritesheet: "/assets/characters/sid.png",
    frameWidth: 80,
    frameHeight: 80,
    totalFrames: 12,
    scale: 1,
    animations: {
      walk: { frames: [4, 5, 6, 7, 8, 9, 10, 11], loop: true },
      idle: { frames: [0, 1, 2, 3], loop: true },
    },
  })
}

// Register default characters at module level so they're available immediately on import
registerDefaultCharacters()
