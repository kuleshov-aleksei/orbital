// Windows per-app audio capture (Electron only).
// Spec: docs/specs/WINDOWS_APP_AUDIO.md
//
// The main process runs the orbital-audiocap helper and sends us a MessagePort
// carrying s16le 48 kHz stereo PCM. We hand that port straight to an
// AudioWorklet, which plays it into a MediaStreamAudioDestinationNode. The
// destination's track is what gets published as screen share audio.
import type { WinAudioApp, WinAudioTarget } from "@/types"
import { debugLog, debugWarn } from "@/utils/debug"

import pcmPlayerWorkletUrl from "./pcmPlayer.worklet.ts?worker&url"

/** Helper exit code: the captured app quit. */
export const WIN_AUDIO_EXIT_TARGET_GONE = 3

const SAMPLE_RATE = 48000
const PORT_WAIT_MS = 3000
const PORT_MESSAGE_TYPE = "orbital:win-audio-port"

export interface WinAudioCapture {
  track: MediaStreamTrack
  /** Called once when the helper stops on its own (app quit, error). */
  onEnded: (callback: (code: number | null) => void) => void
  stop: () => Promise<void>
}

export type WinAudioStartOutcome =
  { ok: true; capture: WinAudioCapture } | { ok: false; unsupported: boolean; error: string }

let probeResult: Promise<boolean> | null = null

/** Whether per-app capture works on this machine (cached for the session). */
export function isWinAudioSupported(): Promise<boolean> {
  if (!window.electronAPI?.winAudioProbe) return Promise.resolve(false)
  if (!probeResult) {
    probeResult = window.electronAPI
      .winAudioProbe()
      .then((r) => {
        debugLog("[WinAudio] probe:", r)
        return r.supported
      })
      .catch((e: unknown) => {
        debugWarn("[WinAudio] probe failed:", e)
        return false
      })
  }
  return probeResult
}

export async function listWinAudioApps(): Promise<WinAudioApp[]> {
  if (!window.electronAPI?.winAudioList) return []
  try {
    return await window.electronAPI.winAudioList()
  } catch (e) {
    debugWarn("[WinAudio] list failed:", e)
    return []
  }
}

/** The process that owns a `window:<hwnd>:<n>` desktop source, if any. */
export async function pidOfWindowSource(sourceId: string): Promise<number | null> {
  if (!sourceId.startsWith("window:") || !window.electronAPI?.winAudioPidOfSource) return null
  try {
    return await window.electronAPI.winAudioPidOfSource(sourceId)
  } catch {
    return null
  }
}

/** Resolves with the PCM port the preload forwards for `sessionId`. */
function createPortWaiter() {
  const ports = new Map<number, MessagePort>()
  let waiting: { sessionId: number; resolve: (port: MessagePort | null) => void } | null = null

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data as { type?: string; sessionId?: number } | null
    if (data?.type !== PORT_MESSAGE_TYPE || typeof data.sessionId !== "number") return
    const port = event.ports[0]
    if (!port) return
    if (waiting?.sessionId === data.sessionId) {
      waiting.resolve(port)
      waiting = null
    } else {
      ports.set(data.sessionId, port)
    }
  }
  window.addEventListener("message", onMessage)

  return {
    wait(sessionId: number): Promise<MessagePort | null> {
      const ready = ports.get(sessionId)
      if (ready) return Promise.resolve(ready)
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting = null
          resolve(null)
        }, PORT_WAIT_MS)
        waiting = {
          sessionId,
          resolve: (port) => {
            clearTimeout(timer)
            resolve(port)
          },
        }
      })
    },
    dispose() {
      window.removeEventListener("message", onMessage)
      for (const port of ports.values()) port.close()
      ports.clear()
    },
  }
}

export async function startWinAudioCapture(target: WinAudioTarget): Promise<WinAudioStartOutcome> {
  const api = window.electronAPI
  if (!api?.winAudioStart || !api.winAudioStop) {
    return { ok: false, unsupported: true, error: "not available" }
  }
  const winAudioStart = api.winAudioStart
  const winAudioStop = api.winAudioStop

  // Build the audio graph first, so PCM has somewhere to go the moment the
  // helper starts.
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" })
  let node: AudioWorkletNode
  try {
    await ctx.audioWorklet.addModule(pcmPlayerWorkletUrl)
    node = new AudioWorkletNode(ctx, "orbital-pcm-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
  } catch (e) {
    void ctx.close()
    return { ok: false, unsupported: true, error: `worklet: ${(e as Error).message}` }
  }
  const destination = ctx.createMediaStreamDestination()
  node.connect(destination)
  void ctx.resume()

  const portWaiter = createPortWaiter()
  const teardownGraph = () => {
    node.port.postMessage({ type: "stop" })
    node.port.onmessage = null
    node.disconnect()
    destination.stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  const result = await winAudioStart(JSON.parse(JSON.stringify(target)) as WinAudioTarget)
  if (!result.ok || result.sessionId === undefined) {
    portWaiter.dispose()
    teardownGraph()
    return { ok: false, unsupported: !!result.unsupported, error: result.error ?? "start failed" }
  }

  const port = await portWaiter.wait(result.sessionId)
  portWaiter.dispose()
  if (!port) {
    teardownGraph()
    await winAudioStop()
    return { ok: false, unsupported: false, error: "audio port not received" }
  }
  node.port.postMessage({ type: "source", port }, [port])

  let endedCallback: ((code: number | null) => void) | null = null
  let ended = false
  let endedCode: number | null = null
  let stopped = false
  node.port.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type?: string; code?: number | null; dropped?: number }
    if (msg?.type !== "ended" || ended) return
    ended = true
    endedCode = msg.code ?? null
    debugLog("[WinAudio] capture ended, code:", msg.code, "dropped frames:", msg.dropped)
    if (!stopped) endedCallback?.(msg.code ?? null)
  }

  const track = destination.stream.getAudioTracks()[0]
  debugLog("[WinAudio] capture started:", target)

  return {
    ok: true,
    capture: {
      track,
      onEnded: (callback) => {
        endedCallback = callback
        // The helper may have quit before anyone subscribed.
        if (ended && !stopped) callback(endedCode)
      },
      stop: async () => {
        if (stopped) return
        stopped = true
        teardownGraph()
        try {
          await winAudioStop()
        } catch (e) {
          debugWarn("[WinAudio] stop failed:", e)
        }
      },
    },
  }
}
