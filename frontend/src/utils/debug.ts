import { useDebugSettingsStore } from "@/stores/debugSettings"

/**
 * Conditional debug logging utility.
 * Only logs to console when debugLogsEnabled setting is true.
 * Errors are always logged regardless of the setting.
 */
export function debugLog(message: string, ...optionalParams: unknown[]): void {
  const debugStore = useDebugSettingsStore()
  if (debugStore.isDebugLogsEnabled) {
    console.log(message, ...optionalParams)
  }
}

/**
 * Conditional debug warning utility.
 * Only logs warnings when debugLogsEnabled setting is true.
 */
export function debugWarn(message: string, ...optionalParams: unknown[]): void {
  const debugStore = useDebugSettingsStore()
  if (debugStore.isDebugLogsEnabled) {
    console.warn(message, ...optionalParams)
  }
}

/**
 * Always log errors regardless of debug setting.
 * This is a pass-through to console.error for consistency.
 */
export function debugError(message: string, ...optionalParams: unknown[]): void {
  console.error(message, ...optionalParams)
}
