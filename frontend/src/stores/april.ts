import { defineStore } from "pinia"
import { ref, computed } from "vue"

export type CaptchaType =
  | "join"
  | "theme"
  | "settings"
  | "mute"
  | "leave"
  | "volume"
  | "video"
  | "screenshare"

export interface CaptchaOption {
  id: string
  message: string
}

export const useAprilStore = defineStore("april", () => {
  // State
  const isActive = ref(false)
  const currentType = ref<CaptchaType | null>(null)

  // Pending callback to execute after captcha completion
  let pendingCallback: (() => void) | null = null

  // Getters
  const isCaptchaActive = computed(() => isActive.value)

  // Actions
  function activateCaptcha(type: CaptchaType, callback?: () => void): void {
    currentType.value = type
    isActive.value = true
    pendingCallback = callback || null
  }

  function completeCaptcha(): void {
    // Execute pending callback if exists
    if (pendingCallback) {
      const callback = pendingCallback
      pendingCallback = null
      callback()
    }

    isActive.value = false
    currentType.value = null
  }

  function deactivateCaptcha(): void {
    isActive.value = false
    currentType.value = null
    pendingCallback = null
  }

  function resetAfterCompletion(): void {
    isActive.value = false
    currentType.value = null
  }

  return {
    isActive,
    isCaptchaActive,
    currentType,

    activateCaptcha,
    deactivateCaptcha,
    completeCaptcha,
    resetAfterCompletion,
  }
})
