import { AnimatedSprite, Container, Sprite, Texture } from "pixi.js"
import type { WorldObjectData } from "./WorldTypes"

export interface WorldObjectDisplay {
  container: Container
  update: (dt: number) => void
  destroy: () => void
}

export function createWorldObjectSprite(
  config: WorldObjectData,
  getTexture: (sourceId: number, tileId: number) => Texture | null,
): WorldObjectDisplay {
  const container = new Container()
  container.sortableChildren = true
  container.x = config.x
  container.y = config.y
  container.zIndex = config.y

  let updateAnim: ((dt: number) => void) | null = null

  if (config.animated && config.frames && config.frames.length > 1) {
    const textures: Texture[] = []
    for (const frameId of config.frames) {
      const tex = getTexture(config.sourceId, frameId)
      if (tex) textures.push(tex)
    }
    if (textures.length > 0) {
      const animSprite = new AnimatedSprite(textures)
      animSprite.anchor.set(0.5, 1)
      animSprite.animationSpeed = 1000 / (config.frameDuration || 300) / 60
      animSprite.play()
      container.addChild(animSprite)

      updateAnim = () => {
        animSprite.update(1 / 60)
      }
    }
  } else {
    const tex = getTexture(config.sourceId, config.tileId)
    if (tex) {
      const sprite = new Sprite(tex)
      sprite.anchor.set(0.5, 1)
      container.addChild(sprite)
    }
  }

  const swayPhase = Math.random() * Math.PI * 2
  let time = 0

  const update = (dt: number) => {
    if (updateAnim) {
      updateAnim(dt)
    }
    time += dt
    const sway = 1 + Math.sin(time / 600 + swayPhase) * 0.015
    container.scale.x = sway
  }

  const destroy = () => {
    container.destroy({ children: true })
  }

  return { container, update, destroy }
}
