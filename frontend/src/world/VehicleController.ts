export interface VehicleState {
  angle: number
  speed: number
  steeringAngle: number
}

export interface VehicleController {
  state: VehicleState
  update(delta: number, keysPressed: Set<string>): void
  getVelocity(frameDelta: number): { x: number; y: number }
  reset(): void
}

const ACCELERATION = 6
const BRAKE_DECELERATION = 15
const MAX_SPEED = 6.5
const MAX_REVERSE_SPEED = 1.5
const STEERING_SPEED = 3.5
const STEERING_RETURN_SPEED = 4.5
const MAX_STEERING_ANGLE = Math.PI / 4
const WHEELBASE = 2.5
const TRACTION = 0.995
const SPEED_THRESHOLD = 0.01

export function createVehicleController(): VehicleController {
  const state: VehicleState = {
    angle: 0,
    speed: 0,
    steeringAngle: 0,
  }

  function update(delta: number, keysPressed: Set<string>) {
    const dt = delta / 1000

    const pressingForward = keysPressed.has("KeyW") || keysPressed.has("ArrowUp")
    const pressingBackward = keysPressed.has("KeyS") || keysPressed.has("ArrowDown")
    const pressingLeft = keysPressed.has("KeyA") || keysPressed.has("ArrowLeft")
    const pressingRight = keysPressed.has("KeyD") || keysPressed.has("ArrowRight")

    if (pressingLeft) {
      state.steeringAngle -= STEERING_SPEED * dt
    }
    if (pressingRight) {
      state.steeringAngle += STEERING_SPEED * dt
    }
    if (!pressingLeft && !pressingRight) {
      if (Math.abs(state.steeringAngle) < 0.01 * dt) {
        state.steeringAngle = 0
      } else {
        state.steeringAngle -= Math.sign(state.steeringAngle) * STEERING_RETURN_SPEED * dt
      }
    }

    state.steeringAngle = Math.max(
      -MAX_STEERING_ANGLE,
      Math.min(MAX_STEERING_ANGLE, state.steeringAngle),
    )

    if (Math.abs(state.speed) > SPEED_THRESHOLD) {
      state.angle += (state.speed / WHEELBASE) * Math.tan(state.steeringAngle) * dt
    }

    if (pressingForward) {
      state.speed += ACCELERATION * dt
    }
    if (pressingBackward) {
      state.speed -= BRAKE_DECELERATION * dt
    }

    if (!pressingForward && !pressingBackward) {
      if (Math.abs(state.speed) < SPEED_THRESHOLD) {
        state.speed = 0
      } else {
        state.speed *= Math.pow(TRACTION, dt * 60)
      }
    }

    state.speed = Math.max(-MAX_REVERSE_SPEED, Math.min(MAX_SPEED, state.speed))
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
    state.steeringAngle = 0
  }

  return { state, update, getVelocity, reset }
}
