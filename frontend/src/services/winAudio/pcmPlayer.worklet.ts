// AudioWorklet that plays the PCM stream from the Windows audio helper.
// Loaded via `?worker&url` (see index.ts). The page forwards each PCM chunk
// over `this.port` (transferring the buffer). The Electron IPC port itself
// can't be handed over: re-transferred into this scope it receives nothing.
import { PcmRing } from "./pcmRing"

// Minimal AudioWorkletGlobalScope declarations (not part of the DOM lib).
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  ctor: new (options?: unknown) => AudioWorkletProcessor,
): void

const CAPACITY_MS = 150
const PREBUFFER_MS = 30
/** How often the processor reports diagnostics to the page. */
const STATS_INTERVAL_S = 2

class PcmPlayerProcessor extends AudioWorkletProcessor {
  private ring = new PcmRing(
    Math.round((sampleRate * CAPACITY_MS) / 1000),
    Math.round((sampleRate * PREBUFFER_MS) / 1000),
  )
  private alive = true
  // Diagnostics since the last report.
  private messages = 0
  private peak = 0
  private framesSinceStats = 0

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent) => {
      const msg = event.data as { type: string; data?: Uint8Array; code?: number | null }
      if (msg.type === "pcm" && msg.data) {
        this.messages++
        this.ring.push(msg.data)
      } else if (msg.type === "ended") {
        this.port.postMessage({ type: "ended", code: msg.code ?? null, dropped: this.ring.dropped })
      } else if (msg.type === "stop") {
        this.alive = false
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (out && out.length >= 2) {
      this.ring.pull(out[0], out[1])
      this.trackPeak(out[0])
      this.trackPeak(out[1])
    } else if (out && out.length === 1) {
      const scratch = new Float32Array(out[0].length)
      this.ring.pull(out[0], scratch)
      this.trackPeak(out[0])
    }
    this.framesSinceStats += out?.[0]?.length ?? 128
    if (this.framesSinceStats >= sampleRate * STATS_INTERVAL_S) this.reportStats()
    return this.alive
  }

  private trackPeak(channel: Float32Array): void {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i])
      if (v > this.peak) this.peak = v
    }
  }

  private reportStats(): void {
    this.port.postMessage({
      type: "stats",
      messages: this.messages,
      pushedFrames: this.ring.pushedFrames,
      buffered: this.ring.buffered,
      underruns: this.ring.underruns,
      dropped: this.ring.dropped,
      peak: Math.round(this.peak * 1000) / 1000,
    })
    this.messages = 0
    this.peak = 0
    this.framesSinceStats = 0
  }
}

registerProcessor("orbital-pcm-player", PcmPlayerProcessor)
