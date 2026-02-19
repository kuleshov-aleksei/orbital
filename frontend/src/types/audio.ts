/**
 * Audio processing types and interfaces for The Orbital
 * Simplified: Only LiveKit native, browser native, and off options
 */

export type NoiseSuppressionAlgorithm = "off" | "browser-native" | "livekit-native"

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
  inputDeviceId: string // Empty string means default device
  microphoneGain: number // 0.0 to 1.2 (0% to 120%)
}

export interface AudioAlgorithmInfo {
  id: NoiseSuppressionAlgorithm
  name: string
  description: string
  isSupported: boolean
  isAvailable: boolean // Whether it's implemented
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
}

/** Default audio settings */
export const defaultAudioSettings: AudioSettings = {
  noiseSuppression: {
    enabled: true,
    algorithm: "livekit-native",
  },
  echoCancellation: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1,
  inputDeviceId: "", // Empty string means default device
  microphoneGain: 1.0, // 100% gain (no boost)
}

/** Audio input device information */
export interface AudioInputDevice {
  deviceId: string
  label: string
  isDefault: boolean
}

/** Local storage key for audio settings */
export const AUDIO_SETTINGS_STORAGE_KEY = "orbital_audio_settings"

/** List of available algorithms with metadata */
export const availableAlgorithms: AudioAlgorithmInfo[] = [
  {
    id: "livekit-native",
    name: "LiveKit Native",
    description: "Built-in LiveKit noise suppression (SFU-optimized, low latency)",
    isSupported: true,
    isAvailable: true,
    sampleRate: null,
  },
  {
    id: "browser-native",
    name: "Browser Native",
    description: "Built-in browser noise suppression (WebRTC Audio Processing)",
    isSupported: true,
    isAvailable: true,
    sampleRate: null,
  },
  {
    id: "off",
    name: "Off",
    description: "Disable noise suppression",
    isSupported: true,
    isAvailable: true,
    sampleRate: null,
  },
]
