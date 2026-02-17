import { defineStore } from "pinia"
import { ref, computed } from "vue"

const DEBUG_LOGS_STORAGE_KEY = "orbital_debug_logs_enabled"

export const useDebugSettingsStore = defineStore("debugSettings", () => {
  // State
  const debugLogsEnabled = ref(false)
  const isLoaded = ref(false)

  // Getters
  const isDebugLogsEnabled = computed(() => debugLogsEnabled.value)

  /**
   * Load settings from localStorage
   */
  const loadSettings = (): void => {
    if (typeof window === "undefined") return

    try {
      const stored = localStorage.getItem(DEBUG_LOGS_STORAGE_KEY)
      if (stored !== null) {
        debugLogsEnabled.value = stored === "true"
      }
      isLoaded.value = true
    } catch (e) {
      console.warn("Failed to load debug settings from localStorage:", e)
    }
  }

  /**
   * Save settings to localStorage
   */
  const saveSettings = (): void => {
    if (typeof window === "undefined") return

    try {
      localStorage.setItem(DEBUG_LOGS_STORAGE_KEY, String(debugLogsEnabled.value))
    } catch (e) {
      console.warn("Failed to save debug settings to localStorage:", e)
    }
  }

  /**
   * Toggle debug logs on/off
   */
  const toggleDebugLogs = (enabled: boolean): void => {
    debugLogsEnabled.value = enabled
    saveSettings()
  }

  // Load settings immediately
  loadSettings()

  return {
    // State
    debugLogsEnabled,
    isLoaded,

    // Getters
    isDebugLogsEnabled,

    // Actions
    toggleDebugLogs,
    loadSettings,
    saveSettings,
  }
})
