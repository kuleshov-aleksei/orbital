import { Capacitor, registerPlugin } from "@capacitor/core"
import type { PluginListenerHandle } from "@capacitor/core"
import * as electron from "@/services/electron"

export type CallNotificationAction = "mute" | "deafen"

/** Local Android plugin (mobile/android/.../CallKeepAlivePlugin.java). */
interface CallKeepAlivePlugin {
  start(options: { title: string }): Promise<void>
  update(options: { muted: boolean; deafened: boolean }): Promise<void>
  stop(): Promise<void>
  addListener(
    eventName: "action",
    listener: (event: { action: CallNotificationAction }) => void,
  ): Promise<PluginListenerHandle>
}
const CallKeepAlive = registerPlugin<CallKeepAlivePlugin>("CallKeepAlive")

/** Local Android plugin (mobile/android/.../MediaCachePlugin.java). */
interface MediaCachePlugin {
  list(): Promise<{ keys: string[] }>
  evict(options: { id: string }): Promise<void>
  clear(): Promise<void>
  addListener(
    eventName: "log",
    listener: (event: { level: string; message: string }) => void,
  ): Promise<PluginListenerHandle>
}
const MediaCache = registerPlugin<MediaCachePlugin>("MediaCache")

export interface KeyboardImageFile {
  uri: string
  name: string
  mime: string
  size: number
}
export type KeyboardImageError = "too_large" | "read_failed"
export type KeyboardImageEvent = KeyboardImageFile | { error: KeyboardImageError }

/** Local Android plugin (mobile/android/.../KeyboardContentPlugin.java). */
interface KeyboardContentPlugin {
  setEnabled(options: { enabled: boolean; maxBytes: number }): Promise<void>
  release(options: { uri: string }): Promise<void>
  addListener(
    eventName: "image",
    listener: (event: KeyboardImageEvent) => void,
  ): Promise<PluginListenerHandle>
}
const KeyboardContent = registerPlugin<KeyboardContentPlugin>("KeyboardContent")

/**
 * Platform layer over the three shells the frontend runs in:
 * plain browser, Electron (services/electron.ts) and the Android app (Capacitor).
 *
 * New native features should be added here instead of importing
 * services/electron.ts directly, so callers don't need per-shell branches.
 * Capacitor plugins are imported lazily so the web/Electron bundles don't pay for them.
 */

/** True inside the Android app (Capacitor native WebView). */
export function isCapacitor(): boolean {
  return Capacitor.isNativePlatform()
}

/** True in any packaged app (Electron or Android), false in a browser tab. */
export function isNative(): boolean {
  return electron.isElectron() || isCapacitor()
}

/** Opens a URL outside the app: system browser on Android, default browser on desktop. */
export async function openExternal(url: string): Promise<void> {
  if (electron.isElectron()) {
    await electron.openExternal(url)
    return
  }
  if (isCapacitor()) {
    const { Browser } = await import("@capacitor/browser")
    await Browser.open({ url })
    return
  }
  window.open(url, "_blank", "noopener")
}

/** Gets the user's attention for a mention: taskbar flash on desktop, a short vibration on Android. */
export function notifyAttention(): void {
  if (electron.isElectron()) {
    electron.flashWindow()
    return
  }
  if (isCapacitor()) {
    void haptic("medium")
  }
}

/**
 * Keeps a voice call alive while the Android app is minimised or the screen is locked:
 * a foreground service (ongoing notification + wake/Wi-Fi locks) stops Android from
 * freezing the process and cutting its network, which kills the LiveKit signal and
 * /ws sockets (code 1006). Start it only while the app is in the foreground (joining);
 * repeat calls are no-ops. No-op outside the Android app.
 */
export async function setCallKeepAlive(active: boolean, roomName = ""): Promise<void> {
  if (!isCapacitor()) return
  try {
    if (active) {
      await CallKeepAlive.start({
        title: roomName ? `In voice: ${roomName}` : "In a voice call",
      })
    } else {
      await CallKeepAlive.stop()
    }
  } catch (err) {
    console.warn("Call keep-alive service failed:", err)
  }
}

/**
 * Pushes the mute/deafen state to the ongoing call notification (Android), which
 * shows matching Mute/Unmute and Deafen/Undeafen buttons. Safe to call before the
 * call starts: the state is kept for the next notification. No-op elsewhere.
 */
export async function setCallNotificationState(state: {
  muted: boolean
  deafened: boolean
}): Promise<void> {
  if (!isCapacitor()) return
  try {
    await CallKeepAlive.update(state)
  } catch (err) {
    console.warn("Call notification update failed:", err)
  }
}

/**
 * Listens for taps on the ongoing call notification buttons (Android). The
 * listener should toggle the state; the notification follows through
 * setCallNotificationState. Returns a function that removes the listener.
 */
export async function onCallNotificationAction(
  listener: (action: CallNotificationAction) => void,
): Promise<() => void> {
  if (!isCapacitor()) return () => {}
  const handle = await CallKeepAlive.addListener("action", (event) => listener(event.action))
  return () => void handle.remove()
}

/** Light haptic feedback on Android (mute/deafen toggles); no-op elsewhere. */
export async function haptic(style: "light" | "medium" = "light"): Promise<void> {
  if (!isCapacitor()) return
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics")
    await Haptics.impact({ style: style === "light" ? ImpactStyle.Light : ImpactStyle.Medium })
  } catch {
    // Haptics are cosmetic; ignore devices without a vibrator.
  }
}

/** Advertises keyboard GIF insertion only for the focused text composer. */
export async function setKeyboardContentEnabled(enabled: boolean, maxBytes: number): Promise<void> {
  if (!isCapacitor()) return
  try {
    await KeyboardContent.setEnabled({ enabled, maxBytes })
  } catch {
    // Older shells do not have the local plugin; the file picker still works.
  }
}

/** Listens for GIFs committed by the Android keyboard. */
export async function onKeyboardImage(
  listener: (event: KeyboardImageEvent) => void,
): Promise<() => void> {
  if (!isCapacitor()) return () => {}
  try {
    const handle = await KeyboardContent.addListener("image", listener)
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** Deletes a native temporary GIF after the WebView has consumed it. */
export async function releaseKeyboardImage(uri: string): Promise<void> {
  if (!isCapacitor()) return
  try {
    await KeyboardContent.release({ uri })
  } catch {
    // The native TTL and startup cleanup remove abandoned temporary files.
  }
}

/**
 * Native side of the chat media cache (services/attachments/mediaCache.ts):
 * electron/main/features/mediaCache.ts on desktop, MediaCache.java on Android.
 */
export const mediaCacheNative = {
  /** True when this shell serves cached media (older Electron builds don't). */
  available(): boolean {
    if (electron.isElectron()) return !!window.electronAPI?.mediaCacheList
    return isCapacitor()
  },
  /** Base URL that serves a cache key (append ?src=... on a miss). */
  urlFor(key: string): string {
    return electron.isElectron() ? `orbital-media://cache/${key}` : `/_media/${key}`
  },
  async list(): Promise<string[]> {
    if (electron.isElectron()) return (await window.electronAPI?.mediaCacheList?.()) ?? []
    if (isCapacitor()) return (await MediaCache.list()).keys
    return []
  },
  async evict(id: string): Promise<void> {
    if (electron.isElectron()) await window.electronAPI?.mediaCacheEvict?.(id)
    else if (isCapacitor()) await MediaCache.evict({ id })
  },
  async clear(): Promise<void> {
    if (electron.isElectron()) await window.electronAPI?.mediaCacheClear?.()
    else if (isCapacitor()) await MediaCache.clear()
  },
  /**
   * Native log lines (Android). Electron's main process logs already reach the
   * debug log through setupMainProcessLogRelay.
   */
  async onLog(listener: (level: string, message: string) => void): Promise<void> {
    if (!isCapacitor()) return
    await MediaCache.addListener("log", (event) => listener(event.level, event.message))
  },
}
