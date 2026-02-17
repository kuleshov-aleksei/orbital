import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { AudioSettings, NoiseSuppressionAlgorithm, AudioAlgorithmInfo } from "@/types/audio"
import {
  defaultAudioSettings,
  AUDIO_SETTINGS_STORAGE_KEY,
  availableAlgorithms,
} from "@/types/audio"
import { getAudioProcessor } from "@/services/audio"

export const useAudioSettingsStore = defineStore("audioSettings", () => {
  // State
  const settings = ref<AudioSettings>({ ...defaultAudioSettings })
  const isLoaded = ref(false)

  // Getters
  const noiseSuppressionEnabled = computed(() => settings.value.noiseSuppression.enabled)
  const noiseSuppressionAlgorithm = computed(() => settings.value.noiseSuppression.algorithm)
  const echoCancellationEnabled = computed(() => settings.value.echoCancellation)
  const autoGainControlEnabled = computed(() => settings.value.autoGainControl)

  /**
   * Get available noise suppression algorithms
   * All algorithms are supported by modern browsers
   */
  const availableNoiseSuppressionAlgorithms = computed<AudioAlgorithmInfo[]>(() => {
    return availableAlgorithms.map((algo) => {
      const support = checkAlgorithmSupportWithReason(algo.id)
      return {
        ...algo,
        isSupported: support.isSupported,
        notSupportedReason: support.reason,
      }
    })
  })

  /**
   * Get the currently selected algorithm info
   */
  const currentAlgorithmInfo = computed<AudioAlgorithmInfo | undefined>(() => {
    return availableAlgorithms.find((a) => a.id === settings.value.noiseSuppression.algorithm)
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
      noiseSuppression:
        settings.value.noiseSuppression.enabled &&
        settings.value.noiseSuppression.algorithm === "browser-native",
      echoCancellation: settings.value.echoCancellation,
      autoGainControl: settings.value.autoGainControl,
      sampleRate: { ideal: settings.value.sampleRate },
      channelCount: { ideal: settings.value.channelCount },
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
      case "browser-native":
      case "off":
      case "livekit-native":
        // All modern browsers support these options
        return { isSupported: true }

      default:
        return { isSupported: false, reason: "Unknown algorithm" }
    }
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
    if (algorithm !== "off") {
      settings.value.noiseSuppression.enabled = true
    }
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
      console.warn("Failed to save audio settings to localStorage:", e)
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
            ...parsed.noiseSuppression,
          },
        }
      }
      isLoaded.value = true
    } catch (e) {
      console.warn("Failed to load audio settings from localStorage:", e)
      isLoaded.value = true
    }
  }

  /**
   * Reset settings to defaults
   */
  function resetSettings() {
    settings.value = { ...defaultAudioSettings }
    saveSettings()
  }

  return {
    // State
    settings,
    isLoaded,

    // Getters
    noiseSuppressionEnabled,
    noiseSuppressionAlgorithm,
    echoCancellationEnabled,
    autoGainControlEnabled,
    availableNoiseSuppressionAlgorithms,
    currentAlgorithmInfo,
    audioConstraints,

    // Actions
    toggleNoiseSuppression,
    setNoiseSuppressionAlgorithm,
    toggleEchoCancellation,
    toggleAutoGainControl,
    loadSettings,
    saveSettings,
    resetSettings,
  }
})
