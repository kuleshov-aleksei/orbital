import { defineStore } from "pinia"
import { ref, computed } from "vue"

const VIDEO_SETTINGS_STORAGE_KEY = "orbital_video_settings"

export interface VideoDevice {
  deviceId: string
  label: string
}

export interface VideoSettings {
  selectedDeviceId: string | null
  backgroundBlurEnabled: boolean
  backgroundBlurRadius: number
  virtualBackgroundEnabled: boolean
  virtualBackgroundImage: string | null
}

const defaultVideoSettings: VideoSettings = {
  selectedDeviceId: null,
  backgroundBlurEnabled: false,
  backgroundBlurRadius: 10,
  virtualBackgroundEnabled: false,
  virtualBackgroundImage: null,
}

export const useVideoSettingsStore = defineStore("videoSettings", () => {
  const settings = ref<VideoSettings>({ ...defaultVideoSettings })
  const isLoaded = ref(false)
  const availableDevices = ref<VideoDevice[]>([])

  const selectedDeviceId = computed(() => settings.value.selectedDeviceId)
  const backgroundBlurEnabled = computed(() => settings.value.backgroundBlurEnabled)
  const backgroundBlurRadius = computed(() => settings.value.backgroundBlurRadius)
  const virtualBackgroundEnabled = computed(() => settings.value.virtualBackgroundEnabled)
  const virtualBackgroundImage = computed(() => settings.value.virtualBackgroundImage)

  async function enumerateDevices(): Promise<VideoDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
        }))
      availableDevices.value = videoDevices
      return videoDevices
    } catch (e) {
      console.warn("Failed to enumerate video devices:", e)
      return []
    }
  }

  async function requestPermissionsAndEnumerate(): Promise<VideoDevice[]> {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true })
      return await enumerateDevices()
    } catch (e) {
      console.warn("Failed to request camera permissions:", e)
      return await enumerateDevices()
    }
  }

  function setSelectedDeviceId(deviceId: string | null) {
    settings.value.selectedDeviceId = deviceId
    saveSettings()
  }

  function setBackgroundBlurEnabled(enabled: boolean) {
    settings.value.backgroundBlurEnabled = enabled
    if (enabled) {
      settings.value.virtualBackgroundEnabled = false
    }
    saveSettings()
  }

  function setBackgroundBlurRadius(radius: number) {
    settings.value.backgroundBlurRadius = Math.max(1, Math.min(50, radius))
    saveSettings()
  }

  function setVirtualBackgroundEnabled(enabled: boolean) {
    settings.value.virtualBackgroundEnabled = enabled
    if (enabled) {
      settings.value.backgroundBlurEnabled = false
    }
    saveSettings()
  }

  function setVirtualBackgroundImage(image: string | null) {
    settings.value.virtualBackgroundImage = image
    saveSettings()
  }

  function saveSettings() {
    try {
      localStorage.setItem(VIDEO_SETTINGS_STORAGE_KEY, JSON.stringify(settings.value))
    } catch (e) {
      console.warn("Failed to save video settings to localStorage:", e)
    }
  }

  function loadSettings() {
    try {
      const stored = localStorage.getItem(VIDEO_SETTINGS_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<VideoSettings>
        settings.value = {
          ...defaultVideoSettings,
          ...parsed,
        }
      }
      isLoaded.value = true
    } catch (e) {
      console.warn("Failed to load video settings from localStorage:", e)
      isLoaded.value = true
    }
  }

  function resetSettings() {
    settings.value = { ...defaultVideoSettings }
    saveSettings()
  }

  return {
    settings,
    isLoaded,
    availableDevices,
    selectedDeviceId,
    backgroundBlurEnabled,
    backgroundBlurRadius,
    virtualBackgroundEnabled,
    virtualBackgroundImage,
    enumerateDevices,
    requestPermissionsAndEnumerate,
    setSelectedDeviceId,
    setBackgroundBlurEnabled,
    setBackgroundBlurRadius,
    setVirtualBackgroundEnabled,
    setVirtualBackgroundImage,
    loadSettings,
    saveSettings,
    resetSettings,
  }
})
