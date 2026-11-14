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
