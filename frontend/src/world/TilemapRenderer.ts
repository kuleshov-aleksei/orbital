import { Assets, Container, Sprite, Texture } from "pixi.js"
import type { WorldData, TileDef, ProgressCallback } from "./WorldTypes"
import { getTilesetUrl } from "./WorldData"
import { debugLog, debugWarn } from "@/utils/debug"

const BATCH_SIZE = 500

interface AnimatedSpriteState {
  sprite: Sprite
  textures: Texture[]
  currentFrame: number
  elapsed: number
  frameDuration: number
}

export interface TilemapRenderer {
  backgroundContainer: Container
  backgroundDecorationContainer: Container
  groundContainer: Container
  groundDecorationContainer: Container
  decorationContainer: Container
  skyContainer: Container
  update(cameraX: number, cameraY: number, screenW: number, screenH: number, dt: number): void
  getTileTexture(sourceId: number, tileId: number): Texture | null
  destroy(): void
}

function getTileTextures(
  tileDef: TileDef,
  tilesetTexture: Texture,
  tileSize: number,
  tileColumns: number,
  cellSize: number,
): Texture[] {
  const frames = tileDef.animated && tileDef.frames ? tileDef.frames : [tileDef.id]
  const textures: Texture[] = []
  for (const frameId of frames) {
    const col = frameId % tileColumns
    const row = Math.floor(frameId / tileColumns)
    const rect = {
      x: col * cellSize,
      y: row * cellSize,
      width: cellSize,
      height: cellSize,
    }
    textures.push(
      new Texture({
        source: tilesetTexture.baseTexture,
        frame: rect,
      }),
    )
  }
  return textures
}

function renderLayer(
  container: Container,
  layerData: [number, number, number, number][],
  tileTextures: Map<string, Texture[]>,
  tileDefMap: Map<string, TileDef>,
  tileSize: number,
  cellSizes: Map<number, number>,
  offsetX: number,
  offsetY: number,
  animatedSprites: AnimatedSpriteState[],
  zIndexOffset: number,
  totalAllTiles: number,
  createdCount: { value: number },
  onProgress?: ProgressCallback,
): Promise<void> {
  const total = layerData.length
  if (total === 0) return Promise.resolve()
  let idx = 0

  function processBatch(): Promise<void> {
    const end = Math.min(idx + BATCH_SIZE, total)
    for (; idx < end; idx++) {
      const [col, row, tileId, sourceId] = layerData[idx]
      const cellSize = cellSizes.get(sourceId) ?? tileSize
      const key = `${sourceId}:${tileId}`
      const textures = tileTextures.get(key)
      if (!textures || textures.length === 0) continue

      const sprite = new Sprite(textures[0])
      sprite.x = offsetX + col * tileSize - (cellSize - tileSize) / 2
      sprite.y = offsetY + row * tileSize - (cellSize - tileSize) / 2
      const overlapScale = (cellSize + 1) / cellSize
      sprite.scale.set(overlapScale)
      sprite.zIndex = row + zIndexOffset
      container.addChild(sprite)

      const tileDef = tileDefMap.get(key)
      if (tileDef?.animated && textures.length > 1) {
        const startFrame = tileDef.randomOffset ? Math.floor(Math.random() * textures.length) : 0
        sprite.texture = textures[startFrame]
        animatedSprites.push({
          sprite,
          textures,
          currentFrame: startFrame,
          elapsed: 0,
          frameDuration: tileDef.frameDuration || 300,
        })
      }
      createdCount.value++
    }

    if (onProgress && totalAllTiles > 0) {
      onProgress(50 + (createdCount.value / totalAllTiles) * 30, "Stitching tilemap…")
    }

    if (idx < total) {
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve(processBatch()))
      })
    }
    return Promise.resolve()
  }

  return processBatch()
}

function getLayerContainer(
  layerType: string,
  layerName: string,
  containers: {
    backgroundContainer: Container
    backgroundDecorationContainer: Container
    groundContainer: Container
    groundDecorationContainer: Container
    decorationContainer: Container
    skyContainer: Container
  },
): Container | null {
  if (layerType === "ground") {
    return layerName === "background" ? containers.backgroundContainer : containers.groundContainer
  }
  if (layerType === "background_decorations") return containers.backgroundDecorationContainer
  if (layerType === "ground_decorations") return containers.groundDecorationContainer
  if (layerType === "decoration") return containers.decorationContainer
  if (layerType === "sky") return containers.skyContainer
  return null
}

async function loadTilesets(
  worldId: string,
  world: WorldData,
  tileTextures: Map<string, Texture[]>,
  tileDefMap: Map<string, TileDef>,
  sourceCellSizes: Map<number, number>,
  tileSize: number,
  onProgress?: ProgressCallback,
): Promise<void> {
  const sources = world.sources.filter((s) => getTilesetUrl(worldId, s))
  if (sources.length === 0) return

  const sourceCount = sources.length
  let completed = 0

  const results = await Promise.all(
    sources.map(async (source) => {
      const url = getTilesetUrl(worldId, source)!
      let tilesetTexture: Texture
      try {
        tilesetTexture = await Assets.load(url)
      } catch (e) {
        debugWarn(`[TilemapRenderer] Failed to load tileset: ${url}`, e)
        return null
      }
      const cellSize = tilesetTexture.baseTexture.width / source.tileColumns
      tilesetTexture.baseTexture.scaleMode = cellSize === tileSize ? "nearest" : "linear"

      const prefix = `${source.id}:`
      let loadedCount = 0
      for (const tileDef of source.tiles) {
        const textures = getTileTextures(
          tileDef,
          tilesetTexture,
          tileSize,
          source.tileColumns,
          cellSize,
        )
        tileTextures.set(prefix + tileDef.id, textures)
        tileDefMap.set(prefix + tileDef.id, tileDef)
        loadedCount++
      }
      completed++
      onProgress?.(15 + (completed / sourceCount) * 35, "Loading tilesets…")

      return { sourceId: source.id, cellSize, loadedCount }
    }),
  )

  for (const r of results) {
    if (r) sourceCellSizes.set(r.sourceId, r.cellSize)
  }

  debugLog(
    `[TilemapRenderer] Loaded ${tileTextures.size} tile textures across ${completed} tilesets`,
  )
}

export async function createTilemapRenderer(
  worldId: string,
  world: WorldData,
  onProgress?: ProgressCallback,
): Promise<TilemapRenderer> {
  const tileSize = world.tileSize
  const startTime = performance.now()

  const containers = {
    backgroundContainer: new Container(),
    backgroundDecorationContainer: new Container(),
    groundContainer: new Container(),
    groundDecorationContainer: new Container(),
    decorationContainer: new Container(),
    skyContainer: new Container(),
  }

  for (const c of Object.values(containers)) {
    c.sortableChildren = true
  }

  const tileTextures = new Map<string, Texture[]>()
  const tileDefMap = new Map<string, TileDef>()
  const sourceCellSizes = new Map<number, number>()
  const animatedSprites: AnimatedSpriteState[] = []

  await loadTilesets(
    worldId,
    world,
    tileTextures,
    tileDefMap,
    sourceCellSizes,
    tileSize,
    onProgress,
  )

  const totalTiles = world.layers.reduce((sum, l) => sum + l.data.length, 0)
  const createdCount = { value: 0 }

  for (const layer of world.layers) {
    if (layer.data.length === 0) continue
    const container = getLayerContainer(layer.type, layer.name, containers)
    if (!container) {
      debugWarn(`[TilemapRenderer] Unknown layer type: ${layer.type} (${layer.name}), skipping`)
      continue
    }
    const lt = layer.tileSize ?? world.tileSize
    const layerOffsetX = layer.offsetX ?? world.bounds.minX
    const layerOffsetY = layer.offsetY ?? world.bounds.minY
    await renderLayer(
      container,
      layer.data,
      tileTextures,
      tileDefMap,
      lt,
      sourceCellSizes,
      layerOffsetX,
      layerOffsetY,
      animatedSprites,
      0,
      totalTiles,
      createdCount,
      onProgress,
    )
  }

  const elapsed = (performance.now() - startTime).toFixed(0)
  debugLog(`[TilemapRenderer] Created ${createdCount.value} tile sprites in ${elapsed}ms`)

  const update = (
    _cameraX: number,
    _cameraY: number,
    _screenW: number,
    _screenH: number,
    dt: number,
  ) => {
    for (const anim of animatedSprites) {
      anim.elapsed += dt
      if (anim.elapsed >= anim.frameDuration) {
        anim.elapsed -= anim.frameDuration
        anim.currentFrame = (anim.currentFrame + 1) % anim.textures.length
        anim.sprite.texture = anim.textures[anim.currentFrame]
      }
    }
  }

  const getTileTexture = (sourceId: number, tileId: number): Texture | null => {
    const key = `${sourceId}:${tileId}`
    const textures = tileTextures.get(key)
    return textures?.[0] ?? null
  }

  const destroy = () => {
    for (const c of Object.values(containers)) {
      c.destroy({ children: true })
    }
    tileTextures.clear()
    tileDefMap.clear()
    animatedSprites.length = 0
  }

  return {
    ...containers,
    update,
    getTileTexture,
    destroy,
  }
}
