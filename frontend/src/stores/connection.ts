import { defineStore } from "pinia"
import { computed, ref, watch } from "vue"
import { apiService, setOnNetworkStatus } from "@/services/api"
import { wsService } from "@/services/websocket"

/**
 * Whether the server is reachable, for the "Connecting to the server…" pill
 * and the offline behaviour of cached data and the message outbox.
 *
 * - connecting: nothing has answered yet, or the global socket is reconnecting
 * - offline: the last request failed at the network level (or the OS says so)
 * - online: the server answered and the global socket is up (when signed in)
 */
export type ServerStatus = "connecting" | "online" | "offline"

export const useConnectionStore = defineStore("connection", () => {
  // null until the first request settles.
  const reachable = ref<boolean | null>(null)
  const socketUp = ref(false)
  // The global socket only exists for signed-in users.
  const socketExpected = ref(false)

  const status = computed<ServerStatus>(() => {
    if (reachable.value === false) return "offline"
    if (reachable.value === null) return "connecting"
    if (socketExpected.value && !socketUp.value) return "connecting"
    return "online"
  })
  const isOnline = computed(() => status.value === "online")

  function setReachable(ok: boolean) {
    reachable.value = ok
  }

  function setSocketExpected(expected: boolean) {
    socketExpected.value = expected
  }

  // Wired once, when the store is first used (main.ts).
  setOnNetworkStatus(setReachable)
  // Socket attempts that closed without ever opening; two in a row means the
  // server is unreachable even if no REST request has failed yet.
  let failedAttempts = 0
  wsService.onGlobalConnection(() => {
    failedAttempts = 0
    socketUp.value = true
    reachable.value = true
  })
  wsService.onGlobalDisconnection(() => {
    const wasUp = socketUp.value
    socketUp.value = false
    if (wsService.isGlobalManualClose()) return
    failedAttempts = wasUp ? 0 : failedAttempts + 1
    if (failedAttempts >= 2) reachable.value = false
  })
  if (typeof window !== "undefined") {
    window.addEventListener("offline", () => {
      reachable.value = false
    })
  }

  /**
   * Checks reachability now: a cheap request (its outcome updates `reachable`
   * through the API hook) plus a socket reconnect if it is down.
   */
  function probe() {
    apiService.getConfig().catch(() => {})
    wsService.recoverConnections()
  }

  // While offline, keep checking: the socket may be fine (a single request
  // timed out) or the network came back without an "online" event.
  const PROBE_INTERVAL_MS = 10_000
  let probeTimer: ReturnType<typeof setInterval> | null = null
  watch(
    () => reachable.value === false,
    (offline) => {
      if (offline && !probeTimer) {
        probeTimer = setInterval(probe, PROBE_INTERVAL_MS)
      } else if (!offline && probeTimer) {
        clearInterval(probeTimer)
        probeTimer = null
      }
    },
  )

  return { status, isOnline, reachable, socketUp, setReachable, setSocketExpected, probe }
})
