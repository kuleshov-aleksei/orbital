import type { AudioWorkletProcessor, NoiseSuppressionAlgorithm } from '@/types/audio'
import type { RnnoiseWorkletNode, SpeexWorkletNode } from '@sapphi-red/web-noise-suppressor'

/**
 * Base class for Web Noise Suppressor-based processors
 * Provides common functionality for WASM-based noise suppression algorithms
 */
export abstract class WebNoiseSuppressorProcessor implements AudioWorkletProcessor {
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

  /**
   * Check if the browser supports required APIs (WebAssembly, AudioContext, AudioWorklet)
   */
  isSupported(): boolean {
    return (
      typeof WebAssembly === 'object' &&
      typeof AudioContext !== 'undefined' &&
      typeof MediaStreamAudioSourceNode !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined'
    )
  }

  /**
   * All WASM-based processors require AudioWorklet
   */
  requiresAudioWorklet(): boolean {
    return true
  }

  /**
   * Get MediaTrackConstraints for this algorithm
   * Disables browser-native noise suppression since we're doing it in AudioWorklet
   */
  getConstraints(): MediaTrackConstraints {
    return {
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
      sampleRate: this.requiredSampleRate ? { ideal: this.requiredSampleRate } : undefined,
      channelCount: { ideal: this.maxChannels },
    }
  }

  /**
   * Check if WASM is loaded and ready
   */
  isReady(): boolean {
    return this.wasmBinary !== null && !this.isLoading && this.loadError === null
  }

  /**
   * Abstract method to process a MediaStream through the noise suppressor
   */
  abstract processStream(stream: MediaStream): Promise<MediaStream>

  /**
   * Clean up resources (AudioContext, worklet node, WASM binary)
   */
  dispose(): void {
    if (this.workletNode) {
      if ('destroy' in this.workletNode) {
        this.workletNode.destroy()
      }
      this.workletNode.disconnect()
      this.workletNode = null
    }
    if (this.audioContext) {
      void this.audioContext.close()
      this.audioContext = null
    }
    this.wasmBinary = null
    this.loadError = null
  }

  /**
   * Get any error that occurred during WASM loading
   */
  getError(): Error | null {
    return this.loadError
  }

  /**
   * Clear any stored error
   */
  clearError(): void {
    this.loadError = null
  }
}
