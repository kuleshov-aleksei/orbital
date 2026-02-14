import { WebNoiseSuppressorProcessor } from "./baseProcessor"
import { loadSpeex, SpeexWorkletNode } from "@sapphi-red/web-noise-suppressor"
import type { NoiseSuppressionAlgorithm } from "@/types/audio"

// Import WASM and Worklet URLs
import speexWasmPath from "@sapphi-red/web-noise-suppressor/speex.wasm?url"
import speexWorkletPath from "@sapphi-red/web-noise-suppressor/speexWorklet.js?url"

// Type assertions for imported URLs
const wasmPath = speexWasmPath as string
const workletPath = speexWorkletPath as string

/**
 * Speex Processor
 * Fast CPU-efficient noise suppression
 */
export class SpeexProcessor extends WebNoiseSuppressorProcessor {
  readonly id = "speex" as NoiseSuppressionAlgorithm
  readonly name = "Speex"
  readonly description = "Fast CPU-efficient noise suppression"
  readonly requiredSampleRate = null

  private async loadWasm(): Promise<void> {
    if (this.wasmBinary || this.isLoading) return

    this.isLoading = true
    this.loadError = null

    try {
      this.wasmBinary = await loadSpeex(
        {
          url: wasmPath,
        },
        { credentials: "same-origin" },
      )
    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error))
      console.error("Failed to load Speex WASM:", error)
      throw this.loadError
    } finally {
      this.isLoading = false
    }
  }

  async processStream(stream: MediaStream): Promise<MediaStream> {
    await this.loadWasm()

    if (!this.wasmBinary) {
      throw new Error("Speex WASM not loaded")
    }

    // Create audio context
    this.audioContext = new AudioContext()

    // Add the worklet module
    await this.audioContext.audioWorklet.addModule(workletPath)

    // Create source from stream
    const source = this.audioContext.createMediaStreamSource(stream)

    // Create Speex worklet node
    this.workletNode = new SpeexWorkletNode(this.audioContext, {
      maxChannels: this.maxChannels,
      wasmBinary: this.wasmBinary,
    })

    // Create destination to get processed stream
    const destination = this.audioContext.createMediaStreamDestination()

    // Connect: source -> speex -> destination
    source.connect(this.workletNode)
    this.workletNode.connect(destination)

    return destination.stream
  }
}

/**
 * Create a new SpeexProcessor instance
 */
export function createSpeexProcessor(): SpeexProcessor {
  return new SpeexProcessor()
}
