// Pumpkin socket asset resolution. The backend owns all pumpkin art
// (see backend/assets/user-pumpkins + GET /api/halloween/assets/{id}):
// uploaded PNGs when present, bundled per-socket placeholders otherwise.
// Nothing pumpkin-related lives in the frontend public dir.
import { resolveUrl } from "@/services/api"
import type { HalloweenItem, HalloweenRarity, PumpkinSocket } from "./types"

// Canonical catalog item per socket, used as the placeholder source.
// The backend resolves these to the per-socket placeholder art.
export const PUMPKIN_SOCKET_PLACEHOLDER: Record<PumpkinSocket, string> = {
  base: "/api/halloween/assets/base_a",
  hat: "/api/halloween/assets/hat_beret",
  eyes: "/api/halloween/assets/eyes_scared",
  mouth: "/api/halloween/assets/mouth_pumpkin",
  feet: "/api/halloween/assets/feet_boots",
}

// Resolve the texture URL for an item id: backend catalog asset_path first,
// then the per-item backend URL (placeholder fallback there), then the
// socket placeholder. All URLs are backend-absolute for Pixi/electron loads.
export function pumpkinAssetForItem(
  socket: PumpkinSocket,
  itemId?: string,
  catalog?: Pick<HalloweenItem, "id" | "asset_path">[],
): string {
  if (itemId && catalog) {
    const found = catalog.find((c) => c.id === itemId)
    if (found?.asset_path) return resolveUrl(found.asset_path)
  }
  if (itemId) return resolveUrl(`/api/halloween/assets/${itemId}`)
  return resolveUrl(PUMPKIN_SOCKET_PLACEHOLDER[socket])
}

// Render layer for an item id (base = 0 default; negative draws behind).
export function pumpkinZIndexForItem(
  itemId: string | undefined,
  catalog?: Pick<HalloweenItem, "id" | "z_index">[],
  fallback: number = 0,
): number {
  if (itemId && catalog) {
    const found = catalog.find((c) => c.id === itemId)
    if (found) return found.z_index
  }
  return fallback
}

// Accessory size multiplier for an item id (1 = natural size). Never returns
// a non-positive or non-finite value: a zero/NaN sprite scale would make the
// accessory (or its anchor math) silently disappear.
export function pumpkinScaleForItem(
  itemId: string | undefined,
  catalog?: Pick<HalloweenItem, "id" | "scale">[],
  fallback: number = 1,
): number {
  if (itemId && catalog) {
    const found = catalog.find((c) => c.id === itemId)
    if (found && Number.isFinite(found.scale) && found.scale > 0) return found.scale
  }
  return fallback
}

// The draw order for sockets (creation order; final stacking uses z_index).
export const PUMPKIN_SOCKET_ORDER: PumpkinSocket[] = ["base", "feet", "eyes", "mouth", "hat"]

// Rarity outline colors for customization buttons and badges:
// common gray, uncommon green, rare blue, epic purple, legendary orange.
export const HALLOWEEN_RARITY_BORDER: Record<HalloweenRarity, string> = {
  common: "border-gray-500",
  uncommon: "border-green-500",
  rare: "border-blue-500",
  epic: "border-purple-500",
  legendary: "border-orange-500",
}

// The id of the one base every user may equip without earning it.
export const HALLOWEEN_FREE_BASE_ID = "base_a"

// Default z per socket when the catalog has no entry for the item.
export const PUMPKIN_SOCKET_DEFAULT_Z: Record<PumpkinSocket, number> = {
  base: 0,
  feet: -1,
  eyes: 10,
  mouth: 11,
  hat: 20,
}
