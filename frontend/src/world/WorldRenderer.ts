import { Application, Container, Graphics } from "pixi.js"
import type { CharacterDisplay } from "./CharacterSprite"
import { WORLD_BACKGROUND_COLOR, BACKGROUND_Z_INDEX } from "./WorldConfig"

export interface WorldRenderer {
  init(container: HTMLElement): Promise<void>
  destroy(): void
  addCharacter(id: string, character: CharacterDisplay): void
  removeCharacter(id: string): void
  setCameraTarget(x: number, y: number): void
  updateCamera(): void
  getScreenCenter(): { x: number; y: number }
  getStage(): Container
}

export function createWorldRenderer(): WorldRenderer {
  let app: Application | null = null
  let stage: Container | null = null
  let cameraContainer: Container | null = null
  let gameLayer: Container | null = null
  let backgroundLayer: Container | null = null
  let uiLayer: Container | null = null

  const characters = new Map<string, CharacterDisplay>()
  let cameraTarget = { x: 0, y: 0 }

  const init = async (container: HTMLElement) => {
    app = new Application()

    await app.init({
      resizeTo: container,
      background: WORLD_BACKGROUND_COLOR,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })

    container.appendChild(app.canvas as HTMLCanvasElement)

    stage = new Container()
    stage.sortableChildren = true
    app.stage.addChild(stage)

    backgroundLayer = new Container()
    backgroundLayer.sortableChildren = true
    stage.addChild(backgroundLayer)

    // Draw background
    const bg = new Graphics()
    bg.rect(-2000, -2000, 4000, 4000)
    bg.fill({ color: WORLD_BACKGROUND_COLOR })
    bg.zIndex = BACKGROUND_Z_INDEX
    backgroundLayer.addChild(bg)

    // Draw world boundary indicators
    const boundary = new Graphics()
    boundary.rect(-775, -790, 1555, 1560)
    boundary.stroke({ width: 2, color: 0x2a2a4a })
    boundary.zIndex = BACKGROUND_Z_INDEX + 1
    backgroundLayer.addChild(boundary)

    gameLayer = new Container()
    gameLayer.sortableChildren = true
    stage.addChild(gameLayer)

    cameraContainer = new Container()
    cameraContainer.sortableChildren = true
    gameLayer.addChild(cameraContainer)

    uiLayer = new Container()
    uiLayer.sortableChildren = true
    stage.addChild(uiLayer)
  }

  const destroy = () => {
    characters.forEach((c) => c.destroy())
    characters.clear()
    if (app) {
      app.destroy(true)
      app = null
    }
    stage = null
    cameraContainer = null
    gameLayer = null
    backgroundLayer = null
    uiLayer = null
  }

  const addCharacter = (id: string, character: CharacterDisplay) => {
    characters.set(id, character)
    cameraContainer?.addChild(character.container)
  }

  const removeCharacter = (id: string) => {
    const character = characters.get(id)
    if (character) {
      character.destroy()
      characters.delete(id)
    }
  }

  const setCameraTarget = (x: number, y: number) => {
    cameraTarget = { x, y }
  }

  const updateCamera = () => {
    if (!stage || !app) return
    const screenW = app.screen.width
    const screenH = app.screen.height
    stage.x = screenW / 2 - cameraTarget.x
    stage.y = screenH / 2 - cameraTarget.y
  }

  const getScreenCenter = () => {
    if (!app) return { x: 0, y: 0 }
    return {
      x: app.screen.width / 2,
      y: app.screen.height / 2,
    }
  }

  const getStage = () => {
    return stage!
  }

  return {
    init,
    destroy,
    addCharacter,
    removeCharacter,
    setCameraTarget,
    updateCamera,
    getScreenCenter,
    getStage,
  }
}
