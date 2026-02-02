/**
 * Audio processing types and interfaces for The Orbital
 * Designed to be extensible for different noise suppression algorithms
 */

export type NoiseSuppressionAlgorithm = 'off' | 'browser-native' | 'rnnoise' | 'speex'

export interface NoiseSuppressionConfig {
  enabled: boolean
  algorithm: NoiseSuppressionAlgorithm
}

export interface AudioSettings {
  noiseSuppression: NoiseSuppressionConfig
  echoCancellation: boolean
  autoGainControl: boolean
  sampleRate: number
  channelCount: number
  forceICERelay: boolean // Debug: force TURN relay only
}

export interface AudioAlgorithmInfo {
  id: NoiseSuppressionAlgorithm
  name: string
  description: string
  isSupported: boolean
  isAvailable: boolean // Whether it's implemented
  requiresAudioWorklet: boolean // Whether it uses custom AudioWorklet processing
  sampleRate: number | null // Required sample rate (null if any)
  notSupportedReason?: string // Reason why algorithm is not supported (for UI display)
}

/**
 * Interface for audio processing algorithms
 * Implement this interface to add new noise suppression methods
 */
export interface AudioProcessor {
  /** Unique identifier for the algorithm */
  readonly id: NoiseSuppressionAlgorithm

  /** Display name for the UI */
  readonly name: string

  /** Description of the algorithm */
  readonly description: string

  /** Check if this algorithm is supported by the current browser */
  isSupported(): boolean

  /** Get MediaTrackConstraints for this algorithm */
  getConstraints(): MediaTrackConstraints

  /** Check if this processor requires AudioWorklet processing */
  requiresAudioWorklet(): boolean
}

/**
 * Interface for AudioWorklet-based noise suppressors
 * These processors create a processed audio stream through AudioWorklet
 */
export interface AudioWorkletProcessor extends AudioProcessor {
  /**
   * Process an audio stream through AudioWorklet
   * Returns a new MediaStream with noise suppression applied
   */
  processStream(stream: MediaStream): Promise<MediaStream>

  /**
   * Check if the WASM module is loaded and ready
   */
  isReady(): boolean

  /**
   * Clean up resources
   */
  dispose(): void
}

/** Default audio settings */
export const defaultAudioSettings: AudioSettings = {
  noiseSuppression: {
    enabled: true,
    algorithm: 'browser-native'
  },
  echoCancellation: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1,
  forceICERelay: false // Debug: disabled by default
}

/** Local storage key for audio settings */
export const AUDIO_SETTINGS_STORAGE_KEY = 'orbital_audio_settings'

/** List of available algorithms with metadata */
export const availableAlgorithms: AudioAlgorithmInfo[] = [
  {
    id: 'browser-native',
    name: 'Browser Native',
    description: 'Built-in browser noise suppression (WebRTC Audio Processing)',
    isSupported: true,
    isAvailable: true,
    requiresAudioWorklet: false,
    sampleRate: null
  },
  {
    id: 'rnnoise',
    name: 'RNNoise',
    description: 'Machine learning-based noise suppression (high quality, requires 48kHz)',
    isSupported: true,
    isAvailable: true,
    requiresAudioWorklet: true,
    sampleRate: 48000
  },
  {
    id: 'speex',
    name: 'Speex',
    description: 'Fast CPU-efficient noise suppression',
    isSupported: true,
    isAvailable: true,
    requiresAudioWorklet: true,
    sampleRate: null
  },
  {
    id: 'off',
    name: 'Off',
    description: 'Disable noise suppression',
    isSupported: true,
    isAvailable: true,
    requiresAudioWorklet: false,
    sampleRate: null
  }
]
