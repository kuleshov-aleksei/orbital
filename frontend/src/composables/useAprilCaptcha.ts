import { useAprilStore } from "@/stores/april"

export function useAprilCaptcha() {
  const aprilStore = useAprilStore()

  /**
   * Show a captcha for the given action type.
   * Call this when user attempts an action that should be protected by captcha.
   * Optional callback is executed after successful captcha completion.
   */
  function showForAction(
    actionType:
      | "join"
      | "theme"
      | "settings"
      | "mute"
      | "leave"
      | "volume"
      | "video"
      | "screenshare",
    callback?: () => void,
  ): void {
    aprilStore.activateCaptcha(actionType, callback)
  }

  /**
   * Check if current action is blocked by active captcha.
   */
  function isBlocked(): boolean {
    return !!aprilStore.isCaptchaActive
  }

  /**
   * Get the current captcha type (if any).
   */
  function getCurrentType(): string | null {
    return aprilStore.currentType || null
  }

  /**
   * Manual trigger for testing/debugging.
   */
  function manualTrigger(type: string): void {
    aprilStore.activateCaptcha(type as any)
  }

  return {
    showForAction,
    isBlocked,
    getCurrentType,
    manualTrigger,
  }
}
