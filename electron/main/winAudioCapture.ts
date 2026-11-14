// Windows per-app audio capture through the orbital-audiocap helper exe
// (native/win-audiocap). Spec: docs/specs/WINDOWS_APP_AUDIO.md
//
// The helper is a child process, not an addon: a hang or crash in COM/audio
// code never touches the main process, and the binary has no Node ABI.
// PCM goes helper stdout → main → MessagePort → renderer AudioWorklet.
import { app, MessageChannelMain, type MessagePortMain, type WebContents } from "electron"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import log from "electron-log"
import { APP_ROOT } from "./paths"

const EXE_NAME = "orbital-audiocap.exe"
const QUERY_TIMEOUT_MS = 5000
const START_TIMEOUT_MS = 6000
const STOP_GRACE_MS = 1000
const BYTES_PER_FRAME = 4 // s16le stereo

export const EXIT_UNSUPPORTED = 2
export const EXIT_TARGET_GONE = 3

export interface WinAudioProbe {
  supported: boolean
  build?: number
}

export interface WinAudioApp {
  pid: number
  name: string
  exe: string
  active: boolean
}

export type WinAudioTarget = { mode: "include"; pid: number } | { mode: "exclude-self" }

export interface WinAudioStartResult {
  ok: boolean
  sessionId?: number
  /** True when the helper is missing or process loopback is unavailable: use the loopback fallback. */
  unsupported?: boolean
  error?: string
}

interface Session {
  id: number
  child: ChildProcess
  port: MessagePortMain
  killTimer: ReturnType<typeof setTimeout> | null
}

let current: Session | null = null
let sessionSeq = 0
let probeCache: WinAudioProbe | null = null

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, EXE_NAME)
    : path.join(APP_ROOT, "..", "native", "win-audiocap", EXE_NAME)
}

function helperAvailable(): boolean {
  if (process.platform !== "win32") return false
  const exe = helperPath()
  if (!existsSync(exe)) {
    log.warn("[WinAudio] Helper not found:", exe)
    return false
  }
  return true
}

function runQuery<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      helperPath(),
      args,
      { timeout: QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (stderr) log.info(`[WinAudio] ${args[0]} stderr:`, stderr.trim())
        const line = stdout.trim().split(/\r?\n/).pop() ?? ""
        if (line) {
          try {
            resolve(JSON.parse(line) as T)
            return
          } catch {
            // fall through to the error below
          }
        }
        reject(error ?? new Error(`orbital-audiocap ${args[0]}: no output`))
      },
    )
  })
}

export async function probe(): Promise<WinAudioProbe> {
  if (probeCache) return probeCache
  if (!helperAvailable()) return { supported: false }
  try {
    // probe exits with code 2 when unsupported but still prints its JSON.
    probeCache = await runQuery<WinAudioProbe>(["probe"])
  } catch (e) {
    log.warn("[WinAudio] Probe failed:", e)
    probeCache = { supported: false }
  }
  log.info("[WinAudio] Probe:", probeCache)
  return probeCache
}

export async function listApps(): Promise<WinAudioApp[]> {
  if (!helperAvailable()) return []
  try {
    // Hide Orbital itself: its call audio is never a useful share target.
    return await runQuery<WinAudioApp[]>(["list", "--skip-tree", String(process.pid)])
  } catch (e) {
    log.warn("[WinAudio] List failed:", e)
    return []
  }
}

/** Process that owns a desktopCapturer window source (`window:<hwnd>:<n>`). */
export async function pidOfSource(sourceId: string): Promise<number | null> {
  const match = /^window:(\d+):/.exec(sourceId)
  if (!match || !helperAvailable()) return null
  try {
    const result = await runQuery<{ pid: number }>(["pid-of-hwnd", match[1]])
    return result.pid > 0 ? result.pid : null
  } catch (e) {
    log.warn("[WinAudio] pid-of-hwnd failed:", e)
    return null
  }
}

export async function startCapture(
  target: WinAudioTarget,
  webContents: WebContents,
): Promise<WinAudioStartResult> {
  stopCapture()
  if (!helperAvailable()) return { ok: false, unsupported: true, error: "helper missing" }

  const args =
    target.mode === "include"
      ? ["capture", "--include", String(target.pid)]
      : ["capture", "--exclude", String(process.pid)]
  if (target.mode === "include" && !(Number.isInteger(target.pid) && target.pid > 0)) {
    return { ok: false, error: "invalid pid" }
  }

  let child: ChildProcess
  try {
    child = spawn(helperPath(), args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  } catch (e) {
    log.error("[WinAudio] Spawn failed:", e)
    return { ok: false, unsupported: true, error: (e as Error).message }
  }

  const { port1, port2 } = new MessageChannelMain()
  const session: Session = { id: ++sessionSeq, child, port: port2, killTimer: null }
  current = session
  log.info(`[WinAudio] Capture #${session.id} started:`, args.join(" "))

  // The renderer's preload forwards port1 to the page (contextBridge cannot
  // carry ports). Messages posted before the page listens are queued.
  webContents.postMessage("win-audio:port", { sessionId: session.id }, [port1])
  port2.start()

  // Pipe chunks may split a frame; carry the remainder so every message holds
  // whole frames.
  let carry: Buffer | null = null
  child.stdout?.on("data", (chunk: Buffer) => {
    const data = carry ? Buffer.concat([carry, chunk]) : chunk
    const whole = data.length - (data.length % BYTES_PER_FRAME)
    carry = whole < data.length ? Buffer.from(data.subarray(whole)) : null
    if (whole > 0) {
      // Copy into a standalone buffer: a pooled Buffer view would serialize
      // its whole backing store.
      port2.postMessage({ type: "pcm", data: new Uint8Array(data.subarray(0, whole)) })
    }
  })

  return await new Promise<WinAudioStartResult>((resolve) => {
    let settled = false
    let lastError = ""
    const settle = (result: WinAudioStartResult) => {
      if (settled) return
      settled = true
      clearTimeout(startTimer)
      resolve(result)
    }
    const startTimer = setTimeout(() => {
      log.warn(`[WinAudio] Capture #${session.id} did not start in time`)
      stopSession(session)
      settle({ ok: false, error: "helper start timed out" })
    }, START_TIMEOUT_MS)

    let stderrBuf = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8")
      let nl: number
      while ((nl = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, nl).trim()
        stderrBuf = stderrBuf.slice(nl + 1)
        if (!line) continue
        log.info(`[WinAudio] #${session.id}:`, line)
        try {
          const msg = JSON.parse(line) as { event?: string; error?: string }
          if (msg.event === "started") settle({ ok: true, sessionId: session.id })
          if (msg.error) lastError = msg.error
        } catch {
          // plain log line
        }
      }
    })

    child.on("error", (e) => {
      log.error(`[WinAudio] Capture #${session.id} process error:`, e)
      lastError = e.message
    })

    child.on("exit", (code) => {
      log.info(`[WinAudio] Capture #${session.id} exited with code`, code)
      if (session.killTimer) clearTimeout(session.killTimer)
      try {
        port2.postMessage({ type: "ended", code })
      } catch {
        // port already closed
      }
      port2.close()
      if (current === session) current = null
      settle({
        ok: false,
        unsupported: code === EXIT_UNSUPPORTED,
        error: lastError || `helper exited with code ${code}`,
      })
    })
  })
}

function stopSession(session: Session): void {
  const { child } = session
  if (child.exitCode !== null || child.signalCode !== null) return
  // Closing stdin asks the helper to stop; kill it if it doesn't.
  child.stdin?.end()
  session.killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      log.warn(`[WinAudio] Capture #${session.id} ignored stdin close, killing`)
      child.kill()
    }
  }, STOP_GRACE_MS)
}

export function stopCapture(): boolean {
  const session = current
  if (!session) return false
  current = null
  log.info(`[WinAudio] Stopping capture #${session.id}`)
  stopSession(session)
  return true
}
