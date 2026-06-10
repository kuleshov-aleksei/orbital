import { assetPath } from "@/utils/assetPath"
import type {
  WorldData,
  WorldSource,
  ProgressCallback,
  LayerData,
  WorldObjectData,
  PropData,
} from "./WorldTypes"

const cache = new Map<string, WorldData>()

const DEFAULT_WORLD_DATA: WorldData = {
  version: 2,
  tileSize: 32,
  sources: [],
  bounds: { minX: -775, maxX: 780, minY: -790, maxY: 770 },
  spawn: { x: 10, y: 0 },
  layers: [],
  objects: [],
  props: [{ id: "boombox", x: 0, y: -200 }],
}

function convertV1ToV2(data: Record<string, unknown>): WorldData {
  const sources: WorldSource[] = []
  if (data.tileset || (data.tiles as unknown[] | undefined)?.length) {
    sources.push({
      id: 0,
      tileset: (data.tileset as string) || "",
      tileColumns: (data.tileColumns as number) || 1,
      tiles:
        (data.tiles as unknown[])?.map((t: Record<string, unknown>) => ({
          id: t.id as number,
          collidable: (t.collidable as boolean) ?? false,
          animated: (t.animated as boolean) ?? false,
          frames: t.frames as number[] | undefined,
          frameDuration: t.frameDuration as number | undefined,
          collisionBox: t.collisionBox as
            | { x: number; y: number; width: number; height: number }
            | undefined,
          collisionPolygons: t.collisionPolygons as [number, number][][] | undefined,
        })) || [],
    })
  }

  return {
    version: 2,
    tileSize: (data.tileSize as number) || 32,
    sources,
    bounds: data.bounds as WorldData["bounds"],
    spawn: data.spawn as WorldData["spawn"],
    layers:
      (data.layers as unknown[])?.map((l: Record<string, unknown>) => ({
        name: l.name as string,
        type: l.type as LayerData["type"],
        sourceId: (l.sourceId as number) ?? (sources.length > 0 ? sources[0].id : 0),
        data: l.data as LayerData["data"],
      })) || [],
    objects:
      (data.objects as unknown[])?.map(
        (o: Record<string, unknown>) =>
          ({
            ...o,
            sourceId: (o.sourceId as number) ?? 0,
          }) as WorldObjectData,
      ) || [],
    props: (data.props as PropData[]) || [],
  }
}

export async function loadWorld(
  worldId: string,
  onProgress?: ProgressCallback,
): Promise<WorldData> {
  if (cache.has(worldId)) {
    return cache.get(worldId)!
  }

  onProgress?.(3, "Loading world data…")
  try {
    const url = assetPath(`/assets/worlds/${worldId}/world.json`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to load world data: ${response.statusText}`)
    }
    onProgress?.(6, "Parsing world data…")
    const raw: Record<string, unknown> = await response.json()
    const version = (raw.version as number) || 1
    const data = version < 2 ? convertV1ToV2(raw) : (raw as unknown as WorldData)
    console.log(`[WorldData] Loaded world "${worldId}":`, {
      tileSize: data.tileSize,
      sourceCount: data.sources.length,
      sources: data.sources.map((s) => ({
        id: s.id,
        tileset: s.tileset,
        tileColumns: s.tileColumns,
        tileCount: s.tiles.length,
      })),
      layerCount: data.layers.length,
      layers: data.layers.map((l) => ({
        name: l.name,
        type: l.type,
        sourceId: l.sourceId,
        cellCount: l.data.length,
      })),
      bounds: data.bounds,
    })
    cache.set(worldId, data)
    return data
  } catch (e) {
    console.warn(`[WorldData] Failed to load world "${worldId}", using fallback:`, e)
    cache.set(worldId, DEFAULT_WORLD_DATA)
    return DEFAULT_WORLD_DATA
  }
}

export function getTilesetUrl(worldId: string, source: WorldSource): string {
  if (!source.tileset) return ""
  return assetPath(`/assets/worlds/${worldId}/${source.tileset}`)
}

export function preloadWorld(worldId: string, onProgress?: ProgressCallback): Promise<WorldData> {
  return loadWorld(worldId, onProgress)
}

export function clearWorldCache(): void {
  cache.clear()
}
