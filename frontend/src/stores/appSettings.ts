import { defineStore } from "pinia"
import { ref, computed } from "vue"

const APP_SETTINGS_STORAGE_KEY = "orbital_app_settings"

export interface AppSettings {
  closeToTray: boolean
  hasSelectedCloseBehavior: boolean
}

const defaultSettings: AppSettings = {
  closeToTray: true,
  hasSelectedCloseBehavior: false,
}

export const useAppSettingsStore = defineStore("appSettings", () => {
  const settings = ref<AppSettings>({ ...defaultSettings })
  const isLoaded = ref(false)

  const closeToTray = computed(() => settings.value.closeToTray)
  const hasSelectedCloseBehavior = computed(() => settings.value.hasSelectedCloseBehavior)

  const loadSettings = (): void => {
    if (typeof window === "undefined") return

    try {
      const stored = localStorage.getItem(APP_SETTINGS_STORAGE_KEY)
      if (stored !== null) {
        settings.value = { ...defaultSettings, ...JSON.parse(stored) }
      }
      isLoaded.value = true
    } catch (e) {
      console.warn("Failed to load app settings from localStorage:", e)
      isLoaded.value = true
    }
  }

  const saveSettings = (): void => {
    if (typeof window === "undefined") return

    try {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings.value))
    } catch (e) {
      console.warn("Failed to save app settings to localStorage:", e)
    }
  }

  const setCloseToTray = (value: boolean): void => {
    settings.value.closeToTray = value
    settings.value.hasSelectedCloseBehavior = true
    saveSettings()
  }

  const markCloseBehaviorSelected = (): void => {
    settings.value.hasSelectedCloseBehavior = true
    saveSettings()
  }

  loadSettings()

  return {
    settings,
    isLoaded,
    closeToTray,
    hasSelectedCloseBehavior,
    loadSettings,
    saveSettings,
    setCloseToTray,
    markCloseBehaviorSelected,
  }
})
