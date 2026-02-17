import type { NoiseSuppressionAlgorithm } from "@/types/audio"

/**
 * LiveKit Native Audio Processor
 *
 * Uses LiveKit's built-in noise suppression.
 * This is a simple processor that just provides constraints.
 */
export class LiveKitNativeProcessor {
  readonly id = "livekit-native" as const
  readonly name = "LiveKit Native"
  readonly description = "Built-in LiveKit noise suppression (SFU-optimized, low latency)"

  /**
   * Check if LiveKit is available (always true if this code runs)
   */
  isSupported(): boolean {
    // LiveKit native processing is always supported when using LiveKit
    // It runs server-side in the SFU, so no client-side requirements
    return true
  }

  /**
   * Get MediaTrackConstraints for LiveKit native processing
   * Disables browser-native noise suppression since LiveKit handles it
   */
  getConstraints(): MediaTrackConstraints {
    return {
      noiseSuppression: false, // Disable browser NS, use LiveKit's instead
      echoCancellation: true,
      autoGainControl: true,
    }
  }
}

/**
 * Factory function to create LiveKit native processor instance
 */
export function createLiveKitNativeProcessor(): LiveKitNativeProcessor {
  return new LiveKitNativeProcessor()
}

/**
 * Get the appropriate audio constraints for publishing to LiveKit
 *
 * @param algorithm - The selected noise suppression algorithm
 * @returns MediaTrackConstraints to use when creating the audio track
 */
export function getLiveKitAudioConstraints(
  algorithm: NoiseSuppressionAlgorithm,
): MediaTrackConstraints {
  switch (algorithm) {
    case "livekit-native":
      // Use LiveKit's built-in noise suppression
      return {
        noiseSuppression: false, // Let LiveKit handle it
        echoCancellation: true,
        autoGainControl: true,
      }

    case "browser-native":
      // Use browser's WebRTC Audio Processing
      return {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      }

    case "off":
      // No noise suppression
      return {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: true,
      }

    default:
      return {
        echoCancellation: true,
        autoGainControl: true,
      }
  }
}
