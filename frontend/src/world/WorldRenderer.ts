import { Application, Assets, Container, Graphics, Sprite } from "pixi.js"
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
  updateEarshotRadius(x: number, y: number, radius: number): void
  addOverlay(overlay: Container): void
  removeOverlay(overlay: Container): void
  getScreenSize(): { width: number; height: number }
  addWorldObject(obj: Container): void
  removeWorldObject(obj: Container): void
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
  let earshotCircle: Graphics | null = null
  let fixedLayer: Container | null = null

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

    // Load map texture
    try {
      const mapTexture = await Assets.load("/assets/world/map.png")
      const mapSprite = new Sprite(mapTexture)
      mapSprite.anchor.set(0.5, 0.5)
      mapSprite.zIndex = BACKGROUND_Z_INDEX + 1
      backgroundLayer.addChild(mapSprite)
    } catch (e) {
      console.warn("[WorldRenderer] Failed to load map texture:", e)
    }

    // Draw world boundary indicators
    const boundary = new Graphics()
    boundary.rect(-775, -790, 1555, 1560)
    boundary.stroke({ width: 2, color: 0x2a2a4a })
    boundary.zIndex = BACKGROUND_Z_INDEX + 2
    backgroundLayer.addChild(boundary)

    gameLayer = new Container()
    gameLayer.sortableChildren = true
    stage.addChild(gameLayer)

    cameraContainer = new Container()
    cameraContainer.sortableChildren = true
    gameLayer.addChild(cameraContainer)

    // Earshot radius circle (behind characters)
    earshotCircle = new Graphics()
    earshotCircle.zIndex = -1
    cameraContainer.addChild(earshotCircle)

    uiLayer = new Container()
    uiLayer.sortableChildren = true
    stage.addChild(uiLayer)

    // Fixed overlay layer (not affected by camera transform)
    fixedLayer = new Container()
    fixedLayer.sortableChildren = true
    app.stage.addChild(fixedLayer)
  }

  const destroy = () => {
    characters.forEach((c) => c.destroy())
    characters.clear()
    if (earshotCircle) {
      earshotCircle.destroy()
      earshotCircle = null
    }
    if (app) {
      app.destroy(true)
      app = null
    }
    stage = null
    cameraContainer = null
    gameLayer = null
    backgroundLayer = null
    uiLayer = null
    fixedLayer = null
  }

  const addCharacter = (id: string, character: CharacterDisplay) => {
    const existing = characters.get(id)
    if (existing) {
      existing.destroy()
    }
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

  const updateEarshotRadius = (x: number, y: number, radius: number) => {
    if (!earshotCircle) return
    earshotCircle.clear()
    earshotCircle.circle(x, y, radius)
    earshotCircle.fill({ color: 0x7dd3fc, alpha: 0.08 })
    earshotCircle.circle(x, y, radius)
    earshotCircle.stroke({ width: 1.5, color: 0x7dd3fc, alpha: 0.3 })
  }

  const addOverlay = (overlay: Container) => {
    fixedLayer?.addChild(overlay)
  }

  const removeOverlay = (overlay: Container) => {
    fixedLayer?.removeChild(overlay)
  }

  const getScreenSize = () => {
    if (!app) return { width: 800, height: 600 }
    return { width: app.screen.width, height: app.screen.height }
  }

  const getStage = () => {
    return stage!
  }

  const addWorldObject = (obj: Container) => {
    cameraContainer?.addChild(obj)
  }

  const removeWorldObject = (obj: Container) => {
    cameraContainer?.removeChild(obj)
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
    updateEarshotRadius,
    addOverlay,
    removeOverlay,
    getScreenSize,
    addWorldObject,
    removeWorldObject,
  }
}
