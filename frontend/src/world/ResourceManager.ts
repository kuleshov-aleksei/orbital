import { Assets, Spritesheet, Texture, SCALE_MODES } from "pixi.js"

export interface CharacterConfig {
  key: string
  spritesheet: string
  frameWidth: number
  frameHeight: number
  totalFrames: number
  animations: {
    walk: { frames: number[]; loop: boolean }
    idle: { frames: number[]; loop: boolean }
  }
}

export interface AnimationTextures {
  walk: Texture[]
  idle: Texture[]
}

const registry = new Map<string, CharacterConfig>()
const cache = new Map<string, Promise<AnimationTextures>>()

export function registerCharacter(config: CharacterConfig) {
  registry.set(config.key, config)
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
  const texture = await Assets.load<Texture>(config.spritesheet)
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

  return {
    walk: walkTextures,
    idle: idleTextures,
  }
}

// Default character registrations
export function registerDefaultCharacters() {
  registerCharacter({
    key: "doux",
    spritesheet: "/assets/characters/doux.png",
    frameWidth: 24,
    frameHeight: 24,
    totalFrames: 24,
    animations: {
      walk: { frames: [4, 5, 6, 7, 8, 9], loop: true },
      idle: { frames: [0, 1, 2, 3], loop: true },
    },
  })

  registerCharacter({
    key: "mort",
    spritesheet: "/assets/characters/mort.png",
    frameWidth: 24,
    frameHeight: 24,
    totalFrames: 24,
    animations: {
      walk: { frames: [4, 5, 6, 7, 8, 9], loop: true },
      idle: { frames: [0, 1, 2, 3], loop: true },
    },
  })

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
    key: "vita",
    spritesheet: "/assets/characters/vita.png",
    frameWidth: 24,
    frameHeight: 24,
    totalFrames: 24,
    animations: {
      walk: { frames: [4, 5, 6, 7, 8, 9], loop: true },
      idle: { frames: [0, 1, 2, 3], loop: true },
    },
  })
}
