import { AnimatedSprite, Container, Text } from "pixi.js"
import type { AnimationTextures } from "./ResourceManager"

const CHARACTER_SCALE = 3
const INITIAL_SPRITE_SCALE = CHARACTER_SCALE

export type AnimationState = "idle" | "walk_right" | "walk_left" | "walk_up" | "walk_down"

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

  // Animated sprite for walk (left/right)
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

  // Optional animated sprites for up/down walking
  const walkUpSprite = animations.walkUp
    ? container.addChild(new AnimatedSprite(animations.walkUp))
    : null
  if (walkUpSprite) {
    walkUpSprite.anchor.set(0.5, 0.65)
    walkUpSprite.scale.set(INITIAL_SPRITE_SCALE)
    walkUpSprite.animationSpeed = 0.15
    walkUpSprite.visible = false
  }

  const walkDownSprite = animations.walkDown
    ? container.addChild(new AnimatedSprite(animations.walkDown))
    : null
  if (walkDownSprite) {
    walkDownSprite.anchor.set(0.5, 0.65)
    walkDownSprite.scale.set(INITIAL_SPRITE_SCALE)
    walkDownSprite.animationSpeed = 0.15
    walkDownSprite.visible = false
  }

  let currentAnim: AnimationState = "idle"
  let isSpeaking = false

  const stopAllSprites = () => {
    idleSprite.stop()
    idleSprite.visible = false
    walkSprite.stop()
    walkSprite.visible = false
    walkUpSprite?.stop()
    if (walkUpSprite) walkUpSprite.visible = false
    walkDownSprite?.stop()
    if (walkDownSprite) walkDownSprite.visible = false
  }

  const setPosition = (x: number, y: number) => {
    container.x = x
    container.y = y
    container.zIndex = y
  }

  const setAnimation = (anim: AnimationState) => {
    if (anim === currentAnim) return
    currentAnim = anim
    stopAllSprites()

    switch (anim) {
      case "idle":
        idleSprite.visible = true
        idleSprite.play()
        break
      case "walk_right":
        walkSprite.scale.x = INITIAL_SPRITE_SCALE
        walkSprite.visible = true
        walkSprite.play()
        break
      case "walk_left":
        walkSprite.scale.x = -INITIAL_SPRITE_SCALE
        walkSprite.visible = true
        walkSprite.play()
        break
      case "walk_up":
        if (walkUpSprite) {
          walkUpSprite.visible = true
          walkUpSprite.play()
        } else {
          walkSprite.scale.x = INITIAL_SPRITE_SCALE
          walkSprite.visible = true
          walkSprite.play()
        }
        break
      case "walk_down":
        if (walkDownSprite) {
          walkDownSprite.visible = true
          walkDownSprite.play()
        } else {
          walkSprite.scale.x = INITIAL_SPRITE_SCALE
          walkSprite.visible = true
          walkSprite.play()
        }
        break
    }
  }

  const setSpeaking = (speaking: boolean) => {
    if (speaking === isSpeaking) return
    isSpeaking = speaking
    nameLabel.style = {
      fill: "#ffffff",
      stroke: { color: speaking ? "#00ff00" : "#000000", width: speaking ? 6 : 4 },
      fontSize: 18,
      fontFamily: "monospace",
      fontWeight: "bold",
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
