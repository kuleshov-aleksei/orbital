import { isCapacitor } from "./platform"

/**
 * App build identity for the minimum-version gate (backend ClientVersionGate).
 * The Android app identifies itself as "android/<version>" on every API
 * request (X-Orbital-Client) and WebSocket (?client=). An app below the
 * minimum gets 426 / WS close 4426 and shows AppOutdatedScreen.
 * Dependency-free on purpose: api.ts and websocket.ts import it.
 */

export const CLIENT_HEADER = "X-Orbital-Client"
export const WS_CLOSE_CLIENT_OUTDATED = 4426

/** The build version without the "-<commit>" suffix ("1.5.2-816skays" → "1.5.2"). */
export function appVersion(): string {
  return __APP_VERSION__.split("-")[0]
}

/** "android/<version>" inside the Android app, null elsewhere (web, Electron). */
export function clientId(): string | null {
  return isCapacitor() ? `android/${appVersion()}` : null
}

/** Parses "X.Y.Z" (optional "v" prefix and "-suffix"); null when it isn't one. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-.*)?$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** -1 / 0 / 1, or null when either side isn't a version (dev builds). */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

// The backend refused this build (426 / WS 4426). The app update store
// registers the handler; kept here to avoid an api.ts ↔ store import cycle.
type ClientOutdatedHandler = (minVersion: string | null) => void
let outdatedHandler: ClientOutdatedHandler | null = null

export function setOnClientOutdated(handler: ClientOutdatedHandler | null): void {
  outdatedHandler = handler
}

export function notifyClientOutdated(minVersion: string | null = null): void {
  outdatedHandler?.(minVersion)
}
