import type { WorldData } from "./WorldTypes"

const COLS_HASH = 100000

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

export function createCollisionSystem(world: WorldData): CollisionSystem {
  const solidTiles = new Set<number>()
  const tileSize = world.tileSize
  const bounds = world.bounds

  const tileCol = (worldX: number) => Math.floor((worldX - bounds.minX) / tileSize)
  const tileRow = (worldY: number) => Math.floor((worldY - bounds.minY) / tileSize)

  const collidableBySource = new Map<number, Set<number>>()
  for (const source of world.sources) {
    const ids = new Set(source.tiles.filter((t) => t.collidable).map((t) => t.id))
    collidableBySource.set(source.id, ids)
  }

  const collisionLayer = world.layers.find((l) => l.type === "collision")
  if (collisionLayer) {
    const sourceId = collisionLayer.sourceId ?? 0
    const collidableIds = collidableBySource.get(sourceId) ?? new Set()
    for (const [col, row, tileId] of collisionLayer.data) {
      if (collidableIds.has(tileId)) {
        solidTiles.add(col * COLS_HASH + row)
      }
    }
  }

  const isSolid = (col: number, row: number): boolean => {
    return solidTiles.has(col * COLS_HASH + row)
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

    let newX = pos.x + velocity.x
    let newY = pos.y + velocity.y

    if (velocity.x !== 0) {
      const testY = pos.y
      const top = testY - hh
      const bottom = testY + hh
      const testCol = velocity.x > 0 ? tileCol(newX + hw) : tileCol(newX - hw)
      const topRow = tileRow(top)
      const bottomRow = tileRow(bottom)
      let blocked = false
      for (let r = topRow; r <= bottomRow; r++) {
        if (isSolid(testCol, r)) {
          blocked = true
          break
        }
      }
      if (blocked) {
        const tileLeft = bounds.minX + testCol * tileSize
        newX = velocity.x > 0 ? tileLeft - hw : tileLeft + tileSize + hw
      }
    }

    if (velocity.y !== 0) {
      const testX = newX
      const left = testX - hw
      const right = testX + hw
      const testRow = velocity.y > 0 ? tileRow(newY + hh) : tileRow(newY - hh)
      const leftCol = tileCol(left)
      const rightCol = tileCol(right)
      let blocked = false
      for (let c = leftCol; c <= rightCol; c++) {
        if (isSolid(c, testRow)) {
          blocked = true
          break
        }
      }
      if (blocked) {
        const tileTop = bounds.minY + testRow * tileSize
        newY = velocity.y > 0 ? tileTop - hh : tileTop + tileSize + hh
      }
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
