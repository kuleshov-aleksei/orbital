import { ConnectionState, type Room } from "livekit-client"
import { stopReconnectingLoop, playReconnected } from "@/services/sounds"
import { useCallStore } from "@/stores/call"
import { debugWarn, debugError } from "@/utils/debug"
import type { LiveKitState } from "./useLiveKitState"

export interface UseLiveKitSupervisorDependencies {
  /** Fresh join with a new Room + token (the same as a manual rejoin). */
  rejoin: () => Promise<boolean>
}

// How often to check the SDK for progress.
const CHECK_INTERVAL_MS = 10_000
// No SDK progress for this long while reconnecting => the retry chain is wedged.
const STAGNATION_LIMIT_MS = 30_000
// Forced rejoins per outage episode before showing "connection lost".
const MAX_SUPERVISOR_REJOINS = 3

/**
 * Dead-man's switch for the SDK reconnect loop.
 *
 * The SDK retries internally (resume -> full reconnect per our ReconnectPolicy),
 * but that chain can wedge silently: no further attempts, no give-up, no
 * Disconnected event. The supervisor watches `engine.reconnectAttempts` on a
 * timer and, on stagnation, performs the manual-equivalent recovery: drop the
 * dead room and rejoin fresh. It never acts while the SDK is making progress.
 */
export function useLiveKitSupervisor(state: LiveKitState, deps: UseLiveKitSupervisorDependencies) {
  const callStore = useCallStore()

  let timer: ReturnType<typeof setInterval> | null = null
  let active = false
  let forcing = false
  let supervisorRejoins = 0
  let lastAttempts: number | null = null
  let lastProgressAt = 0

  const readAttempts = (room: Room): number | null => {
    const attempts = (room as unknown as { engine?: { reconnectAttempts?: number } }).engine
      ?.reconnectAttempts
    return typeof attempts === "number" && attempts >= 0 ? attempts : null
  }

  const isReconnectingState = (room: Room): boolean =>
    room.state === ConnectionState.Reconnecting || room.state === ConnectionState.SignalReconnecting

  const forceFreshJoin = async (): Promise<void> => {
    if (forcing) return
    if (supervisorRejoins >= MAX_SUPERVISOR_REJOINS) {
      debugError(
        `[LiveKit][ERROR]: Supervisor gave up after ${MAX_SUPERVISOR_REJOINS} forced rejoins - showing connection lost state`,
      )
      stopReconnectingLoop()
      state.isReconnecting.value = false
      state.connectionFailed.value = true
      callStore.setReconnecting(false)
      reset()
      return
    }

    forcing = true
    try {
      supervisorRejoins++
      debugWarn(
        `[LiveKit][WARN]: Supervisor: no SDK progress for ${STAGNATION_LIMIT_MS / 1000}s - forcing fresh join (${supervisorRejoins}/${MAX_SUPERVISOR_REJOINS})`,
      )
      const current = state.room.value
      if (current) {
        try {
          await current.disconnect()
        } catch {
          // Dead room may already be unusable - rejoin anyway.
        }
      }
      // User left or rejoined manually while we were tearing down.
      if (!forcing) return
      state.room.value = null
      const rejoined = await deps.rejoin()
      if (!forcing) return
      if (rejoined) {
        // A fresh join emits no Reconnected event - clear the state ourselves
        // and restore the budget: this outage episode is over.
        stopReconnectingLoop()
        playReconnected()
        state.isReconnecting.value = false
        callStore.setReconnecting(false)
        reset()
      }
      // On failure we stay active: the next tick retries (budget permitting).
    } finally {
      forcing = false
    }
  }

  const tick = (): void => {
    const room = state.room.value
    if (!room) {
      // Should be in a call but have no room (a join failed mid-outage).
      // Only while active, so a deliberate leave never triggers this.
      if (active) void forceFreshJoin()
      return
    }
    if (!isReconnectingState(room)) {
      lastProgressAt = Date.now()
      return
    }
    const attempts = readAttempts(room)
    const now = Date.now()
    if (attempts === null || attempts !== lastAttempts) {
      lastAttempts = attempts
      lastProgressAt = now
      return
    }
    if (now - lastProgressAt >= STAGNATION_LIMIT_MS) {
      // Re-baseline so we don't pile up forces while one is in flight.
      lastProgressAt = now
      void forceFreshJoin()
    }
  }

  /** Start (or re-baseline) watching. Called on Reconnecting/SignalReconnecting. */
  const start = (): void => {
    active = true
    lastAttempts = null
    lastProgressAt = Date.now()
    if (timer) return
    timer = setInterval(tick, CHECK_INTERVAL_MS)
  }

  /** Stop watching and restore the full rejoin budget (recovered or fresh join). */
  const reset = (): void => {
    active = false
    forcing = false
    supervisorRejoins = 0
    lastAttempts = null
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { start, reset }
}
