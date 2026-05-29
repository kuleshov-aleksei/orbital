import { AnimatedSprite, Container, Text } from "pixi.js"
import type { AnimationTextures } from "./ResourceManager"

const CHARACTER_SCALE = 3
const INITIAL_SPRITE_SCALE = CHARACTER_SCALE

export type AnimationState = "idle_right" | "idle_left" | "walk_right" | "walk_left"

export interface CharacterDisplay {
  container: Container
  setPosition(x: number, y: number): void
  setAnimation(anim: AnimationState): void
  setSpeaking(speaking: boolean): void
  destroy(): void
}

export function createCharacterSprite(
  username: string,
  animations: AnimationTextures,
): CharacterDisplay {
  const container = new Container()
  container.sortableChildren = true

  // Name label
  const nameLabel = new Text({
    text: username,
    style: {
      fill: "#ffffff",
      stroke: { color: "#000000", width: 4 },
      fontSize: 18,
      fontFamily: "monospace",
      fontWeight: "bold",
    },
  })
  nameLabel.anchor.set(0.5, 1)
  nameLabel.y = -70
  container.addChild(nameLabel)

  // Animated sprite for walk
  const walkSprite = new AnimatedSprite(animations.walk)
  walkSprite.anchor.set(0.5, 0.65)
  walkSprite.scale.set(INITIAL_SPRITE_SCALE)
  walkSprite.animationSpeed = 0.15
  walkSprite.visible = false
  container.addChild(walkSprite)

  // Animated sprite for idle
  const idleSprite = new AnimatedSprite(animations.idle)
  idleSprite.anchor.set(0.5, 0.65)
  idleSprite.scale.set(INITIAL_SPRITE_SCALE)
  idleSprite.animationSpeed = 0.1
  idleSprite.visible = true
  idleSprite.play()
  container.addChild(idleSprite)

  let currentAnim: AnimationState = "idle_right"
  let isSpeaking = false

  const setPosition = (x: number, y: number) => {
    container.x = x
    container.y = y
    container.zIndex = y
  }

  const setAnimation = (anim: AnimationState) => {
    if (anim === currentAnim) return
    currentAnim = anim

    const isWalk = anim.startsWith("walk_")
    const facingRight = anim.endsWith("_right")
    const scaleX = facingRight ? INITIAL_SPRITE_SCALE : -INITIAL_SPRITE_SCALE

    if (isWalk) {
      idleSprite.visible = false
      idleSprite.stop()
      walkSprite.visible = true
      walkSprite.scale.x = scaleX
      walkSprite.play()
    } else {
      walkSprite.visible = false
      walkSprite.stop()
      idleSprite.visible = true
      idleSprite.scale.x = scaleX
      idleSprite.play()
    }
  }

  const setSpeaking = (speaking: boolean) => {
    if (speaking === isSpeaking) return
    isSpeaking = speaking
    nameLabel.style = {
      ...nameLabel.style,
      stroke: { color: speaking ? "#00ff00" : "#000000", width: speaking ? 6 : 4 },
    }
  }

  const destroy = () => {
    container.destroy({ children: true })
  }

  return {
    container,
    setPosition,
    setAnimation,
    setSpeaking,
    destroy,
  }
}
