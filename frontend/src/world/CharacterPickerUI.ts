import { Container, Graphics, Sprite, Text } from "pixi.js"
import type { AnimationTextures } from "./ResourceManager"
import type { CharacterKey } from "@/components/CharacterPicker.vue"

export interface CharacterPickerUI {
  container: Container
  destroy(): void
}

type CharacterData = {
  key: CharacterKey
  idleFrame: Sprite
}

const CARD_SIZE = 72
const CARD_GAP = 8
const PANEL_PADDING = 12
const CORNER_RADIUS = 10

export function createCharacterPickerUI(options: {
  x: number
  y: number
  characters: { key: CharacterKey; anims: AnimationTextures }[]
  selected: CharacterKey
  onSelect: (key: CharacterKey) => void
  onClose: () => void
}): CharacterPickerUI {
  const container = new Container()
  container.eventMode = "static"
  container.sortableChildren = true

  // Click-outside overlay
  const overlay = new Graphics()
  overlay.rect(0, 0, 9999, 9999)
  overlay.fill({ color: 0x000000, alpha: 0 })
  overlay.eventMode = "static"
  overlay.on("pointerdown", () => options.onClose())
  container.addChild(overlay)

  const columns = 2
  const rows = Math.ceil(options.characters.length / columns)
  const panelW = columns * CARD_SIZE + (columns - 1) * CARD_GAP + PANEL_PADDING * 2
  const panelH = rows * CARD_SIZE + (rows - 1) * CARD_GAP + PANEL_PADDING * 2

  // Panel background
  const panel = new Graphics()
  panel.roundRect(options.x, options.y, panelW, panelH, CORNER_RADIUS)
  panel.fill({ color: 0x1e1e30 })
  panel.stroke({ width: 1, color: 0x2a2a4a })
  panel.eventMode = "static"
  panel.on("pointerdown", (e) => e.stopPropagation())
  container.addChild(panel)

  // Character cards
  options.characters.forEach((char, i) => {
    const col = i % columns
    const row = Math.floor(i / columns)
    const cx = options.x + PANEL_PADDING + col * (CARD_SIZE + CARD_GAP)
    const cy = options.y + PANEL_PADDING + row * (CARD_SIZE + CARD_GAP)
    const isSelected = char.key === options.selected

    const card = new Container()
    card.eventMode = "static"
    card.cursor = "pointer"
    card.x = cx
    card.y = cy

    const bg = new Graphics()
    bg.roundRect(0, 0, CARD_SIZE, CARD_SIZE, 8)
    bg.fill({ color: isSelected ? 0x6366f1 : 0x252540 })
    if (isSelected) {
      bg.stroke({ width: 2, color: 0x818cf8 })
    }
    card.addChild(bg)

    // Character preview from idle frame
    const preview = new Sprite(char.anims.idle[0])
    preview.anchor.set(0.5, 0.55)
    preview.scale.set(2)
    preview.x = CARD_SIZE / 2
    preview.y = CARD_SIZE / 2
    card.addChild(preview)

    // Name label
    const label = new Text({
      text: char.key,
      style: {
        fill: isSelected ? "#c7d2fe" : "#94a3b8",
        fontSize: 11,
        fontFamily: "monospace",
      },
    })
    label.anchor.set(0.5, 0)
    label.x = CARD_SIZE / 2
    label.y = CARD_SIZE - 14
    card.addChild(label)

    card.on("pointerover", () => {
      if (!isSelected) {
        bg.clear()
        bg.roundRect(0, 0, CARD_SIZE, CARD_SIZE, 8)
        bg.fill({ color: 0x303050 })
      }
    })
    card.on("pointerout", () => {
      if (!isSelected) {
        bg.clear()
        bg.roundRect(0, 0, CARD_SIZE, CARD_SIZE, 8)
        bg.fill({ color: 0x252540 })
      }
    })
    card.on("pointerdown", () => {
      options.onSelect(char.key)
    })

    container.addChild(card)
  })

  return {
    container,
    destroy() {
      container.destroy({ children: true })
    },
  }
}
