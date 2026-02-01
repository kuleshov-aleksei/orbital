import { WebNoiseSuppressorProcessor } from './baseProcessor'
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import type { NoiseSuppressionAlgorithm } from '@/types/audio'

// Import WASM and Worklet URLs
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'

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
 * Create a new RNNoiseProcessor instance
 */
export function createRNNoiseProcessor(): RNNoiseProcessor {
  return new RNNoiseProcessor()
}
