import type { WorldData, WorldSource } from "./WorldTypes"

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
      tiles: (data.tiles as any[])?.map((t: any) => ({
        id: t.id,
        collidable: t.collidable ?? false,
        animated: t.animated ?? false,
        frames: t.frames,
        frameDuration: t.frameDuration,
      })) || [],
    })
  }

  return {
    version: 2,
    tileSize: (data.tileSize as number) || 32,
    sources,
    bounds: data.bounds as WorldData["bounds"],
    spawn: data.spawn as WorldData["spawn"],
    layers: (data.layers as any[])?.map((l: any) => ({
      name: l.name,
      type: l.type,
      sourceId: l.sourceId ?? (sources.length > 0 ? sources[0].id : 0),
      data: l.data,
    })) || [],
    objects: (data.objects as any[])?.map((o: any) => ({
      ...o,
      sourceId: o.sourceId ?? 0,
    })) || [],
    props: (data.props as any[]) || [],
  }
}

export async function loadWorld(worldId: string): Promise<WorldData> {
  if (cache.has(worldId)) {
    return cache.get(worldId)!
  }

  try {
    const url = `/assets/worlds/${worldId}/world.json`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to load world data: ${response.statusText}`)
    }
    const raw: Record<string, unknown> = await response.json()
    const version = (raw.version as number) || 1
    const data = version < 2 ? convertV1ToV2(raw) : (raw as unknown as WorldData)
    console.log(`[WorldData] Loaded world "${worldId}":`, {
      tileSize: data.tileSize,
      sourceCount: data.sources.length,
      sources: data.sources.map((s) => ({ id: s.id, tileset: s.tileset, tileColumns: s.tileColumns, tileCount: s.tiles.length })),
      layerCount: data.layers.length,
      layers: data.layers.map((l) => ({ name: l.name, type: l.type, sourceId: l.sourceId, cellCount: l.data.length })),
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
  return `/assets/worlds/${worldId}/${source.tileset}`
}

export function preloadWorld(worldId: string): Promise<WorldData> {
  return loadWorld(worldId)
}

export function clearWorldCache(): void {
  cache.clear()
}
