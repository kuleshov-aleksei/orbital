export interface TileDef {
  id: number
  collidable: boolean
  animated: boolean
  frames?: number[]
  frameDuration?: number
  randomOffset?: boolean
  collisionBox?: { x: number; y: number; width: number; height: number }
  collisionPolygons?: [number, number][][]
}

export interface WorldSource {
  id: number
  tileset: string
  tileColumns: number
  tiles: TileDef[]
}

export interface LayerData {
  name: string
  type: "ground" | "collision" | "decoration" | "background_decorations" | "ground_decorations" | "sky"
  tileSize: number
  data: [number, number, number, number][]
}

export interface WorldObjectData {
  id: string
  sourceId: number
  tileId: number
  x: number
  y: number
  animated?: boolean
  frames?: number[]
  frameDuration?: number
  collision?: { width: number; height: number }
}

export interface PropData {
  id: string
  x: number
  y: number
}

export interface WorldData {
  version: number
  tileSize: number
  sources: WorldSource[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  spawn: { x: number; y: number }
  layers: LayerData[]
  objects: WorldObjectData[]
  props: PropData[]
}

import type { Container } from "pixi.js"

export interface WorldObjectDisplay {
  container: Container
  update: (dt: number) => void
  destroy: () => void
}
