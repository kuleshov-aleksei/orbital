import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client'
import type { AudioWorkletProcessor, NoiseSuppressionAlgorithm } from '@/types/audio'
import { getAudioWorkletProcessor } from '@/services/audio'

/**
 * LiveKit Audio Processor Wrapper
 * 
 * Adapts our custom AudioWorklet processors (RNNoise, Speex) to LiveKit's
 * TrackProcessor interface. This allows us to use our existing WASM-based
 * noise suppression with LiveKit's SFU architecture.
 * 
 * Usage with LiveKit:
 * ```typescript
 * const localTrack = await createLocalAudioTrack({
 *   processor: createLiveKitAudioProcessor('rnnoise')
 * })
 * ```
 */

export interface LiveKitAudioProcessorOptions {
  /** The noise suppression algorithm to use */
  algorithm: NoiseSuppressionAlgorithm
  /** Optional callback when processing starts */
  onProcessingStart?: () => void
  /** Optional callback when processing stops */
  onProcessingStop?: () => void
  /** Optional callback on errors */
  onError?: (error: Error) => void
}

/**
 * Create a LiveKit TrackProcessor that wraps our AudioWorklet processors
 * 
 * @param algorithm - The noise suppression algorithm ('rnnoise', 'speex', or 'browser-native')
 * @returns A TrackProcessor compatible with LiveKit's LocalTrack.setProcessor()
 */
export function createLiveKitAudioProcessor(
  algorithm: NoiseSuppressionAlgorithm
): TrackProcessor<Audio, AudioProcessorOptions> | null {
  // Only wrap algorithms that use AudioWorklet processing
  if (algorithm !== 'rnnoise' && algorithm !== 'speex') {
    return null
  }

  return new LiveKitAudioWorkletProcessor(algorithm)
}

/**
 * LiveKit TrackProcessor implementation that wraps our AudioWorklet processors
 */
class LiveKitAudioWorkletProcessor implements TrackProcessor<Audio, AudioProcessorOptions> {
  readonly name: string

  private algorithm: NoiseSuppressionAlgorithm
  private workletProcessor: AudioWorkletProcessor | null = null
  private processedTrack: MediaStreamTrack | undefined
  private options: AudioProcessorOptions | null = null
  private isInitialized = false

  constructor(algorithm: NoiseSuppressionAlgorithm) {
    this.algorithm = algorithm
    this.name = `orbital-${algorithm}`
  }

  /**
   * Initialize the processor with LiveKit's AudioProcessorOptions
   */
  init(options: AudioProcessorOptions): Promise<void> {
    if (this.isInitialized) {
      console.warn(`[LiveKitAudioProcessor] Already initialized for ${this.algorithm}`)
      return Promise.resolve()
    }

    try {
      // Get the AudioWorklet processor for this algorithm
      this.workletProcessor = getAudioWorkletProcessor(this.algorithm)

      if (!this.workletProcessor) {
        throw new Error(`AudioWorklet processor not found for algorithm: ${this.algorithm}`)
      }

      // Store options for later use
      this.options = options

      this.isInitialized = true
      console.log(`[LiveKitAudioProcessor] Initialized ${this.algorithm} processor`)
      return Promise.resolve()
    } catch (error) {
      console.error(`[LiveKitAudioProcessor] Failed to initialize ${this.algorithm}:`, error)
      if (error instanceof Error) {
        return Promise.reject(error)
      }
      return Promise.reject(new Error(String(error)))
    }
  }

  /**
   * Process the audio track through AudioWorklet
   * This is called by LiveKit when the track is published
   */
  async restart(options: AudioProcessorOptions): Promise<void> {
    // Destroy current processor and reinitialize
    await this.destroy()
    await this.init(options)
  }

  /**
   * Clean up resources when the track is unpublished
   */
  destroy(): Promise<void> {
    try {
      if (this.workletProcessor) {
        this.workletProcessor.dispose()
        this.workletProcessor = null
      }
      this.processedTrack = undefined
      this.isInitialized = false
      this.options = null
      console.log(`[LiveKitAudioProcessor] Destroyed ${this.algorithm} processor`)
      return Promise.resolve()
    } catch (error) {
      console.error(`[LiveKitAudioProcessor] Error during destroy:`, error)
      return Promise.resolve()
    }
  }

  /**
   * Process a MediaStream through the AudioWorklet
   * This method is called internally when LiveKit publishes a track
   */
  async processStream(stream: MediaStream): Promise<MediaStream> {
    if (!this.workletProcessor) {
      throw new Error('Processor not initialized. Call init() first.')
    }

    try {
      const processedStream = await this.workletProcessor.processStream(stream)
      
      // Store reference to the processed audio track
      const audioTrack = processedStream.getAudioTracks()[0]
      if (audioTrack) {
        this.processedTrack = audioTrack
      }

      return processedStream
    } catch (error) {
      console.error(`[LiveKitAudioProcessor] Failed to process stream:`, error)
      throw error
    }
  }

  /**
   * Check if the processor is ready to process audio
   */
  isReady(): boolean {
    return this.workletProcessor?.isReady() ?? false
  }

  /**
   * Get the processed track (if available)
   */
  get processedTrackValue(): MediaStreamTrack | undefined {
    return this.processedTrack
  }
}

/**
 * LiveKit Native Audio Processor
 * 
 * Uses LiveKit's built-in noise suppression instead of custom AudioWorklet.
 * This is a simple processor that just passes through the track but signals
 * to LiveKit that native processing should be used.
 */
export class LiveKitNativeProcessor {
  readonly id = 'livekit-native' as const
  readonly name = 'LiveKit Native'
  readonly description = 'Built-in LiveKit noise suppression (SFU-optimized, low latency)'

  /**
   * Check if LiveKit is available (always true if this code runs)
   */
  isSupported(): boolean {
    // LiveKit native processing is always supported when using LiveKit
    // It runs server-side in the SFU, so no client-side requirements
    return true
  }

  /**
   * Get MediaTrackConstraints for LiveKit native processing
   * Disables browser-native noise suppression since LiveKit handles it
   */
  getConstraints(): MediaTrackConstraints {
    return {
      noiseSuppression: false, // Disable browser NS, use LiveKit's instead
      echoCancellation: true,
      autoGainControl: true
    }
  }

  /**
   * LiveKit native processing doesn't require AudioWorklet
   */
  requiresAudioWorklet(): boolean {
    return false
  }
}

/**
 * Factory function to create LiveKit native processor instance
 */
export function createLiveKitNativeProcessor(): LiveKitNativeProcessor {
  return new LiveKitNativeProcessor()
}

/**
 * Check if a specific algorithm can be used with LiveKit
 * 
 * @param algorithm - The noise suppression algorithm
 * @returns true if the algorithm can be used with LiveKit
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isAlgorithmCompatibleWithLiveKit(algorithm: NoiseSuppressionAlgorithm): boolean {
  // All algorithms are compatible with LiveKit:
  // - 'livekit-native': Uses LiveKit's built-in processing
  // - 'browser-native': Uses browser constraints (LiveKit receives pre-processed audio)
  // - 'rnnoise', 'speex': Wrapped via LiveKitAudioWorkletProcessor
  // - 'off': No processing
  void algorithm // Mark as intentionally used (for API consistency)
  return true
}

/**
 * Get the appropriate audio constraints for publishing to LiveKit
 * 
 * @param algorithm - The selected noise suppression algorithm
 * @returns MediaTrackConstraints to use when creating the audio track
 */
export function getLiveKitAudioConstraints(
  algorithm: NoiseSuppressionAlgorithm
): MediaTrackConstraints {
  switch (algorithm) {
    case 'livekit-native':
      // Use LiveKit's built-in noise suppression
      return {
        noiseSuppression: false, // Let LiveKit handle it
        echoCancellation: true,
        autoGainControl: true
      }
    
    case 'browser-native':
      // Use browser's WebRTC Audio Processing
      return {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true
      }
    
    case 'rnnoise':
      // RNNoise requires 48kHz sample rate
      return {
        noiseSuppression: false, // We'll process via AudioWorklet
        echoCancellation: true,
        autoGainControl: true,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 }
      }
    
    case 'speex':
      // Speex can work with any sample rate
      return {
        noiseSuppression: false, // We'll process via AudioWorklet
        echoCancellation: true,
        autoGainControl: true,
        channelCount: { ideal: 1 }
      }
    
    case 'off':
      // No noise suppression
      return {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: true
      }
    
    default:
      return {
        echoCancellation: true,
        autoGainControl: true
      }
  }
}
