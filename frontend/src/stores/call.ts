import { defineStore } from "pinia"
import { ref, watch } from "vue"

// Local storage keys
const MUTE_STORAGE_KEY = "orbital_mic_muted"
const DEAFEN_STORAGE_KEY = "orbital_deafened"

// Helper functions for localStorage
const saveToStorage = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn("Failed to save preference to localStorage:", e)
  }
}

const loadFromStorage = (key: string, defaultValue: boolean): boolean => {
  try {
    const stored = localStorage.getItem(key)
    return stored !== null ? (JSON.parse(stored) as boolean) : defaultValue
  } catch (e) {
    console.warn("Failed to load preference from localStorage:", e)
    return defaultValue
  }
}

export const useCallStore = defineStore("call", () => {
  // State - initialized from localStorage
  const isMuted = ref(loadFromStorage(MUTE_STORAGE_KEY, false))
  const isDeafened = ref(loadFromStorage(DEAFEN_STORAGE_KEY, false))
  const isScreenSharing = ref(false)

  // Watch for changes and persist to localStorage
  watch(isMuted, (newValue) => {
    saveToStorage(MUTE_STORAGE_KEY, newValue)
  })

  watch(isDeafened, (newValue) => {
    saveToStorage(DEAFEN_STORAGE_KEY, newValue)
  })

  // Actions
  function setMuted(muted: boolean) {
    isMuted.value = muted
  }

  function setDeafened(deafened: boolean) {
    isDeafened.value = deafened
  }

  function setScreenSharing(sharing: boolean) {
    isScreenSharing.value = sharing
  }

  function toggleMute() {
    isMuted.value = !isMuted.value
  }

  function toggleDeafen() {
    isDeafened.value = !isDeafened.value
  }

  function toggleScreenShare() {
    isScreenSharing.value = !isScreenSharing.value
  }

  function resetCallState() {
    isMuted.value = false
    isDeafened.value = false
    isScreenSharing.value = false
  }

  return {
    isMuted,
    isDeafened,
    isScreenSharing,
    setMuted,
    setDeafened,
    setScreenSharing,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    resetCallState,
  }
})
