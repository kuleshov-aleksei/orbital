import type { AudioProcessor } from "@/types/audio"

/**
 * Browser Native Noise Suppression Processor
 * Uses the built-in WebRTC Audio Processing module in browsers
 */
export class BrowserNativeProcessor implements AudioProcessor {
  readonly id = "browser-native"
  readonly name = "Browser Native"
  readonly description = "Built-in browser noise suppression (WebRTC Audio Processing)"

  isSupported(): boolean {
    // Check if the browser supports the constraint
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return false
    }

    // Try to check support using getSupportedConstraints
    try {
      const supportedConstraints = navigator.mediaDevices.getSupportedConstraints()
      return "noiseSuppression" in supportedConstraints
    } catch {
      // Fallback: assume supported in modern browsers
      return true
    }
  }

  getConstraints(): MediaTrackConstraints {
    return {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    }
  }
}

/**
 * Create a BrowserNativeProcessor instance
 */
export function createBrowserNativeProcessor(): BrowserNativeProcessor {
  return new BrowserNativeProcessor()
}
