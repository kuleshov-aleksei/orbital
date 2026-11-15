import { defineStore } from "pinia"
import { ref } from "vue"
import * as ota from "@/services/ota"
import { useRoomStore } from "@/stores/room"
import { debugLog } from "@/utils/debug"

// Apply a downloaded bundle by itself once the app has been out of sight or
// untouched for this long (and no call is active).
const HIDDEN_APPLY_MS = 10 * 60 * 1000
const IDLE_APPLY_MS = 30 * 60 * 1000
const IDLE_CHECK_MS = 60 * 1000

/**
 * A newer frontend bundle downloaded by the shell (services/ota.ts) and waiting
 * to be applied. Shows OtaReadyToast; never reloads during a call.
 * Without user action the shell applies it on the next launch anyway.
 */
export const useOtaStore = defineStore("ota", () => {
  const readyVersion = ref<string | null>(null)
  /** "Later": hide the toast for this version (it still applies on idle / next launch). */
  const dismissedVersion = ref<string | null>(null)
  const applying = ref(false)

  let lastInputAt = Date.now()
  let hiddenSince: number | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function setReady(version: string): void {
    debugLog(`[OTA] Bundle ${version} is ready`)
    readyVersion.value = version
  }

  async function apply(): Promise<boolean> {
    if (!readyVersion.value || applying.value) return false
    if (useRoomStore().isInRoom) return false
    applying.value = true
    try {
      const applied = await ota.apply()
      if (!applied) readyVersion.value = null
      return applied
    } finally {
      applying.value = false
    }
  }

  function dismiss(): void {
    dismissedVersion.value = readyVersion.value
  }

  const onInput = () => {
    lastInputAt = Date.now()
  }
  const onVisibility = () => {
    hiddenSince = document.hidden ? Date.now() : null
  }

  function tick(): void {
    if (!readyVersion.value || useRoomStore().isInRoom) return
    const now = Date.now()
    const hiddenLong = hiddenSince !== null && now - hiddenSince >= HIDDEN_APPLY_MS
    const idleLong = now - lastInputAt >= IDLE_APPLY_MS
    if (hiddenLong || idleLong) {
      debugLog("[OTA] App idle, applying the new bundle")
      void apply()
    }
  }

  /** Confirms this bundle's boot and starts listening for new ones. Once, from App.vue. */
  async function start(): Promise<void> {
    if (!ota.otaSupported()) return
    await ota.confirmBoot()
    ota.onReady(setReady)
    const pending = await ota.pendingVersion()
    if (pending) setReady(pending)

    window.addEventListener("pointerdown", onInput, { passive: true })
    window.addEventListener("keydown", onInput, { passive: true })
    document.addEventListener("visibilitychange", onVisibility)
    onVisibility()
    timer = setInterval(tick, IDLE_CHECK_MS)
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
    window.removeEventListener("pointerdown", onInput)
    window.removeEventListener("keydown", onInput)
    document.removeEventListener("visibilitychange", onVisibility)
  }

  return { readyVersion, dismissedVersion, applying, setReady, apply, dismiss, start, stop }
})
