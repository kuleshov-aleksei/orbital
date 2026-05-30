import { Container, Graphics, Text } from "pixi.js"

export interface ToolbarUI {
  container: Container
  destroy(): void
}

const BUTTON_SIZE = 40
const BUTTON_GAP = 8
const PANEL_PADDING = 6
const PANEL_COLOR = 0x1e1e30
const PANEL_BORDER_COLOR = 0x2a2a4a
const BUTTON_COLOR = 0x252540
const BUTTON_HOVER_COLOR = 0x303050

export function createToolbarUI(options: {
  screenWidth: number
  screenHeight: number
  onCharacterClick: () => void
  onPropClick: () => void
}): ToolbarUI {
  const container = new Container()
  container.eventMode = "static"
  container.sortableChildren = true

  const panelWidth = BUTTON_SIZE + PANEL_PADDING * 2
  const panelHeight = BUTTON_SIZE * 2 + BUTTON_GAP + PANEL_PADDING * 2

  // Panel background
  const panel = new Graphics()
  panel.roundRect(0, 0, panelWidth, panelHeight, 10)
  panel.fill({ color: PANEL_COLOR })
  panel.stroke({ width: 1, color: PANEL_BORDER_COLOR })
  container.addChild(panel)

  const buttonYOffset = PANEL_PADDING
  const iconSize = 18

  // Character button
  const charBtn = new Graphics()
  const charBtnBg = new Graphics()
  charBtnBg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 8)
  charBtnBg.fill({ color: BUTTON_COLOR })
  charBtn.eventMode = "static"
  charBtn.cursor = "pointer"

  const charIcon = new Text({
    text: "\u263A",
    style: {
      fill: "#94a3b8",
      fontSize: iconSize,
      fontFamily: "monospace",
    },
  })
  charIcon.anchor.set(0.5)
  charIcon.x = BUTTON_SIZE / 2
  charIcon.y = BUTTON_SIZE / 2

  charBtn.addChild(charBtnBg, charIcon)
  charBtn.x = PANEL_PADDING
  charBtn.y = buttonYOffset
  container.addChild(charBtn)

  charBtn.on("pointerover", () => {
    charBtnBg.clear()
    charBtnBg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 8)
    charBtnBg.fill({ color: BUTTON_HOVER_COLOR })
    charIcon.style = { ...charIcon.style, fill: "#e2e8f0" }
  })
  charBtn.on("pointerout", () => {
    charBtnBg.clear()
    charBtnBg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 8)
    charBtnBg.fill({ color: BUTTON_COLOR })
    charIcon.style = { ...charIcon.style, fill: "#94a3b8" }
  })
  charBtn.on("pointerdown", () => {
    options.onCharacterClick()
  })

  // Prop button (placeholder)
  const propBtn = new Graphics()
  const propBtnBg = new Graphics()
  propBtnBg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 8)
  propBtnBg.fill({ color: BUTTON_COLOR })
  propBtn.eventMode = "static"
  propBtn.cursor = "pointer"

  const propIcon = new Text({
    text: "\u266A",
    style: {
      fill: "#475569",
      fontSize: iconSize,
      fontFamily: "monospace",
    },
  })
  propIcon.anchor.set(0.5)
  propIcon.x = BUTTON_SIZE / 2
  propIcon.y = BUTTON_SIZE / 2

  propBtn.addChild(propBtnBg, propIcon)
  propBtn.x = PANEL_PADDING
  propBtn.y = buttonYOffset + BUTTON_SIZE + BUTTON_GAP
  container.addChild(propBtn)

  propBtn.on("pointerover", () => {
    propBtnBg.clear()
    propBtnBg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 8)
    propBtnBg.fill({ color: BUTTON_HOVER_COLOR })
    propIcon.style = { ...propIcon.style, fill: "#e2e8f0" }
  })
  propBtn.on("pointerout", () => {
    propBtnBg.clear()
    propBtnBg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 8)
    propBtnBg.fill({ color: BUTTON_COLOR })
    propIcon.style = { ...propIcon.style, fill: "#475569" }
  })
  propBtn.on("pointerdown", () => {
    options.onPropClick()
  })

  // Position at right center of screen
  container.x = options.screenWidth - panelWidth - 16
  container.y = options.screenHeight / 2 - panelHeight / 2

  const destroy = () => {
    container.destroy({ children: true })
  }

  return { container, destroy }
}
