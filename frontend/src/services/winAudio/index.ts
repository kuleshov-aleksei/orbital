// Windows per-app audio capture (Electron only).
// Spec: docs/specs/WINDOWS_APP_AUDIO.md
//
// The main process runs the orbital-audiocap helper and sends its s16le 48 kHz
// stereo PCM as IPC events, which the preload hands to our sink. We forward
// each chunk to an AudioWorklet (over node.port, transferring the buffer),
// which plays it into a MediaStreamAudioDestinationNode. The destination's
// track is what gets published as screen share audio. Don't route PCM through
// an Electron MessagePort: one forwarded to the page delivered nothing.
import type { WinAudioApp, WinAudioTarget } from "@/types"
import { debugLog, debugWarn } from "@/utils/debug"

import pcmPlayerWorkletUrl from "./pcmPlayer.worklet.ts?worker&url"

/** Helper exit code: the captured app quit. */
export const WIN_AUDIO_EXIT_TARGET_GONE = 3

const SAMPLE_RATE = 48000

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

export async function startWinAudioCapture(target: WinAudioTarget): Promise<WinAudioStartOutcome> {
  const api = window.electronAPI
  if (!api?.winAudioStart || !api.winAudioStop || !api.setWinAudioSink) {
    return { ok: false, unsupported: true, error: "not available" }
  }
  const winAudioStart = api.winAudioStart
  const winAudioStop = api.winAudioStop
  const setWinAudioSink = api.setWinAudioSink

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
  try {
    // resume() can stay pending without user activation; don't let it block the share.
    await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 1000))])
  } catch (e) {
    debugWarn("[WinAudio] AudioContext resume failed:", e)
  }
  debugLog("[WinAudio] AudioContext state after resume:", ctx.state)

  // Chunks arriving before the start result names our session are dropped
  // (a few ms of audio).
  let sessionId: number | null = null
  // Diagnostics: PCM messages that reached the page since the last stats line.
  let pageMessages = 0
  setWinAudioSink({
    pcm: (id, data) => {
      if (id !== sessionId) return
      pageMessages++
      // Transfer, not copy; slice first if the view doesn't own its buffer.
      const chunk =
        data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice()
      node.port.postMessage({ type: "pcm", data: chunk }, [chunk.buffer])
    },
    ended: (id, code) => {
      if (id === sessionId) node.port.postMessage({ type: "ended", code })
    },
  })
  const teardownGraph = () => {
    setWinAudioSink(null)
    node.port.postMessage({ type: "stop" })
    node.port.onmessage = null
    node.disconnect()
    destination.stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  const result = await winAudioStart(JSON.parse(JSON.stringify(target)) as WinAudioTarget)
  if (!result.ok || result.sessionId === undefined) {
    teardownGraph()
    return { ok: false, unsupported: !!result.unsupported, error: result.error ?? "start failed" }
  }
  sessionId = result.sessionId

  let endedCallback: ((code: number | null) => void) | null = null
  let ended = false
  let endedCode: number | null = null
  let stopped = false
  const track = destination.stream.getAudioTracks()[0]
  node.port.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type?: string; code?: number | null; dropped?: number }
    if (msg?.type === "stats") {
      // Diagnostics: shows whether PCM reaches the worklet and leaves it non-silent.
      debugLog("[WinAudio] worklet stats:", {
        ...(event.data as object),
        pageMessages,
        ctxState: ctx.state,
        trackState: track?.readyState,
        trackMuted: track?.muted,
        trackEnabled: track?.enabled,
      })
      pageMessages = 0
      return
    }
    if (msg?.type !== "ended" || ended) return
    ended = true
    endedCode = msg.code ?? null
    debugLog("[WinAudio] capture ended, code:", msg.code, "dropped frames:", msg.dropped)
    if (!stopped) endedCallback?.(msg.code ?? null)
  }

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
