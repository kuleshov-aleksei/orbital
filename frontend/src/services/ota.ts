import { registerPlugin } from "@capacitor/core"
import * as electron from "@/services/electron"
import { isCapacitor } from "@/services/platform"
import { BACKEND_BASE } from "@/services/api"
import { debugLog, debugWarn } from "@/utils/debug"

/**
 * Over-the-air frontend updates: the shell (Electron main process,
 * electron/main/features/ota.ts, or the Android OtaBundle plugin) downloads
 * newer builds of this frontend and serves them instead of the one inside the
 * installer. This facade hides which shell does it. A web browser always loads
 * the live frontend and has nothing to do here.
 *
 * Bundles are only applied when the user reloads, when the app is idle (stores/ota.ts)
 * or on the next launch, never in the middle of a call.
 */

export type StageResult = "staged" | "native" | "none" | "unsupported" | "failed"

/** Local Android plugin (mobile/android/.../OtaBundlePlugin.java). */
interface OtaBundlePlugin {
  getInfo(): Promise<{
    shellApi: number
    nativeVersion: string
    activeVersion: string | null
    pendingVersion: string | null
  }>
  stage(options: { manifestUrl: string; backendUrl: string }): Promise<{
    result: "staged" | "native" | "none"
    version?: string
    reason?: string
  }>
  apply(): Promise<{ applied: boolean }>
  confirmBoot(): Promise<void>
}
const OtaBundle = registerPlugin<OtaBundlePlugin>("OtaBundle")

/** True when the shell can update this frontend over the air (older shells can't). */
export function otaSupported(): boolean {
  if (electron.isElectron()) return !!window.electronAPI?.applyOta
  return isCapacitor()
}

/** Tells the shell this bundle booted; otherwise it rolls back to the built-in one. */
export async function confirmBoot(): Promise<void> {
  try {
    if (electron.isElectron()) await window.electronAPI?.confirmOtaBoot?.()
    else if (isCapacitor()) await OtaBundle.confirmBoot()
  } catch (err) {
    // An APK without the plugin: nothing to confirm.
    debugLog("[OTA] confirmBoot unavailable", err)
  }
}

/** A downloaded bundle waiting to be applied, if any. */
export async function pendingVersion(): Promise<string | null> {
  try {
    if (electron.isElectron())
      return (await window.electronAPI?.otaStatus?.())?.pendingVersion ?? null
    if (isCapacitor()) return (await OtaBundle.getInfo()).pendingVersion
  } catch (err) {
    debugLog("[OTA] status unavailable", err)
  }
  return null
}

/** Electron: the main process downloaded a bundle in the background. */
export function onReady(callback: (version: string) => void): void {
  window.electronAPI?.onOtaReady?.((info) => callback(info.version))
}

/**
 * Android: checks the release manifest and downloads a newer bundle.
 * "native" = the release needs a newer APK; "unsupported" = this APK has no plugin;
 * "failed" = the download or the write broke (the next check retries; it must not
 * turn into an APK download prompt). Electron checks by itself (main process), so
 * this is Android-only.
 */
export async function stage(
  manifestUrl: string,
): Promise<{ result: StageResult; version?: string }> {
  if (!isCapacitor()) return { result: "unsupported" }
  try {
    const res = await OtaBundle.stage({ manifestUrl, backendUrl: BACKEND_BASE })
    debugLog(
      `[OTA] stage ${res.version ?? "?"}: ${res.result}${res.reason ? ` (${res.reason})` : ""}`,
    )
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/not implemented/i.test(msg)) return { result: "unsupported" }
    debugWarn("[OTA] stage failed", err)
    return { result: "failed" }
  }
}

/** Reloads into the pending bundle. False when there is none. */
export async function apply(): Promise<boolean> {
  try {
    if (electron.isElectron()) return (await window.electronAPI?.applyOta?.()) ?? false
    if (isCapacitor()) return (await OtaBundle.apply()).applied
  } catch (err) {
    debugWarn("[OTA] apply failed", err)
  }
  return false
}
