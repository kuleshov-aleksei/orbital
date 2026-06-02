import { Assets, Container, SCALE_MODES, Sprite, Texture } from "pixi.js"
import type { WorldData, WorldSource, TileDef } from "./WorldTypes"
import { getTilesetUrl } from "./WorldData"

interface AnimatedSpriteState {
  sprite: Sprite
  textures: Texture[]
  currentFrame: number
  elapsed: number
  frameDuration: number
}

export interface TilemapRenderer {
  groundContainer: Container
  decorationContainer: Container
  update(cameraX: number, cameraY: number, screenW: number, screenH: number, dt: number): void
  getTileTexture(sourceId: number, tileId: number): Texture | null
  destroy(): void
}

function getTileTextures(
  tileDef: TileDef,
  tilesetTexture: Texture,
  tileSize: number,
  tileColumns: number,
): Texture[] {
  const frames = tileDef.animated && tileDef.frames ? tileDef.frames : [tileDef.id]
  const textures: Texture[] = []
  for (const frameId of frames) {
    const col = frameId % tileColumns
    const row = Math.floor(frameId / tileColumns)
    const rect = {
      x: col * tileSize,
      y: row * tileSize,
      width: tileSize,
      height: tileSize,
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
  layerData: [number, number, number][],
  tileTextures: Map<string, Texture[]>,
  tileDefMap: Map<string, TileDef>,
  tileSize: number,
  sourceId: number,
  boundsMinX: number,
  boundsMinY: number,
  animatedSprites: AnimatedSpriteState[],
): void {
  const prefix = `${sourceId}:`
  let rendered = 0
  let skipped = 0
  for (const [col, row, tileId] of layerData) {
    const key = prefix + tileId
    const textures = tileTextures.get(key)
    if (!textures || textures.length === 0) {
      skipped++
      continue
    }

    const sprite = new Sprite(textures[0])
    sprite.x = boundsMinX + col * tileSize
    sprite.y = boundsMinY + row * tileSize
    sprite.zIndex = row
    container.addChild(sprite)
    rendered++

    const tileDef = tileDefMap.get(key)
    if (tileDef?.animated && textures.length > 1) {
      animatedSprites.push({
        sprite,
        textures,
        currentFrame: 0,
        elapsed: 0,
        frameDuration: tileDef.frameDuration || 300,
      })
    }
  }
  console.log(`[TilemapRenderer] renderLayer(source=${sourceId}): ${rendered} sprites created, ${skipped} skipped (no texture)`)
}

export async function createTilemapRenderer(
  worldId: string,
  world: WorldData,
): Promise<TilemapRenderer> {
  const groundContainer = new Container()
  groundContainer.sortableChildren = true

  const decorationContainer = new Container()
  decorationContainer.sortableChildren = true

  const tileTextures = new Map<string, Texture[]>()
  const tileDefMap = new Map<string, TileDef>()
  const animatedSprites: AnimatedSpriteState[] = []

  const tileSize = world.tileSize

  for (const source of world.sources) {
    const url = getTilesetUrl(worldId, source)
    if (!url) {
      console.warn(`[TilemapRenderer] Source ${source.id} has no tileset, skipping`)
      continue
    }

    console.log(`[TilemapRenderer] Loading tileset source ${source.id}: ${url} (${source.tileColumns} cols, ${source.tiles.length} tiles)`)

    let tilesetTexture: Texture
    try {
      tilesetTexture = await Assets.load(url)
    } catch (e) {
      console.warn(`[TilemapRenderer] Failed to load tileset: ${url}`, e)
      continue
    }
    tilesetTexture.baseTexture.scaleMode = SCALE_MODES.NEAREST

    const prefix = `${source.id}:`
    let loadedCount = 0
    for (const tileDef of source.tiles) {
      const textures = getTileTextures(tileDef, tilesetTexture, tileSize, source.tileColumns)
      tileTextures.set(prefix + tileDef.id, textures)
      tileDefMap.set(prefix + tileDef.id, tileDef)
      loadedCount++
    }
    console.log(`[TilemapRenderer] Loaded ${loadedCount} tile textures for source ${source.id}`)
  }

  console.log(`[TilemapRenderer] tileTextures has ${tileTextures.size} entries, tileDefMap has ${tileDefMap.size} entries`)

  for (const layer of world.layers) {
    if (layer.type === "ground") {
      console.log(`[TilemapRenderer] Rendering ground layer "${layer.name}": sourceId=${layer.sourceId}, ${layer.data.length} cells`)
      renderLayer(
        groundContainer,
        layer.data,
        tileTextures,
        tileDefMap,
        tileSize,
        layer.sourceId ?? 0,
        world.bounds.minX,
        world.bounds.minY,
        animatedSprites,
      )
    } else if (layer.type === "decoration") {
      console.log(`[TilemapRenderer] Rendering decoration layer "${layer.name}": sourceId=${layer.sourceId}, ${layer.data.length} cells`)
      renderLayer(
        decorationContainer,
        layer.data,
        tileTextures,
        tileDefMap,
        tileSize,
        layer.sourceId ?? 0,
        world.bounds.minX,
        world.bounds.minY,
        animatedSprites,
      )
    }
  }

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
    groundContainer.destroy({ children: true })
    decorationContainer.destroy({ children: true })
    tileTextures.clear()
    tileDefMap.clear()
    animatedSprites.length = 0
  }

  return {
    groundContainer,
    decorationContainer,
    update,
    getTileTexture,
    destroy,
  }
}
