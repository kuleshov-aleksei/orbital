import { Assets, type Texture } from "pixi.js"
import { loadTizoAtlas, type LoadedAtlas } from "./atlas"
import { assetPath } from "@/utils/assetPath"
import { debugError, debugWarn } from "@/utils/debug"
import type { AbilityId, ProjectileKind, PumpkinType } from "./types"
import type { GameInventoryItem } from "./types"
import type { CardDefinition } from "./balance"

export interface AtlasManifestEntry {
  key: string
  url: string
}

// Pixi's Assets resolver only recognizes http(s) URLs, so in the Electron
// build (served from orbital://app/) a root-absolute "/assets/..." is mangled
// into "orbital://assets/..." and the protocol handler 404s. assetPath()
// emits a "./" relative URL in Electron so Pixi joins it correctly.
// assetPath() must be applied to full file URLs only — never to the raw
// base constants (the "?v=" version query would land mid-path).
const hw26 = (file: string): string => assetPath(`/assets/hw26/${file}`)

// Every animated object the mini game renders. The preloader blocks the game
// until all of these resolve — add new exports here as they arrive.
export const HALLOWEEN_ATLASES: AtlasManifestEntry[] = [
  { key: "pumpkin:ferdinand", url: hw26("pumkins/ferdinand/atlas.json") },
  { key: "pumpkin:chunky", url: hw26("pumkins/chunky/atlas.json") },
  { key: "pumpkin:herbert", url: hw26("pumkins/herbert/atlas.json") },
  { key: "pumpkin:gwynevere", url: hw26("pumkins/gwynevere/atlas.json") },
  { key: "pumpkin:cramer", url: hw26("pumkins/cramer/atlas.json") },
  { key: "pumpkin:pearcer", url: hw26("pumkins/pearcer/atlas.json") },
  { key: "slug:scout", url: hw26("slugs/scout/atlas.json") },
  { key: "slug:marvin", url: hw26("slugs/marvin/atlas.json") },
  { key: "slug:gerald", url: hw26("slugs/gerald/atlas.json") },
  { key: "slug:dell", url: hw26("slugs/dell/atlas.json") },
]

// Card + item art (hw26 drop). Files are canonical snake_case ids:
// cards/<abilityId|pumpkinType>.png (424x632 full-bleed faces; pumpkins are
// ~1.5MB so they prefetch non-blocking) and items/<abilityId|pumpkinType|
// seed|healing_seed|missile>.png (256x256 icons; pumpkin portraits are the
// first idle frame cropped from each atlas spritesheet).
export const HW26_CARD_BASE = "/assets/hw26/cards"
export const HW26_ITEM_BASE = "/assets/hw26/items"

export const CARD_ART: Record<string, string> = {
  annihilation: hw26("cards/annihilation.png"),
  freeze: hw26("cards/freeze.png"),
  distraction: hw26("cards/distraction.png"),
  do_not_stop_daddy: hw26("cards/do_not_stop_daddy.png"),
  wide_pumpkin: hw26("cards/wide_pumpkin.png"),
  holy_grenade: hw26("cards/holy_grenade.png"),
  beer: hw26("cards/beer.png"),
  salt_line: hw26("cards/salt_line.png"),
  tailwind: hw26("cards/tailwind.png"),
  seed_rain: hw26("cards/seed_rain.png"),
  thorn_patch: hw26("cards/thorn_patch.png"),
  pearcer: hw26("cards/pearcer.png"),
  ferdinand: hw26("cards/ferdinand.png"),
  chunky: hw26("cards/chunky.png"),
  herbert: hw26("cards/herbert.png"),
  gwynevere: hw26("cards/gwynevere.png"),
  cramer: hw26("cards/cramer.png"),
}

export const ITEM_ART: Record<string, string> = {
  annihilation: hw26("items/annihilation.png"),
  freeze: hw26("items/freeze.png"),
  distraction: hw26("items/distraction.png"),
  do_not_stop_daddy: hw26("items/do_not_stop_daddy.png"),
  wide_pumpkin: hw26("items/wide_pumpkin.png"),
  holy_grenade: hw26("items/holy_grenade.png"),
  beer: hw26("items/beer.png"),
  salt_line: hw26("items/salt_line.png"),
  tailwind: hw26("items/tailwind.png"),
  seed_rain: hw26("items/seed_rain.png"),
  thorn_patch: hw26("items/thorn_patch.png"),
  pearcer: hw26("items/pearcer.png"),
  // Pumpkin portraits: first idle frame cropped from each atlas spritesheet.
  ferdinand: hw26("items/ferdinand.png"),
  chunky: hw26("items/chunky.png"),
  herbert: hw26("items/herbert.png"),
  gwynevere: hw26("items/gwynevere.png"),
  cramer: hw26("items/cramer.png"),
}

export const PROJECTILE_ART: Record<ProjectileKind, string> = {
  seed: hw26("items/seed.png"),
  heal: hw26("items/healing_seed.png"),
  missile: hw26("items/missile.png"),
}

// cardArtFor resolves the full-bleed popup art for a card offer entry.
export function cardArtFor(card: CardDefinition): string {
  const key = card.kind === "pumpkin" ? card.pumpkinType : card.abilityId
  return CARD_ART[key] ?? hw26(`cards/${key}.png`)
}

// itemArtFor resolves the 256px inventory icon for an inventory entry.
// Only pearcer can ever be a pumpkin inventory item.
export function itemArtFor(item: GameInventoryItem): string {
  const key = item.kind === "pumpkin" ? item.pumpkinType : item.abilityId
  return ITEM_ART[key] ?? hw26(`items/${key}.png`)
}

export function projectileArtFor(kind: ProjectileKind): string {
  return PROJECTILE_ART[kind]
}

// AbilityId → item icon, for code that only has the id (tooltips, feed).
export function itemArtForAbility(abilityId: AbilityId | string): string {
  return ITEM_ART[abilityId] ?? hw26(`items/${abilityId}.png`)
}

export function itemArtForPumpkin(pumpkinType: PumpkinType | string): string {
  return ITEM_ART[pumpkinType] ?? hw26(`items/${pumpkinType}.png`)
}

// Minigame UI chrome (hw26 items drop): coin + XP orb currency icons and the
// transparent-center frame behind inventory slots. DOM <img> icons, not Pixi
// textures — so they prefetch via plain Image, not the field-sprite loader.
export const COIN_URL = hw26("items/coin.png")
export const XP_ORB_URL = hw26("items/xp.png")
export const INVENTORY_SLOT_URL = hw26("items/inventory_slot.png")
export const HALLOWEEN_UI_URLS: string[] = [COIN_URL, XP_ORB_URL, INVENTORY_SLOT_URL]

// Slug shield + charge sparks (hw26 effects drop). Translucent PNGs drawn over
// slugs — one shield bubble per shielded slug, one spark per shield charge.
export const HW26_EFFECT_BASE = "/assets/hw26/effects"
export const SHIELD_URL = hw26("effects/shield.png")
export const SHIELD_SPARK_URL = hw26("effects/shield-spark.png")
// Field ability art (hw26 effects drop): ground decals drawn under engine
// zones. Salt stays procedural (white noise) — no asset.
export const BEER_PUDDLE_URL = hw26("effects/beer_puddle.png")
export const THORN_PATCH_URL = hw26("effects/thorn_patch.png")
export const DISTRACTION_SWIRL_URL = hw26("effects/distraction_swirl.png")
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
export const HALLOWEEN_BACKGROUND_URL = hw26("backgrounds/background_c_v4.png")

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
    try {
      const atlas = await loadTizoAtlas(entry.url, entry.key)
      assets.set(entry.key, atlas)
    } catch (error) {
      debugError(`[halloween] atlas failed to preload: ${entry.key}`, { url: entry.url }, error)
      throw error
    }
    onProgress?.(Math.round(((i + 1) / total) * 100), `Loaded ${prettyLabel(entry.key)}`)
  }
  // The backdrop is optional art, not a hard dependency: if it fails to load
  // the renderer falls back to the flat fill, so never fail the preload here.
  try {
    onProgress?.(100, "Loading Background…")
    await Assets.load<Texture>(HALLOWEEN_BACKGROUND_URL)
  } catch (error) {
    debugWarn(`[halloween] background failed to preload`, { url: HALLOWEEN_BACKGROUND_URL }, error)
  }
  // Field sprites (items + projectiles) are hard dependencies of the
  // renderer — a failed load falls back to vector dots, so never fail here.
  // allSettled (not Promise.all) so every failing URL lands in the remote
  // log instead of just the first rejection.
  try {
    onProgress?.(100, "Loading Items…")
    const results = await Promise.allSettled(
      HALLOWEEN_FIELD_SPRITES.map((url) => Assets.load<Texture>(url)),
    )
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === "rejected") {
        debugError(
          `[halloween] field sprite failed to preload`,
          { url: HALLOWEEN_FIELD_SPRITES[i] },
          result.reason,
        )
      }
    }
  } catch (error) {
    debugWarn(`[halloween] field sprites failed to preload: ${(error as Error).message}`)
  }
  // Card faces + UI chrome prefetch in the background (non-blocking — the
  // game starts immediately; the popup reads from a warm cache when it opens).
  for (const url of [...HALLOWEEN_CARD_URLS, ...HALLOWEEN_UI_URLS]) {
    const img = new Image()
    img.onerror = () => {
      debugWarn(`[halloween] card/UI art failed to prefetch: ${url}`)
    }
    img.src = url
  }
  onProgress?.(100, "Ready")
  return assets
}

function prettyLabel(key: string): string {
  const name = key.split(":").pop() ?? key
  return name.charAt(0).toUpperCase() + name.slice(1)
}
