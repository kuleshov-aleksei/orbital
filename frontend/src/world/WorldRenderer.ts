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
  updateEarshotRadius(x: number, y: number, radius: number): void
  addOverlay(overlay: Container): void
  removeOverlay(overlay: Container): void
  getScreenSize(): { width: number; height: number }
  addWorldObject(obj: Container): void
  removeWorldObject(obj: Container): void
  addTilemapBackground(container: Container): void
  removeTilemapBackground(container: Container): void
  addTilemapBackgroundDecoration(container: Container): void
  removeTilemapBackgroundDecoration(container: Container): void
  addTilemapGround(container: Container): void
  removeTilemapGround(container: Container): void
  addTilemapGroundDecoration(container: Container): void
  removeTilemapGroundDecoration(container: Container): void
  addTilemapDecoration(container: Container): void
  removeTilemapDecoration(container: Container): void
  addTilemapSky(container: Container): void
  removeTilemapSky(container: Container): void
  addCollisionDebug(container: Container): void
  removeCollisionDebug(container: Container): void
  getCameraContainer(): Container
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
  let backgroundTileLayer: Container | null = null
  let backgroundDecorationTileLayer: Container | null = null
  let groundTileLayer: Container | null = null
  let groundDecorationTileLayer: Container | null = null
  let skyTileLayer: Container | null = null
  let decorationTileLayer: Container | null = null

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
    stage.roundPixels = true
    app.stage.addChild(stage)

    backgroundLayer = new Container()
    backgroundLayer.sortableChildren = true
    stage.addChild(backgroundLayer)

    const bg = new Graphics()
    bg.rect(-2000, -2000, 4000, 4000)
    bg.fill({ color: WORLD_BACKGROUND_COLOR })
    bg.zIndex = BACKGROUND_Z_INDEX
    backgroundLayer.addChild(bg)

    gameLayer = new Container()
    gameLayer.sortableChildren = true
    stage.addChild(gameLayer)

    cameraContainer = new Container()
    cameraContainer.sortableChildren = true
    gameLayer.addChild(cameraContainer)

    earshotCircle = new Graphics()
    earshotCircle.zIndex = -1
    cameraContainer.addChild(earshotCircle)

    uiLayer = new Container()
    uiLayer.sortableChildren = true
    stage.addChild(uiLayer)

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
    backgroundTileLayer = null
    backgroundDecorationTileLayer = null
    groundTileLayer = null
    groundDecorationTileLayer = null
    decorationTileLayer = null
    skyTileLayer = null
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
    stage.x = Math.round(screenW / 2 - cameraTarget.x)
    stage.y = Math.round(screenH / 2 - cameraTarget.y)
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

  const getCameraContainer = () => {
    return cameraContainer!
  }

  const addWorldObject = (obj: Container) => {
    obj.zIndex = obj.y
    cameraContainer?.addChild(obj)
  }

  const removeWorldObject = (obj: Container) => {
    cameraContainer?.removeChild(obj)
  }

  const addTilemapBackground = (container: Container) => {
    if (backgroundTileLayer) {
      cameraContainer?.removeChild(backgroundTileLayer)
    }
    backgroundTileLayer = container
    backgroundTileLayer.zIndex = -20000
    cameraContainer?.addChild(backgroundTileLayer)
  }

  const removeTilemapBackground = (container: Container) => {
    if (backgroundTileLayer === container) {
      cameraContainer?.removeChild(container)
      backgroundTileLayer = null
    }
  }

  const addTilemapBackgroundDecoration = (container: Container) => {
    if (backgroundDecorationTileLayer) {
      cameraContainer?.removeChild(backgroundDecorationTileLayer)
    }
    backgroundDecorationTileLayer = container
    backgroundDecorationTileLayer.zIndex = -15000
    cameraContainer?.addChild(backgroundDecorationTileLayer)
  }

  const removeTilemapBackgroundDecoration = (container: Container) => {
    if (backgroundDecorationTileLayer === container) {
      cameraContainer?.removeChild(container)
      backgroundDecorationTileLayer = null
    }
  }

  const addTilemapGround = (container: Container) => {
    if (groundTileLayer) {
      cameraContainer?.removeChild(groundTileLayer)
    }
    groundTileLayer = container
    groundTileLayer.zIndex = -10000
    cameraContainer?.addChild(groundTileLayer)
  }

  const removeTilemapGround = (container: Container) => {
    if (groundTileLayer === container) {
      cameraContainer?.removeChild(container)
      groundTileLayer = null
    }
  }

  const addTilemapGroundDecoration = (container: Container) => {
    if (groundDecorationTileLayer) {
      cameraContainer?.removeChild(groundDecorationTileLayer)
    }
    groundDecorationTileLayer = container
    groundDecorationTileLayer.zIndex = 0
    cameraContainer?.addChild(groundDecorationTileLayer)
  }

  const removeTilemapGroundDecoration = (container: Container) => {
    if (groundDecorationTileLayer === container) {
      cameraContainer?.removeChild(container)
      groundDecorationTileLayer = null
    }
  }

  const addTilemapDecoration = (container: Container) => {
    if (decorationTileLayer) {
      cameraContainer?.removeChild(decorationTileLayer)
    }
    decorationTileLayer = container
    decorationTileLayer.zIndex = 100000
    cameraContainer?.addChild(decorationTileLayer)
  }

  const removeTilemapDecoration = (container: Container) => {
    if (decorationTileLayer === container) {
      cameraContainer?.removeChild(container)
      groundDecorationTileLayer = null
      decorationTileLayer = null
    }
  }

  const addTilemapSky = (container: Container) => {
    if (skyTileLayer) {
      cameraContainer?.removeChild(skyTileLayer)
    }
    skyTileLayer = container
    skyTileLayer.zIndex = 150000
    cameraContainer?.addChild(skyTileLayer)
  }

  const removeTilemapSky = (container: Container) => {
    if (skyTileLayer === container) {
      cameraContainer?.removeChild(container)
      skyTileLayer = null
    }
  }

  const addCollisionDebug = (container: Container) => {
    container.zIndex = 200000
    cameraContainer?.addChild(container)
  }

  const removeCollisionDebug = (container: Container) => {
    cameraContainer?.removeChild(container)
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
    addTilemapBackground,
    removeTilemapBackground,
    addTilemapBackgroundDecoration,
    removeTilemapBackgroundDecoration,
    addTilemapGround,
    removeTilemapGround,
    addTilemapGroundDecoration,
    removeTilemapGroundDecoration,
    addTilemapDecoration,
    removeTilemapDecoration,
    addTilemapSky,
    removeTilemapSky,
    addCollisionDebug,
    removeCollisionDebug,
    getCameraContainer,
  }
}
