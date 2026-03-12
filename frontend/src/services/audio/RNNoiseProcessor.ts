import { Track } from "livekit-client"
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client"
import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor"
import type { NoiseSuppressionAlgorithm } from "@/types/audio"
import { debugError, debugLog } from "@/utils/debug"

import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url"
import rnnoiseSimdWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url"
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url"

const wasmPath = rnnoiseWasmPath as string
const simdWasmPath = rnnoiseSimdWasmPath as string
const workletPath = rnnoiseWorkletPath as string

let workletLoaded = false
let wasmLoaded = false
let wasmBinary: ArrayBuffer | null = null

async function ensureWorkletLoaded(audioContext: AudioContext): Promise<void> {
  if (workletLoaded) return
  
  debugLog("[RNNoise][INFO]: Loading worklet module...")
  await audioContext.audioWorklet.addModule(workletPath)
  workletLoaded = true
  debugLog("[RNNoise][INFO]: Worklet module registered")
}

async function ensureWasmLoaded(): Promise<ArrayBuffer> {
  if (wasmBinary) return wasmBinary
  
  debugLog("[RNNoise][INFO]: Loading WASM module...")
  wasmBinary = await loadRnnoise(
    {
      url: wasmPath,
      simdUrl: simdWasmPath,
    },
    { credentials: "same-origin" },
  )
  wasmLoaded = true
  debugLog(`[RNNoise][INFO]: WASM module loaded (${wasmBinary.byteLength} bytes)`)
  
  return wasmBinary
}

export class RNNoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "rnnoise" as NoiseSuppressionAlgorithm
  processedTrack?: MediaStreamTrack

  private source?: MediaStreamAudioSourceNode
  private workletNode?: RnnoiseWorkletNode
  private destination?: MediaStreamAudioDestinationNode

  static isSupported(): boolean {
    return typeof WebAssembly === "object" && typeof AudioWorkletNode !== "undefined"
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track, audioContext } = opts

    debugLog("[RNNoise][INFO]: Initializing RNNoise processor")

    try {
      await ensureWorkletLoaded(audioContext)
      const wasmBinary = await ensureWasmLoaded()

      const trackSettings = track.getSettings()
      const channelCount = trackSettings.channelCount ?? 1

      debugLog(`[RNNoise][INFO]: Creating processor with ${channelCount} channels`)

      this.source = audioContext.createMediaStreamSource(new MediaStream([track]))

      this.workletNode = new RnnoiseWorkletNode(audioContext, {
        wasmBinary: wasmBinary,
        maxChannels: channelCount,
      })

      this.destination = audioContext.createMediaStreamDestination()

      this.source.connect(this.workletNode)
      this.workletNode.connect(this.destination)

      const processedTrack = this.destination.stream.getAudioTracks()[0]

      this.processedTrack = processedTrack

      debugLog(`[RNNoise][INFO]: RNNoise processor initialized successfully`)
    } catch (error) {
      debugError("[RNNoise][ERROR]: Failed to initialize RNNoise processor", error)
      throw error
    }
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    debugLog("[RNNoise][INFO]: Restarting RNNoise processor")
    await this.destroy()
    await this.init(opts)
  }

  async destroy(): Promise<void> {
    debugLog("[RNNoise][INFO]: Destroying RNNoise processor")

    this.source?.disconnect()
    this.source = undefined

    this.workletNode?.disconnect()
    if (this.workletNode && "destroy" in this.workletNode) {
      (this.workletNode as unknown as { destroy: () => void }).destroy()
    }
    this.workletNode = undefined

    this.destination?.disconnect()
    this.destination = undefined

    this.processedTrack = undefined

    debugLog("[RNNoise][INFO]: RNNoise processor destroyed")
  }
}

export function createRNNoiseProcessor(): RNNoiseProcessor {
  return new RNNoiseProcessor()
}
