import { Assets, Container, Sprite } from "pixi.js"
import type { EquippedCustomization, PumpkinSocket } from "./types"
import { PUMPKIN_SOCKET_ORDER, pumpkinAssetForItem } from "./assets"

export interface PumpkinSpriteDisplay {
  container: Container
  setEquipped(equipped: EquippedCustomization): void
  destroy(): void
}

// Height (in scene units) the base pumpkin sprite is scaled to fit.
const PUMPKIN_FIT_HEIGHT = 96

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

  let baseTexture: { width: number; height: number } | null = null

  const applySocket = async (socket: PumpkinSocket, itemId?: string) => {
    const sprite = sprites.get(socket)
    if (!sprite) return

    const path = pumpkinAssetForItem(socket, itemId)
    const texture = await Assets.load(path)
    sprite.texture = texture

    // Base dictates the fit scale; overlays inherit it so they stack cleanly.
    if (!baseTexture) {
      baseTexture = { width: texture.width, height: texture.height }
      const scale = size / (baseTexture.height || size)
      for (const s of sprites.values()) {
        s.scale.set(scale)
      }
    }

    sprite.visible = true
  }

  const setEquipped = (equipped: EquippedCustomization) => {
    void applySocket("base", "base_a")
    for (const socket of PUMPKIN_SOCKET_ORDER) {
      if (socket === "base") continue
      const itemId = equipped[socket]
      if (itemId) {
        void applySocket(socket, itemId)
      } else {
        const sprite = sprites.get(socket)
        if (sprite) sprite.visible = false
      }
    }
  }

  const destroy = () => {
    container.destroy({ children: true })
  }

  return {
    container,
    setEquipped,
    destroy,
  }
}
