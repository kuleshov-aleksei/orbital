import { Assets, type Texture } from "pixi.js"
import { loadTizoAtlas, type LoadedAtlas } from "./atlas"

export interface AtlasManifestEntry {
  key: string
  url: string
}

// Every animated object the mini game renders. The preloader blocks the game
// until all of these resolve — add new exports here as they arrive.
export const HALLOWEEN_ATLASES: AtlasManifestEntry[] = [
  { key: "pumpkin:ferdinand", url: "/assets/hw26/pumkins/ferdinand/atlas.json" },
  { key: "pumpkin:chunky", url: "/assets/hw26/pumkins/chunky/atlas.json" },
  { key: "pumpkin:herbert", url: "/assets/hw26/pumkins/herbert/atlas.json" },
  { key: "pumpkin:gwynevere", url: "/assets/hw26/pumkins/gwynevere/atlas.json" },
  { key: "pumpkin:cramer", url: "/assets/hw26/pumkins/cramer/atlas.json" },
  { key: "pumpkin:pearcer", url: "/assets/hw26/pumkins/pearcer/atlas.json" },
  { key: "slug:scout", url: "/assets/hw26/slugs/scout/atlas.json" },
  { key: "slug:marvin", url: "/assets/hw26/slugs/marvin/atlas.json" },
  { key: "slug:gerald", url: "/assets/hw26/slugs/gerald/atlas.json" },
  { key: "slug:dell", url: "/assets/hw26/slugs/dell/atlas.json" },
]

export type HalloweenAssets = Map<string, LoadedAtlas>

// Battlefield backdrop. Plain PNG (not an atlas) — preloaded into Pixi's
// global Assets cache so the renderer can pick it up without type changes.
export const HALLOWEEN_BACKGROUND_URL = "/assets/hw26/backgrounds/background_c_v4.png"

export type PreloadProgress = (percent: number, stage: string) => void

// preloadHalloweenAssets loads every manifest atlas, reporting 0–100 progress
// for the loading overlay. The caller must await this before starting a game.
export async function preloadHalloweenAssets(
  onProgress?: PreloadProgress,
): Promise<HalloweenAssets> {
  const assets: HalloweenAssets = new Map()
  const total = HALLOWEEN_ATLASES.length
  onProgress?.(0, "Preparing assets…")
  for (let i = 0; i < total; i++) {
    const entry = HALLOWEEN_ATLASES[i]
    onProgress?.(Math.round((i / total) * 100), `Loading ${prettyLabel(entry.key)}…`)
    const atlas = await loadTizoAtlas(entry.url, entry.key)
    assets.set(entry.key, atlas)
    onProgress?.(Math.round(((i + 1) / total) * 100), `Loaded ${prettyLabel(entry.key)}`)
  }
  // The backdrop is optional art, not a hard dependency: if it fails to load
  // the renderer falls back to the flat fill, so never fail the preload here.
  try {
    onProgress?.(100, "Loading Background…")
    await Assets.load<Texture>(HALLOWEEN_BACKGROUND_URL)
  } catch (error) {
    console.warn(`[halloween] background failed to preload: ${(error as Error).message}`)
  }
  onProgress?.(100, "Ready")
  return assets
}

function prettyLabel(key: string): string {
  const name = key.split(":").pop() ?? key
  return name.charAt(0).toUpperCase() + name.slice(1)
}
