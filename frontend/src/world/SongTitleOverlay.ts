import { Container, Text } from "pixi.js"

export interface SongTitleOverlay {
  container: Container
  setSong(title: string): void
  setVisible(visible: boolean): void
  update(screenWidth: number, screenHeight: number, deltaMs: number): void
  destroy(): void
}

function hslToHex(h: number, s: number, l: number): string {
  h /= 360
  s /= 100
  l /= 100
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = hue2rgb(p, q, h + 1 / 3)
  const g = hue2rgb(p, q, h)
  const b = hue2rgb(p, q, h - 1 / 3)
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function createSongTitleOverlay(): SongTitleOverlay {
  const container = new Container()
  container.visible = false
  container.alpha = 0
  container.eventMode = "none"
  container.sortableChildren = true

  const baseStyle: Record<string, unknown> = {
    fontFamily: "Pixelify Sans",
    fontSize: 28,
    stroke: { color: "#000000", width: 4 },
    fontWeight: "500",
    align: "center",
  }

  const text = new Text({
    text: "",
    style: {
      ...baseStyle,
      fill: "#ffffff",
    },
  })
  text.anchor.set(0.5, 0.5)
  container.addChild(text)

  let elapsed = 0
  let targetAlpha = 0
  let currentTitle = ""

  const setSong = (title: string) => {
    currentTitle = title
    text.text = title
  }

  const setVisible = (visible: boolean) => {
    targetAlpha = visible ? 1 : 0
    container.visible = true
    if (!visible) {
      currentTitle = ""
    }
  }

  const update = (screenWidth: number, screenHeight: number, deltaMs: number) => {
    text.x = 0
    text.y = 0
    container.x = screenWidth / 2
    container.y = screenHeight * 0.8

    if (targetAlpha === 0 && container.alpha === 0) {
      container.visible = false
      return
    }

    const fadeSpeed = 0.003
    if (container.alpha < targetAlpha) {
      container.alpha = Math.min(container.alpha + fadeSpeed * deltaMs, targetAlpha)
    } else if (container.alpha > targetAlpha) {
      container.alpha = Math.max(container.alpha - fadeSpeed * deltaMs, targetAlpha)
    }

    elapsed += deltaMs
    const hue = (elapsed * 0.03) % 360
    text.style = {
      ...baseStyle,
      fill: hslToHex(hue, 80, 75),
    }
  }

  const destroy = () => {
    container.destroy({ children: true })
  }

  return {
    container,
    setSong,
    setVisible,
    update,
    destroy,
  }
}
