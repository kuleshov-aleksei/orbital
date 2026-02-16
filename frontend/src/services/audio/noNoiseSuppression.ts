import type { AudioProcessor } from "@/types/audio"

/**
 * No Noise Suppression Audio Processor
 * Returns constraints with noise suppression disabled
 * Used when user selects "Off" for noise suppression
 */
export class NoNoiseSuppressionAudioProcessor implements AudioProcessor {
  readonly id = "off"
  readonly name = "No Noise Suppression"
  readonly description = "No noise suppression applied"

  isSupported(): boolean {
    // Always supported since we just disable noise suppression
    return true
  }

  getConstraints(): MediaTrackConstraints {
    return {
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    }
  }
}

/**
 * Create a NoNoiseSuppressionAudioProcessor instance
 */
export function createNoNoiseSuppressionProcessor(): NoNoiseSuppressionAudioProcessor {
  return new NoNoiseSuppressionAudioProcessor()
}
