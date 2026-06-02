import { Container, Graphics } from "pixi.js"
import type { WorldData } from "./WorldTypes"

const COLS_HASH = 100000

interface CollisionCell {
  polygons: [number, number][][]
}

export interface CollisionSystem {
  isSolid(tileCol: number, tileRow: number): boolean
  isSolidAt(worldX: number, worldY: number): boolean
  resolveMovement(
    pos: { x: number; y: number },
    velocity: { x: number; y: number },
    hitbox: { width: number; height: number },
  ): { x: number; y: number }
  getWorldBounds(): { minX: number; minY: number; maxX: number; maxY: number }
}

function projectOnAxis(points: [number, number][], axis: [number, number]): [number, number] {
  let min = Infinity,
    max = -Infinity
  for (const [x, y] of points) {
    const proj = x * axis[0] + y * axis[1]
    if (proj < min) min = proj
    if (proj > max) max = proj
  }
  return [min, max]
}

function aabbPoints(aabb: {
  x: number
  y: number
  width: number
  height: number
}): [number, number][] {
  return [
    [aabb.x, aabb.y],
    [aabb.x + aabb.width, aabb.y],
    [aabb.x + aabb.width, aabb.y + aabb.height],
    [aabb.x, aabb.y + aabb.height],
  ]
}

function satAabbVsPolygon(
  aabb: { x: number; y: number; width: number; height: number },
  polygon: [number, number][],
): { axis: [number, number]; overlap: number } | null {
  const aabbPts = aabbPoints(aabb)
  const axes: [number, number][] = [
    [1, 0],
    [0, 1],
  ]

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    const ex = polygon[j][0] - polygon[i][0]
    const ey = polygon[j][1] - polygon[i][1]
    const len = Math.sqrt(ex * ex + ey * ey)
    if (len < 0.001) continue
    axes.push([-ey / len, ex / len])
  }

  let minOverlap = Infinity
  let minAxis: [number, number] = [1, 0]

  for (const axis of axes) {
    const [aMin, aMax] = projectOnAxis(aabbPts, axis)
    const [pMin, pMax] = projectOnAxis(polygon, axis)

    if (aMax <= pMin || pMax <= aMin) return null

    const overlap = Math.min(aMax - pMin, pMax - aMin)
    if (overlap < minOverlap) {
      minOverlap = overlap
      minAxis = [axis[0], axis[1]]
    }
  }

  let cx = 0,
    cy = 0
  for (const [px, py] of polygon) {
    cx += px
    cy += py
  }
  cx /= polygon.length
  cy /= polygon.length

  const acx = aabb.x + aabb.width / 2
  const acy = aabb.y + aabb.height / 2
  const dot = (acx - cx) * minAxis[0] + (acy - cy) * minAxis[1]

  if (dot < 0) {
    minAxis[0] = -minAxis[0]
    minAxis[1] = -minAxis[1]
  }

  return { axis: minAxis, overlap: minOverlap }
}

export function createCollisionSystem(world: WorldData): CollisionSystem {
  const tileSize = world.tileSize
  const bounds = world.bounds

  const tileCol = (worldX: number) => Math.floor((worldX - bounds.minX) / tileSize)
  const tileRow = (worldY: number) => Math.floor((worldY - bounds.minY) / tileSize)

  const polygonData = new Map<number, Map<number, [number, number][][]>>()
  for (const source of world.sources) {
    const map = new Map<number, [number, number][][]>()
    for (const tile of source.tiles) {
      if (tile.collisionPolygons && tile.collisionPolygons.length > 0) {
        map.set(tile.id, tile.collisionPolygons)
      }
    }
    polygonData.set(source.id, map)
  }

  const collidableBySource = new Map<number, Set<number>>()
  for (const source of world.sources) {
    const ids = new Set(
      source.tiles
        .filter((t) => t.collidable && (!t.collisionPolygons || t.collisionPolygons.length === 0))
        .map((t) => t.id),
    )
    collidableBySource.set(source.id, ids)
  }

  const cells = new Map<number, CollisionCell>()
  const collidableLayerTypes = new Set(["ground", "ground_decorations", "collision"])

  for (const layer of world.layers) {
    if (!collidableLayerTypes.has(layer.type)) continue
    for (const [col, row, tileId, sourceId] of layer.data) {
      const key = col * COLS_HASH + row
      if (cells.has(key)) continue

      const srcPolys = polygonData.get(sourceId)
      const polys = srcPolys?.get(tileId)
      if (polys) {
        const worldPolys: [number, number][][] = []
        for (const poly of polys) {
          const wp: [number, number][] = []
          for (const [px, py] of poly) {
            wp.push([bounds.minX + col * tileSize + px, bounds.minY + row * tileSize + py])
          }
          worldPolys.push(wp)
        }
        cells.set(key, { polygons: worldPolys })
      } else {
        const collidableIds = collidableBySource.get(sourceId)
        if (collidableIds?.has(tileId)) {
          const cx = bounds.minX + col * tileSize
          const cy = bounds.minY + row * tileSize
          cells.set(key, {
            polygons: [
              [
                [cx, cy],
                [cx + tileSize, cy],
                [cx + tileSize, cy + tileSize],
                [cx, cy + tileSize],
              ],
            ],
          })
        }
      }
    }
  }

  const getCell = (col: number, row: number): CollisionCell | null => {
    return cells.get(col * COLS_HASH + row) ?? null
  }

  const isSolid = (col: number, row: number): boolean => {
    return cells.has(col * COLS_HASH + row)
  }

  const isSolidAt = (worldX: number, worldY: number): boolean => {
    return isSolid(tileCol(worldX), tileRow(worldY))
  }

  const resolveMovement = (
    pos: { x: number; y: number },
    velocity: { x: number; y: number },
    hitbox: { width: number; height: number },
  ): { x: number; y: number } => {
    const hw = hitbox.width / 2
    const hh = hitbox.height / 2

    const findMtv = (aabb: {
      x: number
      y: number
      width: number
      height: number
    }): { x: number; y: number } | null => {
      const leftCol = tileCol(aabb.x)
      const rightCol = tileCol(aabb.x + aabb.width)
      const topRow = tileRow(aabb.y)
      const bottomRow = tileRow(aabb.y + aabb.height)

      for (let r = topRow; r <= bottomRow; r++) {
        for (let c = leftCol; c <= rightCol; c++) {
          const cell = getCell(c, r)
          if (!cell) continue
          for (const poly of cell.polygons) {
            const result = satAabbVsPolygon(aabb, poly)
            if (!result) continue
            return { x: result.axis[0] * result.overlap, y: result.axis[1] * result.overlap }
          }
        }
      }
      return null
    }

    let newX = pos.x + velocity.x
    let newY = pos.y + velocity.y

    if (velocity.x !== 0) {
      const mtv = findMtv({ x: newX - hw, y: pos.y - hh, width: hw * 2, height: hh * 2 })
      if (mtv && mtv.x !== 0) newX += mtv.x
    }

    if (velocity.y !== 0) {
      const mtv = findMtv({
        x: newX - hw,
        y: pos.y + velocity.y - hh,
        width: hw * 2,
        height: hh * 2,
      })
      if (mtv && mtv.y !== 0) newY += mtv.y
    }

    for (let iter = 0; iter < 2; iter++) {
      const mtv = findMtv({ x: newX - hw, y: newY - hh, width: hw * 2, height: hh * 2 })
      if (!mtv) break
      newX += mtv.x
      newY += mtv.y
    }

    newX = Math.max(bounds.minX + hw + 1, Math.min(bounds.maxX - hw - 1, newX))
    newY = Math.max(bounds.minY + hh + 1, Math.min(bounds.maxY - hh - 1, newY))

    return { x: newX, y: newY }
  }

  const getWorldBounds = () => bounds

  return {
    isSolid,
    isSolidAt,
    resolveMovement,
    getWorldBounds,
  }
}

export function createCollisionDebugOverlay(world: WorldData): Container {
  const overlay = new Container()
  const g = new Graphics()

  const tileSize = world.tileSize
  const bounds = world.bounds

  const polygonData = new Map<number, Map<number, [number, number][][]>>()
  for (const source of world.sources) {
    const map = new Map<number, [number, number][][]>()
    for (const tile of source.tiles) {
      if (tile.collisionPolygons && tile.collisionPolygons.length > 0) {
        map.set(tile.id, tile.collisionPolygons)
      }
    }
    polygonData.set(source.id, map)
  }

  const collidableBySource = new Map<number, Set<number>>()
  for (const source of world.sources) {
    const ids = new Set(
      source.tiles
        .filter((t) => t.collidable && (!t.collisionPolygons || t.collisionPolygons.length === 0))
        .map((t) => t.id),
    )
    collidableBySource.set(source.id, ids)
  }

  const drawn = new Set<string>()
  const collidableLayerTypes = new Set(["ground", "ground_decorations", "collision"])

  for (const layer of world.layers) {
    if (!collidableLayerTypes.has(layer.type)) continue
    for (const [col, row, tileId, sourceId] of layer.data) {
      const key = `${col},${row}`
      if (drawn.has(key)) continue

      const srcPolys = polygonData.get(sourceId)
      const polys = srcPolys?.get(tileId)
      if (polys) {
        drawn.add(key)
        for (const poly of polys) {
          if (poly.length === 0) continue
          g.moveTo(
            bounds.minX + col * tileSize + poly[0][0],
            bounds.minY + row * tileSize + poly[0][1],
          )
          for (let i = 1; i < poly.length; i++) {
            g.lineTo(
              bounds.minX + col * tileSize + poly[i][0],
              bounds.minY + row * tileSize + poly[i][1],
            )
          }
          g.closePath()
        }
      } else {
        const collidableIds = collidableBySource.get(sourceId)
        if (collidableIds?.has(tileId)) {
          drawn.add(key)
          g.rect(bounds.minX + col * tileSize, bounds.minY + row * tileSize, tileSize, tileSize)
        }
      }
    }
  }

  g.fill({ color: 0xff0000, alpha: 0.2 })
  g.stroke({ width: 1, color: 0xff4444, alpha: 0.7 })

  overlay.addChild(g)
  return overlay
}

export function updateCollisionDebugOverlay(
  overlay: Container,
  x: number,
  y: number,
  hw: number,
  hh: number,
): void {
  while (overlay.children.length > 1) {
    overlay.removeChildAt(1)
  }

  const g = new Graphics()
  g.rect(x - hw, y - hh, hw * 2, hh * 2)
  g.stroke({ width: 1, color: 0x00ff00, alpha: 0.8 })
  g.fill({ color: 0x00ff00, alpha: 0.1 })
  overlay.addChild(g)
}
