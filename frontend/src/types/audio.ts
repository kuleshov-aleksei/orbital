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

/**
 * Sound pack types for UI audio customization
 */
export interface SoundPackInfo {
  id: string
  name: string
  description: string
}

export interface SoundPackSprite {
  name: string
  start: number // milliseconds
  duration: number // milliseconds
}

export interface SoundPack {
  id: string
  name: string
  description: string
  sprites: Record<string, SoundPackSprite>
}

export interface UserSoundPackPreference {
  userId: string
  soundPack: string
}

export interface SoundPackOverride {
  userId: string
  useDefault: boolean // true = use default, false = use user's preference
}

/**
 * Available sound events that can be played
 */
export type SoundEvent =
  | 'toggle_on'
  | 'toggle_off'
  | 'join_room'
  | 'leave_room'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'camera_start'
  | 'camera_stop'
  | 'screenshare_start'
  | 'screenshare_stop'

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
}

/** Local storage key for audio settings */
export const AUDIO_SETTINGS_STORAGE_KEY = "orbital_audio_settings"

/** Local storage key for user volume preferences */
export const USER_VOLUMES_STORAGE_KEY = "orbital_user_volumes"

/** Local storage key for sound pack preferences */
export const SOUND_PACK_STORAGE_KEY = "orbital_sound_pack"

/** Local storage key for sound pack overrides */
export const SOUND_PACK_OVERRIDES_KEY = "orbital_sound_pack_overrides"

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
