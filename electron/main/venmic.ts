// @ts-nocheck
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { app, utilityProcess, type UtilityProcess } from "electron";
import log from "electron-log"
import type { LinkData, Node } from "@vencord/venmic";

export interface VenmicSource {
  "application.process.id"?: string
  "application.name"?: string
}

const getModuleUrl = (): string => {
  if (typeof import.meta !== "undefined" && import.meta.url && import.meta.url !== "undefined") {
    return import.meta.url
  }
  return `file://${join(app.getAppPath(), "dist-electron/main/index.js")}`
}

const moduleUrl = getModuleUrl()
const __dirname = dirname(fileURLToPath(moduleUrl))

const APP_ROOT = app.isPackaged ? app.getAppPath() : join(__dirname, "..", "..")
let DIST_DIR: string;

if (app.isPackaged) {
  const unpackedPath = join(app.getAppPath(), "..", "app.asar.unpacked", "dist");
  DIST_DIR = unpackedPath;
} else {
  DIST_DIR = join(APP_ROOT, "dist");
}

const WORKER_ENTRY = join(__dirname, "venmicWorker.js")

const REQUEST_TIMEOUT_MS: Record<string, number> = {
  ping: 3000,
  hasPipeWire: 5000,
  list: 10000,
  link: 20000,
  unlink: 5000,
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: UtilityProcess | null = null
let pendingRequests = new Map<number, PendingRequest>()
let requestSeq = 0
let respawnTimer: ReturnType<typeof setTimeout> | null = null
let respawnDelayMs = 1000

function nodeModulePath(): string {
  return join(DIST_DIR, `venmic-${process.arch}.node`)
}

// The venmic addon's list() blocks the calling thread until the PipeWire
// worker replies. A vanished node can wedge that worker forever, so all
// addon calls happen in a utilityProcess: a hang blocks only the worker, and
// the main process recovers by killing and respawning it.
function startWorker(): void {
  if (worker) return
  if (process.platform !== "linux") return
  if (!existsSync(WORKER_ENTRY)) {
    log.error("[Venmic] Worker entry missing:", WORKER_ENTRY)
    return
  }
  try {
    worker = utilityProcess.fork(WORKER_ENTRY, [nodeModulePath()], { serviceName: "venmic" })
  } catch (e) {
    log.error("[Venmic] Failed to fork worker:", e)
    worker = null
    return
  }
  worker.on("message", (msg) => {
    const { requestId, ok, data, error } = msg ?? {}
    const pending = pendingRequests.get(requestId)
    if (!pending) return
    pendingRequests.delete(requestId)
    clearTimeout(pending.timer)
    if (ok) pending.resolve(data)
    else pending.reject(new Error(error || "venmic worker error"))
  })
  worker.on("exit", (code) => {
    log.warn("[Venmic] Worker exited with code", code)
    worker = null
    for (const [, pending] of pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error("venmic worker exited"))
    }
    pendingRequests.clear()
    if (isCapturing) scheduleRecovery()
  })
}

function killWorker(): void {
  if (worker) {
    worker.kill()
    worker = null
  }
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error("venmic worker terminated"))
  }
  pendingRequests.clear()
}

function scheduleRecovery(): void {
  if (respawnTimer !== null) return
  respawnTimer = setTimeout(() => {
    respawnTimer = null
    if (process.platform !== "linux") return
    startWorker()
    if (!worker) return
    request("ping", undefined, REQUEST_TIMEOUT_MS.ping)
      .then(async () => {
        respawnDelayMs = 1000
        log.info("[Venmic] Worker recovered")
        if (isCapturing && captureCriteria.length > 0) {
          log.info("[Venmic] Re-linking after worker recovery")
          try {
            await doLink(linkDataFor(captureCriteria))
          } catch (e) {
            log.warn("[Venmic] Re-link after recovery failed:", e)
          }
        }
      })
      .catch((e) => {
        log.warn("[Venmic] Worker recovery failed, retrying in", respawnDelayMs, "ms:", e)
        respawnDelayMs = Math.min(respawnDelayMs * 2, 30000)
        scheduleRecovery()
      })
  }, respawnDelayMs)
}

function request<T = unknown>(cmd: string, data?: unknown, timeoutMs?: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!worker) {
      reject(new Error("venmic worker not running"))
      return
    }
    const requestId = ++requestSeq
    const timeout = timeoutMs ?? REQUEST_TIMEOUT_MS[cmd] ?? 10000
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      log.warn(`[Venmic] Request "${cmd}" timed out after ${timeout}ms - killing worker`)
      killWorker()
      if (isCapturing) scheduleRecovery()
      reject(new Error(`venmic request "${cmd}" timed out`))
    }, timeout)
    pendingRequests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer })
    try {
      worker.postMessage({ requestId, cmd, data })
    } catch (e) {
      clearTimeout(timer)
      pendingRequests.delete(requestId)
      reject(e)
    }
  })
}

async function ensureWorker(): Promise<boolean> {
  if (process.platform !== "linux") return false
  if (worker) {
    try {
      await request("ping", undefined, REQUEST_TIMEOUT_MS.ping)
      return true
    } catch {
      return false
    }
  }
  startWorker()
  if (!worker) return false
  try {
    await request("ping", undefined, REQUEST_TIMEOUT_MS.ping)
    return true
  } catch (e) {
    log.error("[Venmic] Worker failed to start:", e)
    return false
  }
}

export async function hasVenmic(): Promise<boolean> {
  return ensureWorker()
}

export async function hasPipeWire(): Promise<boolean> {
  if (!(await ensureWorker())) {
    log.warn("[Venmic] hasPipeWire: venmic worker unavailable")
    return false
  }
  try {
    const ok = (await request<boolean>("hasPipeWire", undefined, REQUEST_TIMEOUT_MS.hasPipeWire)) ?? false
    if (!ok) log.warn("[Venmic] hasPipeWire: venmic reports PipeWire is not the active audio server")
    return ok
  } catch (e) {
    log.warn("[Venmic] hasPipeWire failed, retrying once with a fresh worker:", e)
    if (!worker) return false
    killWorker()
    startWorker()
    if (!worker) return false
    try {
      return (await request<boolean>("hasPipeWire", undefined, REQUEST_TIMEOUT_MS.hasPipeWire)) ?? false
    } catch (e2) {
      log.error("[Venmic] hasPipeWire retry failed:", e2)
      return false
    }
  }
}

export async function listAudioSources(props?: string[]): Promise<Node[]> {
  if (!(await ensureWorker())) return []
  try {
    const result = await request<Node[] | null>("list", { props }, REQUEST_TIMEOUT_MS.list)
    const nodes = result ?? []
    log.info("[Venmic] Listed", nodes.length, "sources")
    return nodes
  } catch (e) {
    log.warn("[Venmic] listAudioSources failed:", e)
    return []
  }
}

export interface VenmicApp {
  pid?: string
  name: string
  hasAudio: boolean
}

const WATCHDOG_SCAN_MS = 12000
const RELINK_MIN_GAP_MS = 10000
const RELINK_STABILITY_MS = 4000

const GENERIC_COMMS = new Set(["wine", "wine64", "wine64-preloader", "wineserver", "python", "python3"])

let captureCriteria: VenmicSource[] = []

// Selected audio sources live in session memory only. Pids and process names
// are ephemeral, so they are never written to persistent config.
let savedSources: VenmicSource[] = []

export function getSavedVenmicSources(): VenmicSource[] {
  return savedSources
}

export function setSavedVenmicSources(sources: VenmicSource[]): void {
  savedSources = sources ?? []
}
let seenSerials = new Set<string>()
let pendingSerials = new Set<string>()
let watchdogTimer: ReturnType<typeof setInterval> | null = null
let relinkTimer: ReturnType<typeof setTimeout> | null = null
let lastLinkAt = 0
let isCapturing = false

// venmic matches a node when ALL props of ANY include target match the node.
// Full node snapshots carry volatile props (object.serial, node.name, ...), so
// new nodes created by the same app (games toggling outputs) would never match.
// Use stable identifiers instead: pid+name, plus name and pid fallbacks.
function buildIncludeCriteria(sources: VenmicSource[]): Node[] {
  const targets: Node[] = []
  const seen = new Set<string>()
  const push = (target: Node) => {
    const key = JSON.stringify(target)
    if (!seen.has(key)) {
      seen.add(key)
      targets.push(target)
    }
  }
  for (const source of sources) {
    const pid = source["application.process.id"]
    const name = source["application.name"]
    if (pid && name) push({ "application.process.id": pid, "application.name": name })
    if (name) push({ "application.name": name })
    if (pid) push({ "application.process.id": pid })
  }
  return targets
}

function matchesCriteria(node: Node, criteria: VenmicSource[]): boolean {
  return criteria.some((target) =>
    Object.entries(target).every(([key, value]) => node[key] === value),
  )
}

function linkDataFor(criteria: VenmicSource[]): LinkData {
  return {
    include: buildIncludeCriteria(criteria),
    exclude: [{ "media.class": "Stream/Input/Audio" }],
    ignore_devices: true,
    only_speakers: true,
    only_default_speakers: false,
  }
}

async function doLink(linkData: LinkData): Promise<void> {
  if (!worker) throw new Error("venmic worker not running")
  await request("link", linkData, REQUEST_TIMEOUT_MS.link)
  await refreshSeenSerials()
}

async function refreshSeenSerials(): Promise<void> {
  if (!worker) return
  try {
    const all = (await request<Node[] | null>("list", undefined, REQUEST_TIMEOUT_MS.list)) ?? []
    seenSerials = new Set(
      all.filter((n) => matchesCriteria(n, captureCriteria)).map((n) => n["object.serial"]),
    )
    pendingSerials.clear()
    log.info("[Venmic] Watchdog tracking", seenSerials.size, "matching node(s)")
  } catch (e) {
    log.warn("[Venmic] refreshSeenSerials failed:", e)
  }
}

// venmic's registry worker auto-links new matching nodes event-driven, so this
// watchdog is only a backstop. link() tears down and rebuilds every loopback,
// which is expensive and risky during node churn (a minimized game toggling
// outputs), so re-links are debounced: wait for a stability window and keep a
// minimum gap between rebuilds. New serials seen during the wait coalesce.
function armRelink(): void {
  if (relinkTimer !== null) return
  const wait = Math.max(RELINK_STABILITY_MS, lastLinkAt + RELINK_MIN_GAP_MS - Date.now())
  relinkTimer = setTimeout(() => {
    relinkTimer = null
    if (!isCapturing || pendingSerials.size === 0) return
    log.info("[Venmic] Re-linking", pendingSerials.size, "new matching node(s)")
    lastLinkAt = Date.now()
    doLink(linkDataFor(captureCriteria)).catch((e) => log.warn("[Venmic] Re-link failed:", e))
  }, wait)
}

function startWatchdog(): void {
  stopWatchdog()
  watchdogTimer = setInterval(() => {
    if (!isCapturing || captureCriteria.length === 0) return
    request<Node[] | null>("list", undefined, REQUEST_TIMEOUT_MS.list)
      .then((all) => {
        if (!isCapturing) return
        for (const node of all ?? []) {
          if (!matchesCriteria(node, captureCriteria)) continue
          const serial = node["object.serial"]
          if (!serial || seenSerials.has(serial)) continue
          seenSerials.add(serial)
          pendingSerials.add(serial)
        }
        if (pendingSerials.size > 0) armRelink()
      })
      .catch(() => {
        // worker is down or recovering; the recovery path re-links on its own
      })
  }, WATCHDOG_SCAN_MS)
}

function stopWatchdog(): void {
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  if (relinkTimer !== null) {
    clearTimeout(relinkTimer)
    relinkTimer = null
  }
}

function readProc(pid: string, file: string): string {
  try {
    return readFileSync(`/proc/${pid}/${file}`, "utf-8")
  } catch {
    return ""
  }
}

// /proc/<pid>/stat: "pid (comm) state ppid ..." - comm may contain spaces/parens
function isUnlistableProcess(pid: string): boolean {
  const stat = readProc(pid, "stat")
  if (!stat) return true
  const parts = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)
  if (parts[0] === "Z") return true
  return Number(parts[1]) === 2 // child of kthreadd => kernel thread
}

function processName(pid: string): string {
  const comm = readProc(pid, "comm").trim()
  if (!comm) return pid
  const cmdline = readProc(pid, "cmdline").split("\0").filter(Boolean)
  const binary = cmdline[0]
  if (binary) {
    const base = basename(binary).trim()
    if (base && (GENERIC_COMMS.has(comm) || base !== comm)) return base
  }
  return comm
}

function isVenmicOwned(node: Node): boolean {
  const description = node["node.description"] || ""
  const name = node["node.name"] || ""
  return description.startsWith("venmic-loopback") || name.startsWith("vencord-")
}

// Processes that will never be audio capture sources. Kernel truncates comm to
// 15 chars, so keep entries short. Applies to /proc entries only - venmic
// nodes are audio sources by definition and always shown. wine* is
// intentionally NOT blocked: it hosts audio for Proton games.
const BLOCKED_COMMS = new Set([
  // init & system services
  "systemd", "dbus-daemon", "dbus-broker", "dbus-launch",
  // audio infrastructure (services, never capture sources)
  "pipewire", "pipewire-pulse", "wireplumber", "pulseaudio", "rtkit", "alsactl",
  // desktop environments & compositors
  "kwin_wayland", "gnome-shell", "plasmashell", "sway", "hyprland", "xfwm4",
  "gdm", "gdm-session-worker", "lightdm", "sddm",
  // terminals & shells
  "bash", "zsh", "fish", "dash", "sh", "tmux", "screen", "konsole",
  "gnome-terminal", "kitty",
  // CLI / dev tools
  "git", "ssh", "ssh-agent", "gpg", "gpg-agent", "curl", "wget", "make",
  "cmake", "ninja", "gcc", "cc", "clang", "cargo", "rustc", "vim", "nvim",
  "emacs", "less", "grep", "sed", "awk",
  // editor/IDE helper daemons (never audio sources)
  "gitstatusd", "gopls", "forkserver", "ksmserver",
])

// Prefixes match kernel-truncated comms (15 chars) and versioned daemon names.
// Matching is case-insensitive.
const BLOCKED_PREFIXES = [
  "systemd-", "dbus-", "gvfs-", "xdg-",
  // KDE / GTK session infrastructure
  "kded", "kwin", "kaccess", "kactivity", "ksecret", "kwallet", "kdeconnect",
  "baloo", "at-spi", "startplasma", "org_kde", "polkit-kde", "msm_kde",
  "xembedsniproxy", "gmenudbusmenupr", "xsettingsd", "spectacle", "dconf",
  "krunner", "kglobalaccel", "pamac-tray", "fossilize",
  // dev tools / editors / runtimes / known non-audio apps
  "code", "python", "steamwebhelper", "node", "limux", "vicinae",
]

function isBlockedProcess(comm: string): boolean {
  if (!comm) return false
  if (BLOCKED_COMMS.has(comm)) return true
  const lower = comm.toLowerCase()
  return BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

function isOwnedByUser(pid: string): boolean {
  try {
    return statSync(`/proc/${pid}`).uid === process.getuid()
  } catch {
    return false
  }
}

// Apps with active audio outputs come from venmic; everything else comes from
// /proc so users can pick apps with no current output (e.g. minimized games).
// System processes are filtered out unless includeAll is set. Sorted by pid
// descending so new processes land on top.
export async function listApps(includeAll = false): Promise<VenmicApp[]> {
  const apps = new Map<string, VenmicApp>()

  for (const node of await listAudioSources()) {
    if (isVenmicOwned(node)) continue
    const pid = node["application.process.id"]
    const name = node["application.name"] || node["node.name"] || "Unknown"
    const key = pid || name
    if (!key || apps.has(key)) continue
    apps.set(key, { pid: pid || undefined, name, hasAudio: true })
  }

  const ownPids = new Set(app.getAppMetrics().map((p) => String(p.pid)))

  let entries: string[] = []
  try {
    entries = readdirSync("/proc")
  } catch (e) {
    log.warn("[Venmic] Failed to read /proc:", e)
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    if (ownPids.has(entry) || apps.has(entry)) continue
    if (isUnlistableProcess(entry)) continue
    if (!isOwnedByUser(entry)) continue
    if (!includeAll && isBlockedProcess(readProc(entry, "comm").trim())) continue
    apps.set(entry, { pid: entry, name: processName(entry), hasAudio: false })
  }

  return Array.from(apps.values()).sort((a, b) => Number(b.pid ?? -1) - Number(a.pid ?? -1))
}

export async function startAudioCapture(include: VenmicSource[]): Promise<boolean> {
  if (!(await ensureWorker())) {
    log.error("[Venmic] Cannot start capture - venmic worker unavailable");
    return false;
  }

  const criteria = (include ?? []).filter(
    (s) => s["application.process.id"] || s["application.name"],
  )
  if (criteria.length === 0) {
    log.error("[Venmic] No sources provided to capture");
    return false;
  }

  captureCriteria = criteria
  isCapturing = true
  pendingSerials.clear()

  const linkData = linkDataFor(criteria)
  log.info("[Venmic] Linking with criteria:", buildIncludeCriteria(criteria));
  try {
    await request("link", linkData, REQUEST_TIMEOUT_MS.link);
  } catch (e) {
    log.error("[Venmic] Link failed:", e);
    isCapturing = false;
    return false;
  }

  setSavedVenmicSources(criteria);
  await refreshSeenSerials();
  startWatchdog();

  return true;
}

export async function stopAudioCapture(): Promise<boolean> {
  const wasCapturing = isCapturing
  isCapturing = false
  stopWatchdog()
  seenSerials.clear()
  pendingSerials.clear()
  captureCriteria = []
  if (!worker) return false
  try {
    await request("unlink", undefined, REQUEST_TIMEOUT_MS.unlink)
    if (wasCapturing) log.info("[Venmic] Audio capture stopped")
    return true
  } catch (e) {
    log.warn("[Venmic] Unlink failed:", e)
    return false
  }
}