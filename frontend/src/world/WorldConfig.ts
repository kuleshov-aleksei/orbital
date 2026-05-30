export interface Vector2 {
  x: number
  y: number
}

export const WORLD_BOUNDARIES = { minX: -775, maxX: 780, minY: -790, maxY: 770 }
export const PLAYER_SPEED = 6
export const EARSHOT_RADIUS = 300
export const MAX_BOOMBOX_VOLUME = 0.5
export const BACKGROUND_Z_INDEX = -100000
export const SPAWN_POSITION: Vector2 = { x: 10, y: 0 }
export const SEND_INTERVAL_MS = 100
export const TICK_RATE = 30

export const WORLD_BACKGROUND_COLOR = 0x16213e

export const BOOMBOX_POSITION: Vector2 = { x: 0, y: -200 }
export const BOOMBOX_INTERACT_DISTANCE = 60
