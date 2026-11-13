import { Capacitor } from "@capacitor/core"
import * as electron from "@/services/electron"

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
