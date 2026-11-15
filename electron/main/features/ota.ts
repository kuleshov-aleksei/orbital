// Over-the-air frontend updates (docs/notes/MIGRATION_TO_S3.md "OTA frontend").
//
// The renderer (Vue bundle) can be replaced without reinstalling the app: newer
// bundles built for the same shell API (shell-api.json) are downloaded from the
// update feed into userData/ota/bundles/<version>/ and served by the orbital://
// protocol (features/protocol.ts) instead of the bundle inside the installer.
// The origin stays orbital://app, so IndexedDB and localStorage are kept.
//
// A bundle that doesn't confirm its boot within BOOT_TIMEOUT_MS (or crashes
// before that) is marked bad and the app falls back to the built-in bundle.
import { app, net, type BrowserWindow } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import log from "electron-log"
import { RENDERER_DIST, VITE_DEV_SERVER_URL } from "../paths"
import { getMainWindow } from "../state"
import {
  decide,
  normalizeState,
  parseManifest,
  resolveStartupState,
  type OtaManifest,
  type OtaState,
} from "./otaPlan"

const BOOT_TIMEOUT_MS = 30_000
const FETCH_TIMEOUT_MS = 30_000
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const APP_URL = "orbital://app/"

export type OtaCheckResult = "native" | "staged" | "none" | "failed"

export interface OtaStatus {
  shellApi: number
  builtinVersion: string
  activeVersion: string | null
  pendingVersion: string | null
}

let state: OtaState = { active: null, pending: null, bad: [] }
let checking: Promise<OtaCheckResult> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
/** Version whose boot we are waiting to be confirmed; null when none. */
let bootingVersion: string | null = null

const otaRoot = () => path.join(app.getPath("userData"), "ota")
const bundlesDir = () => path.join(otaRoot(), "bundles")
const stateFile = () => path.join(otaRoot(), "state.json")
const bundleDir = (version: string) => path.join(bundlesDir(), version)
const bundleIndex = (version: string) => path.join(bundleDir(version), ".ota-manifest.json")

/** Update feed root. ORBITAL_OTA_URL overrides it for local testing. */
function feedUrl(): string {
  const url = process.env.ORBITAL_OTA_URL || __UPDATE_URL__
  if (!url) return ""
  return url.endsWith("/") ? url : `${url}/`
}

function saveState(): void {
  try {
    fs.mkdirSync(otaRoot(), { recursive: true })
    const tmp = `${stateFile()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, stateFile())
  } catch (err) {
    log.error("[OTA] Failed to save state:", err)
  }
}

function bundleExists(version: string): boolean {
  return fs.existsSync(path.join(bundleDir(version), "index.html")) && fs.existsSync(bundleIndex(version))
}

/** The directory the orbital:// protocol serves the renderer from. */
export function getRendererRoot(): string {
  return state.active ? bundleDir(state.active) : RENDERER_DIST
}

/** The version the renderer runs right now (OTA bundle or built-in). */
function currentVersion(): string {
  return state.active ?? app.getVersion()
}

export function getOtaStatus(): OtaStatus {
  return {
    shellApi: __SHELL_API__,
    builtinVersion: app.getVersion(),
    activeVersion: state.active,
    pendingVersion: state.pending,
  }
}

/** Loads the state, applies a pending bundle and removes stale ones. Before the protocol is registered. */
export function initOta(): void {
  if (VITE_DEV_SERVER_URL) return
  try {
    const raw = fs.existsSync(stateFile()) ? JSON.parse(fs.readFileSync(stateFile(), "utf8")) : null
    state = resolveStartupState(normalizeState(raw), app.getVersion(), bundleExists)
  } catch (err) {
    log.warn("[OTA] Unreadable state, starting from the built-in bundle:", err)
    state = { active: null, pending: null, bad: [] }
  }
  saveState()
  removeUnusedBundles()
  log.info(`[OTA] Built-in ${app.getVersion()}, active ${state.active ?? "built-in"}, shell API ${__SHELL_API__}`)
}

function removeUnusedBundles(): void {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(bundlesDir())
  } catch {
    return
  }
  for (const name of entries) {
    if (name === state.active || name === state.pending) continue
    fs.rm(path.join(bundlesDir(), name), { recursive: true, force: true }, (err) => {
      if (err) log.warn(`[OTA] Failed to remove ${name}:`, err)
    })
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" })
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`)
  return res
}

const sha256 = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex")

/** Files we already have, by sha256 → absolute path. */
function localFiles(manifest: OtaManifest): Map<string, string> {
  const found = new Map<string, string>()
  const wanted = new Set(manifest.files.map((f) => f.sha256))

  // The active OTA bundle keeps its own index, so no hashing is needed.
  if (state.active && bundleExists(state.active)) {
    try {
      const index = parseManifest(JSON.parse(fs.readFileSync(bundleIndex(state.active), "utf8")))
      for (const f of index?.files ?? []) {
        if (wanted.has(f.sha256)) found.set(f.sha256, path.join(bundleDir(state.active), f.path))
      }
    } catch {
      // Corrupt index: just download those files again.
    }
  }

  // Built-in bundle: hash only files whose path and size match.
  for (const f of manifest.files) {
    if (found.has(f.sha256)) continue
    const candidate = path.join(RENDERER_DIST, f.path)
    try {
      if (fs.statSync(candidate).size === f.size && sha256(fs.readFileSync(candidate)) === f.sha256) {
        found.set(f.sha256, candidate)
      }
    } catch {
      // Not present.
    }
  }
  return found
}

/** Downloads and verifies a bundle into bundles/<version>/ (atomic rename). */
async function stageBundle(manifest: OtaManifest): Promise<void> {
  const target = bundleDir(manifest.version)
  if (bundleExists(manifest.version)) return

  const tmp = `${target}.tmp`
  await fs.promises.rm(tmp, { recursive: true, force: true })
  await fs.promises.mkdir(tmp, { recursive: true })

  const have = localFiles(manifest)
  const blobBase = `${feedUrl()}ota/electron/files/`
  let downloaded = 0
  let bytes = 0

  for (const file of manifest.files) {
    const dest = path.join(tmp, file.path)
    if (!dest.startsWith(tmp + path.sep)) throw new Error(`unsafe path ${file.path}`)
    await fs.promises.mkdir(path.dirname(dest), { recursive: true })

    const local = have.get(file.sha256)
    if (local) {
      await fs.promises.copyFile(local, dest)
      continue
    }
    const data = Buffer.from(await (await fetchWithTimeout(blobBase + file.sha256)).arrayBuffer())
    if (data.length !== file.size || sha256(data) !== file.sha256) {
      throw new Error(`checksum mismatch for ${file.path}`)
    }
    await fs.promises.writeFile(dest, data)
    downloaded++
    bytes += data.length
  }

  await fs.promises.writeFile(path.join(tmp, ".ota-manifest.json"), JSON.stringify(manifest))
  await fs.promises.rm(target, { recursive: true, force: true })
  await fs.promises.rename(tmp, target)
  log.info(
    `[OTA] Staged ${manifest.version}: ${downloaded} of ${manifest.files.length} files downloaded (${(bytes / 1048576).toFixed(1)} MiB)`,
  )
}

function notifyReady(version: string): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send("ota-ready", { version })
}

async function runCheck(): Promise<OtaCheckResult> {
  const feed = feedUrl()
  if (!feed) {
    log.info("[OTA] No update feed configured, skipping")
    return "failed"
  }
  let manifest: OtaManifest | null
  try {
    manifest = parseManifest(await (await fetchWithTimeout(`${feed}ota-electron.json`)).json())
  } catch (err) {
    log.warn("[OTA] Manifest fetch failed:", err)
    return "failed"
  }
  if (!manifest) {
    log.warn("[OTA] Invalid manifest")
    return "failed"
  }

  const decision = decide(manifest, {
    shellApi: __SHELL_API__,
    currentVersion: state.pending ?? currentVersion(),
    builtinVersion: app.getVersion(),
    backendUrl: __BACKEND_URL__,
    bad: state.bad,
  })
  if (decision.action === "none") {
    log.info(`[OTA] Latest ${manifest.version}: nothing to do (${decision.reason})`)
    return "none"
  }
  if (decision.action === "native") {
    log.info(`[OTA] Latest ${manifest.version} needs shell API ${manifest.shell_api} (have ${__SHELL_API__})`)
    return "native"
  }

  try {
    await stageBundle(manifest)
  } catch (err) {
    log.error(`[OTA] Staging ${manifest.version} failed:`, err)
    return "failed"
  }
  const previous = state.pending
  state.pending = manifest.version
  saveState()
  if (previous && previous !== manifest.version) {
    fs.rm(bundleDir(previous), { recursive: true, force: true }, () => {})
  }
  notifyReady(manifest.version)
  return "staged"
}

/** Looks for a newer bundle; concurrent calls share one check. */
export function checkOta(): Promise<OtaCheckResult> {
  if (VITE_DEV_SERVER_URL) return Promise.resolve("none")
  checking ??= runCheck().finally(() => {
    checking = null
  })
  return checking
}

/** Periodic checks in the background (staging only; native updates wait for the next launch). */
export function startOtaPolling(): void {
  if (VITE_DEV_SERVER_URL) return
  setInterval(() => void checkOta(), CHECK_INTERVAL_MS)
}

/** Switches to the pending bundle now (renderer asked: "Reload"). */
export function applyPendingOta(): boolean {
  const win = getMainWindow()
  if (!state.pending || !win || win.isDestroyed()) return false
  state.active = state.pending
  state.pending = null
  saveState()
  log.info(`[OTA] Applying ${state.active}`)
  void win.loadURL(APP_URL)
  armBootGuard(win)
  return true
}

/** Called by the renderer once the app mounted. */
export function confirmOtaBoot(): void {
  if (bootTimer) clearTimeout(bootTimer)
  bootTimer = null
  if (bootingVersion) log.info(`[OTA] Bundle ${bootingVersion} booted`)
  bootingVersion = null
  // Old bundles (anything but active/pending) can go now.
  removeUnusedBundles()
}

function rollBack(win: BrowserWindow, reason: string): void {
  const failed = bootingVersion
  if (!failed || state.active !== failed) return
  log.error(`[OTA] Bundle ${failed} failed to boot (${reason}), falling back to the built-in bundle`)
  if (bootTimer) clearTimeout(bootTimer)
  bootTimer = null
  bootingVersion = null
  state.bad = [...state.bad.filter((v) => v !== failed), failed]
  state.active = null
  saveState()
  if (!win.isDestroyed()) void win.loadURL(APP_URL)
}

/** Watches the boot of a non-built-in bundle and rolls back if it never confirms. */
export function armBootGuard(win: BrowserWindow): void {
  if (!state.active || VITE_DEV_SERVER_URL) return
  bootingVersion = state.active
  if (bootTimer) clearTimeout(bootTimer)
  bootTimer = setTimeout(() => rollBack(win, "no boot confirmation"), BOOT_TIMEOUT_MS)
}

/** Window-level failure hooks; installed once per window. */
export function watchRendererFailures(win: BrowserWindow): void {
  win.webContents.on("render-process-gone", (_e, details) => rollBack(win, `renderer gone: ${details.reason}`))
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    // -3 (ERR_ABORTED) is a navigation replaced by another one, not a failure.
    if (isMainFrame && code !== -3) rollBack(win, `load failed ${code} ${desc} ${url}`)
  })
}
