import { Assets, type Texture } from "pixi.js"
import { loadTizoAtlas, type LoadedAtlas } from "./atlas"
import type { AbilityId, ProjectileKind, PumpkinType } from "./types"
import type { GameInventoryItem } from "./types"
import type { CardDefinition } from "./balance"

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

// Card + item art (hw26 drop). Files are canonical snake_case ids:
// cards/<abilityId|pumpkinType>.png (424x632 full-bleed faces; pumpkins are
// ~1.5MB so they prefetch non-blocking) and items/<abilityId|pumpkinType|
// seed|healing_seed|missile>.png (256x256 icons; pumpkin portraits are the
// first idle frame cropped from each atlas spritesheet).
export const HW26_CARD_BASE = "/assets/hw26/cards"
export const HW26_ITEM_BASE = "/assets/hw26/items"

export const CARD_ART: Record<string, string> = {
  annihilation: `${HW26_CARD_BASE}/annihilation.png`,
  freeze: `${HW26_CARD_BASE}/freeze.png`,
  distraction: `${HW26_CARD_BASE}/distraction.png`,
  do_not_stop_daddy: `${HW26_CARD_BASE}/do_not_stop_daddy.png`,
  wide_pumpkin: `${HW26_CARD_BASE}/wide_pumpkin.png`,
  holy_grenade: `${HW26_CARD_BASE}/holy_grenade.png`,
  beer: `${HW26_CARD_BASE}/beer.png`,
  salt_line: `${HW26_CARD_BASE}/salt_line.png`,
  tailwind: `${HW26_CARD_BASE}/tailwind.png`,
  seed_rain: `${HW26_CARD_BASE}/seed_rain.png`,
  thorn_patch: `${HW26_CARD_BASE}/thorn_patch.png`,
  pearcer: `${HW26_CARD_BASE}/pearcer.png`,
  ferdinand: `${HW26_CARD_BASE}/ferdinand.png`,
  chunky: `${HW26_CARD_BASE}/chunky.png`,
  herbert: `${HW26_CARD_BASE}/herbert.png`,
  gwynevere: `${HW26_CARD_BASE}/gwynevere.png`,
  cramer: `${HW26_CARD_BASE}/cramer.png`,
}

export const ITEM_ART: Record<string, string> = {
  annihilation: `${HW26_ITEM_BASE}/annihilation.png`,
  freeze: `${HW26_ITEM_BASE}/freeze.png`,
  distraction: `${HW26_ITEM_BASE}/distraction.png`,
  do_not_stop_daddy: `${HW26_ITEM_BASE}/do_not_stop_daddy.png`,
  wide_pumpkin: `${HW26_ITEM_BASE}/wide_pumpkin.png`,
  holy_grenade: `${HW26_ITEM_BASE}/holy_grenade.png`,
  beer: `${HW26_ITEM_BASE}/beer.png`,
  salt_line: `${HW26_ITEM_BASE}/salt_line.png`,
  tailwind: `${HW26_ITEM_BASE}/tailwind.png`,
  seed_rain: `${HW26_ITEM_BASE}/seed_rain.png`,
  thorn_patch: `${HW26_ITEM_BASE}/thorn_patch.png`,
  pearcer: `${HW26_ITEM_BASE}/pearcer.png`,
  // Pumpkin portraits: first idle frame cropped from each atlas spritesheet.
  ferdinand: `${HW26_ITEM_BASE}/ferdinand.png`,
  chunky: `${HW26_ITEM_BASE}/chunky.png`,
  herbert: `${HW26_ITEM_BASE}/herbert.png`,
  gwynevere: `${HW26_ITEM_BASE}/gwynevere.png`,
  cramer: `${HW26_ITEM_BASE}/cramer.png`,
}

export const PROJECTILE_ART: Record<ProjectileKind, string> = {
  seed: `${HW26_ITEM_BASE}/seed.png`,
  heal: `${HW26_ITEM_BASE}/healing_seed.png`,
  missile: `${HW26_ITEM_BASE}/missile.png`,
}

// cardArtFor resolves the full-bleed popup art for a card offer entry.
export function cardArtFor(card: CardDefinition): string {
  const key = card.kind === "pumpkin" ? card.pumpkinType : card.abilityId
  return CARD_ART[key] ?? `${HW26_CARD_BASE}/${key}.png`
}

// itemArtFor resolves the 256px inventory icon for an inventory entry.
// Only pearcer can ever be a pumpkin inventory item.
export function itemArtFor(item: GameInventoryItem): string {
  const key = item.kind === "pumpkin" ? item.pumpkinType : item.abilityId
  return ITEM_ART[key] ?? `${HW26_ITEM_BASE}/${key}.png`
}

export function projectileArtFor(kind: ProjectileKind): string {
  return PROJECTILE_ART[kind]
}

// AbilityId → item icon, for code that only has the id (tooltips, feed).
export function itemArtForAbility(abilityId: AbilityId | string): string {
  return ITEM_ART[abilityId] ?? `${HW26_ITEM_BASE}/${abilityId}.png`
}

export function itemArtForPumpkin(pumpkinType: PumpkinType | string): string {
  return ITEM_ART[pumpkinType] ?? `${HW26_ITEM_BASE}/${pumpkinType}.png`
}

// Minigame UI chrome (hw26 items drop): coin + XP orb currency icons and the
// transparent-center frame behind inventory slots. DOM <img> icons, not Pixi
// textures — so they prefetch via plain Image, not the field-sprite loader.
export const COIN_URL = `${HW26_ITEM_BASE}/coin.png`
export const XP_ORB_URL = `${HW26_ITEM_BASE}/xp.png`
export const INVENTORY_SLOT_URL = `${HW26_ITEM_BASE}/inventory_slot.png`
export const HALLOWEEN_UI_URLS: string[] = [COIN_URL, XP_ORB_URL, INVENTORY_SLOT_URL]

// Slug shield + charge sparks (hw26 effects drop). Translucent PNGs drawn over
// slugs — one shield bubble per shielded slug, one spark per shield charge.
export const HW26_EFFECT_BASE = "/assets/hw26/effects"
export const SHIELD_URL = `${HW26_EFFECT_BASE}/shield.png`
export const SHIELD_SPARK_URL = `${HW26_EFFECT_BASE}/shield-spark.png`
// Field ability art (hw26 effects drop): ground decals drawn under engine
// zones. Salt stays procedural (white noise) — no asset.
export const BEER_PUDDLE_URL = `${HW26_EFFECT_BASE}/beer_puddle.png`
export const THORN_PATCH_URL = `${HW26_EFFECT_BASE}/thorn_patch.png`
export const DISTRACTION_SWIRL_URL = `${HW26_EFFECT_BASE}/distraction_swirl.png`
export const HALLOWEEN_EFFECT_SPRITES: string[] = [
  SHIELD_URL,
  SHIELD_SPARK_URL,
  BEER_PUDDLE_URL,
  THORN_PATCH_URL,
  DISTRACTION_SWIRL_URL,
]

// Every item/projectile texture the field renderer draws as a Pixi sprite.
// Small (~1.5MB total) — preloaded blocking before the game starts.
export const HALLOWEEN_FIELD_SPRITES: string[] = [
  ...new Set([
    ...Object.values(ITEM_ART),
    ...Object.values(PROJECTILE_ART),
    ...HALLOWEEN_EFFECT_SPRITES,
  ]),
]

// Full-bleed card faces (~4.8MB total at 424x632). Prefetched non-blocking
// after the game starts so the card popup hits a warm browser cache.
export const HALLOWEEN_CARD_URLS: string[] = [...new Set(Object.values(CARD_ART))]

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
  // Field sprites (items + projectiles) are hard dependencies of the
  // renderer — a failed load falls back to vector dots, so never fail here.
  try {
    onProgress?.(100, "Loading Items…")
    await Promise.all(HALLOWEEN_FIELD_SPRITES.map((url) => Assets.load<Texture>(url)))
  } catch (error) {
    console.warn(`[halloween] field sprites failed to preload: ${(error as Error).message}`)
  }
  // Card faces + UI chrome prefetch in the background (non-blocking — the
  // game starts immediately; the popup reads from a warm cache when it opens).
  for (const url of [...HALLOWEEN_CARD_URLS, ...HALLOWEEN_UI_URLS]) {
    const img = new Image()
    img.src = url
  }
  onProgress?.(100, "Ready")
  return assets
}

function prettyLabel(key: string): string {
  const name = key.split(":").pop() ?? key
  return name.charAt(0).toUpperCase() + name.slice(1)
}
