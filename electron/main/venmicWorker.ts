// Runs inside an Electron utilityProcess: owns the venmic native addon so a
// wedged PipeWire operation (vanishing nodes mid-bind) can never block the
// main process. The main process health-checks this worker with pings and
// kills + respawns it to recover from a hung PipeWire connection.

import type { LinkData } from "@vencord/venmic"

interface WorkerRequest {
  requestId: number
  cmd: string
  data?: unknown
}

// process.argv layout in a utility process: [electronBinary, modulePath, ...args]
const nodePath = process.argv[2]

if (!nodePath) {
  console.error("[VenmicWorker] no venmic addon path provided")
  process.exit(1)
}

let PatchBay: any
let patchBay: any

function reply(requestId: number, ok: boolean, data?: unknown, error?: string): void {
  process.parentPort.postMessage({ requestId, ok, data, error })
}

interface LoadResult {
  ok: boolean
  error?: string
}

// Loading only requires the native module. Constructing PatchBay spins up the
// venmic PipeWire worker thread, which can fail (or block) when PipeWire is
// unavailable - so the hasPipeWire probe must never construct it.
function loadPatchBay(): LoadResult {
  if (PatchBay) return { ok: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const venmic = require(nodePath)
    PatchBay = venmic.PatchBay
    return { ok: true }
  } catch (e) {
    console.error("[VenmicWorker] Failed to load venmic addon:", e)
    return { ok: false, error: (e as Error).message ?? String(e) }
  }
}

function ensurePatchBay(): LoadResult {
  if (patchBay) return { ok: true }
  const loaded = loadPatchBay()
  if (!loaded.ok) return loaded
  try {
    patchBay = new PatchBay()
    console.log("[VenmicWorker] PatchBay instance created")
    return { ok: true }
  } catch (e) {
    console.error("[VenmicWorker] Failed to instantiate PatchBay:", e)
    patchBay = undefined
    return { ok: false, error: (e as Error).message ?? String(e) }
  }
}

process.parentPort.on("message", (event) => {
  const { requestId, cmd, data } = event.data as WorkerRequest
  try {
    switch (cmd) {
      case "ping":
        reply(requestId, true)
        break
      case "hasPipeWire": {
        const loaded = loadPatchBay()
        if (!loaded.ok) {
          reply(requestId, false, undefined, `venmic addon failed to load: ${loaded.error}`)
          break
        }
        reply(requestId, true, PatchBay.hasPipeWire())
        break
      }
      case "list": {
        const ready = ensurePatchBay()
        if (!ready.ok) {
          reply(requestId, false, undefined, `venmic addon failed to load: ${ready.error}`)
          break
        }
        reply(requestId, true, patchBay.list((data as { props?: string[] } | undefined)?.props))
        break
      }
      case "link": {
        const ready = ensurePatchBay()
        if (!ready.ok) {
          reply(requestId, false, undefined, `venmic addon failed to load: ${ready.error}`)
          break
        }
        patchBay.link(data as LinkData)
        reply(requestId, true)
        break
      }
      case "unlink": {
        const ready = ensurePatchBay()
        if (!ready.ok) {
          reply(requestId, false, undefined, `venmic addon failed to load: ${ready.error}`)
          break
        }
        patchBay.unlink()
        reply(requestId, true)
        break
      }
      default:
        reply(requestId, false, undefined, `unknown command: ${cmd}`)
    }
  } catch (e) {
    reply(requestId, false, undefined, (e as Error).message ?? String(e))
  }
})

process.on("uncaughtException", (e) => {
  console.error("[VenmicWorker] uncaught exception:", e)
  process.exit(1)
})