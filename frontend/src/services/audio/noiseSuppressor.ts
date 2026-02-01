import type { AudioWorkletProcessor, NoiseSuppressionAlgorithm } from '@/types/audio'
import {
  loadRnnoise,
  loadSpeex,
  RnnoiseWorkletNode,
  SpeexWorkletNode,
} from '@sapphi-red/web-noise-suppressor'

// Import WASM and Worklet URLs
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import speexWasmPath from '@sapphi-red/web-noise-suppressor/speex.wasm?url'
import speexWorkletPath from '@sapphi-red/web-noise-suppressor/speexWorklet.js?url'

/**
 * Base class for Web Noise Suppressor-based processors
 */
abstract class WebNoiseSuppressorProcessor implements AudioWorkletProcessor {
  abstract readonly id: NoiseSuppressionAlgorithm
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly requiredSampleRate: number | null

  protected wasmBinary: ArrayBuffer | null = null
  protected audioContext: AudioContext | null = null
  protected workletNode: RnnoiseWorkletNode | SpeexWorkletNode | null = null
  protected isLoading = false
  protected loadError: Error | null = null
  protected maxChannels = 1

  isSupported(): boolean {
    return (
      typeof WebAssembly === 'object' &&
      typeof AudioContext !== 'undefined' &&
      typeof MediaStreamAudioSourceNode !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined'
    )
  }

  requiresAudioWorklet(): boolean {
    return true
  }

  getConstraints(): MediaTrackConstraints {
    // Disable browser-native noise suppression since we're doing it in AudioWorklet
    // Keep echo cancellation enabled as requested
    return {
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
      sampleRate: this.requiredSampleRate ? { ideal: this.requiredSampleRate } : undefined,
      channelCount: { ideal: this.maxChannels },
    }
  }

  isReady(): boolean {
    return this.wasmBinary !== null && !this.isLoading && this.loadError === null
  }

  abstract processStream(stream: MediaStream): Promise<MediaStream>

  dispose(): void {
    if (this.workletNode) {
      if ('destroy' in this.workletNode) {
        this.workletNode.destroy()
      }
      this.workletNode.disconnect()
      this.workletNode = null
    }
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    this.wasmBinary = null
    this.loadError = null
  }

  getError(): Error | null {
    return this.loadError
  }

  clearError(): void {
    this.loadError = null
  }
}

/**
 * RNNoise Processor
 * High-quality ML-based noise suppression, requires 48kHz sample rate
 */
export class RNNoiseProcessor extends WebNoiseSuppressorProcessor {
  readonly id = 'rnnoise' as NoiseSuppressionAlgorithm
  readonly name = 'RNNoise'
  readonly description = 'Machine learning-based noise suppression (high quality, requires 48kHz)'
  readonly requiredSampleRate = 48000

  private async loadWasm(): Promise<void> {
    if (this.wasmBinary || this.isLoading) return

    this.isLoading = true
    this.loadError = null

    try {
      this.wasmBinary = await loadRnnoise(
        {
          url: rnnoiseWasmPath,
          simdUrl: rnnoiseSimdWasmPath,
        },
        { credentials: 'same-origin' }
      )
    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error))
      console.error('Failed to load RNNoise WASM:', error)
      throw this.loadError
    } finally {
      this.isLoading = false
    }
  }

  async processStream(stream: MediaStream): Promise<MediaStream> {
    await this.loadWasm()

    if (!this.wasmBinary) {
      throw new Error('RNNoise WASM not loaded')
    }

    // Create audio context with 48kHz sample rate
    this.audioContext = new AudioContext({
      sampleRate: this.requiredSampleRate,
    })

    // Add the worklet module
    await this.audioContext.audioWorklet.addModule(rnnoiseWorkletPath)

    // Create source from stream
    const source = this.audioContext.createMediaStreamSource(stream)

    // Create RNNoise worklet node
    this.workletNode = new RnnoiseWorkletNode(this.audioContext, {
      maxChannels: this.maxChannels,
      wasmBinary: this.wasmBinary,
    })

    // Create destination to get processed stream
    const destination = this.audioContext.createMediaStreamDestination()

    // Connect: source -> rnnoise -> destination
    source.connect(this.workletNode)
    this.workletNode.connect(destination)

    return destination.stream
  }
}

/**
 * Speex Processor
 * Fast CPU-efficient noise suppression
 */
export class SpeexProcessor extends WebNoiseSuppressorProcessor {
  readonly id = 'speex' as NoiseSuppressionAlgorithm
  readonly name = 'Speex'
  readonly description = 'Fast CPU-efficient noise suppression'
  readonly requiredSampleRate = null

  private async loadWasm(): Promise<void> {
    if (this.wasmBinary || this.isLoading) return

    this.isLoading = true
    this.loadError = null

    try {
      this.wasmBinary = await loadSpeex(
        {
          url: speexWasmPath,
        },
        { credentials: 'same-origin' }
      )
    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error))
      console.error('Failed to load Speex WASM:', error)
      throw this.loadError
    } finally {
      this.isLoading = false
    }
  }

  async processStream(stream: MediaStream): Promise<MediaStream> {
    await this.loadWasm()

    if (!this.wasmBinary) {
      throw new Error('Speex WASM not loaded')
    }

    // Create audio context
    this.audioContext = new AudioContext()

    // Add the worklet module
    await this.audioContext.audioWorklet.addModule(speexWorkletPath)

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
 * Create processor instances
 */
export function createRNNoiseProcessor(): RNNoiseProcessor {
  return new RNNoiseProcessor()
}

export function createSpeexProcessor(): SpeexProcessor {
  return new SpeexProcessor()
}
