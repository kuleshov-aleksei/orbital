import { Track } from "livekit-client"
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client"
import { loadSpeex, SpeexWorkletNode } from "@sapphi-red/web-noise-suppressor"
import type { NoiseSuppressionAlgorithm } from "@/types/audio"
import { debugError, debugLog } from "@/utils/debug"

import speexWasmPath from "@sapphi-red/web-noise-suppressor/speex.wasm?url"
import speexWorkletPath from "@sapphi-red/web-noise-suppressor/speexWorklet.js?url"

const wasmPath = speexWasmPath as string
const workletPath = speexWorkletPath as string

const workletLoadPromises = new Map<AudioContext, Promise<void>>()
const wasmLoadPromises = new Map<string, Promise<ArrayBuffer>>()
let wasmBinary: ArrayBuffer | null = null

async function ensureWorkletLoaded(audioContext: AudioContext): Promise<void> {
  const existing = workletLoadPromises.get(audioContext)
  if (existing) return existing

  debugLog("[Speex][INFO]: Loading worklet module...")
  const promise = audioContext.audioWorklet.addModule(workletPath).then(() => {
    debugLog("[Speex][INFO]: Worklet module registered")
  })

  // Evict the cached promise on failure so a later retry can load the module
  // again. Without this, a single failed load permanently breaks every
  // subsequent processor init for the rest of the session.
  promise.catch(() => {
    workletLoadPromises.delete(audioContext)
  })

  workletLoadPromises.set(audioContext, promise)
  return promise
}

async function ensureWasmLoaded(): Promise<ArrayBuffer> {
  if (wasmBinary) return wasmBinary

  const cacheKey = wasmPath
  const existing = wasmLoadPromises.get(cacheKey)
  if (existing) return existing

  debugLog("[Speex][INFO]: Loading WASM module...")
  const promise = loadSpeex(
    {
      url: wasmPath,
    },
    { credentials: "same-origin" },
  ).then((binary) => {
    wasmBinary = binary
    debugLog(`[Speex][INFO]: WASM module loaded (${binary.byteLength} bytes)`)
    return binary
  })

  // Same as the worklet cache above: evict on failure so retries are possible.
  promise.catch(() => {
    wasmLoadPromises.delete(cacheKey)
  })

  wasmLoadPromises.set(cacheKey, promise)
  return promise
}

export class SpeexProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "speex" as NoiseSuppressionAlgorithm
  processedTrack?: MediaStreamTrack

  private source?: MediaStreamAudioSourceNode
  private workletNode?: SpeexWorkletNode
  private destination?: MediaStreamAudioDestinationNode

  static isSupported(): boolean {
    return typeof WebAssembly === "object" && typeof AudioWorkletNode !== "undefined"
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track, audioContext } = opts

    debugLog("[Speex][INFO]: Initializing Speex processor")

    try {
      await ensureWorkletLoaded(audioContext)
      const wasmBinary = await ensureWasmLoaded()

      debugLog(`[Speex][INFO]: Creating mono processor`)

      // Same as RNNoise: the worklet only fills `maxChannels` output channels,
      // so a stereo capture would come out with a silent right channel. Pin the
      // graph to mono instead of trusting getSettings().channelCount.
      this.source = audioContext.createMediaStreamSource(new MediaStream([track]))

      this.workletNode = new SpeexWorkletNode(audioContext, {
        wasmBinary: wasmBinary,
        maxChannels: 1,
      })
      this.workletNode.channelCount = 1
      this.workletNode.channelCountMode = "explicit"
      this.workletNode.channelInterpretation = "speakers"

      this.destination = audioContext.createMediaStreamDestination()
      this.destination.channelCount = 1
      this.destination.channelCountMode = "explicit"
      this.destination.channelInterpretation = "speakers"

      this.source.connect(this.workletNode)
      this.workletNode.connect(this.destination)

      const processedTrack = this.destination.stream.getAudioTracks()[0]

      this.processedTrack = processedTrack

      debugLog(
        `[Speex][INFO]: Speex processor initialized successfully (capture ${track.getSettings().channelCount ?? "?"}ch -> processed ${processedTrack?.getSettings().channelCount ?? "?"}ch)`,
      )
    } catch (error) {
      debugError("[Speex][ERROR]: Failed to initialize Speex processor", error)
      throw error
    }
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    debugLog("[Speex][INFO]: Restarting Speex processor")
    await this.destroy()
    await this.init(opts)
  }

  async destroy(): Promise<void> {
    debugLog("[Speex][INFO]: Destroying Speex processor")

    this.source?.disconnect()
    this.source = undefined

    this.workletNode?.disconnect()
    if (this.workletNode && "destroy" in this.workletNode) {
      ;(this.workletNode as unknown as { destroy: () => void }).destroy()
    }
    this.workletNode = undefined

    this.destination?.disconnect()
    this.destination = undefined

    this.processedTrack = undefined

    debugLog("[Speex][INFO]: Speex processor destroyed")
  }
}

export function createSpeexProcessor(): SpeexProcessor {
  return new SpeexProcessor()
}
