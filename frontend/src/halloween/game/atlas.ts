import { Assets, Spritesheet, Texture } from "pixi.js"
import type { SpritesheetData, SpritesheetFrameData } from "pixi.js"

// The asset generator ("tizo8") exports atlases in a custom shape: the frames
// and image live under textures[0], animation keys are descriptive labels, and
// generation metadata sits in `meta.pairs`. Pixi's Spritesheet expects
// frames/animations/meta at the top level, so we adapt the payload here.
// Everything else in the game stays agnostic to the generator format.

interface TizoFrame extends SpritesheetFrameData {
  watermarkEligible?: boolean
}

interface TizoTexture {
  image: string
  format?: string
  size?: { w: number; h: number }
  scale?: number | string
  frames: Record<string, TizoFrame>
}

interface TizoAtlasJson {
  textures: TizoTexture[]
  animations?: Record<string, string[]>
  meta?: {
    app?: string
    version?: string
    pairs?: Array<{ label?: string; fps?: number; frameCount?: number }>
  }
}

export interface LoadedAtlas {
  sheet: Spritesheet
  /** Canonical state name (idle/fire/hurt/…) → its texture frames. */
  animations: Record<string, Texture[]>
}

const cache = new Map<string, Promise<LoadedAtlas>>()

export function loadTizoAtlas(jsonUrl: string, cachePrefix = jsonUrl): Promise<LoadedAtlas> {
  const cached = cache.get(jsonUrl)
  if (cached) return cached
  const promise = doLoad(jsonUrl, cachePrefix)
  cache.set(jsonUrl, promise)
  return promise
}

async function doLoad(jsonUrl: string, cachePrefix: string): Promise<LoadedAtlas> {
  const response = await fetch(jsonUrl)
  if (!response.ok) throw new Error(`Failed to load atlas ${jsonUrl}: ${response.status}`)
  const raw = (await response.json()) as TizoAtlasJson

  const tex = raw.textures?.[0]
  if (!tex) throw new Error(`Atlas ${jsonUrl} has no textures`)

  const base = jsonUrl.slice(0, jsonUrl.lastIndexOf("/") + 1)
  const texture = await Assets.load<Texture>(base + tex.image)

  // Flatten descriptive keys ("idle_subtle_breath_squash_candle_glo" → "idle")
  // into canonical state names — the leading token names the animation state.
  const animations: NonNullable<SpritesheetData["animations"]> = {}
  for (const [key, frames] of Object.entries(raw.animations ?? {})) {
    const state = normalizeState(key)
    if (!animations[state]) animations[state] = frames
  }

  const data: SpritesheetData = {
    frames: tex.frames,
    animations,
    meta: { image: tex.image, scale: tex.scale ?? 1, size: tex.size },
  }

  const sheet = new Spritesheet({ texture, data, cachePrefix })
  await sheet.parse()

  return { sheet, animations: sheet.animations as Record<string, Texture[]> }
}

// tizo8 animation keys are descriptive ("fire_recoil_kick_toward_the_right").
// The token before the first underscore is the canonical state.
export function normalizeState(key: string): string {
  return key.split("_")[0] || key
}
