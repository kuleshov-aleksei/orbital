export interface VehicleState {
  angle: number
  speed: number
}

export interface VehicleController {
  state: VehicleState
  update(delta: number, keysPressed: Set<string>): void
  getVelocity(frameDelta: number): { x: number; y: number }
  reset(position?: { x: number; y: number }): void
}

const ACCELERATION = 10
const DECELERATION = 15
const MAX_SPEED = 6
const MAX_REVERSE_SPEED = 3
const ROTATION_SPEED = 3
const FRICTION = 0.97

export function createVehicleController(): VehicleController {
  const state: VehicleState = {
    angle: 0,
    speed: 0,
  }

  function update(delta: number, keysPressed: Set<string>) {
    const dt = delta / 1000

    const pressingForward = keysPressed.has("KeyW") || keysPressed.has("ArrowUp")
    const pressingBackward = keysPressed.has("KeyS") || keysPressed.has("ArrowDown")
    const pressingLeft = keysPressed.has("KeyA") || keysPressed.has("ArrowLeft")
    const pressingRight = keysPressed.has("KeyD") || keysPressed.has("ArrowRight")

    if (pressingForward) {
      state.speed += ACCELERATION * dt
    }
    if (pressingBackward) {
      state.speed -= DECELERATION * dt
    }

    if (!pressingForward && !pressingBackward) {
      if (Math.abs(state.speed) < 0.05) {
        state.speed = 0
      } else {
        state.speed *= FRICTION
      }
    }

    state.speed = Math.max(-MAX_REVERSE_SPEED, Math.min(MAX_SPEED, state.speed))

    if (pressingLeft) {
      state.angle -= ROTATION_SPEED * dt
    }
    if (pressingRight) {
      state.angle += ROTATION_SPEED * dt
    }
  }

  function getVelocity(frameDelta: number): { x: number; y: number } {
    return {
      x: Math.cos(state.angle) * state.speed * frameDelta,
      y: Math.sin(state.angle) * state.speed * frameDelta,
    }
  }

  function reset() {
    state.angle = 0
    state.speed = 0
  }

  return { state, update, getVelocity, reset }
}
