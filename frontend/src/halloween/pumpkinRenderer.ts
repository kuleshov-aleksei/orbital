import { Assets, Container, Sprite, type Texture } from "pixi.js"
import type { BaseLayouts, EquippedCustomization, HalloweenItem, PumpkinSocket } from "./types"
import {
  PUMPKIN_SOCKET_DEFAULT_Z,
  PUMPKIN_SOCKET_ORDER,
  pumpkinAssetForItem,
  pumpkinScaleForItem,
  pumpkinZIndexForItem,
} from "./assets"

export interface PumpkinSpriteDisplay {
  container: Container
  setEquipped(
    equipped: EquippedCustomization,
    opts?: { layouts?: BaseLayouts; catalog?: HalloweenItem[] },
  ): void
  destroy(): void
}

// Height (in scene units) the base pumpkin sprite is scaled to fit.
const PUMPKIN_FIT_HEIGHT = 96

const DEFAULT_BASE_ID = "base_a"

// Backend-owned pumpkin art URLs are extensionless (/api/halloween/assets/<id>,
// optionally with ?v=), so Pixi's extension-sniffing parser picker finds no
// match and Assets.load resolves null. Pin the texture parser explicitly.
async function loadPumpkinTexture(path: string): Promise<Texture | null> {
  try {
    const texture = await Assets.load<Texture>({
      alias: path,
      src: path,
      parser: "texture",
    })
    return texture ?? null
  } catch (error) {
    console.warn(`[pumpkin] failed to load texture ${path}:`, error)
    return null
  }
}

function layoutFor(
  layouts: BaseLayouts | undefined,
  baseId: string,
  socket: PumpkinSocket,
): { offset_x: number; offset_y: number } {
  const entry = layouts?.[baseId]?.[socket as keyof BaseLayouts[string]]
  return { offset_x: entry?.offset_x ?? 0, offset_y: entry?.offset_y ?? 0 }
}

export async function createPumpkinSprite(
  size = PUMPKIN_FIT_HEIGHT,
): Promise<PumpkinSpriteDisplay> {
  const container = new Container()
  container.sortableChildren = true

  const sprites = new Map<PumpkinSocket, Sprite>()
  for (const socket of PUMPKIN_SOCKET_ORDER) {
    const sprite = new Sprite()
    sprite.anchor.set(0.5)
    sprite.visible = false
    container.addChild(sprite)
    sprites.set(socket, sprite)
  }

  // Guards overlapping setEquipped calls (texture loads race each other).
  let generation = 0

  const applyAll = async (
    equipped: EquippedCustomization,
    opts?: { layouts?: BaseLayouts; catalog?: HalloweenItem[] },
  ) => {
    const gen = ++generation
    const layouts = opts?.layouts
    const catalog = opts?.catalog
    const baseId = equipped.base ?? DEFAULT_BASE_ID

    // Base first: it dictates the fit scale for the whole composition.
    const baseSprite = sprites.get("base")
    let scale = 1
    let baseW = size
    let baseH = size
    if (baseSprite) {
      const path = pumpkinAssetForItem("base", baseId, catalog)
      const texture = await loadPumpkinTexture(path)
      if (gen !== generation) return
      if (!texture) {
        console.warn(`[pumpkin] base texture missing for ${path}; hiding composition`)
        baseSprite.visible = false
        return
      }
      baseSprite.texture = texture
      scale = size / (texture.height || size)
      baseSprite.scale.set(scale)
      baseSprite.position.set(0, 0)
      baseSprite.zIndex = pumpkinZIndexForItem(baseId, catalog, PUMPKIN_SOCKET_DEFAULT_Z.base)
      baseSprite.visible = true
      baseW = texture.width * scale
      baseH = texture.height * scale
    }

    // Overlays inherit the base scale and sit on the per-base socket anchor:
    // position = anchor (base center) + normalized offset * base display size.
    await Promise.all(
      PUMPKIN_SOCKET_ORDER.filter((s) => s !== "base").map(async (socket) => {
        const sprite = sprites.get(socket)
        if (!sprite) return
        const itemId = equipped[socket]
        if (!itemId) {
          if (gen === generation) sprite.visible = false
          return
        }
        const path = pumpkinAssetForItem(socket, itemId, catalog)
        const texture = await loadPumpkinTexture(path)
        if (gen !== generation) return
        if (!texture) {
          console.warn(`[pumpkin] overlay texture missing for ${path}; hiding ${socket}`)
          if (gen === generation) sprite.visible = false
          return
        }
        sprite.texture = texture
        // Guarded: a non-finite combined scale must fall back to the base fit
        // instead of collapsing the sprite to nothing.
        const itemScale = pumpkinScaleForItem(itemId, catalog)
        const overlayScale = Number.isFinite(scale * itemScale) ? scale * itemScale : scale
        sprite.scale.set(overlayScale > 0 ? overlayScale : scale)
        const { offset_x, offset_y } = layoutFor(layouts, baseId, socket)
        sprite.position.set(offset_x * baseW, offset_y * baseH)
        sprite.zIndex = pumpkinZIndexForItem(itemId, catalog, PUMPKIN_SOCKET_DEFAULT_Z[socket])
        sprite.visible = true
      }),
    )
  }

  const setEquipped = (
    equipped: EquippedCustomization,
    opts?: { layouts?: BaseLayouts; catalog?: HalloweenItem[] },
  ) => {
    void applyAll(equipped, opts)
  }

  const destroy = () => {
    generation++
    container.destroy({ children: true })
  }

  return {
    container,
    setEquipped,
    destroy,
  }
}
