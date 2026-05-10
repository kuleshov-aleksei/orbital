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
  const isCameraEnabled = ref(false)
  const wasMutedBeforeDeafen = ref(false)
  const watchingUserIds = ref<Set<string>>(new Set())

  let unsubscribeFnRef: ((userId: string) => Promise<void>) | null = null

  function setUnsubscribeFn(fn: (userId: string) => Promise<void>) {
    unsubscribeFnRef = fn
  }

  function registerStopWatchingHandler() {
    return () => {
      if (unsubscribeFnRef) {
        const ids = Array.from(watchingUserIds.value)
        for (const id of ids) {
          unsubscribeFnRef(id)
        }
      }
    }
  }

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
    if (deafened) {
      wasMutedBeforeDeafen.value = isMuted.value
      if (!isMuted.value) {
        isMuted.value = true
      }
    } else {
      if (!wasMutedBeforeDeafen.value) {
        isMuted.value = false
      }
    }
    isDeafened.value = deafened
  }

  function setScreenSharing(sharing: boolean) {
    isScreenSharing.value = sharing
  }

  function setCameraEnabled(enabled: boolean) {
    isCameraEnabled.value = enabled
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

  function toggleCamera() {
    isCameraEnabled.value = !isCameraEnabled.value
  }

  function setWatchingUsers(userIds: Set<string>) {
    watchingUserIds.value = userIds
  }

  async function stopWatchingAll(unsubscribeFn: (userId: string) => Promise<void>) {
    const ids = Array.from(watchingUserIds.value)
    for (const id of ids) {
      await unsubscribeFn(id)
    }
  }

  async function triggerStopWatching() {
    if (unsubscribeFnRef) {
      const ids = Array.from(watchingUserIds.value)
      for (const id of ids) {
        await unsubscribeFnRef(id)
      }
    }
  }

  function resetCallState() {
    isMuted.value = false
    isDeafened.value = false
    isScreenSharing.value = false
    isCameraEnabled.value = false
    watchingUserIds.value = new Set()
  }

  return {
    isMuted,
    isDeafened,
    isScreenSharing,
    isCameraEnabled,
    watchingUserIds,
    setMuted,
    setDeafened,
    setScreenSharing,
    setCameraEnabled,
    setWatchingUsers,
    setUnsubscribeFn,
    registerStopWatchingHandler,
    triggerStopWatching,
    stopWatchingAll,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    toggleCamera,
    resetCallState,
  }
})
