import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { apiService } from "@/services/api"
import {
  setUserSoundPack,
  getUserSoundPack,
  preloadSoundPacks,
  soundPacks,
  DEFAULT_SOUND_PACK_ID,
} from "@/services/sounds"
import {
  SOUND_PACK_STORAGE_KEY,
  SOUND_PACK_OVERRIDES_KEY,
  SoundPack,
  SoundPackOverride,
} from "@/types/audio"

export const useSoundPackStore = defineStore("soundPack", () => {
  const selectedPackId = ref<string>(DEFAULT_SOUND_PACK_ID)
  const userSoundPacks = ref<Map<string, string>>(new Map())
  const overrides = ref<Map<string, boolean>>(new Map())
  const isLoading = ref(false)

  const availablePacks = computed((): SoundPack[] => {
    return Object.values(soundPacks)
  })

  const currentPack = computed((): SoundPack | undefined => {
    return soundPacks[selectedPackId.value]
  })

  function loadFromStorage(): void {
    const stored = localStorage.getItem(SOUND_PACK_STORAGE_KEY)
    if (stored) {
      selectedPackId.value = stored
      setUserSoundPack(stored)
    }

    const storedOverrides = localStorage.getItem(SOUND_PACK_OVERRIDES_KEY)
    if (storedOverrides) {
      try {
        const parsed = JSON.parse(storedOverrides) as Record<string, boolean>
        overrides.value = new Map(Object.entries(parsed))
      } catch {
        console.error("Failed to parse sound pack overrides from storage")
      }
    }
  }

  function saveToStorage(): void {
    localStorage.setItem(SOUND_PACK_STORAGE_KEY, selectedPackId.value)

    const overridesObj: Record<string, boolean> = {}
    overrides.value.forEach((value, key) => {
      overridesObj[key] = value
    })
    localStorage.setItem(SOUND_PACK_OVERRIDES_KEY, JSON.stringify(overridesObj))
  }

  async function setSelectedPack(packId: string): Promise<void> {
    selectedPackId.value = packId
    setUserSoundPack(packId)
    saveToStorage()

    try {
      await apiService.updateSoundPack(packId)
    } catch (error) {
      console.error("Failed to save sound pack to backend:", error)
    }
  }

  function getUserPack(userId: string): string {
    return userSoundPacks.value.get(userId) || DEFAULT_SOUND_PACK_ID
  }

  function setUserPack(userId: string, packId: string): void {
    userSoundPacks.value.set(userId, packId)
  }

  function getEffectivePack(userId: string): string {
    const override = overrides.value.get(userId)
    if (override === true) {
      return DEFAULT_SOUND_PACK_ID
    }
    return getUserPack(userId)
  }

  function isOverridden(userId: string): boolean {
    return overrides.value.get(userId) === true
  }

  function setOverride(userId: string, useDefault: boolean): void {
    overrides.value.set(userId, useDefault)
    saveToStorage()
  }

  function clearOverride(userId: string): void {
    overrides.value.delete(userId)
    saveToStorage()
  }

  function clearAllOverrides(): void {
    overrides.value.clear()
    saveToStorage()
  }

  async function initialize(): Promise<void> {
    isLoading.value = true
    try {
      preloadSoundPacks()
      loadFromStorage()
    } finally {
      isLoading.value = false
    }
  }

  return {
    selectedPackId,
    userSoundPacks,
    overrides,
    isLoading,
    availablePacks,
    currentPack,
    setSelectedPack,
    getUserPack,
    setUserPack,
    getEffectivePack,
    isOverridden,
    setOverride,
    clearOverride,
    clearAllOverrides,
    initialize,
    loadFromStorage,
  }
})
