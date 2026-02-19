import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { AudioSettings, NoiseSuppressionAlgorithm, AudioAlgorithmInfo, AudioInputDevice } from "@/types/audio"
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
  const availableInputDevices = ref<AudioInputDevice[]>([])
  const hasDevicePermission = ref<boolean | null>(null)

  // Getters
  const noiseSuppressionEnabled = computed(() => settings.value.noiseSuppression.enabled)
  const noiseSuppressionAlgorithm = computed(() => settings.value.noiseSuppression.algorithm)
  const echoCancellationEnabled = computed(() => settings.value.echoCancellation)
  const autoGainControlEnabled = computed(() => settings.value.autoGainControl)
  const inputDeviceId = computed(() => settings.value.inputDeviceId)
  const microphoneGain = computed(() => settings.value.microphoneGain)

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
   * Set input device ID
   */
  function setInputDevice(deviceId: string) {
    settings.value.inputDeviceId = deviceId
    saveSettings()
  }

  /**
   * Refresh the list of available input devices
   * Returns true if successful, false if permission denied
   */
  async function refreshInputDevices(): Promise<boolean> {
    try {
      // Enumerate devices - this works without permission, but labels will be empty
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices
        .filter((device) =>
          device.kind === "audioinput" &&
          !device.label.toLowerCase().startsWith("monitor")
        )
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}...`,
          isDefault: device.deviceId === "default" || device.deviceId === "",
        }))

      // Check if we got labels (indicates permission was granted)
      const hasLabels = audioInputs.some((d) => !d.label.includes("..."))
      hasDevicePermission.value = hasLabels

      // If no device is selected or selected device is not available, use default
      const currentDevice = settings.value.inputDeviceId
      const deviceExists = audioInputs.some((d) => d.deviceId === currentDevice)
      if (!deviceExists || !currentDevice) {
        // Find the default device or use the first one
        const defaultDevice = audioInputs.find((d) => d.isDefault) || audioInputs[0]
        if (defaultDevice && !currentDevice) {
          settings.value.inputDeviceId = defaultDevice.deviceId
          // Don't save here, let the user explicitly select
        }
      }

      availableInputDevices.value = audioInputs
      return true
    } catch (error) {
      console.warn("Failed to enumerate audio input devices:", error)
      hasDevicePermission.value = false
      return false
    }
  }

  /**
   * Request microphone permission to get device labels
   */
  async function requestDevicePermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Immediately stop the tracks to release the mic
      stream.getTracks().forEach((track) => track.stop())
      // Refresh device list to get labels
      await refreshInputDevices()
      return true
    } catch (error) {
      console.warn("Microphone permission denied:", error)
      hasDevicePermission.value = false
      return false
    }
  }

  /**
   * Toggle auto gain control
   */
  function toggleAutoGainControl(enabled: boolean) {
    settings.value.autoGainControl = enabled
    saveSettings()
  }

  /**
   * Set microphone gain (0.0 to 1.2, representing 0% to 120%)
   */
  function setMicrophoneGain(gain: number) {
    // Clamp gain between 0 and 1.2 (0% to 120%)
    settings.value.microphoneGain = Math.max(0, Math.min(1.2, gain))
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
    availableInputDevices,
    hasDevicePermission,

    // Getters
    noiseSuppressionEnabled,
    noiseSuppressionAlgorithm,
    echoCancellationEnabled,
    autoGainControlEnabled,
    inputDeviceId,
    microphoneGain,
    availableNoiseSuppressionAlgorithms,
    currentAlgorithmInfo,
    audioConstraints,

    // Actions
    toggleNoiseSuppression,
    setNoiseSuppressionAlgorithm,
    toggleEchoCancellation,
    toggleAutoGainControl,
    setInputDevice,
    setMicrophoneGain,
    refreshInputDevices,
    requestDevicePermission,
    loadSettings,
    saveSettings,
    resetSettings,
  }
})
