// Maps pumpkin socket item ids to placeholder asset paths under
// frontend/public/assets/hw26/user-pumpkins/. Once real art is added, only this
// manifest needs updating — the renderer stays socket-agnostic.
import type { PumpkinSocket } from "./types"

export const PUMPKIN_BASE_PATH = "/assets/hw26/user-pumpkins"

// Per-socket placeholder asset (used when a specific item has no art yet).
export const PUMPKIN_SOCKET_PLACEHOLDER: Record<PumpkinSocket, string> = {
  base: `${PUMPKIN_BASE_PATH}/bases/base_a.png`,
  hat: `${PUMPKIN_BASE_PATH}/hats/hat_A.png`,
  eyes: `${PUMPKIN_BASE_PATH}/eyes/eye_A.png`,
  mouth: `${PUMPKIN_BASE_PATH}/mouths/mouth_A.png`,
}

// Item id → asset path. All placeholders currently point at the per-socket art.
export const PUMPKIN_ITEM_ASSETS: Record<string, string> = {
  base_a: PUMPKIN_SOCKET_PLACEHOLDER.base,
  // Hats
  hat_party: PUMPKIN_SOCKET_PLACEHOLDER.hat,
  hat_frog: PUMPKIN_SOCKET_PLACEHOLDER.hat,
  hat_beret: PUMPKIN_SOCKET_PLACEHOLDER.hat,
  // Eyes
  eyes_sinister: PUMPKIN_SOCKET_PLACEHOLDER.eyes,
  eyes_scared: PUMPKIN_SOCKET_PLACEHOLDER.eyes,
  eyes_smiling: PUMPKIN_SOCKET_PLACEHOLDER.eyes,
  eyes_cat: PUMPKIN_SOCKET_PLACEHOLDER.eyes,
  // Mouths / smiles
  mouth_vampire: PUMPKIN_SOCKET_PLACEHOLDER.mouth,
  mouth_crooked: PUMPKIN_SOCKET_PLACEHOLDER.mouth,
  mouth_pumpkin: PUMPKIN_SOCKET_PLACEHOLDER.mouth,
}

// Resolve the texture path for an item id, falling back to the socket's
// placeholder when the item is unknown or has no art.
export function pumpkinAssetForItem(socket: PumpkinSocket, itemId?: string): string {
  if (itemId && PUMPKIN_ITEM_ASSETS[itemId]) {
    return PUMPKIN_ITEM_ASSETS[itemId]
  }
  return PUMPKIN_SOCKET_PLACEHOLDER[socket]
}

// The draw order for sockets (base first, then overlays top-to-bottom).
export const PUMPKIN_SOCKET_ORDER: PumpkinSocket[] = ["base", "eyes", "mouth", "hat"]
