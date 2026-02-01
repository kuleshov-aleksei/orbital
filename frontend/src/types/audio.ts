/**
 * Audio processing types and interfaces for The Orbital
 * Designed to be extensible for different noise suppression algorithms
 */

export type NoiseSuppressionAlgorithm = 'off' | 'browser-native' | 'rnnoise'

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
}

export interface AudioAlgorithmInfo {
  id: NoiseSuppressionAlgorithm
  name: string
  description: string
  isSupported: boolean
  isAvailable: boolean // Whether it's implemented (rnnoise = false)
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
  channelCount: 1
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
    isAvailable: true
  },
  {
    id: 'rnnoise',
    name: 'RNNoise',
    description: 'Machine learning-based noise suppression (high quality)',
    isSupported: true,
    isAvailable: false // Coming soon
  },
  {
    id: 'off',
    name: 'Off',
    description: 'Disable noise suppression',
    isSupported: true,
    isAvailable: true
  }
]
