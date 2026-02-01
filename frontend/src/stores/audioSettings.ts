import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  AudioSettings,
  NoiseSuppressionAlgorithm,
  AudioAlgorithmInfo
} from '@/types/audio'
import {
  defaultAudioSettings,
  AUDIO_SETTINGS_STORAGE_KEY,
  availableAlgorithms
} from '@/types/audio'
import { getAudioProcessor } from '@/services/audio'

export const useAudioSettingsStore = defineStore('audioSettings', () => {
  // State
  const settings = ref<AudioSettings>({ ...defaultAudioSettings })
  const isLoaded = ref(false)
  const wasmError = ref<string | null>(null)
  const microphoneSupports48kHz = ref<boolean | null>(null)

  // Getters
  const noiseSuppressionEnabled = computed(() => settings.value.noiseSuppression.enabled)
  const noiseSuppressionAlgorithm = computed(() => settings.value.noiseSuppression.algorithm)
  const echoCancellationEnabled = computed(() => settings.value.echoCancellation)
  const autoGainControlEnabled = computed(() => settings.value.autoGainControl)

  /**
   * Check if current algorithm requires AudioWorklet processing
   */
  const requiresAudioWorklet = computed(() => {
    const processor = getAudioProcessor(settings.value.noiseSuppression.algorithm)
    return processor ? processor.requiresAudioWorklet() : false
  })

  /**
   * Get available noise suppression algorithms
   * Filters out unsupported algorithms based on browser capabilities
   */
  const availableNoiseSuppressionAlgorithms = computed<AudioAlgorithmInfo[]>(() => {
    return availableAlgorithms.map(algo => {
      const support = checkAlgorithmSupportWithReason(algo.id)
      return {
        ...algo,
        isSupported: support.isSupported,
        notSupportedReason: support.reason
      }
    })
  })

  /**
   * Get the currently selected algorithm info
   */
  const currentAlgorithmInfo = computed<AudioAlgorithmInfo | undefined>(() => {
    return availableAlgorithms.find(a => a.id === settings.value.noiseSuppression.algorithm)
  })

  /**
   * Check if RNNoise is available (48kHz supported and WASM ready)
   */
  const isRNNoiseAvailable = computed(() => {
    if (microphoneSupports48kHz.value === null) return true // Still checking
    return microphoneSupports48kHz.value === true && wasmError.value === null
  })

  /**
   * Generate MediaTrackConstraints based on current settings
   */
  const audioConstraints = computed<MediaTrackConstraints | boolean>(() => {
    // Get the processor for the current algorithm
    const processor = getAudioProcessor(settings.value.noiseSuppression.algorithm)

    if (processor && processor.isSupported()) {
      return processor.getConstraints()
    }

    // Fallback constraints
    const constraints: MediaTrackConstraints = {
      noiseSuppression: settings.value.noiseSuppression.enabled && settings.value.noiseSuppression.algorithm === 'browser-native',
      echoCancellation: settings.value.echoCancellation,
      autoGainControl: settings.value.autoGainControl,
      sampleRate: { ideal: settings.value.sampleRate },
      channelCount: { ideal: settings.value.channelCount }
    }

    return constraints
  })

  // Actions

  /**
   * Check if a specific algorithm is supported and return the reason if not
   */
  function checkAlgorithmSupportWithReason(algorithm: NoiseSuppressionAlgorithm): {
    isSupported: boolean
    reason?: string
  } {
    switch (algorithm) {
      case 'browser-native':
      case 'off':
        // Browser native constraints are supported by all modern browsers
        return { isSupported: true }

      case 'rnnoise': {
        // Check WebAssembly support
        if (typeof WebAssembly !== 'object') {
          return { isSupported: false, reason: 'WebAssembly not supported by browser' }
        }
        // Check AudioContext support
        if (typeof AudioContext === 'undefined') {
          return { isSupported: false, reason: 'AudioContext not supported by browser' }
        }
        // Check AudioWorklet support
        if (typeof AudioWorkletNode === 'undefined') {
          return { isSupported: false, reason: 'AudioWorklet not supported by browser' }
        }
        // Check 48kHz support
        if (microphoneSupports48kHz.value === false) {
          return { isSupported: false, reason: 'Microphone doesn\'t support 48kHz sample rate' }
        }
        return { isSupported: true }
      }

      case 'speex': {
        // Check WebAssembly support
        if (typeof WebAssembly !== 'object') {
          return { isSupported: false, reason: 'WebAssembly not supported by browser' }
        }
        // Check AudioContext support
        if (typeof AudioContext === 'undefined') {
          return { isSupported: false, reason: 'AudioContext not supported by browser' }
        }
        // Check AudioWorklet support
        if (typeof AudioWorkletNode === 'undefined') {
          return { isSupported: false, reason: 'AudioWorklet not supported by browser' }
        }
        return { isSupported: true }
      }

      default:
        return { isSupported: false, reason: 'Unknown algorithm' }
    }
  }

  /**
   * Check if the microphone supports 48kHz sample rate
   * This is required for RNNoise
   * Uses a two-step approach: first try ideal, then try exact to determine capability
   */
  async function checkMicrophone48kHzSupport(): Promise<boolean> {
    // Step 1: Try with ideal constraint first (most likely to succeed)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 }
        }
      })

      const track = stream.getAudioTracks()[0]
      const settings = track.getSettings()

      // Clean up
      stream.getTracks().forEach(t => t.stop())

      // Check if we got 48kHz (browsers may not report sampleRate in settings)
      // If we got a stream with ideal 48kHz, we assume it supports it
      // unless we can confirm otherwise
      if (settings.sampleRate === 48000) {
        microphoneSupports48kHz.value = true
        return true
      }

      // If sampleRate is not in settings or different value, 
      // check if it's at least close (some mics report 44100 or 48000)
      if (settings.sampleRate && settings.sampleRate >= 44100) {
        microphoneSupports48kHz.value = true
        return true
      }
    } catch (error) {
      console.log('Ideal 48kHz check failed:', error)
    }

    // Step 2: Try with exact constraint to confirm support
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { exact: 48000 },
          channelCount: { ideal: 1 }
        }
      })

      // If we get here, the microphone supports 48kHz
      stream.getTracks().forEach(t => t.stop())
      microphoneSupports48kHz.value = true
      return true
    } catch (error) {
      // OverconstrainedError means the microphone doesn't support 48kHz
      if (error instanceof Error && error.name === 'OverconstrainedError') {
        console.warn('Microphone does not support 48kHz sample rate (OverconstrainedError)')
      } else {
        console.warn('Could not verify 48kHz support:', error)
      }
      microphoneSupports48kHz.value = false
      return false
    }
  }

  /**
   * Set WASM loading error
   */
  function setWASMError(error: string | null) {
    wasmError.value = error
  }

  /**
   * Clear WASM loading error
   */
  function clearWASMError() {
    wasmError.value = null
  }

  /**
   * Toggle noise suppression on/off
   */
  function toggleNoiseSuppression(enabled: boolean) {
    settings.value.noiseSuppression.enabled = enabled
    saveSettings()
  }

  /**
   * Set noise suppression algorithm
   */
  function setNoiseSuppressionAlgorithm(algorithm: NoiseSuppressionAlgorithm) {
    settings.value.noiseSuppression.algorithm = algorithm
    // If setting to an algorithm that's not "off", ensure enabled is true
    if (algorithm !== 'off') {
      settings.value.noiseSuppression.enabled = true
    }
    // Clear any previous WASM error when switching algorithms
    wasmError.value = null
    saveSettings()
  }

  /**
   * Toggle echo cancellation
   */
  function toggleEchoCancellation(enabled: boolean) {
    settings.value.echoCancellation = enabled
    saveSettings()
  }

  /**
   * Toggle auto gain control
   */
  function toggleAutoGainControl(enabled: boolean) {
    settings.value.autoGainControl = enabled
    saveSettings()
  }

  /**
   * Save settings to localStorage
   */
  function saveSettings() {
    try {
      localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(settings.value))
    } catch (e) {
      console.warn('Failed to save audio settings to localStorage:', e)
    }
  }

  /**
   * Load settings from localStorage
   */
  function loadSettings() {
    try {
      const stored = localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AudioSettings>
        // Merge with defaults to ensure all fields exist
        settings.value = {
          ...defaultAudioSettings,
          ...parsed,
          noiseSuppression: {
            ...defaultAudioSettings.noiseSuppression,
            ...parsed.noiseSuppression
          }
        }
      }
      isLoaded.value = true
    } catch (e) {
      console.warn('Failed to load audio settings from localStorage:', e)
      isLoaded.value = true
    }
  }

  /**
   * Reset settings to defaults
   */
  function resetSettings() {
    settings.value = { ...defaultAudioSettings }
    wasmError.value = null
    saveSettings()
  }

  return {
    // State
    settings,
    isLoaded,
    wasmError,
    microphoneSupports48kHz,

    // Getters
    noiseSuppressionEnabled,
    noiseSuppressionAlgorithm,
    echoCancellationEnabled,
    autoGainControlEnabled,
    availableNoiseSuppressionAlgorithms,
    currentAlgorithmInfo,
    audioConstraints,
    requiresAudioWorklet,
    isRNNoiseAvailable,

    // Actions
    toggleNoiseSuppression,
    setNoiseSuppressionAlgorithm,
    toggleEchoCancellation,
    toggleAutoGainControl,
    loadSettings,
    saveSettings,
    resetSettings,
    checkMicrophone48kHzSupport,
    setWASMError,
    clearWASMError
  }
})
